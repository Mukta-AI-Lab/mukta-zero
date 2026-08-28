# mz-cli

Standalone CLI ("mao local, cerebro nuvem") to run **Mukta Zero** — Mukta's own
engineering/productivity AI agent — as a real Mukta user, under that user's own
JWT. Mukta Zero has its **own identity** (it is NOT the company's marketing/sales
agent) that you customize with local files, the same way Claude Code uses
`CLAUDE.md` + memory.

> **Driving this from an LLM/agent or CI?** See [`AGENTS.md`](./AGENTS.md) — the
> headless-auth recipe (`MZ_ACCESS_TOKEN`), the exact `--json` output shapes, and the
> stdout/stderr + exit-code contract, all with real captured outputs.

```
# Janela única (interativo)
mz                                        # abre a janela
mz tui | mz chat [--mode conversa|plano|agente|auto]

# Autenticação e sessão
mz login <username> [--session <id>]
mz auth
mz logout [--session <id>]
mz whoami [--json] [--session <id>]

# Geração e edição de código
mz ask "<prompt>" [--provider <name>] [--model <m>] [--agent <id>] [--company <id>] [--async|--resume <job_id>] [--timeout <s>] [--json]
mz review <file> [--local-only] [--company <id>] [--agent <id>] [--json]
mz build "<spec>" [--lang py|js] [--test <file>] [--out <file>] [--allow-exec] [--company <id>] [--agent <id>] [--json]
mz patch <arquivo> "<mudança>" [--allow-exec] [--company <id>] [--agent <id>] [--json]
mz agent "<task>" [--file <f>]... [--test "<cmd>"] [--max <n>] [--company <id>] [--agent <id>]

# Orquestração multi-etapas
mz plan "<objetivo>" [--dry-run] [--approve-privileged]
mz loop "<objetivo>" [--until "<cmd>"] [--times <n>] [--interval <s>] [--approve-privileged]
mz workflow "<t1>" "<t2>" ... [--concurrency <n>] [--approve-privileged]
mz wake schedule "<obj>" [--at <ISO>] | list | resume <id> | run-due

# Observabilidade e busca
mz falhas [--run <id>] [--limit N] [--json]
mz history [show <id> | sessions] [--json]
mz search "<regex>" [--path <dir>] [--fixed] [--max <n>] [--json]

# Git, estados e setup
mz push <branch> -m "<msg>" [--file <f>]... [--pr] [--base <b>] [--allow-default] [--no-push]
mz state create <name> --persona "<...>" [--desc <d>] [--keywords "a,b"] [--approve] | list | approve <name>
mz config set-provider <name> --key <k> [--base-url <u>] [--model <m>] | list-providers | remove-provider <name>
mz target set --url <kong> --key <anon> [--runtime <u>] | show | clear
mz init [--global] [--project]

# Meta
mz version, -v, --version
mz help, -h, --help
```

## Referência de comandos

Todos os comandos. `mz` = `node mz-cli/src/index.mjs` (não há binário global — o
pacote é `private:true`). Para agentes/LLMs, veja **[AGENTS.md](./AGENTS.md)** (formas
`--json` reais + contrato de stdout/stderr/exit). O detalhe aprofundado dos principais
está em **How it works** abaixo. Toda aba isola a sessão por workspace (cwd) + `--session
<id>` (ou env `MZ_SESSION`); `MZ_ACCESS_TOKEN` (JWT) tem precedência sobre a sessão em disco.

### Janela única (interativo)
- **`mz`** (sem argumento, num terminal) — abre a **janela**: abas de execução, `@` para arquivos, `+` para anexos, `/` para comandos, `!` para rodar comando, `Shift+Tab` para o modo. Sem TTY (pipe/CI) cai no uso de linha de comando + exit 1, como antes.
- **`tui`** / **`chat`** — a mesma janela, explicitamente. `--mode conversa|plano|agente|auto` já entra num modo. Sem `--json` (é interativo).

**Modos de execução** (`Shift+Tab` cicla; sempre visível na barra de estado). O modo é o que decide o que o agente pode tocar no disco:

| modo | lê | escreve | roda comando | aprovação |
|---|---|---|---|---|
| `conversa` | ✅ | ❌ | ❌ | — |
| `plano` | ✅ | ❌ | ❌ | — |
| `agente` | ✅ | ✅ | ❌ | mostra o diff e pede **s/n** por arquivo |
| `auto` | ✅ | ✅ | ✅ | nenhuma |

