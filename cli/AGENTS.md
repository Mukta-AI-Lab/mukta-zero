# mz-cli — guia para um agente de IA / LLM (primeiro uso)

> **Se você é uma LLM dirigindo este CLI, leia este arquivo antes.** Ele tem o
> essencial de máquina que o `README.md` (voltado a humanos) não consolida: a
> **receita de auth headless**, as **formas exatas de saída `--json`** (capturadas
> de execuções reais), e o **contrato de streams/exit code**. O `README.md`
> cobre a arquitetura e o "como funciona" de cada comando — use-o de referência
> conceitual; use **este** arquivo para operar.

`mz` roda o **Mukta Zero** (agente de engenharia/produtividade da Mukta) como um
usuário Mukta real, sempre sob o **JWT desse usuário** (nunca service-role).
"Mão local, cérebro nuvem": os gates de segurança (cyber-defense, escopo,
sintaxe) rodam **offline** na sua máquina; o raciocínio roda na nuvem.

---

## 0. Invocação canônica

**Não há binário global `mz` neste repositório** (o pacote é `private:true`, sem
`npm link`). Rode todo comando, a partir da raiz do repo, como:

```bash
node mz-cli/src/index.mjs <comando> [args]
```

Nos exemplos abaixo, `mz` é abreviação de `node mz-cli/src/index.mjs`.

> **Backend default = a instância do agente Mukta Zero `api.example.com`** (auth E runtime na mesma
> base, `config.mjs`). NÃO é o app Mukta principal (`<SUPABASE_PROJECT_REF>`), onde o `run-agent-chat` do MZ
> dá 404. Sobrescreva com env `MZ_SUPABASE_URL`/`MZ_RUNTIME_BASE_URL`/`MZ_SUPABASE_ANON_KEY` ou `mz target set`.

---

## 1. Auth headless (o item nº1 para uma LLM)

Três formas, em ordem de aptidão para automação:

### (A) `MZ_ACCESS_TOKEN` — melhor para LLM/CI, zero interação ✅

Exporte um **JWT de usuário vivo (não expirado)** na env var. Todo comando o usa,
**vinculado sob RLS** (RPCs como `get_user_company_ids` agem como esse usuário),
**sem login e sem arquivo de sessão em disco**. O token da env **vence** qualquer
sessão salva.

```bash
MZ_ACCESS_TOKEN="$JWT" node mz-cli/src/index.mjs ask "..." --json
```

Como obter o JWT: (a) faça `login` uma vez (forma B) e leia
`~/.mukta/session.json` → campo `.access_token`; ou (b) gere pelo seu próprio
fluxo Supabase auth (anon key + credenciais do usuário). Opcional:
`MZ_USERNAME` só rotula o contexto.

> Provado E2E: com `session.json` **ausente**, apenas `MZ_ACCESS_TOKEN` resolveu
> company/agent e respondeu.

### (B) `login` com senha via stdin — não-interativo

```bash
printf '<senha>\n' | node mz-cli/src/index.mjs login <user>@local.internal
```

Autentica (anon key + credenciais do usuário) e persiste **só os tokens** em
`~/.mukta/session.json` (modo `0600`; a senha nunca vai a disco/argv/log). Depois
disso, `ask`/`review`/... funcionam sem a env var. Usernames sem `@` viram
`<user>@local.internal`.

### (C) `auth` (device-flow no navegador) — **somente humano** ❌

Abre o navegador e espera aprovação humana. **Uma LLM não consegue completar** —
não use em automação.

---

## 2. Contrato de saída (o que capturar e como decidir)

| Canal | Conteúdo | O que fazer |
|-------|----------|-------------|
| **STDOUT** | O **resultado** (a resposta, ou o objeto JSON com `--json`). | **Capture só isto.** |
| **STDERR** | Chrome/status: prompt de senha, `[estado especialista: ...]`, mensagens de erro humanas. | Não parseie. |
| **exit code** | `0` = sucesso com conteúdo. `≠0` = falha, resposta vazia, ou (review/build) veredito **BLOCKED** / teste não passou. | Gate primário. |

