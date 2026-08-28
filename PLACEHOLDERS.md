# Placeholders — o que trocar antes de rodar

Esta distribuição não contém nenhum endereço, chave ou identificador de infraestrutura de
quem a publicou. Todo ponto que precisa do **seu** valor está marcado com um placeholder
reconhecível. Este documento é a lista completa: se você trocar tudo o que está aqui, o
sistema sobe apontando para a sua instalação.

> Verificação rápida do que ainda falta trocar:
> ```bash
> grep -rIn '<HOST>\|<BASTION_HOST>\|<SUPABASE_PROJECT_REF>\|<ANON_KEY>\|<REPO_ROOT>\|example\.com\|local\.internal' . --exclude-dir=node_modules --exclude=PLACEHOLDERS.md
> ```

## 1 · Configuração obrigatória (variáveis de ambiente)

Nada abaixo tem valor padrão: sem eles o sistema recusa a subir, e isso é proposital.

### `deploy/.env` — copie de `deploy/env.example`

| variável | o que é | como obter |
|---|---|---|
| `POSTGRES_PASSWORD` | senha do banco | `openssl rand -hex 32` |
| `JWT_SECRET` | **chave-mestra**: quem a tem forja qualquer identidade | `openssl rand -hex 32` (≥32 chars) |
| `ANON_KEY` | JWT `role: anon`, público, usado pelo front | assine com o seu `JWT_SECRET` |
| `SERVICE_ROLE_KEY` | JWT `role: service_role`, **nunca** vai ao navegador | idem |
| `SECRET_KEY_BASE`, `REALTIME_ENC_KEY`, `POOLER_VAULT_ENC_KEY` | segredos do realtime/storage | `openssl rand -hex 32` |
| `API_EXTERNAL_URL` | URL pública da API | ex.: `https://api.suaempresa.com` |
| `SITE_URL` | URL pública do front | ex.: `https://app.suaempresa.com` |

### `web/.env` — build do front (Vite)

| variável | o que é |
|---|---|
| `VITE_MZ_API_URL` | mesma URL de `API_EXTERNAL_URL` |
| `VITE_MZ_ANON_KEY` | mesmo valor de `ANON_KEY` |
| `VITE_MZ_PAYMENT_ENDPOINT` | **opcional** — só se você for cobrar dos seus tenants (§4) |

### Provedor de LLM (por usuário, pela própria UI, ou por env para a instância)

`MZ_PROVIDER`, `MZ_API_BASE`, `MZ_API_KEY`, `MZ_MODEL` — ver `SETUP.md §2`. Os usuários
também cadastram as chaves deles em **Configurações → Meus Provedores** (BYOK).

### Sandbox de execução

| variável | o que é | padrão |
|---|---|---|
| `CODEEXEC_TOKEN` | token que o cérebro usa para chamar o sandbox | gere você (`openssl rand -hex 32`) |
| `CODEEXEC_BIND` | interface onde o sandbox escuta | `172.17.0.1` (bridge docker padrão) — **confirme a sua**: `docker network inspect bridge` |

## 2 · Placeholders literais que sobraram em comentários e docs

Estes aparecem em texto (comentários, exemplos de linha de comando, documentação do CLI) e
existem só para você saber onde estava um valor específico da instalação original:

| placeholder | significa | onde aparece |
|---|---|---|
| `<HOST>` | o host da sua instância | `bench/mz107-brain.cjs`, `server/sql/{11-storage,15-pptx-templates}.sql` |
| `<BASTION_HOST>` | seu salto SSH, se houver | `bench/mz107-brain.cjs` |
| `<SUPABASE_PROJECT_REF>` | ref do projeto, se você usar Supabase gerenciado | `cli/AGENTS.md`, `cli/README.md`, `server/sql/14-research-base.sql` |
| `<ANON_KEY>` | veja §1 | `web/src/config.js` (só num comentário — o valor real vem do env) |
| `<REPO_ROOT>` | o caminho onde você clonou | `cli/README.md` |
| `api.example.com` · `app.example.com` · `sandbox.example.com` | seus domínios | CLI, docs, configs |
| `local.internal` | domínio interno para nomes de usuário sem `@` | CLI e servidor (`INTERNAL_EMAIL_DOMAIN`) |

## 3 · Nomes de container

O `deploy/docker-compose.yml` usa o prefixo `mz-` (`mz-db`, `mz-auth`, `mz-rest`, `mz-kong`,
`mz-storage`, `mz-realtime`, `mz-meta`, `mz-edge`). Se você rodar mais de uma instância na
mesma máquina, troque o prefixo — e lembre que os scripts SQL e utilitários referenciam
`mz-db` pelo nome.

## 4 · Pagamento por tenant (opcional)

A distribuição **não** traz provedor de pagamento. A quota (pontos) é da plataforma: é como o
admin distribui capacidade e é o freio dos laços autônomos — mas cobrar por ela é decisão de
quem opera.

- **Sem configurar nada**: a carteira funciona como painel de quota (saldo, plano, consumo) e
  a recarga é feita pelo admin em **Admin → Usuários → Dar pontos**.
- **Para cobrar dos seus tenants**: implemente o contrato descrito em `web/src/lib/payments.js`
  e aponte `VITE_MZ_PAYMENT_ENDPOINT` para ele. A UI passa a mostrar a seção de compra
  sozinha. Quem credita os pontos após o pagamento é o seu endpoint.

## 5 · Antes de expor à internet

1. **`CORS_ALLOWED_ORIGINS`** com a sua origem — nunca `*`.
2. **TLS**: o compose não termina TLS; ponha um proxy reverso ou CDN na frente.
3. **Segredos no banco**: o helper `get_vault_secret` guarda valores em **texto puro** numa
   tabela comum. Se você for guardar chaves de terceiros ali, troque por um cofre de verdade
   ou passe-as por variável de ambiente.
4. **`JWT_SECRET`** é a chave-mestra: rotacioná-la invalida todas as sessões e todas as chaves
   `anon`/`service_role` derivadas dela.
