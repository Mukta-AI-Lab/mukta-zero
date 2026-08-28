// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState, useEffect, useCallback } from "react";
import {
  Users, Loader2, RefreshCw, AlertTriangle, Plus, Trash2, KeyRound, Copy, Check,
  ScrollText, Brain, ShieldCheck, History, X,
} from "lucide-react";
import { useT } from "./lib/i18n.jsx";

// Superfície dos SHARED WORKSPACES. Contrato provado em mz-cli/instance/migrations/
// 20260807220000_mz_shared_workspaces.sql (gate 35/35 — mz-web/scripts/verify-workspaces-api.cjs).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// DOIS AVISOS QUE ESTA TELA É OBRIGADA A DAR, e o motivo de cada um
//
// 1) AS REGRAS AINDA NÃO SÃO APLICADAS PELO AGENTE (F4/MZF-WS-ENFORCE, do MZEng). O contrato
//    grava, o runtime ainda não lê. Um admin que configura limites, vê a tela verde e acredita
//    que a equipe está contida não está diante de uma lacuna de produto — está diante de FALSA
//    GARANTIA DE GOVERNANÇA. É a diferença entre esta tela e a de Configurações, que carrega a
//    mesma dívida desde 03/08 (MZF-DISPATCH) e ficou calada sobre ela.
//
// 2) O PAPEL 'supervise' HOJE NÃO CONCEDE NADA ALÉM DE 'read'. Isto foi MEDIDO (caso X8 do gate),
//    não suposto: na escada monotónica admin>write>supervise>read, tudo o que 'supervise' permite
//    'read' também permite. Um papel que o admin ATRIBUI acreditando conceder algo, e que não
//    concede nada, é o mesmo defeito da nota 1 em miniatura. Passa a discriminar quando existir
//    observabilidade do workspace (runs/falhas de TODOS os membros).
//
// Nenhum dos dois é confortável de exibir. Exibir os dois é o único motivo de a tela ser honesta.
// ─────────────────────────────────────────────────────────────────────────────────────────

const ROLES = ["admin", "write", "supervise", "read"];
const RANK = { admin: 4, write: 3, supervise: 2, read: 1 };
const isAdmin = (r) => r === "admin";

