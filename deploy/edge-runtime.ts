// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
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
