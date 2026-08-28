#!/usr/bin/env bash
# Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
# SPDX-License-Identifier: BUSL-1.1
#
# Use of this software is governed by the Business Source License 1.1
# included in the repository LICENSE file. Change License: AGPL-3.0-only
# Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
# =============================================================================
# Mukta IaaS — Stack Pack installer  ·  v2  (Supabase COMPLETO via Docker)
# =============================================================================
# Turns a fresh Debian 12 VM into a FULL self-hosted Supabase:
#   - PostgreSQL 17 (supabase/postgres, with pg_cron + extensions)
#   - Auth        (GoTrue)
#   - REST        (PostgREST)
#   - Storage     (storage-api, file backend)
#   - Realtime    (supabase/realtime)
#   - Edge Funcs  (Deno runtime - UNLIMITED secrets vault, the differentiator)
#   - Gateway     (Kong, declarative) - single public entrypoint on :8000
#
# Idempotent. Run as root on Debian 12.
#
# -----------------------------------------------------------------------------
# WHAT CHANGED vs v1 (scripts/mukta-stack-install.sh)
# -----------------------------------------------------------------------------
# v1 installed a MINIMAL Deno-only "Supabase-in-a-box": native PostgreSQL +
# a hand-rolled Deno edge runtime + a secrets vault. NO GoTrue / PostgREST /
# Storage / Realtime / Kong. It was never real Supabase - just Postgres + 1
# function route. v2 replaces that with the genuine Supabase service mesh:
#
#   v1                                  ->  v2
#   --------------------------------------------------------------------------
#   native apt PostgreSQL               ->  supabase/postgres:17 in Docker
#   no Docker                           ->  Docker CE + compose plugin
#   hand-rolled Deno runtime (systemd)  ->  Deno runtime CONTAINERIZED as the
#                                           Kong upstream "edge-runtime" (:9000),
#                                           still loads UNLIMITED secrets from the
#                                           vault (kept as the vs-Supabase edge)
#   no Auth/REST/Storage/Realtime       ->  GoTrue + PostgREST + storage-api +
#                                           realtime, all wired to the DB
#   no gateway                          ->  Kong declarative gateway on :8000
#                                           routing /auth /rest /storage /realtime
#                                           /functions  (the only public port)
#   PGPASS only secret                  ->  per-instance UNIQUE JWT_SECRET +
#                                           ANON_KEY + SERVICE_ROLE_KEY (HS256
#                                           JWTs SIGNED here, NOT copied from the
#                                           hosted project) - true multi-tenant
#   compose template was Fase-2         ->  same image set, generated fresh for
#     migration (hosted JWT, external        an EMPTY instance: relative
#     Caddy, 77GB CNPJ, /var/lib/...)        ./data volumes, init-SQL that
#                                            creates the roles/schemas the
#                                            services need, Google OAuth OFF,
#                                            URLs = this instance's own ref
#   health = Deno /__health on :8000    ->  health = Kong /__health -> edge-runtime
#                                           (same {"ok":true} contract that
#                                           installStack() greps for)
#
# OUTPUT CONTRACT (unchanged - iaas-cli/src/provision/ssh.ts:installStack):
#   - prints "STACK READY" on success (run output | tail -6)
#   - Kong :8000 answers GET /__health with {"ok":true}
#
# ENV IN (optional, passed by the pipeline; all have safe defaults):
#   MUKTA_REF        instance ref/subdomain -> API_EXTERNAL_URL/SITE_URL
#   MUKTA_DOMAIN     apex domain for URLs (default mukta.app)
#   MUKTA_EDGE_PORT  public Kong port (default 8000) - firewall opens this one
#   MUKTA_PLAN       starter|standard|pro (reserved; default standard)
# =============================================================================
set -euo pipefail

STACK=/opt/mukta-zero-zero/stack
PORT="${MUKTA_EDGE_PORT:-8000}"
REF="${MUKTA_REF:-$(hostname -s 2>/dev/null || echo instance)}"
DOMAIN="${MUKTA_DOMAIN:-mukta.app}"
PLAN="${MUKTA_PLAN:-standard}"
export DEBIAN_FRONTEND=noninteractive