**Com `--json`, o STDOUT é sempre um objeto JSON** — `{"ok":true,...}` no sucesso
ou `{"ok":false,"error":...,"status":...}` na falha. **Prefira gate no campo
`ok`** (o exit code confirma). Sem `--json`, o STDOUT é texto puro.

---

## 3. Referência por comando (input → saída `--json` → exit)

Flags comuns: `--company <id>` e `--agent <id>` (senão auto-resolvidos: única
company do usuário + primeiro agente ativo com modelo válido). O **modelo é
resolvido no servidor** pela SSOT da Mukta Admin (`llm_models` /
`llm_role_defaults`) — o CLI nunca escolhe modelo (exceto no BYOK `--provider`).

### `ask "<prompt>" [--json] [--provider <name>] [--model <m>]`
Pergunta ao agente. Forma `--json` (capturada de execução real, caminho nuvem):

```json
{
  "ok": true,
  "text": "PONG",
  "model": "google/gemma-4-31B-it",
  "provider": "deepinfra",
  "usage": null
}
```

`text` é o campo a consumir. `model`/`provider` refletem a resolução SSOT (podem
vir `null` se o payload não os expuser). Erro sob `--json`:
`{"ok":false,"error":"<msg>","status":<http>}`. Exit `0` sse `text` não vazio.

**Async / tarefas longas (`--async` · `--resume <job_id>` · `--timeout <s>`):** o `ask` SEMPRE roda pelo
caminho async do `mz-async` (submit→poll). O cliente espera até `--timeout` segundos (default ~290). Se o
budget do CLIENTE estoura, o job **NÃO morre** — segue no servidor e o resultado persiste (`mz_jobs`/`mz_messages`);
o CLI devolve `{"ok":false,"error":"job timeout (cliente)","job_id":"…","still_running":true}` e **exit 3**.
Retome depois com `mz ask --resume <job_id>` (só faz poll, sem re-submeter → mesma forma `--json` do sucesso).
Para não bloquear, `--async` submete e devolve `{"ok":true,"async":true,"job_id":"…"}` na hora (exit 0).

**BYOK (`--provider`):** chama um provedor OpenAI-compatível **direto** com sua
chave local (`mz config set-provider`), sem JWT/nuvem. Mesma forma `--json`.

### `review <arquivo> [--json] [--local-only]`
Cyber-gate: **mão local** (assinaturas offline determinísticas, CWE) +
**cérebro nuvem** (revisão semântica). `--local-only` pula a nuvem (não precisa
de login). Forma `--json` (capturada, `--local-only` num arquivo com SQLi):

```json
{
  "filename": ".mz-tmp/sqli-fixture.js",
  "blocked": true,
  "max_severity": "critical",
  "local": {
    "ok": false,
    "blocked": true,
    "verdict": "block",
    "findings": [
      {
        "rule": "sqli_string_build",
        "severity": "block",
        "cwe": "CWE-89",
        "layer": "SAST",
        "line": 2,
        "message": "SQL construído por interpolação/concat em cláusula (CWE-89) — use query parametrizada ($1/?)",
        "snippet": "from users where id = \" + r"
      }
    ],
    "summary": "cyber-gate block: 1 findings (CWE-89)"
  },
  "cloud": { "skipped": true }
}
```

**Exit `≠0` se `blocked:true`** (gate local bloqueou OU nuvem sinalizou
high/critical). `cloud` traz `{skipped:true}` com `--local-only` ou sem sessão.

### `build "<spec>" [--lang py|js] [--test <f>] [--out <f>] [--json] [--allow-exec]`
Gera **1 arquivo completo** → roda o cyber-gate (hard) → se `--test`, **executa**
contra seu teste (oráculo real, sandbox, 10s) com self-repair (até 3 tentativas).
Forma `--json` (capturada, sem `--test`):

```json
{
  "code": "def soma(a: int, b: int) -> int:\n    ...\n    return a + b\n...",
  "filename": "soma.py",
  "entryNote": "Execute com 'python soma.py' ...",
  "review": { "ok": true, "blocked": false, "verdict": "pass", "findings": [], "summary": "cyber-gate pass: nenhum finding" },
  "tested": false,
  "passed": null,
  "attempts": 1
}
```

