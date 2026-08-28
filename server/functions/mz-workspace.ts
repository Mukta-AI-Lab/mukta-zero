// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// mz-workspace — Workspaces do MZ: PROJETOS que agrupam ARQUIVOS (CSV/planilha/texto) e permitem que o
// agente TRABALHE esses arquivos. Contrato mukta-edge (req, {sql, getSecret}). RLS já existe em mz_projects/
// mz_project_files (owner por auth.uid); aqui o edge valida o JWT e escopa por user_id explícito (o sql do
// mukta-edge não tem auth.uid). "Obter dados da internet" = via ask_project (o agente tem web_search/scrape_url).

function b64urlToBytes(s: string): Uint8Array { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
async function verifyJwt(token: string, secret: string): Promise<any> {
  const p = token.split("."); if (p.length !== 3) throw new Error("jwt malformado");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", key, b64urlToBytes(p[2]), new TextEncoder().encode(`${p[0]}.${p[1]}`))) throw new Error("assinatura inválida");
  const c = JSON.parse(new TextDecoder().decode(b64urlToBytes(p[1])));
  if (c.exp && Date.now() / 1000 > c.exp) throw new Error("token expirado");
  if (!c.sub) throw new Error("sem sub");
  return c;
}
// parser CSV robusto (aspas, vírgulas dentro de aspas, "" escape, CRLF)
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []; let cur: string[] = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { cur.push(field); field = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; cur.push(field); rows.push(cur); cur = []; field = ""; } else field += c; }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const ne = rows.filter((r) => r.some((x) => x.trim() !== ""));
  return { headers: ne[0] || [], rows: ne.slice(1) };
}