log(){ printf '%s\n' "== $* =="; }

# -----------------------------------------------------------------------------
log "[1/8] system deps + swap"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg jq openssl gettext-base unzip >/dev/null
# Swap (CL9 Linux template ships none; the service mesh benefits under pressure).
if [ "$(swapon --noheadings --show 2>/dev/null | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none 2>/dev/null
  chmod 600 /swapfile && mkswap /swapfile >/dev/null 2>&1 && swapon /swapfile 2>/dev/null || true
  grep -q '/swapfile' /etc/fstab 2>/dev/null || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# -----------------------------------------------------------------------------
log "[2/8] Docker CE + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-bookworm}")"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker --version
docker compose version | head -1

mkdir -p "$STACK"/kong "$STACK"/postgres/init "$STACK"/data/db "$STACK"/data/storage "$STACK"/functions

# -----------------------------------------------------------------------------
log "[3/8] per-instance secrets (.env) - UNIQUE JWT/ANON/SERVICE"
# base64url helper for JWT (no padding, +/ -> -_)
b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
# Mint an HS256 JWT for a given role, signed with this instance's JWT_SECRET.
mint_jwt(){ # $1=role  $2=secret
  local role="$1" secret="$2" iat exp hdr pl signing sig
  iat=$(date +%s); exp=$((iat + 315360000)) # +10y
  hdr=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  pl=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$iat" "$exp" | b64url)
  signing="${hdr}.${pl}"
  sig=$(printf '%s' "$signing" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
  printf '%s.%s' "$signing" "$sig"
}

if [ ! -f "$STACK/.env" ]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  ANON_KEY=$(mint_jwt anon "$JWT_SECRET")
  SERVICE_ROLE_KEY=$(mint_jwt service_role "$JWT_SECRET")
  SECRET_KEY_BASE=$(openssl rand -hex 32)
  POOLER_VAULT_ENC_KEY=$(openssl rand -hex 16)
  # Realtime's Crypto.encrypt! uses a cipher that needs a key of EXACTLY 16 chars
  # (`openssl rand -hex 16` yields 32 hex chars → wrong; seeds.exs crash-loops). Use 8 raw bytes = 16 hex.
  REALTIME_ENC_KEY=$(openssl rand -hex 8)
  API_EXTERNAL_URL="https://${REF}.${DOMAIN}"
  {
    echo "# Mukta instance ${REF} - generated $(date -u +%FT%TZ). Secrets are UNIQUE to this instance."
    echo "POSTGRES_DB=postgres"
    echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
    echo "JWT_SECRET=${JWT_SECRET}"
    echo "JWT_EXP=3600"
    echo "JWT_ISSUER=supabase"
    echo "ANON_KEY=${ANON_KEY}"
    echo "SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
    echo "SECRET_KEY_BASE=${SECRET_KEY_BASE}"
    echo "POOLER_VAULT_ENC_KEY=${POOLER_VAULT_ENC_KEY}"
    echo "REALTIME_ENC_KEY=${REALTIME_ENC_KEY}"
    echo "POOLER_TENANT_ID=${REF}"
    echo "API_EXTERNAL_URL=${API_EXTERNAL_URL}"
    echo "SITE_URL=${API_EXTERNAL_URL}"
    echo "ADDITIONAL_REDIRECT_URLS=${API_EXTERNAL_URL}"
    echo "PGRST_DB_SCHEMAS=public,storage,graphql_public"
    echo "EDGE_PORT=9000"
    echo "MUKTA_PLAN=${PLAN}"
  } > "$STACK/.env"
  chmod 600 "$STACK/.env"
  echo "  generated unique secrets for ref=${REF} (JWT_SECRET 64 hex, ANON+SERVICE HS256)"
else
  echo "  .env exists - preserving existing secrets (idempotent)"
fi
set -a; . "$STACK/.env"; set +a

# -----------------------------------------------------------------------------
log "[4/8] materialize stack assets (compose / kong / postgres init)"

# --- postgres/init/00-init.sql : roles + schemas the services require ---------
# Written with envsubst so the DB password lands in the SQL (psql vars are awkward
# across the docker-entrypoint). Only ${POSTGRES_PASSWORD} is substituted.
cat > "$STACK/postgres/init/00-init.sql.tpl" <<'INITSQL'
-- Roles + schemas required by GoTrue / PostgREST / Storage / Realtime.
-- supabase/postgres seeds most of this; we GUARANTEE the login roles exist
-- with THIS instance's password and grant the basics.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '__PGPASS__'; ELSE ALTER ROLE authenticator LOGIN PASSWORD '__PGPASS__'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN CREATEROLE PASSWORD '__PGPASS__'; ELSE ALTER ROLE supabase_auth_admin LOGIN PASSWORD '__PGPASS__'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin LOGIN CREATEROLE PASSWORD '__PGPASS__'; ELSE ALTER ROLE supabase_storage_admin LOGIN PASSWORD '__PGPASS__'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin LOGIN SUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS PASSWORD '__PGPASS__'; ELSE ALTER ROLE supabase_admin LOGIN PASSWORD '__PGPASS__'; END IF;
  -- The supabase/postgres image does NOT seed a `postgres` superuser, but GoTrue &
  -- Storage migrations reference it explicitly (e.g. `grant select ... to postgres`,
  -- `permission denied for database postgres`). Create it or auth/storage crash-loop.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres LOGIN SUPERUSER CREATEROLE CREATEDB REPLICATION BYPASSRLS PASSWORD '__PGPASS__'; ELSE ALTER ROLE postgres LOGIN SUPERUSER PASSWORD '__PGPASS__'; END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth      AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage   AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgjwt       WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- UNLIMITED secrets vault (the vs-Supabase differentiator; edge-runtime loads it).
CREATE SCHEMA IF NOT EXISTS vault AUTHORIZATION supabase_admin;
CREATE TABLE IF NOT EXISTS vault.secrets (
  name text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION vault.set_secret(p_name text, p_value text) RETURNS void
  LANGUAGE sql AS $fn$ INSERT INTO vault.secrets(name,value) VALUES(p_name,p_value)
    ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=now() $fn$;

GRANT USAGE ON SCHEMA public, storage, graphql_public, extensions TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
ALTER ROLE authenticator SET search_path = public, extensions;

-- PG15+ revoked CREATE on `public` from PUBLIC. GoTrue's migrator creates its
-- `schema_migrations` bookkeeping table in `public` and Storage migrates against
-- `database postgres`; without these the admins hit `permission denied for schema
-- public (42501)` and crash-loop. Grant CREATE/ALL on the schemas they touch.
GRANT ALL ON SCHEMA public  TO supabase_auth_admin, supabase_storage_admin, postgres;
GRANT ALL ON SCHEMA auth     TO supabase_auth_admin, postgres;
GRANT ALL ON SCHEMA storage  TO supabase_storage_admin, postgres;
GRANT ALL ON DATABASE postgres TO supabase_auth_admin, supabase_storage_admin, postgres;
ALTER ROLE supabase_auth_admin    SET search_path = auth, public;
ALTER ROLE supabase_storage_admin SET search_path = storage, public;
INITSQL
export POSTGRES_PASSWORD
sed "s/__PGPASS__/${POSTGRES_PASSWORD}/g" "$STACK/postgres/init/00-init.sql.tpl" > "$STACK/postgres/init/00-init.sql"
rm -f "$STACK/postgres/init/00-init.sql.tpl"

# --- postgres/postgresql.conf : modest, RAM-aware (tuned at [5/8]) ------------
cat > "$STACK/postgres/postgresql.conf" <<'PGCONF'
listen_addresses = '*'
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 768MB
work_mem = 16MB
maintenance_work_mem = 128MB
max_worker_processes = 8
max_parallel_workers = 4
max_parallel_workers_per_gather = 2
wal_compression = on
checkpoint_completion_target = 0.9
max_wal_size = 2GB
min_wal_size = 256MB
random_page_cost = 1.1
effective_io_concurrency = 200
shared_preload_libraries = 'pg_cron,pg_stat_statements'
cron.database_name = 'postgres'
pg_stat_statements.track = all
log_min_duration_statement = 2000
PGCONF

# --- edge-runtime image (Deno): Dockerfile + runtime source -------------------
# vs-Supabase differentiator: loads UNLIMITED secrets from vault.secrets and
# exposes /__health (Kong routes :8000/__health here -> the pipeline contract).
cat > "$STACK/functions/edge-runtime.ts" <<'TS'
import postgres from "npm:postgres@3";
const PGURL = Deno.env.get("PGURL")!;
const PORT = Number(Deno.env.get("EDGE_PORT") ?? "9000");
const sql = postgres(PGURL);
let secretCount = 0;
const modCache = new Map<string, any>();
async function loadSecrets() {
  try {
    const rows = await sql`select name, value from vault.secrets`;
    for (const r of rows) Deno.env.set(r.name as string, r.value as string);
    secretCount = rows.length;
  } catch (_) { secretCount = -1; }
}
await loadSecrets();
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/__health" || url.pathname === "/functions/v1/__health")
    return Response.json({ ok: true, runtime: "mukta-edge", deno: Deno.version.deno, secrets_loaded: secretCount });
  if (url.pathname === "/__reload") { await loadSecrets(); modCache.clear(); return Response.json({ reloaded: true, secrets_loaded: secretCount }); }
  const m = url.pathname.match(/^\/(?:functions\/v1\/)?([\w-]+)\/?$/);
  if (!m) return new Response("mukta edge runtime", { status: 200 });
  try {
    let mod = modCache.get(m[1]);
    if (!mod) { mod = await import("file:///functions/" + m[1] + ".ts"); modCache.set(m[1], mod); }
    const handler = mod.default;
    if (typeof handler !== "function") return new Response("function has no default export", { status: 500 });
    return await handler(req, { sql, getSecret: (n: string) => Deno.env.get(n) });
  } catch (e) { return new Response("function error: " + (e instanceof Error ? e.message : String(e)), { status: 500 }); }
});
TS