Em **todos** os modos, inclusive `auto`: o cyber-gate offline roda **antes** de qualquer byte ir para o disco, o acesso é confinado à raiz do workspace, e há deny-list absoluta (`.env`, `.git/`, chaves, `~/.mukta/sessions/`, `session.json`/`providers.json`/`target.json`) — esses nem entram no índice do `@`.

**Atalhos**

| tecla | efeito |
|---|---|
| `Enter` / `Ctrl+J`, `Alt+Enter` | envia / quebra linha sem enviar |
| `Shift+Tab` | cicla o modo de execução |
| `Ctrl+T` / `Ctrl+W` | abre / fecha aba de execução (até 9) |
| `Alt+1..9`, `Alt+←/→` | troca de aba |
| `@` / `+` / `!` / `/` | arquivo · anexo · comando · paleta |
| `Esc` | fecha o painel, ou cancela o que está rodando |
| `PgUp`/`PgDn`/`End` | rola o transcript |
| `Ctrl+C` ×2 / `Ctrl+D` | sai |

**Abas de execução** — cada aba tem conversa (`session_id`), modo, anexos e transcript próprios, e **um trabalho em voo próprio**. Trocar de aba não pausa nada: o job segue no servidor e a aba pisca (`◐`→`●`) ao terminar. `Esc` para de *esperar*, mas o job continua — a janela devolve o `job_id` para `mz ask --resume <id>`.

Comandos `/` da janela: `/ajuda /limpar /nova /historico /sessoes /quem /entrar /sair` · `/anexar /anexos /desanexar /arquivos /busca /diff` · `/modo /parar /revisar /plano /estados` · `/aba /abas /renomear` · `/provedor /alvo /init /versao`.

Preview do layout sem abrir terminal: `node mz-cli/test/tui-frames.mjs [colunas] [linhas]`.
Benchmark contra os CLIs de mercado e o desenho da janela: `documentação interna`.

### Falhas e observabilidade
- **`falhas [--run <id>] [--limit N] [--dias N] [--json]`** — o **log de falhas** dos runs, espelhando a aba Falhas de `app.example.com` (`#/obs`). Fonte: RPC `public.mz_falhas(p_limit)` na `.107`, que inclui `status='failed'` (o campo canônico), junta o run ao `mz_jobs` e devolve a **trilha de etapas** com timestamp, além de `error_detail` e um `error_code` derivado.
  - ⚠️ A primeira versão filtrava só `error_code not null OR dod_passed=false` e **excluía `status='failed'`** — dizia "nenhuma falha" com 19 runs falhados no banco. Corrigido no FB11.
  - **Sempre imprime a COBERTURA** da instrumentação (`--dias`, default 30): quantos % dos runs têm `dod`, `step_id`, trilha. Instrumentação parcial engana mais que ausente, porque o que aparece parece o todo.
  - `--json` devolve `{ok, falhas[], total, cobertura, janela_dias}`. Exit 0 com ou sem falhas; exit 1 só em erro real.
  - Distingue 401 (credencial) de 42501 (permissão RLS) na mensagem — confundir os dois custa uma tarde.
### Autenticação e sessão
- **`login <user>`** — autentica por senha (lida do stdin, ex.: `printf 'senha' | mz login user`); persiste a sessão (com refresh) em `~/.mukta/sessions/<hash>-<sid>/`. Sem `--json`.
- **`auth`** — alternativa por device-flow no navegador (JWT de 24h, sem refresh); **só para humano** (uma LLM não completa). Sem `--json`.
- **`logout`** — encerra a sessão desta aba (recusa e avisa se `MZ_ACCESS_TOKEN` está no ambiente — dê `unset`). Sem `--json`.
- **`whoami`** — mostra quem está logado nesta aba, sem tocar a rede. `--json`. Exit ≠0 se não logado.

