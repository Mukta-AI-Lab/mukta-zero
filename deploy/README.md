# Self-hosting Mukta Zero

This directory stands up the full platform: Postgres, auth (GoTrue), REST
(PostgREST), the Kong gateway, storage, realtime, and the Deno edge runtime that
serves the functions in `../server/functions/`.

Everything here is standard self-hosted Supabase plus one small custom runtime —
no proprietary components.

## Files

| file | what it is |
|---|---|
| `docker-compose.yml` | the stack (8 services) |
| `edge-runtime.ts` | the Deno router that serves the edge functions |
| `env.example` | template for the 17 required variables — copy to `.env` |
| `mukta-stack-install-v2.sh` | scripted installer |

## Quickstart

```bash
cp env.example .env
# Fill .env. Generate secrets with: openssl rand -hex 32
# ANON_KEY and SERVICE_ROLE_KEY are JWTs signed with your JWT_SECRET.
docker compose up -d
```

Then apply the SQL in `../server/sql/` in filename order (they are numbered —
`99-security-hardening.sql` must run **last**, and is safe to re-run after any other
file), and deploy the functions from `../server/functions/` **including the
`_shared/` and `office/` folders** (the functions import them).

The scripted installer (`mukta-stack-install-v2.sh`) does the stack part for you: it
creates the encrypted secrets vault, writes `JWT_SECRET`, `JWT_ISSUER` and `ANON_KEY`
into it (the functions read them from there), and configures CORS and rate limits.

**VERIFY:** `docker compose ps`
**EXPECTED:** all 8 services `running`/`healthy`.

**VERIFY (security, offline):** `cd ../cli && npm install && npm run security`
**EXPECTED:** `TODOS OK` twice (JWT verification, tenant isolation, upload limits,
CLI login, CORS).

## Sizing

See the hardware section in `../SETUP.md`. Short version: the platform host runs
comfortably on **2 vCPU / 4 GB RAM / 40 GB disk** (the whole stack idles around
1.2 GB), and the **code-execution sandbox belongs on a separate host** — it is the
only component that takes untrusted load, and its real limit is concurrency, not
CPU.

## Security notes before you expose this

1. **`.env` holds every secret.** Never commit it. `JWT_SECRET` is the master key:
   anyone with it can mint a `service_role` token and impersonate any user.
2. **The secrets vault is encrypted at rest.** `vault.secrets` is a decrypting view
   over `vault.secrets_store` (AES-256 via pgcrypto). The key is the file
   `mz_vault.key` in the Postgres data directory — it is not in `pg_dump`, but it IS
   in a physical copy of the data volume. **Back it up separately: losing it means
   losing every stored secret.** Write secrets with `select vault.set_secret('NAME', 'value');`
   and restart the edge runtime to load them.
3. **Restrict CORS.** The gateway allows only `SITE_URL` and `API_EXTERNAL_URL`.
   The functions have their own allow-list in `server/functions/_shared/tenant-guard.ts`
   (`MZ_ALLOWED_ORIGINS`) — set it to your front-end and API origins. Never `*`.
4. **Put the gateway behind TLS** (a reverse proxy or a CDN) — the compose file
   does not terminate TLS for you. If the CDN is Cloudflare, firewall port 8000 to
   Cloudflare's ranges only: the gateway trusts `CF-Connecting-IP` from those ranges
   to rate-limit per real client IP (1200/min overall, 60/min on `/auth/v1`, 300/min
   on `/functions/v1`).
5. **Sign-up is closed by default** and passwords need at least 10 characters.
   Accounts are created by an administrator.
6. **`/__reload` is internal only.** It answers only requests that did not come
   through the gateway and carry `x-mz-runtime-token` equal to the vault secret
   `MZ_RUNTIME_ADMIN_TOKEN`; otherwise restart the edge container.