export default async function (req: Request, ctx: { sql: any; getSecret: (n: string) => string | undefined }) {
  const { sql, getSecret } = ctx;
  const _allowed = ["https://app.example.com", "https://api.example.com"]; const _o = req.headers.get("origin");
  const CORS: Record<string, string> = { "Access-Control-Allow-Origin": !_o ? "*" : (_allowed.includes(_o) ? _o : _allowed[0]), "Access-Control-Allow-Headers": "apikey, content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  const apikey = req.headers.get("apikey") || ""; const authz = req.headers.get("authorization") || "";
  const secret = getSecret("JWT_SECRET") || getSecret("GOTRUE_JWT_SECRET");
  if (!secret) return j({ error: "server_misconfig" }, 500);
  let userId: string;
  try { userId = (await verifyJwt(authz.replace(/^Bearer\s+/i, ""), secret)).sub; } catch (e) { return j({ error: "unauthorized", detail: String((e as Error).message || e) }, 401); }

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const action = String(body.action || "");
  try {
    if (action === "create_project") {
      const r = await sql`insert into public.mz_projects (user_id, name, description) values (${userId}::uuid, ${String(body.name || "Projeto").slice(0, 120)}, ${String(body.description || "").slice(0, 500)}) returning id, name`;
      return j({ ok: true, project: r[0] });
    }
    if (action === "list_projects") {
      const r = await sql`select id, name, description, created_at from public.mz_projects where user_id = ${userId}::uuid order by created_at desc limit 100`;
      return j({ ok: true, projects: r });
    }
    if (action === "ingest_csv") {
      const pid = String(body.project_id || ""); const name = String(body.file_name || "dados.csv").slice(0, 200);
      const csv = String(body.csv_content || "");
      if (!pid || !csv) return j({ error: "project_id e csv_content requeridos" }, 400);
      if (csv.length > 5_000_000) return j({ error: "csv muito grande (máx 5MB)" }, 413); // cap anti-DoS no parser
      const own = await sql`select 1 from public.mz_projects where id = ${pid} and user_id = ${userId}::uuid limit 1`;
      if (!own.length) return j({ error: "projeto não encontrado" }, 404);
      const { headers, rows } = parseCSV(csv);
      // content_text = tabela legível pelo agente (capado). meta = estrutura + preview.
      const tableTxt = [headers.join(" | "), headers.map(() => "---").join(" | "), ...rows.slice(0, 500).map((r) => r.join(" | "))].join("\n").slice(0, 40000);
      const meta = { kind: "csv", n_rows: rows.length, n_cols: headers.length, headers, preview: rows.slice(0, 5) };
      const fr = await sql`insert into public.mz_project_files (user_id, project_id, file_name, kind, content_text, meta) values (${userId}::uuid, ${pid}::uuid, ${name}, 'csv', ${tableTxt}, ${meta}) returning id`;
      return j({ ok: true, file_id: fr[0].id, n_rows: rows.length, n_cols: headers.length, headers, preview: rows.slice(0, 5) });
    }
    if (action === "list_files") {
      const pid = String(body.project_id || "");
      const r = await sql`select id, file_name, kind, meta, created_at from public.mz_project_files where project_id = ${pid}::uuid and user_id = ${userId}::uuid order by created_at desc limit 200`;
      return j({ ok: true, files: r });
    }
    if (action === "get_file") {
      const fid = String(body.file_id || "");
      const r = await sql`select file_name, kind, content_text, meta from public.mz_project_files where id = ${fid}::uuid and user_id = ${userId}::uuid limit 1`;
      if (!r.length) return j({ error: "arquivo não encontrado" }, 404);
      return j({ ok: true, file: r[0] });
    }
    // sign_file — gera uma signed URL FRESCA p/ DOWNLOAD do blob no bucket (URLs assinadas expiram; re-assina sob demanda).
    // Verifica POSSE via mz_project_files.user_id ANTES de assinar; assina com o JWT do próprio user (owner=user no
    // bucket → RLS ok), mesmo mecanismo do mz-office (persistFile). Arquivos só-texto (sem storage_path) devolvem content_text
    // p/ o cliente montar o blob e baixar. Endereça o pedido do Herbert: botão de download nos arquivos dos Projetos.
    if (action === "sign_file") {
      const fid = String(body.file_id || "");
      if (!fid) return j({ error: "file_id requerido" }, 400);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fid)) return j({ error: "file_id inválido" }, 400); // evita 500 vazando erro do Postgres (UAT)
      const r = await sql`select file_name, storage_path, content_text from public.mz_project_files where id = ${fid}::uuid and user_id = ${userId}::uuid limit 1`;
      if (!r.length) return j({ error: "arquivo não encontrado" }, 404);
      const f = r[0];
      if (f.storage_path) {
        const KONG = "http://kong:8000/storage/v1"; const PUB = "https://api.example.com/storage/v1";
        try {
          const sg = await fetch(`${KONG}/object/sign/mz-uploads/${f.storage_path}`, { method: "POST", headers: { authorization: authz, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) });
          if (!sg.ok) return j({ error: "sign_failed", detail: `http ${sg.status}` }, 502);
          const sj = await sg.json();
          if (!sj.signedURL) return j({ error: "sign_failed", detail: "sem signedURL" }, 502);
          return j({ ok: true, signed_url: `${PUB}${sj.signedURL}`, file_name: f.file_name });
        } catch (e) { return j({ error: "sign_failed", detail: String((e as Error).message || e).slice(0, 120) }, 502); }
      }
      if (f.content_text != null) return j({ ok: true, content_text: f.content_text, file_name: f.file_name });
      return j({ error: "sem_conteudo", detail: "arquivo sem blob nem content_text" }, 404);
    }
    // upload_file — sobe um arquivo de CÓDIGO/TEXTO genérico no projeto (content vai p/ content_text; igual ao doc-edit).
    if (action === "upload_file") {
      const pid = String(body.project_id || ""); const name = String(body.file_name || "arquivo.txt").slice(0, 200);
      const content = String(body.content || ""); const kind = String(body.kind || "code").slice(0, 20);
      if (!pid || !content) return j({ error: "project_id e content requeridos" }, 400);
      if (content.length > 2_000_000) return j({ error: "arquivo muito grande (máx 2MB)" }, 413);
      const own = await sql`select 1 from public.mz_projects where id = ${pid} and user_id = ${userId}::uuid limit 1`;
      if (!own.length) return j({ error: "projeto não encontrado" }, 404);
      const fr = await sql`insert into public.mz_project_files (user_id, project_id, file_name, kind, content_text, meta) values (${userId}::uuid, ${pid}::uuid, ${name}, ${kind}, ${content}, ${{ kind, bytes: content.length, version: 1 }}) returning id`;
      return j({ ok: true, file_id: fr[0].id, bytes: content.length });
    }
    // edit_file — o agente ALTERA o arquivo (mesmo padrão do surgical_edit de docx/pptx, mas p/ código/texto):
    // carrega o content_text, aplica a instrução via run-agent-chat, grava a nova versão. Verificação-por-execução no oráculo.
    if (action === "edit_file") {
      const fid = String(body.file_id || ""); const instr = String(body.instruction || "");
      if (!fid || !instr) return j({ error: "file_id e instruction requeridos" }, 400);
      const r = await sql`select file_name, kind, content_text, meta from public.mz_project_files where id = ${fid}::uuid and user_id = ${userId}::uuid limit 1`;
      if (!r.length) return j({ error: "arquivo não encontrado" }, 404);
      const f = r[0]; const prev = f.content_text || "";
      const sys = "Você é um editor de arquivos de código/texto. Aplique EXATAMENTE a instrução e devolva o conteúdo COMPLETO e FINAL do arquivo. Não explique, não use blocos markdown ```, não adicione nada antes/depois — SOMENTE o conteúdo do arquivo.";
      const user = `ARQUIVO: ${f.file_name}\nCONTEÚDO ATUAL:\n${prev}\n\nINSTRUÇÃO: ${instr}\n\nDevolva o arquivo completo já alterado:`;
      const resp = await fetch("http://kong:8000/functions/v1/run-agent-chat", { method: "POST", headers: { apikey, authorization: authz, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: user }], system_prompt_override: sys }) });
      const rj: any = await resp.json().catch(() => ({}));
      let out = String(rj.response_text || "").replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      if (!out) return j({ error: "edição vazia", detail: rj.error || "?" }, 502);
      const curVer = (f.meta && f.meta.version) || 1; const ver = curVer + 1;
      // LOCK OTIMISTA: só grava se a versão não mudou desde a leitura (edições concorrentes → conflito, sem perda silenciosa).
      const up = await sql`update public.mz_project_files set content_text = ${out}, meta = ${{ ...(f.meta || {}), version: ver, prev_bytes: prev.length }}
        where id = ${fid}::uuid and user_id = ${userId}::uuid and coalesce((meta->>'version')::int, 1) = ${curVer} returning id`;
      if (!up.length) return j({ error: "conflito_de_versao", detail: "o arquivo foi alterado por outra edição concorrente; recarregue e tente de novo" }, 409);
      return j({ ok: true, file_id: fid, version: ver, bytes: out.length, changed: out !== prev, new_content: out.slice(0, 6000) });
    }
    // ask_project — o agente TRABALHA os arquivos: injeta o content_text dos arquivos do projeto no contexto
    // e chama run-agent-chat (que tem web_search/scrape p/ complementar com dados da internet). Via kong (sem CF).
    if (action === "ask_project") {
      const pid = String(body.project_id || ""); const prompt = String(body.prompt || "");
      if (!pid || !prompt) return j({ error: "project_id e prompt requeridos" }, 400);
      const files = await sql`select file_name, content_text from public.mz_project_files where project_id = ${pid}::uuid and user_id = ${userId}::uuid and content_text is not null order by created_at desc limit 20`;
      let ctxTxt = ""; for (const f of files) { const add = `\n\n### Arquivo: ${f.file_name}\n${f.content_text}`; if ((ctxTxt.length + add.length) < 60000) ctxTxt += add; }
      const msg = `CONTEXTO — ARQUIVOS DO PROJETO (use-os para responder; se faltar dado atual, use web_search/scrape_url):${ctxTxt || " (nenhum arquivo com conteúdo)"}\n\nPERGUNTA DO USUÁRIO:\n${prompt}`;
      const resp = await fetch("http://kong:8000/functions/v1/run-agent-chat", { method: "POST", headers: { apikey, authorization: authz, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: msg }] }) });
      const rj = await resp.json().catch(() => ({}));
      return j({ ok: resp.ok, response_text: rj.response_text ?? null, model: rj.model ?? null, files_used: files.length });
    }
    // delete_project — apaga o projeto, seus arquivos (FK cascade) E os blobs no bucket (o FK NÃO toca no storage).
    if (action === "delete_project") {
      const pid = String(body.project_id || "");
      if (!pid) return j({ error: "project_id requerido" }, 400);
      const own = await sql`select 1 from public.mz_projects where id = ${pid} and user_id = ${userId}::uuid limit 1`;
      if (!own.length) return j({ error: "projeto não encontrado" }, 404);
      const files = await sql`select storage_path from public.mz_project_files where project_id = ${pid}::uuid and user_id = ${userId}::uuid and storage_path is not null`;
      const paths = (files || []).map((f: any) => f.storage_path).filter(Boolean);
      if (paths.length) { try { await fetch("http://kong:8000/storage/v1/object/mz-uploads", { method: "DELETE", headers: { apikey, authorization: authz, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths }) }); } catch { /* blobs órfãos são toleráveis vs falhar o delete */ } }
      await sql`delete from public.mz_projects where id = ${pid}::uuid and user_id = ${userId}::uuid`;
      return j({ ok: true, deleted_files: paths.length });
    }
    return j({ error: "unknown_action", actions: ["create_project", "list_projects", "ingest_csv", "list_files", "get_file", "sign_file", "ask_project", "delete_project"] }, 400);
  } catch (e) { return j({ error: "workspace_error", detail: String((e as Error).message || e).slice(0, 160) }, 500); }
}