`code` é o arquivo gerado. `review.blocked:true` ⇒ código **nunca é executado**.
Com `--test`: `tested:true` e `passed:true|false` (o oráculo de execução real, não
auto-relato). Sem `--test`: `tested:false`, `passed:null`. Exit `≠0` se a geração
falhou, o review bloqueou, ou (com `--test`) não passou dentro do orçamento.

### `patch <arquivo> "<mudança>" [--json] [--allow-exec]`
Edita um **arquivo existente** (o que o `build`, reescrita inteira, não cobre).
Pipeline: gera a edição (blocos **SEARCH/REPLACE** determinísticos, ou `git apply`
de um diff no fallback) → aplica → **cyber-gate no resultado** → se bloquear,
**reverte ao original**. **NÃO executa teste** (não há `--test`; o self-repair
dispara só em falha de APLICAÇÃO — SEARCH não bateu / diff não aplica). `--allow-exec`
aqui **não** roda nada — só rebaixa achados exec-related do gate (block→warn).
Aplica mas **não commita** (isso é `mz push`). `--json`:
`{ok,applied,attempts,mode,note?,review?,blockedByReview?,error?}`. Exit `0` se
aplicou e passou no gate; `1` se não aplicou / foi bloqueado+revertido.

### `agent "<task>" [--file <f>]... [--test "<cmd>"] [--max <n>]`
Loop de **auto-edição** no repo local, sob seu JWT: localiza → reescreve arquivo
inteiro → [escopo] → [cyber-gate HARD] → [sintaxe] → aplica → [teste→repair].
**Imprime o `git diff` para revisão humana — nunca commita.** Reset cirúrgico
(`git checkout -- <alvos>`, nunca `git reset --hard`). É orientado a diff, não a
`--json`; o sinal de máquina é o exit code + o diff no STDOUT.

### `config set-provider <name> --key <k> [--base-url <u>] [--model <m>]`
BYOK. `config list-providers` (chaves **mascaradas**) · `config remove-provider
<name>`. Chaves em `~/.mukta/providers.json` (`0600`), nunca impressas.

### Sessão por aba · `whoami` / `logout` / `--session`
O CLI isola cada **aba** por workspace (projeto do cwd) + `--session <id>` opcional.
Abas em projetos diferentes isolam sozinhas; no mesmo projeto, `--session B` cria
uma 2ª identidade. Store em `~/.mukta/sessions/<hash>-<sid>/`.
- `mz whoami [--json]` — quem está logado nesta aba. Exit `≠0` se não logado.
  `--json`: `{ok,logged_in,session,source,user,expires_at}` (source = env|session|legacy).
- `mz logout` — encerra a sessão desta aba. Avisa se `MZ_ACCESS_TOKEN` está no
  ambiente (o logout não remove env vars — faça `unset`).
- Qualquer comando aceita `--session <id>` (ou env `MZ_SESSION`) para isolar a aba.

### `history` — observabilidade dos runs desta aba
Histórico local (como o do shell), por aba, nunca vai ao servidor.
- `mz history [--json]` — últimos 30 runs (id, ts, exit, comando, input, ms).
- `mz history show <id>` — registro completo de um run.
- `mz history sessions [--json]` — todas as abas (label/workspace/updated_at).

### `search` — busca de conteúdo no projeto em uso
- `mz search "<regex>" [--path <dir>] [--fixed] [--max <n>] [--json]`. Motor:
  ripgrep → git grep → walk JS (funciona em projeto arbitrário). `--fixed` = literal;
  `--path` aponta outro projeto sem `cd`. Exit `0` se houve match, `1` se nenhum.
  `--json`: `{ok,query,base,engine,count,matches:[{file,line,text}]}`.