### Geração e edição de código
- **`ask "<prompt>"`** — pergunta ao agente na nuvem (sob o JWT), ou direto a um provider BYOK com `--provider`. `--json` → `{ok,text,model,provider,usage}`. `--model` só vale no BYOK (na nuvem o modelo vem da SSOT do servidor). Tarefas longas: `--timeout <s>` sobe a espera do cliente; `--async` submete e devolve o `job_id` na hora; `--resume <job_id>` retoma um job (exit `3` = estourou o tempo do cliente, mas o job **segue vivo no servidor** e o resultado é recuperável).
- **`review <file>`** — cyber-gate: assinaturas offline (sempre) + revisão semântica na nuvem (pule com `--local-only`). `--json`. Exit ≠0 se **bloqueado**.
- **`build "<spec>"`** — gera 1 arquivo completo → gate (hard) → com `--test`, **executa** contra o teste e auto-repara (até 3×). `--out` grava; `--lang py|js`; `--allow-exec` relaxa só regras de exec do gate. `--json`.
- **`patch <arq> "<mudança>"`** — edita um arquivo **existente** (blocos SEARCH/REPLACE ou diff) → gate no resultado → **reverte se bloquear**. **Não executa teste.** `--allow-exec` aqui só relaxa o gate (não roda nada). `--json`.
- **`agent "<task>"`** — loop de self-edit no repo (localize → gate HARD → aplica → testa → repara); imprime o `git diff` e **não commita**. `--file` (repetível), `--test "<cmd>"`, `--max`. Sem `--json`.

### Orquestração (sinal = exit code; sem `--json`)
- **`plan "<obj>"`** — decompõe → executa → verifica (DoD) → replan (gate HPX, 2 tentativas/passo). `--dry-run` só planeja; `--approve-privileged` libera passos privilegiados.
- **`loop "<obj>"`** — roda o `plan` em loop até `--until "<cmd>"` sair 0 (ou entregar); `--times`, `--interval <s>` (teto de 50 iterações).
- **`workflow "<t1>" "<t2>" ...`** — vários planos/times em paralelo; `--concurrency` (default 4).
- **`wake <schedule|list|resume|run-due>`** — agenda/retoma trabalho multi-etapas (`schedule "<obj>" [--at <ISO>]`, `resume <id>`, `run-due`).

### Observabilidade e busca
- **`history`** — runs desta aba (id, ts, exit, comando, input, ms). `history show <id>` (sempre JSON) · `history sessions` (todas as abas). `--json`.
- **`search "<regex>"`** — busca no projeto (ripgrep → git grep → walk). `--path <dir>` (outro projeto sem `cd`), `--fixed` (literal), `--max`, `--json`. Exit 0 se houve match.

### Git, estados e setup (sem `--json`)
- **`push <branch> -m "<msg>"`** — commit + push (+ `--pr`). Recusa `main`/`master` sem `--allow-default`; **nunca `--force`**. `--file` (repetível), `--base`, `--no-push`.
- **`state <create|list|approve>`** — personas especialistas que entram sozinhas no `ask` quando as `--keywords` casam (após `approve`). Governança anti-burla rejeita personas que tentam desabilitar guardas.
- **`config <set-provider|list-providers|remove-provider>`** — BYOK: chaves locais (`~/.mukta/providers.json`, `0600`, mascaradas). Alimenta `ask --provider`.
- **`target <set|show|clear>`** — aponta o CLI para uma instância própria (global; `--url`/`--key`/`--runtime`). Refaça `login` após `set`.
- **`init`** — scaffold de persona/memória local (`.mukta/system.md` + `memory/`); `--global` faz em `~/.mukta/`; não-destrutivo.

### Meta
- **`version`** (`-v`, `--version`) — versão do pacote.
- **`help`** (`-h`, `--help`) — banner + uso de todos (STDOUT, exit 0). `mz` sem comando → usage no STDERR, exit 1.

## How it works

- `mz login <username>` prompts for a password (input hidden, never echoed),
  authenticates against Supabase auth (`SUPABASE_PUBLISHABLE_KEY` / anon role +
  the user's own credentials — the same pattern as
  `scripts/_companion-harness-lib.mjs`), and persists only the session tokens
  to `~/.mukta/session.json` (mode `0600`).
- `mz ask "<prompt>"` restores that session, resolves the acting
  `company_id` (from the user's own `user_company_memberships`, via RPC
  `get_user_company_ids()`) and `agent_id` (first active
  `agent_profiles` row in that company, unless `--agent` is passed), then
  calls `POST /functions/v1/run-agent-chat` with `Authorization: Bearer
  <user JWT>` and prints the agent's response.
- Usernames without an `@` are normalized to `<username>@local.internal`
  (matches the internal test-account convention).