const STRINGS = {
  pt: {
    title: "SharedWorkspaces", sub: "Colaboração, regras e memória compartilhada de um projeto.",
    refresh: "Atualizar", loading: "Carregando…",
    loadFail: "Não foi possível carregar os workspaces.",
    none: "Você ainda não participa de nenhum workspace.",
    create: "Novo workspace", createName: "Nome", createSlug: "Identificador (slug)",
    createInstr: "Instruções gerais de execução do projeto",
    createDo: "Criar", cancel: "Cancelar",
    slugHint: "minúsculas, números e hífen",
    members: (n) => `${n} ${n === 1 ? "membro" : "membros"}`,
    vRules: (v) => `regras v${v}`,
    tabRules: "Regras", tabMembers: "Membros", tabKeys: "Chaves", tabMemory: "Memória",
    tabHistory: "Histórico",

    enforceTitle: "Estas regras estão REGISTRADAS e ainda NÃO são aplicadas pelo agente.",
    enforceBody: "O enforcement no runtime é pendente (MZF-WS-ENFORCE). Até ele existir, o que você configura aqui é o contrato do workspace — não um limite que o agente obedece. Não configure supondo contenção.",

    rulesPrompt: "Prompt de sistema do workspace",
    rulesPersonas: "Personas permitidas", rulesWorkflows: "Workflows habilitados",
    rulesModels: "Modelos de LLM ativados",
    rulesListHint: "um por linha · vazio = todos os do catálogo",
    rulesModelsHint: "o workspace RESTRINGE o catálogo aprovado da Mukta; nunca o amplia",
    save: "Salvar regras", saved: "Regras salvas na versão",
    onlyAdmin: "Somente o admin ou o criador do workspace altera as regras.",
    readOnlyRules: "Você lê as regras a que está submetido, mas não as altera — seu papel é",

    roleLabel: "Papel", addMember: "Adicionar membro", memberId: "ID do usuário (uuid)",
    superviseNote: "Atenção: hoje 'supervise' não concede nada além de 'read'. Só passa a diferir quando a observabilidade do workspace existir.",
    remove: "Remover",

    keysSub: "Chave de projeto para o CLI, no modelo das deploy keys do GitHub: o papel é DA CHAVE, e o efetivo é sempre o MENOR entre o da chave e o seu.",
    keyNew: "Nova chave", keyLabel: "Rótulo", keyCreate: "Gerar chave",
    keyOnce: "Copie agora: este segredo não é armazenado e não volta a ser exibido.",
    keyCopy: "Copiar", keyCopied: "Copiado",
    keyRevoke: "Revogar", keyRevoked: "revogada", keyNever: "nunca usada",
    keyUsed: "último uso", noKeys: "Nenhuma chave criada.",
    keyAdminNever: "Uma chave nunca pode ter papel de admin — é limite do esquema, não da tela: nenhuma chave, vazada ou emprestada, altera a governança do workspace.",

    memSub: "Memória compartilhada do projeto: todo membro lê; escrever exige papel 'write' ou superior.",
    memAdd: "Registrar na memória", memEmpty: "Memória vazia.",
    memNoWrite: "Seu papel não permite escrever na memória.",
    histEmpty: "Sem versões anteriores.", histBy: "por", histV: (v) => `v${v}`,
    err: "Erro",
  },
  en: {
    title: "SharedWorkspaces", sub: "Collaboration, rules and shared memory for a project.",
    refresh: "Refresh", loading: "Loading…",
    loadFail: "Could not load workspaces.", none: "You are not in any workspace yet.",
    create: "New workspace", createName: "Name", createSlug: "Identifier (slug)",
    createInstr: "General execution instructions for the project",
    createDo: "Create", cancel: "Cancel", slugHint: "lowercase, digits and hyphen",
    members: (n) => `${n} ${n === 1 ? "member" : "members"}`,
    vRules: (v) => `rules v${v}`,
    tabRules: "Rules", tabMembers: "Members", tabKeys: "Keys", tabMemory: "Memory",
    tabHistory: "History",
    enforceTitle: "These rules are RECORDED and are NOT yet enforced by the agent.",
    enforceBody: "Runtime enforcement is pending (MZF-WS-ENFORCE). Until it exists, what you set here is the workspace contract — not a limit the agent obeys. Do not configure assuming containment.",
    rulesPrompt: "Workspace system prompt",
    rulesPersonas: "Allowed personas", rulesWorkflows: "Enabled workflows",
    rulesModels: "Enabled LLM models",
    rulesListHint: "one per line · empty = all from the catalog",
    rulesModelsHint: "the workspace RESTRICTS Mukta's approved catalog; it never widens it",
    save: "Save rules", saved: "Rules saved at version",
    onlyAdmin: "Only the workspace admin or creator can change the rules.",
    readOnlyRules: "You can read the rules you are subject to, but not change them — your role is",
    roleLabel: "Role", addMember: "Add member", memberId: "User ID (uuid)",
    superviseNote: "Note: today 'supervise' grants nothing beyond 'read'. It only differs once workspace observability exists.",
    remove: "Remove",
    keysSub: "Project key for the CLI, like GitHub deploy keys: the role belongs to THE KEY, and the effective role is always the LOWER of the key's and yours.",
    keyNew: "New key", keyLabel: "Label", keyCreate: "Generate key",
    keyOnce: "Copy it now: this secret is not stored and will not be shown again.",
    keyCopy: "Copy", keyCopied: "Copied",
    keyRevoke: "Revoke", keyRevoked: "revoked", keyNever: "never used",
    keyUsed: "last used", noKeys: "No keys created.",
    keyAdminNever: "A key can never hold the admin role — that is a schema limit, not a UI one: no key, leaked or lent, can change workspace governance.",
    memSub: "Shared project memory: every member reads; writing requires role 'write' or above.",
    memAdd: "Add to memory", memEmpty: "Memory is empty.",
    memNoWrite: "Your role does not allow writing to memory.",
    histEmpty: "No previous versions.", histBy: "by", histV: (v) => `v${v}`,
    err: "Error",
  },
};
STRINGS.es = STRINGS.pt;

const Card = ({ children, className = "" }) => (
  <div className={`rounded-xl border border-border bg-surface ${className}`}>{children}</div>
);

const linesToArr = (s) => {
  const a = String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  return a;
};
const arrToLines = (a) => (Array.isArray(a) ? a.join("\n") : "");