### Orquestração (imprimem progresso humano; sinal = exit code)
- `plan "<objetivo>" [--dry-run] [--approve-privileged]` — decompõe → executa → verifica → replan.
- `loop "<objetivo>" [--until "<cmd>"] [--times <n>] [--interval <s>]` — roda o `plan` em loop até a condição.
- `workflow "<t1>" "<t2>" ... [--concurrency <n>]` — orquestra vários planos/times em paralelo.
- `wake schedule "<obj>" [--at <ISO>] | list | resume <id> | run-due` — agenda/retoma trabalho multi-etapas.

Ações privilegiadas ficam atrás de `--approve-privileged` (gate de segurança).

### `login` / `auth` — autenticar (detalhe em §1)
- `mz login <user> [--session <id>]` — senha via stdin (§1B); persiste a sessão
  **com** refresh_token (renovável). Exit `0` ok / `1` falha. Sem `--json`.
- `mz auth` — device-flow no navegador (**só humano**, §1C): JWT de 24h **sem**
  refresh_token. Não listado no `help`. Sem `--json`.

### `init` — scaffold de persona/memória local
`mz init [--global] [--project]` — cria `.mukta/system.md` + `.mukta/memory/example.md`
no **projeto** (default) ou em `~/.mukta/` (`--global`; `--project` vence se ambos).
**Não-destrutivo** (nunca sobrescreve). Camadas da persona: ground-zero → global →
projeto → memória. Sem `--json`.

### `target` — apontar o CLI para uma instância própria
`mz target <set --url <kong> --key <anon> [--runtime <u>] | show | clear>`. Grava
`~/.mukta/target.json` (**GLOBAL**, não por aba). Precedência: env `MZ_*` > target.json
> hospedado. Após `set`, refaça `mz login` na nova instância; `clear` volta ao
hospedado. Sem `--json`.

### `config` — BYOK (provedores diretos; ver `ask --provider`)
`mz config <set-provider <name> --key <k> [--base-url <u>] [--model <m>] | list-providers | remove-provider <name>>`.
Chaves em `~/.mukta/providers.json` (`0600`), **mascaradas** no list. Providers
conhecidos (deepinfra/nebius/bitdeer) têm base-url embutida; outro nome exige
`--base-url`. Sem `--json`.

### `state` — estados especialistas (persona auto-selecionada no `ask`)
`mz state <create <name> --persona "<regras>" [--desc "<d>"] [--keywords "a,b,c"] [--approve] | list | approve <name>>`.
Um estado **aprovado** entra sozinho no `mz ask` quando suas keywords casam a tarefa
(via `sealedSystem`, herdando as guardas). A governança **rejeita** personas que
tentam desabilitar guardas. Persistido em `~/.mukta/states/`. Sem `--json`.

### `push` — git commit + push (+ PR opcional)
`mz push <branch> -m "<msg>" [--file <f>]... [--pr] [--base <b>] [--allow-default] [--no-push]`.
**OUTWARD** (usa git/gh do usuário). Fail-closed: valida o nome da branch, **nunca
`--force`**, **recusa `main`/`master`** sem `--allow-default`. `--file` escopa o
`git add` (senão `git add -A`); `--pr` abre PR via `gh` (base `--base`, default
`main`); `--no-push` só commita local. Exit `0`/`1`. Sem `--json`.

### `version` / `help`
- `mz version` (= `mz -v` = `mz --version`) — versão do pacote (`package.json`). Sem `--json`.
- `mz help` (= `mz -h` = `mz --help`) — banner + uso de todos em **STDOUT**, exit `0`.
  `mz` **sem comando** → banner + usage em **STDERR**, exit `1`.

---

## 4. Gotchas para uma LLM

1. **Sem binário global.** Sempre `node mz-cli/src/index.mjs ...` (não `mz ...`).
2. **`--json` existe em `ask`/`review`/`build`/`patch`/`search`/`history`/`whoami`.**
   `agent`, a orquestração (`plan`/`loop`/`workflow`/`wake`) e os de setup
   (`login`/`auth`/`config`/`target`/`init`/`state`/`push`/`version`/`help`) **não
   têm `--json`** — leia exit code + STDOUT. (`history show <id>` sempre imprime JSON.)
