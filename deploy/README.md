<!-- Substitui o deploy/README.md HERDADO (que é interno: fala de /opt/mukta-zero-zero/stack, da .107 e
     do MANIFEST). Copiado por cima dele em F1 — ver copy-manifest.tsv. -->

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

Then apply the SQL in `../server/sql/` in filename order (they are numbered), and
deploy the functions from `../server/functions/`.

**VERIFY:** `docker compose ps`
**EXPECTED:** all 8 services `running`/`healthy`.

## Sizing

See the hardware section in `../SETUP.md`. Short version: the platform host runs
comfortably on **2 vCPU / 4 GB RAM / 40 GB disk** (the whole stack idles around
1.2 GB), and the **code-execution sandbox belongs on a separate host** — it is the
only component that takes untrusted load, and its real limit is concurrency, not
CPU.

## Security notes before you expose this

1. **`.env` holds every secret.** Never commit it. `JWT_SECRET` is the master key:
   anyone with it can mint a `service_role` token and impersonate any user.
2. **Secrets in the database are stored in plaintext** by the bundled
   `get_vault_secret` helper (`vault.secrets` is a plain table). If you hold
   third-party API keys there, either move them to environment variables or
   replace the helper with an encrypted store before going to production.
3. **Restrict CORS.** Set `CORS_ALLOWED_ORIGINS` to your own front-end origin;
   never `*`.
4. **Put the gateway behind TLS** (a reverse proxy or a CDN) — the compose file
   does not terminate TLS for you.