cat > "$STACK/Dockerfile.edge" <<'DOCKER'
FROM denoland/deno:alpine-2.1.4
WORKDIR /functions
COPY functions/ /functions/
EXPOSE 9000
CMD ["run","--allow-net","--allow-env","--allow-read","--allow-ffi","--allow-sys","/functions/edge-runtime.ts"]
DOCKER

# --- kong/kong.yml.tpl : declarative gateway (envsubst -> kong.yml) -----------
cat > "$STACK/kong/kong.yml.tpl" <<'KONG'
_format_version: "2.1"
services:
  - name: auth-v1
    url: http://auth:9999/
    routes: [{ name: auth-v1-route, strip_path: true, paths: ["/auth/v1/"] }]
    plugins: [{ name: cors }]
  - name: rest-v1
    url: http://rest:3000/
    routes: [{ name: rest-v1-route, strip_path: true, paths: ["/rest/v1/"] }]
    plugins:
      - name: cors
      - { name: key-auth, config: { hide_credentials: true } }
  - name: storage-v1
    url: http://storage:5000/
    routes: [{ name: storage-v1-route, strip_path: true, paths: ["/storage/v1/"] }]
    plugins: [{ name: cors }]
  - name: realtime-v1
    url: http://realtime:4000/socket/
    routes: [{ name: realtime-v1-route, strip_path: true, paths: ["/realtime/v1/"] }]
    plugins: [{ name: cors }]
  - name: functions-v1
    url: http://edge-runtime:9000/
    routes: [{ name: functions-v1-route, strip_path: true, paths: ["/functions/v1/"] }]
    plugins: [{ name: cors }]
  - name: health
    url: http://edge-runtime:9000/__health
    routes: [{ name: health-route, strip_path: true, paths: ["/__health"] }]