3. **Uma flag desconhecida solta vira erro de uso** em `ask` (ex.: `mz ask
   --help` → usage + exit 1, não é interpretado como prompt). Passe o prompt
   entre aspas como **um** argumento.
4. **Capture STDOUT e STDERR separados.** Se juntar, o `[estado especialista:
   ...]` (STDERR) contamina o JSON (STDOUT). Ex.: `... --json 2>/dev/null`.
5. **`review`/`build` usam exit `≠0` como veredito** (BLOCKED / teste falhou),
   não como "erro do CLI". Distinga com o `--json` (`blocked`, `passed`).
6. **Token expirado** ⇒ `MZ_ACCESS_TOKEN` é ignorado e o CLI cai para a sessão em
   disco; se também não houver, `ask` responde `Not logged in`. Renove o JWT.
7. **Latência do `ask` é variável** (pipeline assíncrono, dezenas de s a min). Suba `--timeout <s>` se
   precisar esperar mais; se o budget do cliente estourar, o job **segue no servidor** — retome com
   `mz ask --resume <job_id>` (**exit 3** = job vivo, resultado recuperável; NÃO é erro real). Ou submeta
   sem bloquear com `--async` e recupere depois pelo `job_id`.

---

## 5. Lista completa de comandos

`login` · `logout` · `whoami` · `auth` · `ask` · `review` · `build` · `patch` · `agent` · `plan` ·
`loop` · `workflow` · `wake` · `history` · `search` · `config` · `init` · `target` · `state` · `push` ·
`falhas` · `tui`/`chat` · `version`/`-v` · `help`/`-h`

`mz help` imprime o uso de todos (exit 0, STDOUT). `mz init [--global]` cria os
arquivos locais de persona/memória (`.mukta/system.md` + `.mukta/memory/`, estilo
`/init` do Claude Code). `mz target` aponta o CLI para uma instância própria.

### `falhas [--run <id>] [--limit N] [--dias N] [--json]` — log de falhas dos runs

Fonte: RPC `public.mz_falhas(p_limit)` (.107). Inclui `status='failed'`, junta `mz_jobs` e devolve `etapas` (trilha com timestamp), `error_detail` e `error_code` derivado.

```json
{"ok":true,"falhas":[{"run_id":"…","status":"failed","error_code":null,"etapas":[]}],"total":17,
 "cobertura":{"runs":321,"status_failed":17,"com_error_code":0,"com_dod":0,"com_step_id":7,"com_etapas":4},
 "janela_dias":30}
```

⚠️ **Leia `cobertura` ANTES de concluir qualquer coisa de `falhas`.** Com `com_dod: 0`, nenhum run tem veredito de DoD — logo "nenhum passo reprovou" é inafirmável, não verdadeiro. Um agente que ler só o array está tirando conclusão de um acervo que não mede o que ele quer concluir.

- exits: `0` sucesso (com ou sem falhas) · `1` erro de consulta/credencial
- `401` = credencial (rode `mz auth`); `42501` = permissão RLS (credencial válida, conta não enxerga)

### `tui` / `chat` — a janela única (⚠️ **não use por LLM/CI**)

`mz tui`, `mz chat` e `mz` sem argumento abrem a **janela interativa** (abas de
execução, `@` arquivos, `+` anexos, `/` comandos, `Shift+Tab` modo). Ela **exige
TTY em stdin E stdout**; num pipe ou em CI ela **recusa** com exit 1 e a mensagem
`A janela do mz precisa de um terminal interativo (TTY)`.

Isso é proposital e é a garantia que interessa a você, agente: **`mz` sem
argumento continua NÃO-interativo no seu ambiente** — imprime o uso e sai 1,
exatamente como antes. Não existe caminho em que a janela "prenda" um run
headless esperando tecla. Para automação, use os subcomandos com `--json`.

- sem `--json` (é uma interface humana; não há forma de saída estruturada)
- flags: `--mode conversa|plano|agente|auto` (entra já no modo)
- exits: `1` sem TTY · `0` ao sair da janela

Desenho, modos, política de acesso a arquivos e benchmark:
`documentação interna`.