- `mz review <file>` runs cyber-defense over a local source file, "mao local
  / cerebro nuvem":
  - **Mao local** — `localReview()` runs the vendored, FP-tuned deterministic
    signature gate (`mz-cli/vendor/cyber-gate.mjs`, an esbuild bundle of
    `supabase/functions/_shared/cyber-defense-gate.ts`) fully **offline**: no
    network call, no secrets, deterministic CWE-anchored regex rules (SQLi,
    XSS, command injection, path traversal, SSRF, insecure eval,
    hardcoded-secret entropy, weak crypto, unpinned remote imports). Always
    runs, even with `--local-only` or while logged out.
  - **Cerebro nuvem** — `cloudReview()` calls `run-agent-chat` (same
    user-JWT call path as `mz ask`, including the one-time 401/403 refresh
    retry) with a `system_prompt_override` that turns the company's
    configured agent into a CWE-aware reviewer for that single call. The
    file content becomes the user message (truncated at ~8000 chars, with a
    warning printed if truncated). If the cloud call fails or returns
    non-JSON, the section degrades to raw text instead of erroring out.
    Skipped entirely with `--local-only`, or if the CLI session is missing/
    expired (`mz review` still prints the local section and exits based on
    it alone in that case).
  - `combineReport()` merges both sections; the command exits non-zero if
    the local gate blocked **or** the cloud review flagged anything
    high/critical severity.