consumers:
  - username: anon
    keyauth_credentials: [{ key: "${ANON_KEY}" }]
  - username: service_role
    keyauth_credentials: [{ key: "${SERVICE_ROLE_KEY}" }]
acls:
  - { consumer: anon, group: anon }
  - { consumer: service_role, group: admin }
KONG
# Kong DB-less does NOT expand env vars in kong.yml -> render with envsubst.
envsubst '${ANON_KEY} ${SERVICE_ROLE_KEY}' < "$STACK/kong/kong.yml.tpl" > "$STACK/kong/kong.yml"

# --- docker-compose.yml : full Supabase mesh, EMPTY-instance shape -----------
cat > "$STACK/docker-compose.yml" <<'COMPOSE'
x-logging: &dl
  driver: json-file
  options: { max-size: "10m", max-file: "3" }
services:
  db:
    image: supabase/postgres:17.6.1.139
    container_name: mz-db
    restart: unless-stopped
    logging: *dl
    command: ["postgres","-c","config_file=/etc/postgresql/postgresql.conf"]
    environment:
      POSTGRES_HOST: /var/run/postgresql
      POSTGRES_DB: ${POSTGRES_DB:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXP: ${JWT_EXP:-3600}
    volumes:
      - ./data/db:/var/lib/postgresql/data
      - ./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    ports: ["127.0.0.1:5432:5432"]
    healthcheck:
      test: ["CMD","pg_isready","-U","postgres","-h","localhost"]
      interval: 10s
      timeout: 5s
      retries: 20
    networks: [sb]
  auth:
    image: supabase/gotrue:v2.177.0
    container_name: mz-auth
    restart: unless-stopped
    logging: *dl
    depends_on: { db: { condition: service_healthy } }
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: ${API_EXTERNAL_URL}
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      GOTRUE_SITE_URL: ${SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${ADDITIONAL_REDIRECT_URLS}
      GOTRUE_JWT_SECRET: ${JWT_SECRET}
      GOTRUE_JWT_EXP: ${JWT_EXP:-3600}
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_ISSUER: ${JWT_ISSUER:-supabase}
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_MAILER_AUTOCONFIRM: "true"
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: "false"
    networks: [sb]
  rest:
    image: postgrest/postgrest:v12.2.8
    container_name: mz-rest
    restart: unless-stopped
    logging: *dl
    depends_on: { db: { condition: service_healthy } }
    environment:
      PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@db:5432/postgres
      PGRST_DB_SCHEMAS: ${PGRST_DB_SCHEMAS:-public,storage,graphql_public}
      PGRST_DB_ANON_ROLE: anon
      PGRST_JWT_SECRET: ${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"
    networks: [sb]
  storage:
    image: supabase/storage-api:v1.19.3
    container_name: mz-storage
    restart: unless-stopped
    logging: *dl
    depends_on:
      db: { condition: service_healthy }
      rest: { condition: service_started }
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_KEY: ${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://rest:3000
      PGRST_JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      FILE_SIZE_LIMIT: 52428800
      STORAGE_BACKEND: file
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      GLOBAL_S3_BUCKET: stub
    volumes: ["./data/storage:/var/lib/storage"]
    networks: [sb]
  realtime:
    image: supabase/realtime:v2.34.47
    container_name: mz-realtime
    restart: unless-stopped
    logging: *dl
    depends_on: { db: { condition: service_healthy } }
    environment:
      PORT: 4000
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: postgres
      DB_USER: supabase_admin
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      DB_ENC_KEY: ${REALTIME_ENC_KEY}
      API_JWT_SECRET: ${JWT_SECRET}
      SECRET_KEY_BASE: ${SECRET_KEY_BASE}
      APP_NAME: realtime
      RLIMIT_NOFILE: "10000"
      SEED_SELF_HOST: "true"
      RUN_JANITOR: "true"
    networks: [sb]
  meta:
    image: supabase/postgres-meta:v0.84.2
    container_name: mz-meta
    restart: unless-stopped
    logging: *dl
    depends_on: { db: { condition: service_healthy } }
    environment:
      PG_META_PORT: 8080
      PG_META_DB_HOST: db
      PG_META_DB_PORT: 5432
      PG_META_DB_NAME: postgres
      PG_META_DB_USER: supabase_admin
      PG_META_DB_PASSWORD: ${POSTGRES_PASSWORD}
    networks: [sb]
  edge-runtime:
    build: { context: ., dockerfile: Dockerfile.edge }
    image: mukta-edge-runtime:1.0
    container_name: mz-edge
    restart: unless-stopped
    logging: *dl
    depends_on: { db: { condition: service_healthy } }
    environment:
      PGURL: postgres://supabase_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      EDGE_PORT: 9000
    volumes: ["./functions:/functions"]
    networks: [sb]
  kong:
    image: kong:2.8.1
    container_name: mz-kong
    restart: unless-stopped
    logging: *dl
    depends_on: [auth, rest, storage, realtime, edge-runtime]
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /home/kong/kong.yml
      KONG_DNS_ORDER: LAST,A,CNAME
      KONG_PLUGINS: request-transformer,cors,key-auth,acl
    volumes: ["./kong/kong.yml:/home/kong/kong.yml:ro"]
    ports: ["0.0.0.0:__PORT__:8000"]
    networks: [sb]
networks:
  sb: { name: mukta-sb, driver: bridge }
COMPOSE
sed -i "s/__PORT__/${PORT}/" "$STACK/docker-compose.yml"

# -----------------------------------------------------------------------------
log "[5/8] RAM-aware Postgres tuning"
RAM_MB=$(free -m | awk '/Mem:/{print $2}')
SHB=$(( RAM_MB / 4 )); ECS=$(( RAM_MB * 3 / 5 ))
[ "$SHB" -lt 128 ] && SHB=128
sed -i "s/^shared_buffers = .*/shared_buffers = ${SHB}MB/" "$STACK/postgres/postgresql.conf"
sed -i "s/^effective_cache_size = .*/effective_cache_size = ${ECS}MB/" "$STACK/postgres/postgresql.conf"
echo "  shared_buffers=${SHB}MB effective_cache_size=${ECS}MB (RAM ${RAM_MB}MB)"

# -----------------------------------------------------------------------------
log "[6/8] build edge-runtime + pull images"
( cd "$STACK" && docker compose --env-file "$STACK/.env" build edge-runtime ) || \
  echo "  WARN: edge build had warnings (continuing)"

# -----------------------------------------------------------------------------
log "[7/8] docker compose up -d"
( cd "$STACK" && docker compose --env-file "$STACK/.env" up -d )

echo "  waiting for db healthy..."
for i in $(seq 1 30); do
  st=$(docker inspect -f '{{.State.Health.Status}}' mz-db 2>/dev/null || echo starting)
  [ "$st" = "healthy" ] && break
  sleep 4
done

# -----------------------------------------------------------------------------
log "[8/8] healthcheck (Kong :${PORT}/__health)"
HEALTH="FAILED"
for i in $(seq 1 30); do
  body=$(curl -fsS "http://localhost:${PORT}/__health" 2>/dev/null || true)
  if printf '%s' "$body" | grep -Eq '"ok":[[:space:]]*true'; then HEALTH="$body"; break; fi
  sleep 4
done
echo "  health: ${HEALTH}"
echo "  services: db auth rest storage realtime meta edge-runtime kong"
echo "  public: :${PORT} (Kong) -> /auth/v1 /rest/v1 /storage/v1 /realtime/v1 /functions/v1 /__health"
echo "  internal-only (127.0.0.1): :5432 (Postgres)"

# Convenience helper to drop functions onto the edge-runtime volume.
cat > /usr/local/bin/deploy-function <<'HELP'
#!/usr/bin/env bash
# deploy-function <name> <file.ts>  - deploy an edge function (-> /functions/v1/<name>)
cp "$2" "/opt/mukta-zero-zero/stack/functions/$1.ts" && docker restart mz-edge >/dev/null && echo "deployed '$1' -> /functions/v1/$1"
HELP
chmod 755 /usr/local/bin/deploy-function

if printf '%s' "$HEALTH" | grep -q '"ok"'; then
  echo "STACK READY (Supabase: Postgres + Auth + REST + Storage + Realtime + Edge + Kong)"
else
  echo "STACK INCOMPLETE - Kong /__health not green; check: docker compose -f $STACK/docker-compose.yml ps"
  exit 1
fi