export default function Workspaces({ supabase, lang = "pt" }) {
  const t = useT(STRINGS, lang);
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState("rules");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("mz_my_workspaces");
    // Leitor MUDO foi um defeito real desta base de código (F-3, persona sobre tabela sem grant):
    // o erro era engolido e a tela mostrava "vazio", que é indistinguível de "não tem nenhum".
    if (error) { console.error("mz_my_workspaces:", error); setErr(`${t.loadFail} ${error.message || ""}`.trim()); setLoading(false); return; }
    setList(data || []);
    setLoading(false);
  }, [supabase, t.loadFail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">{t.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.sub}</p>
        </div>
        <button onClick={load} disabled={loading}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {t.refresh}
        </button>
      </header>

      {err ? (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{err}
          </p>
        </Card>
      ) : null}

      {notice ? (
        <Card className="mb-4 border-primary/30 bg-primary-soft p-3">
          <p className="flex items-start gap-2 text-sm text-primary">
            <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{notice}
          </p>
        </Card>
      ) : null}

      {sel ? (
        <Detail supabase={supabase} t={t} ws={sel} onBack={() => { setSel(null); load(); }}
          tab={tab} setTab={setTab} setNotice={setNotice} setErr={setErr} busy={busy} setBusy={setBusy} />
      ) : (
        <List t={t} list={list} loading={loading} supabase={supabase}
          onOpen={(w) => { setSel(w); setTab("rules"); }} onCreated={load} setErr={setErr} />
      )}
    </div>
  );
}

