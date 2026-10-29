# Security advisories

## MZ-2026-10 — tenant isolation, authentication and resource limits

**Affected:** every revision of this repository published before the 2026-10 security release
(the initial public release of 2026-08-29).
**Fixed in:** the 2026-10 security release (the commit that adds this file).
**Severity:** critical for any installation reachable from the internet.

An external audit of the public package found, and we confirmed, problems in four groups:

1. **Tenant isolation (database).** Several tables were readable and writable by any signed-in
   account; some privileged database functions were executable with the public (anon) key,
   including functions that read session memory and the secrets vault; and a few functions
   trusted a company/user id passed as a parameter.
2. **Authentication.** Each edge function carried its own copy of the JWT check, without issuer
   or audience validation and with expiry optional; the CLI login stored issued tokens and could
   hand the same approval to two concurrent pollers; public sign-up was open with auto-confirm.
3. **Edge functions.** The chat accepted a company/agent id from the request body; the document
   service had no authentication and fetched arbitrary URLs; uploads had no size/zip/SVG limits;
   user-supplied file names could escape the owner's storage folder; CORS reflected any origin;
   an internal runtime endpoint was reachable through the gateway.
4. **Cost controls.** Usage was charged only after the model call (no spending cap) and the
   benchmark endpoint accepted any `max_tokens`.

**What changed:** row-level security on every table and a consolidated hardening script
(`server/sql/99-security-hardening.sql`); a single JWT verifier
(`server/functions/_shared/tenant-guard.ts`) requiring `exp`, issuer, audience and role; tenant
checks in every function; atomic CLI login without stored tokens; upload, zip, SVG and token
limits; CORS allow-lists; an encrypted secrets vault; balance reservation before model calls;
gateway rate limits and a minimum password length. Tests: `cd cli && npm run security`.

**If you installed an earlier revision:**

1. Update to this release and apply `server/sql/` in order, ending with `99-security-hardening.sql`.
2. Rotate `JWT_SECRET` (then re-mint `ANON_KEY` and `SERVICE_ROLE_KEY`) and every third-party
   API key that was stored in the vault — assume they may have been read.
3. Review accounts created while public sign-up was open.

### Follow-up (2026-10-29)

- **Sign-out now revokes the access token.** Previously a token stayed valid until it expired
  (1 hour in the web app, 24 hours for the CLI). PostgREST now runs `public.mz_check_session()`
  before every request and the edge runtime does the same check: a token whose session was
  ended returns 401. CLI tokens carry the session created at login, and `mz logout` ends it.
  Storage and realtime still accept the token until it expires.
- **Gateway:** Kong 2.8.1 (out of support) replaced by Kong 3.9.1; `kong.yml` uses
  `_format_version: "3.0"`.
- **Runtime:** the database driver is pinned to an exact version.

To update an existing installation: re-apply `99-security-hardening.sql`; add
`PGRST_DB_PRE_REQUEST: public.mz_check_session` to the `rest` service; change the Kong image to
`kong:3.9.1` and `_format_version` to `"3.0"` in `kong.yml`; replace `functions/edge-runtime.ts`
and `functions/cli-auth.ts`; recreate the `rest`, `kong` and `edge-runtime` containers. Apply
the SQL **before** setting `PGRST_DB_PRE_REQUEST` — PostgREST fails every request if the
function does not exist. Run `mz auth` again on each CLI.

Report new issues as described in `SECURITY.md`.