- `mz build "<spec>"` — the capstone, "ask -> review -> build": generates a
  single complete file for `<spec>`, then always runs the offline
  cyber-defense gate on it, then (only if it wasn't blocked and `--test` was
  given) actually executes it against your test file to verify it works.
  - **Direct one-shot generation, not planner/executor.** Every generation
    call — the first attempt and every self-repair — asks the agent for one
    complete file in a single call. This is deliberate: splitting codegen
    into a planning stage + an executor stage was measured to *degrade*
    output quality for this class of task versus one-shot generation with
    self-repair against a real test failure.
  - **Review is a hard gate, not a lint pass.** `reviewGenerated()` (the
    same offline `localReview()` used by `mz review`) always runs
    immediately after generation. If it blocks (block/critical severity),
    `mz build` stops there — the generated code is never executed, even if
    `--test` was passed.
  - **`--test <file>` is a real execution oracle, not a self-report.** When
    given, the generated code and a copy of your test file are written into
    an isolated temp directory (auto-deleted afterward) and actually run
    with a 10s timeout: `python -m pytest <test> -q` for `--lang py`
    (falling back to a tiny bootstrap runner that calls the test file's
    `test_*` functions directly if `pytest` isn't installed on the host),
    or `node <test>` for `--lang js`. The child process env has any
    variable whose name matches `TOKEN`/`SECRET`/`KEY`/`PASSWORD`/
    `CREDENTIAL` stripped (defense-in-depth — the offline gate is the
    primary control, not the sandbox; there is no OS-level network
    isolation).
  - **Self-repair, bounded.** If the test fails, `mz build` feeds the
    previous code + the *actual* test output back into another one-shot
    generation call (up to 2 repair attempts, 3 total), asking the model to
    fix the real root cause. If it still fails after that budget, `mz
    build` reports the failure honestly instead of forcing a pass.
  - Without `--test`, `mz build` still runs the review gate and returns the
    generated code, but `tested` stays `false`/`null` — there is no
    execution oracle to confirm correctness in that mode.
  - `--out <file>` writes the generated code to disk; without it, the code
    is printed to stdout (unless `--json`, which includes it in the JSON
    payload instead).
  - Exit code is non-zero if generation failed, the review blocked, or (when
    `--test` was given) the code never passed within the repair budget.
- `mz agent "<task>"` — the **agentic self-edit loop**: localize -> generate a
  whole-file rewrite -> [scope gate] -> [cyber-gate, HARD] -> [syntax gate] ->
  apply -> [test -> repair]*, editing files in the local repo under **your own
  JWT** (same call path as `mz ask` — never service-role). This is how Mukta
  Zero edits its own code.
  - **Localize.** Without `--file`, it extracts 2-3 domain keywords from the
    task and runs `git grep -l` (scoped to `mz-cli/` first, then repo-wide) to
    find candidate targets. Pass `--file <f>` (repeatable) to name them
    explicitly and skip localization.
  - **Cyber-gate before any write.** Every generated file is run through the
    same offline `localReview()` gate as `mz review` *before a single byte is
    written to disk*; if any file in a round is blocked, the whole round is
    discarded (atomic) and the finding is fed back for the next attempt.
  - **Scope + syntax gates.** Any generated path not in the declared target
    list is rejected; `.js/.mjs/.cjs` outputs are `node --check`ed in a temp
    dir before applying.
  - **Reset is surgical.** Each round runs `git checkout -- <targets>` — it
    resets ONLY the target files, NEVER `git reset --hard` (protects other
    uncommitted work in the tree).
  - **`--test "<cmd>"` is a real oracle.** After a passing test, if a
    `mz-cli/src/` file was touched it also runs the `commands-smoke` regression
    guard — a whole-file rewrite that silently drops unrelated code counts as a
    failure and is fed back, not committed.
  - It applies the winning edit and prints the full `git diff` for a
    **human-in-the-loop** review before you commit; it never commits for you.

## Mukta Zero persona (ground zero + local customization)

Mukta Zero has its own base identity ("ground zero" — an engineering/
productivity agent, defined in `src/persona.mjs`), completely separate from the
company's marketing/sales agent. You layer your own rules on top with local
files, exactly like Claude Code's `CLAUDE.md` + memory:

- `~/.mukta/system.md` — **global** system customization (all projects).
- `<cwd>/.mukta/system.md` — **project** system customization (this repo;
  takes precedence over global).
- `~/.mukta/memory/*.md` + `<cwd>/.mukta/memory/*.md` — persistent memory,
  injected as context.

`assembleSystem()` composes them in precedence order (ground-zero -> global ->
project -> memory), and that combined system is what `mz ask` and `mz agent`
send — so Mukta Zero answers as itself, with your customizations, on every
surface (never the company's "Bom dia! ☀️ ... marketing ou vendas?" persona).

`mz init` scaffolds these files (commented templates that guide you), the way
`/init` works in Claude Code. It is **non-destructive** — it never overwrites an
existing file, so your customizations are safe to re-run against. Default is the
project (`.mukta/` in the current dir); `--global` targets `~/.mukta/`.

```bash
mz init                 # create .mukta/system.md + .mukta/memory/ in this project
mz init --global        # create ~/.mukta/system.md + ~/.mukta/memory/
```

## BYOK — bring your own provider keys

By default every command routes through Mukta's cloud agent (`run-agent-chat`,
your JWT). `mz config` lets you instead store OpenAI-compatible **provider keys
locally** and call a provider **directly**, bypassing the cloud entirely:

```bash
mz config set-provider deepinfra --key sk-... --model deepseek-ai/DeepSeek-V4-Pro
mz config set-provider nebius    --key ...    --model Qwen/Qwen3-32B
mz config list-providers          # keys shown MASKED
mz config remove-provider nebius
mz ask "explique este erro" --provider deepinfra   # direct call, no JWT needed
```

- Keys live in `~/.mukta/providers.json` (mode `0600`) and are **never**
  printed — `list-providers` masks them.
- Known providers (`deepinfra`, `nebius`, `bitdeer`) have built-in base URLs;
  any other name requires `--base-url <openai-compatible endpoint>`.
- `mz ask --provider <name>` sends the **same** Mukta Zero persona
  (`assembleSystem()`) as the only system prompt — so the direct path gives you
  a 100%-clean persona (no company prompt is ever prepended). `--model` overrides
  the provider's default model for that call.

## Security

- **JWT only.** The CLI never uses `SUPABASE_SERVICE_ROLE_KEY` and never
  sends `X-Internal-Call` — that header requires a service-role token
  server-side and is intentionally out of reach for this CLI (CLAUDE.md
  Section 2.A: user actions must run under the user's own JWT, never
  service-role).
- Passwords are read via a masked prompt and are **never** written to argv,
  env, disk, or logs.
- `access_token` / `refresh_token` are **never** printed to stdout/stderr;
  they are only written to `~/.mukta/session.json` (`0600`, best-effort on
  Windows/NTFS).
- On a 401/403 from `run-agent-chat`, the CLI refreshes the session once and
  retries a single time before failing.
- **BYOK provider keys** (`~/.mukta/providers.json`, `0600`) are never printed
  to stdout/stderr and never sent anywhere except, as a `Bearer` token, to the
  provider's own OpenAI-compatible endpoint you configured. `list-providers`
  shows them masked.
- **`mz agent` writes to disk only behind the offline cyber-gate**, applies to
  the declared target files only, resets surgically (never `git reset --hard`),
  and always hands the diff to a human before commit — it never commits.

## Files

- `src/config.mjs` — URLs / anon key. **Default = a instância do agente Mukta Zero `api.example.com`** (auth+runtime), não o app principal (`<SUPABASE_PROJECT_REF>`, onde o `run-agent-chat` do MZ dá 404). Tudo overridable via `MZ_*` env vars ou `mz target set`.
- `src/auth.mjs` — login, session persistence/restore, refresh.
- `src/api.mjs` — `resolveCompany`, `resolveAgent`, `askAgent` (calls
  `run-agent-chat`), response-text extraction.
- `src/review.mjs` — `localReview` (offline signature gate), `cloudReview`
  (semantic review via `run-agent-chat` + `system_prompt_override`),
  `combineReport` (merges both into one report/verdict), `extractJson`
  (tolerant JSON-from-agent-reply parser, reused by `src/build.mjs`).
- `src/build.mjs` — `generateCode` (direct one-shot codegen call via
  `run-agent-chat` + `system_prompt_override`), `reviewGenerated` (wraps
  `localReview` as the hard pre-execution gate), `runTest` (sandboxed local
  execution oracle: isolated temp dir, 10s timeout, stripped env), and
  `buildLoop` (the generate -> review -> test -> self-repair pipeline behind
  `mz build`).
- `src/agent.mjs` — `agentLoop` (the `mz agent` self-edit loop: localize ->
  generate -> cyber/scope/syntax gates -> apply -> test -> repair, all under the
  user's JWT), plus `localize` / `extractKeywords` / `generateEdits`.
- `src/persona.mjs` — `MZ_GROUND_ZERO` (Mukta Zero's base identity) and
  `assembleSystem()` (layers ground-zero + `~/.mukta` + `.mukta` system/memory);
  `personaPaths()` for `mz init`.
- `src/providers.mjs` — BYOK provider store (`~/.mukta/providers.json`, `0600`):
  `setProvider` / `getProvider` / `listProviders` (masked) / `removeProvider`.
- `src/llm-direct.mjs` — `callDirect()`: OpenAI-compatible
  `POST {base_url}/chat/completions` (Bearer the user's key, 90s timeout, one
  retry on 429/5xx); the key is never logged.
- `src/index.mjs` — CLI entry point + roteamento de TODOS os comandos: `login`,
  `logout`, `whoami`, `auth`, `ask`, `review`, `build`, `patch`, `agent`, `plan`,
  `loop`, `workflow`, `wake`, `history`, `search`, `config`, `init`, `target`,
  `state`, `push`, `version`, `help`. Ver a **Referência de comandos** acima.
- `vendor/cyber-gate.mjs` — **generated**, esbuild bundle of
  `supabase/functions/_shared/cyber-defense-gate.ts`. Do not hand-edit;
  regenerate with `node mz-cli/scripts/build-gate.mjs` after the shared gate
  changes.
- `scripts/build-gate.mjs` — the esbuild script that (re)generates
  `vendor/cyber-gate.mjs`.
- `test/e2e.mjs` — real, non-mocked E2E oracle for `login`/`ask` (login,
  company/agent resolution, a real agent call, and a negative
  no-auth-> 401 check).
- `test/e2e-review.mjs` — real, non-mocked E2E oracle for `review`: two
  deterministic local assertions (SQLi fixture blocked, clean fixture not
  blocked) plus a best-effort cloud assertion (HTTP 200 + non-empty body;
  SKIP, not FAIL, if no session/backend is available).
- `test/e2e-build.mjs` — real, non-mocked E2E oracle for `build`: an easy
  spec run through `buildLoop()` with a real pytest file (asserts the
  review didn't block AND the generated code actually passed the test when
  executed — the real execution oracle, not the model's self-report), a
  deterministic review-gate assertion (known SQLi snippet -> `blocked`),
  and a no-`--test` build (non-empty code + review ran).
- `test/e2e-cli.mjs` — E2E of the **real CLI path** (the `node index.mjs`
  binary, not the core functions): `mz version` / `mz help` / piped `mz login`
  -> session persists -> `mz ask` via `restoreClient`. This is the layer that
  would have caught the it.21 bug where a whole-file self-edit dropped the
  `agent` command's routing without any test failing.
- `test/e2e-agent.mjs` — E2E of `agentLoop` (self-edit under the user's JWT):
  cyber-gate blocks a malicious edit before write; a benign edit applies + its
  test passes.
- `test/e2e-config.mjs` — E2E of BYOK `mz config` (set/persist/mask/remove +
  a real bad-key direct call returning 401 from the provider).
- `test/commands-smoke.mjs`, `test/persona-check.mjs`, `test/init-check.mjs`,
  `test/help-check.mjs`, `test/version-check.mjs`, `test/v-alias-check.mjs`,
  `test/login-stdin-check.mjs` — fast **offline** oracles (no network): command
  routing/regression guard, persona layering (ground-zero + local files),
  `mz init` scaffold + non-destructiveness, and the version/help/alias/login-
  stdin invariants.

## Manual usage

From the repo root (`<REPO_ROOT>`):

```bash
node mz-cli/src/index.mjs login <username>
node mz-cli/src/index.mjs ask "Qual o status da fila?"
node mz-cli/src/index.mjs review src/lib/some-file.ts
node mz-cli/src/index.mjs review src/lib/some-file.ts --local-only --json
node mz-cli/src/index.mjs build "soma dos numeros pares de uma lista" --lang py --test test_solution.py --out solution.py
node mz-cli/src/index.mjs agent "adicione um alias -v para version" --file mz-cli/src/index.mjs --test "node mz-cli/test/version-check.mjs"
node mz-cli/src/index.mjs init
node mz-cli/src/index.mjs config set-provider deepinfra --key sk-... --model deepseek-ai/DeepSeek-V4-Pro
```

Or, after `npm install -g` / linking the package so the `mz` bin resolves on
PATH:

```bash
mz login <username>
mz ask "Qual o status da fila?"
mz review src/lib/some-file.ts
```

Example output of `mz review` on a file with a SQL-injection-by-concatenation
line:

```
REVIEW: src/lib/some-file.ts

== MAO LOCAL (assinatura, offline, determinístico) ==
verdict: block | blocked: true
  [BLOCK] CWE-89 (linha 2): SQL construído por interpolação/concat em cláusula (CWE-89) — use query parametrizada ($1/?)
    trecho: from users where id = " + r

== CEREBRO NUVEM (revisão semântica, agente MZ) ==
  [CRITICAL] CWE-89 (linha 2): A variável req.query.id é concatenada diretamente na query SQL...
    recomendacao: Utilize parameterized queries (ex: db.query('select * from users where id = ?', [req.query.id]))...
  resumo: O código contém uma vulnerabilidade crítica de SQL Injection na linha 2...

== VEREDITO COMBINADO: BLOCKED (severidade máxima: critical) ==
```

Exit code is `0` when the combined verdict is `OK`, non-zero when `BLOCKED`.

## E2E oracles

```bash
node mz-cli/test/e2e.mjs
node mz-cli/test/e2e-review.mjs
node mz-cli/test/e2e-build.mjs
```

Run from the repo root so they can find `.claude/settings.local.json`
(`automation.username` / `automation.password`) and the hoisted
`node_modules/@supabase/supabase-js`. Env overrides:
`COMPANION_ADMIN_USERNAME` / `COMPANION_ADMIN_PASSWORD` or
`PLAYWRIGHT_USERNAME` / `PLAYWRIGHT_PASSWORD`.

`test/e2e.mjs` prints one `PASS`/`FAIL` line per assertion (login, company
resolution, agent resolution, a real `run-agent-chat` call, and the no-auth
negative case) and a final `E2E: X/5 PASS` line. Exit code is `0` only on
`5/5`.

`test/e2e-review.mjs` prints one `PASS`/`FAIL`/`SKIP` line per assertion (two
deterministic local-gate checks + a best-effort cloud check) and a final
`REVIEW-E2E: X/Y PASS (cloud: PASS|SKIP)` line. Exit code is `0` as long as
both local assertions pass — the cloud assertion is best-effort and SKIPs
(does not fail the run) if no session/backend is available.

`test/e2e-build.mjs` prints one `PASS`/`FAIL` line per assertion (the
review-gate check, the tested-generation check, and the no-test check) and a
final `BUILD-E2E: X/3 PASS` line, plus a detail line with the self-repair
attempt count. Exit code is `0` only if the review-gate and tested-generation
assertions both pass (the two safety/correctness properties `mz build`
depends on).