// ── Lista + criação ──────────────────────────────────────────────────────────────────────
function List({ t, list, loading, supabase, onOpen, onCreated, setErr }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", slug: "", instructions: "" });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("mz_ws_create", {
      p_name: f.name, p_slug: f.slug, p_instructions: f.instructions || null,
    });
    setBusy(false);
    if (error) { console.error("mz_ws_create:", error); setErr(`${t.err}: ${error.message}`); return; }
    setOpen(false); setF({ name: "", slug: "", instructions: "" }); onCreated();
  };

  return (
    <>
      {open ? (
        <Card className="mb-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {t.createName}
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              {t.createSlug} <span className="opacity-70">· {t.slugHint}</span>
              <input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-sm text-foreground" />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-[11px] text-muted-foreground">
            {t.createInstr}
            <textarea rows={3} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={create} disabled={busy || !f.name.trim() || f.slug.length < 2}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t.createDo}
            </button>
            <button onClick={() => setOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-2">{t.cancel}</button>
          </div>
        </Card>
      ) : (
        <button onClick={() => setOpen(true)}
          className="mb-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2">
          <Plus className="h-4 w-4" />{t.create}
        </button>
      )}

      {loading ? (
        <div className="grid gap-3">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2/60" />)}</div>
      ) : list.length === 0 ? (
        <Card className="p-6"><p className="text-sm text-muted-foreground">{t.none}</p></Card>
      ) : (
        <div className="grid gap-2">
          {list.map((w) => (
            <button key={w.id} onClick={() => onOpen(w)}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{w.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{w.slug}</span>
              </span>
              <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">{w.my_role}</span>
              <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:inline">{t.members(w.members)}</span>
              <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:inline">{t.vRules(w.rules_version)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Detalhe ──────────────────────────────────────────────────────────────────────────────
function Detail({ supabase, t, ws, onBack, tab, setTab, setNotice, setErr, busy, setBusy }) {
  const admin = isAdmin(ws.my_role);
  const canWrite = RANK[ws.my_role] >= RANK.write;

  const TabBtn = ({ id, label, Icon }) => (
    <button onClick={() => setTab(id)} role="tab" aria-selected={tab === id}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        tab === id ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </button>
  );

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2" aria-label="voltar">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{ws.name}</h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{ws.slug} · {ws.my_role}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border pb-2" role="tablist">
        <TabBtn id="rules" label={t.tabRules} Icon={ScrollText} />
        <TabBtn id="members" label={t.tabMembers} Icon={Users} />
        {admin ? <TabBtn id="keys" label={t.tabKeys} Icon={KeyRound} /> : null}
        <TabBtn id="memory" label={t.tabMemory} Icon={Brain} />
        <TabBtn id="history" label={t.tabHistory} Icon={History} />
      </div>

      {tab === "rules" ? <Rules {...{ supabase, t, ws, admin, setNotice, setErr, busy, setBusy }} /> : null}
      {tab === "members" ? <Members {...{ supabase, t, ws, admin, setErr }} /> : null}
      {tab === "keys" && admin ? <Keys {...{ supabase, t, ws, setErr }} /> : null}
      {tab === "memory" ? <Memory {...{ supabase, t, ws, canWrite, setErr }} /> : null}
      {tab === "history" ? <HistoryTab {...{ supabase, t, ws, setErr }} /> : null}
    </>
  );
}

// ── Regras ───────────────────────────────────────────────────────────────────────────────
function Rules({ supabase, t, ws, admin, setNotice, setErr, busy, setBusy }) {
  const [r, setR] = useState(null);
  const [f, setF] = useState({ prompt: "", personas: "", workflows: "", models: "" });

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("mz_ws_rules_get", { p_ws: ws.id });
      if (error) { console.error("mz_ws_rules_get:", error); setErr(`${t.err}: ${error.message}`); return; }
      const row = (data || [])[0] || {};
      setR(row);
      setF({
        prompt: row.system_prompt || "", personas: arrToLines(row.allowed_personas),
        workflows: arrToLines(row.allowed_workflows), models: arrToLines(row.allowed_models),
      });
    })();
  }, [supabase, ws.id, setErr, t.err]);

  const save = async () => {
    setBusy(true); setErr(""); setNotice("");
    const { data, error } = await supabase.rpc("mz_ws_set_rules", {
      p_ws: ws.id,
      p_system_prompt: f.prompt,
      p_allowed_personas: linesToArr(f.personas),
      p_allowed_workflows: linesToArr(f.workflows),
      p_allowed_models: linesToArr(f.models),
    });
    setBusy(false);
    if (error) { console.error("mz_ws_set_rules:", error); setErr(`${t.err}: ${error.message}`); return; }
    setNotice(`${t.saved} ${data}.`);
    setR({ ...r, version: data });
  };

  const Field = ({ label, hint, value, onChange, rows = 3, mono }) => (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>{label}{hint ? <span className="opacity-70"> · {hint}</span> : null}</span>
      <textarea rows={rows} value={value} disabled={!admin} onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground disabled:opacity-70 ${mono ? "font-mono text-xs" : ""}`} />
    </label>
  );

  return (
    <div className="grid gap-4">
      {/* AVISO 1 — o único ponto desta tela em que eu me recuso a entregar silêncio. */}
      <Card className="border-amber-500/40 bg-amber-500/5 p-3.5">
        <p className="flex items-start gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t.enforceTitle}
        </p>
        <p className="mt-1.5 pl-6 text-xs text-amber-700/90 dark:text-amber-400/80">{t.enforceBody}</p>
      </Card>

      {!admin ? (
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">
            {t.readOnlyRules} <span className="font-medium text-foreground">{ws.my_role}</span>. {t.onlyAdmin}
          </p>
        </Card>
      ) : null}

      {r === null ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-2/60" />
      ) : (
        <Card className="grid gap-3 p-4">
          {ws.instructions || r.instructions ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted-foreground">{r.instructions}</p>
          ) : null}
          <Field label={t.rulesPrompt} value={f.prompt} onChange={(v) => setF({ ...f, prompt: v })} rows={4} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.rulesPersonas} hint={t.rulesListHint} value={f.personas} onChange={(v) => setF({ ...f, personas: v })} />
            <Field label={t.rulesWorkflows} hint={t.rulesListHint} value={f.workflows} onChange={(v) => setF({ ...f, workflows: v })} />
          </div>
          <Field label={t.rulesModels} hint={t.rulesModelsHint} value={f.models} onChange={(v) => setF({ ...f, models: v })} mono />
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={!admin || busy}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t.save}
            </button>
            <span className="text-[11px] tabular-nums text-muted-foreground">{t.vRules(r.version)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Membros ──────────────────────────────────────────────────────────────────────────────
function Members({ supabase, t, ws, admin, setErr }) {
  const [rows, setRows] = useState(null);
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("read");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("mz_workspace_members")
      .select("user_id, role, joined_at").eq("workspace_id", ws.id);
    if (error) { console.error("members:", error); setErr(`${t.err}: ${error.message}`); return; }
    setRows((data || []).sort((a, b) => RANK[b.role] - RANK[a.role]));
  }, [supabase, ws.id, setErr, t.err]);
  useEffect(() => { load(); }, [load]);

  const set = async (u, r) => {
    const { error } = await supabase.rpc("mz_ws_set_member", { p_ws: ws.id, p_user_id: u, p_role: r });
    if (error) { console.error("set_member:", error); setErr(`${t.err}: ${error.message}`); return; }
    setUid(""); load();
  };
  const rm = async (u) => {
    const { error } = await supabase.rpc("mz_ws_remove_member", { p_ws: ws.id, p_user_id: u });
    if (error) { console.error("remove_member:", error); setErr(`${t.err}: ${error.message}`); return; }
    load();
  };

  return (
    <div className="grid gap-4">
      {/* AVISO 2 — medido no caso X8 do gate, não suposto. Sem isto o admin atribui um papel
          acreditando conceder algo que ele não concede. */}
      <Card className="border-amber-500/40 bg-amber-500/5 p-3">
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t.superviseNote}
        </p>
      </Card>

      {admin ? (
        <Card className="flex flex-wrap items-end gap-2 p-3.5">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
            {t.memberId}
            <input value={uid} onChange={(e) => setUid(e.target.value.trim())} placeholder="uuid"
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            {t.roleLabel}
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button onClick={() => set(uid, role)} disabled={uid.length < 30}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Plus className="h-4 w-4" />{t.addMember}
          </button>
        </Card>
      ) : null}

      {rows === null ? <div className="h-24 animate-pulse rounded-xl bg-surface-2/60" /> : (
        <Card>
          {rows.map((m, i) => (
            <div key={m.user_id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? "border-t border-border" : ""}`}>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{m.user_id}</span>
              {admin ? (
                <select value={m.role} onChange={(e) => set(m.user_id, e.target.value)}
                  className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">{m.role}</span>
              )}
              {admin ? (
                <button onClick={() => rm(m.user_id)} title={t.remove} aria-label={t.remove}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Chaves ───────────────────────────────────────────────────────────────────────────────
function Keys({ supabase, t, ws, setErr }) {
  const [rows, setRows] = useState(null);
  const [label, setLabel] = useState("");
  const [role, setRole] = useState("read");
  const [fresh, setFresh] = useState(null);   // segredo recém-criado, exibido UMA vez
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("mz_ws_keys", { p_ws: ws.id });
    if (error) { console.error("mz_ws_keys:", error); setErr(`${t.err}: ${error.message}`); return; }
    setRows(data || []);
  }, [supabase, ws.id, setErr, t.err]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const { data, error } = await supabase.rpc("mz_ws_key_create", { p_ws: ws.id, p_label: label, p_role: role });
    if (error) { console.error("key_create:", error); setErr(`${t.err}: ${error.message}`); return; }
    setFresh((data || [])[0] || null); setLabel(""); setCopied(false); load();
  };
  const revoke = async (id) => {
    const { error } = await supabase.rpc("mz_ws_key_revoke", { p_key_id: id });
    if (error) { console.error("key_revoke:", error); setErr(`${t.err}: ${error.message}`); return; }
    load();
  };

  return (
    <div className="grid gap-4">
      <Card className="p-3">
        <p className="text-xs text-muted-foreground">{t.keysSub}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{t.keyAdminNever}</p>
      </Card>

      {fresh ? (
        <Card className="border-primary/40 bg-primary-soft p-3.5">
          <p className="text-xs font-medium text-primary">{t.keyOnce}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground">{fresh.secret}</code>
            <button onClick={() => { navigator.clipboard?.writeText(fresh.secret); setCopied(true); }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t.keyCopied : t.keyCopy}
            </button>
            <button onClick={() => setFresh(null)} aria-label="fechar"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface"><X className="h-3.5 w-3.5" /></button>
          </div>
        </Card>
      ) : null}

      <Card className="flex flex-wrap items-end gap-2 p-3.5">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[11px] text-muted-foreground">
          {t.keyLabel}
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          {t.roleLabel}
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground">
            {/* 'admin' ausente de propósito: o esquema o recusa, e oferecer para depois falhar é má tela. */}
            {["write", "supervise", "read"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button onClick={create} disabled={!label.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          <KeyRound className="h-4 w-4" />{t.keyCreate}
        </button>
      </Card>

      {rows === null ? <div className="h-20 animate-pulse rounded-xl bg-surface-2/60" />
        : rows.length === 0 ? <Card className="p-4"><p className="text-sm text-muted-foreground">{t.noKeys}</p></Card> : (
        <Card>
          {rows.map((k, i) => (
            <div key={k.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? "border-t border-border" : ""} ${k.revoked_at ? "opacity-55" : ""}`}>
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{k.label}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{k.key_prefix}…</span>
              </span>
              <span className="shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">{k.role}</span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {k.revoked_at ? t.keyRevoked : k.last_used_at ? `${t.keyUsed} ${new Date(k.last_used_at).toLocaleString()}` : t.keyNever}
              </span>
              {!k.revoked_at ? (
                <button onClick={() => revoke(k.id)} title={t.keyRevoke} aria-label={t.keyRevoke}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Memória ──────────────────────────────────────────────────────────────────────────────
function Memory({ supabase, t, ws, canWrite, setErr }) {
  const [rows, setRows] = useState(null);
  const [txt, setTxt] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("mz_ws_memory", { p_ws: ws.id, p_limit: 100 });
    if (error) { console.error("mz_ws_memory:", error); setErr(`${t.err}: ${error.message}`); return; }
    setRows(data || []);
  }, [supabase, ws.id, setErr, t.err]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const { error } = await supabase.rpc("mz_ws_memory_append", { p_ws: ws.id, p_content: txt });
    if (error) { console.error("memory_append:", error); setErr(`${t.err}: ${error.message}`); return; }
    setTxt(""); load();
  };

  return (
    <div className="grid gap-4">
      <Card className="p-3"><p className="text-xs text-muted-foreground">{t.memSub}</p></Card>

      {canWrite ? (
        <Card className="p-3.5">
          <textarea rows={3} value={txt} onChange={(e) => setTxt(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground" />
          <button onClick={add} disabled={!txt.trim()}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Brain className="h-4 w-4" />{t.memAdd}
          </button>
        </Card>
      ) : (
        <Card className="p-3"><p className="text-xs text-muted-foreground">{t.memNoWrite}</p></Card>
      )}

      {rows === null ? <div className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
        : rows.length === 0 ? <Card className="p-4"><p className="text-sm text-muted-foreground">{t.memEmpty}</p></Card> : (
        <Card>
          {rows.map((m, i) => (
            <div key={m.id} className={`px-3.5 py-2.5 ${i ? "border-t border-border" : ""}`}>
              <p className="whitespace-pre-wrap text-sm text-foreground">{m.content}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{new Date(m.created_at).toLocaleString()}</span>
                <span className="rounded border border-border px-1">{m.kind}</span>
                {/* Autoria por CHAVE, não por pessoa: escrita vinda do CLI pode não ter usuário. */}
                {m.author_key_id ? <span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" />CLI</span> : null}
                {m.author_user_id ? <span className="font-mono opacity-70">{String(m.author_user_id).slice(0, 8)}</span> : null}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Histórico das regras ─────────────────────────────────────────────────────────────────
function HistoryTab({ supabase, t, ws, setErr }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("mz_ws_rules_history", { p_ws: ws.id });
      if (error) { console.error("rules_history:", error); setErr(`${t.err}: ${error.message}`); return; }
      setRows(data || []);
    })();
  }, [supabase, ws.id, setErr, t.err]);

  return (
    <div className="grid gap-4">
      <Card className="p-3">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {/* Por que TODO membro vê: quem obedece à regra tem direito ao registro de quando ela
              mudou. Foi o conserto do caso X6 do gate — a premissa errada era a minha. */}
          {t.tabHistory}
        </p>
      </Card>
      {rows === null ? <div className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
        : rows.length === 0 ? <Card className="p-4"><p className="text-sm text-muted-foreground">{t.histEmpty}</p></Card> : (
        <Card>
          {rows.map((h, i) => (
            <div key={h.version} className={`px-3.5 py-2.5 ${i ? "border-t border-border" : ""}`}>
              <p className="flex items-center gap-2 text-xs">
                <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{t.histV(h.version)}</span>
                <span className="text-muted-foreground">{h.updated_at ? new Date(h.updated_at).toLocaleString() : ""}</span>
                {h.updated_by ? <span className="font-mono text-[11px] text-muted-foreground">{t.histBy} {String(h.updated_by).slice(0, 8)}</span> : null}
              </p>
              {h.system_prompt ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{h.system_prompt}</p> : null}
              <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {h.allowed_personas?.length ? <span>personas: {h.allowed_personas.join(", ")}</span> : null}
                {h.allowed_workflows?.length ? <span>workflows: {h.allowed_workflows.join(", ")}</span> : null}
                {h.allowed_models?.length ? <span>modelos: {h.allowed_models.length}</span> : null}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
