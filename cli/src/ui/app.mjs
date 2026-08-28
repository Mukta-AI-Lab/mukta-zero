// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli ui/app — A JANELA. Uma só, ocupando o terminal inteiro:
 * barra de abas em cima, transcript no meio, caixa de pedido embaixo, barra de
 * estado no rodapé, e painéis (`/`, `@`, `+`) sobrepostos logo acima do input.
 *
 * Decisões que valem registro:
 *  - Repinta o FRAME INTEIRO numa única escrita. Diff de tela dá menos bytes,
 *    mas custa uma classe de bug (resto de frame anterior) que num agente de
 *    engenharia aparece como "o terminal está mentindo".
 *  - O modo de execução mora na barra de estado e cicla com Shift+Tab. Nunca
 *    fica escondido: é a coisa que decide se o agente pode escrever no disco.
 *  - Trabalho roda POR ABA e não bloqueia a janela; a aba pisca ao terminar.
 *  - Cancelar diz a verdade (o job segue no servidor e devolve job_id).
 */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import {
  screen, decodeKey, width, truncate, pad, wrapText, dim, bold, inverse, C, useColor, CSI,
} from "./ansi.mjs";
import { markLines } from "./logo.mjs";
import { MODES, getMode, nextMode, modeColorCode, checkAccess } from "./modes.mjs";
import { createStore, activeTab, addTab, closeTab, selectTab, cycleTab, tabBarCells, persist, MAX_TABS } from "./tabs.mjs";
import { matchFiles, extractMentions, fileIndex } from "./files.mjs";
import { ATTACH_TYPES, attachFile, attachDir, attachGitDiff, attachCommand, attachText, attachUrl, chip, composePrompt } from "./attach.mjs";
import { buildRegistry, matchSlash, parseSlash } from "./slash.mjs";
import { run as engineRun, runReview, makeCancelToken, Cancelled, auth as engineAuth, resetAuth, resetContext } from "./engine.mjs";
import { workspaceRoot, sessionLabel, listSessions } from "../session.mjs";
import { listRuns } from "../run-store.mjs";
import { localIdentity, createAuthedClient, saveSession } from "../auth.mjs";
import { searchProject } from "../search.mjs";
import { listStates } from "../state-store.mjs";
import { listProviders } from "../providers.mjs";
import { SUPABASE_URL, COMPANION_RUNTIME_BASE_URL, ACTIVE_TARGET_KIND, CLI_AUTH_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.mjs";

const CLI_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.mjs");
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MAX_INPUT_ROWS = 8;
const MAX_POPUP_ROWS = 10;

export async function startTui({ mode: initialMode = null } = {}) {
  const S = {
    store: createStore(),
    popup: null, // {kind, items, index, query, onSelect}
    ask: null, // pergunta de uma linha reaproveitando a caixa de pedido
    footer: "",
    footerKind: "info",
    quitArmed: false,
    closeArmed: false,
    tick: 0,
    running: true,
  };
  if (initialMode) for (const t of S.store.tabs) t.mode = initialMode;

  const tab = () => activeTab(S.store);
  const anyRunning = () => S.store.tabs.some((t) => t.running);

  /* ───────────────── transcript ───────────────── */

  const push = (t, role, text) => {
    t.transcript.push({ role, text: String(text), ts: Date.now() });
    if (t.transcript.length > 500) t.transcript.splice(0, t.transcript.length - 500);
    t.scroll = 0;
  };
  const say = (text, role = "sys") => push(tab(), role, text);
  const footer = (text, kind = "info") => { S.footer = text; S.footerKind = kind; };

  /* ───────────────── ações dos comandos `/` ───────────────── */

  const actions = {
    help: () => { say(helpText(), "help"); return null; },
    clearTranscript: () => { tab().transcript = []; return null; },
    newConversation: () => {
      const t = tab();
      t.conversationId = cryptoUUID();
      t.transcript = [];
      persist(S.store);
      return "conversa nova — a memória turno-a-turno desta aba foi zerada";
    },
    history: () => {
      const runs = listRuns(15);
      if (!runs.length) return "sem histórico nesta sessão";
      return ["runs recentes:", ...runs.map((r) => `  ${String(r.ts || "").replace("T", " ").slice(0, 19)}  [${r.exit === 0 ? "ok " : "err"}]  ${r.command}  ${r.input ? `"${String(r.input).slice(0, 40)}"` : ""}`)].join("\n");
    },
    sessions: () => {
      const rows = listSessions();
      if (!rows.length) return "nenhuma sessão registrada";
      return ["sessões conhecidas:", ...rows.map((r) => `  ${r.label || r.key}  ·  ${(r.updated_at || "").slice(0, 19)}  ·  ${r.workspace || ""}`)].join("\n");
    },
    whoami: () => {
      const id = localIdentity();
      if (!id || id.expired) return `não logado${id && id.expired ? " (sessão expirada)" : ""} · sessão ${sessionLabel()} — use /entrar`;
      return `logado como ${id.username || id.sub} (${id.source}) · sessão ${id.label}${id.exp ? ` · expira ${new Date(id.exp * 1000).toISOString()}` : ""}`;
    },
    // `/entrar <usuário>` → senha aqui mesmo (campo mascarado).
    // `/entrar` sem argumento → device-flow no navegador, conduzido pela janela.
    // Antes isto só mandava o usuário para OUTRO terminal, o que na prática
    // significava que não dava para entrar pela janela.
    login: (arg) => {
      if (!arg) { startDeviceFlow(); return null; }
      S.ask = {
        label: `senha de ${arg}  (Esc cancela)`,
        value: "",
        secret: true,
        onSubmit: (pw) => { void doPasswordLogin(arg, pw); },
      };
      return null;
    },
    quit: () => { S.running = false; return null; },

    attach: (arg) => { openAttachMenu(arg); return null; },
    listAttachments: () => {
      const t = tab();
      if (!t.attachments.length) return "nenhum anexo — use + (ou @arquivo) para anexar";
      return ["anexos deste pedido:", ...t.attachments.map((x) => `  [${x.id}] ${chip(x)}`)].join("\n");
    },
    detach: (arg) => {
      const t = tab();
      if (!arg) return "uso: /desanexar <id|todos>";
      if (arg === "todos") { const n = t.attachments.length; t.attachments = []; return `${n} anexo(s) removido(s)`; }
      const before = t.attachments.length;
      t.attachments = t.attachments.filter((x) => x.id !== arg && x.label !== arg);
      return t.attachments.length < before ? `anexo ${arg} removido` : `anexo ${arg} não encontrado`;
    },
    findFiles: (arg) => {
      const hits = matchFiles(arg || "", 15);
      if (!hits.length) return `nenhum arquivo casa "${arg}"`;
      return [`arquivos (${fileIndex().length} indexados):`, ...hits.map((f) => `  ${f}`), "", "anexe com @<caminho> no pedido"].join("\n");
    },
    search: (arg) => {
      if (!arg) return "uso: /busca <regex>";
      const { engine, matches } = searchProject(arg, { cwd: workspaceRoot(), maxResults: 40 });
      if (!matches.length) return `sem resultados para /${arg}/ (motor ${engine})`;
      return [`${matches.length} resultado(s) · motor ${engine}:`, ...matches.map((m) => `  ${m.file}:${m.line}: ${m.text.slice(0, 120)}`)].join("\n");
    },
    diff: () => {
      try {
        const out = execFileSync("git", ["diff", "--stat", "HEAD"], { cwd: workspaceRoot(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return out.trim() ? `git diff --stat HEAD:\n${out.trim()}` : "working tree limpo";
      } catch (e) { return `git diff falhou: ${e.message.split("\n")[0]}`; }
    },

    setMode: (arg) => {
      const t = tab();
      if (!arg) return `modo atual: ${t.mode} — ${getMode(t.mode).hint}\nmodos: ${MODES.map((m) => m.id).join(" · ")} (Shift+Tab cicla)`;
      const m = MODES.find((x) => x.id === arg.toLowerCase());
      if (!m) return `modo desconhecido "${arg}" — use: ${MODES.map((x) => x.id).join(", ")}`;
      t.mode = m.id;
      persist(S.store);
      return `modo: ${m.id} — ${m.hint}`;
    },
    cancel: () => {
      const t = tab();
      if (!t.running || !t.cancel) return "nada rodando nesta aba";
      t.cancel();
      return null;
    },
    review: (arg) => {
      if (!arg) return "uso: /revisar <arquivo>";
      startTask(tab(), { kind: "review", file: arg });
      return null;
    },
    plan: (arg) => {
      if (!arg) return "uso: /plano <objetivo>";
      const t = tab();
      const prev = t.mode;
      t.mode = "plano";
      submit(arg, { restoreMode: prev });
      return null;
    },
    states: () => {
      const st = listStates();
      if (!st.length) return "nenhum estado especialista criado (crie com `mz state create`)";
      return ["estados:", ...st.map((s) => `  ${s.status === "approved" ? "✓" : "·"} ${s.name} — ${s.description || "(sem descrição)"}`)].join("\n");
    },

    tabCmd: (arg) => {
      if (!arg || arg === "nova") {
        const r = addTab(S.store, {});
        return r.ok ? `aba ${S.store.tabs.length} aberta` : r.error;
      }
      if (arg === "fechar") {
        const r = closeTab(S.store, S.store.active, { force: S.closeArmed });
        S.closeArmed = Boolean(r.needsForce);
        return r.ok ? "aba fechada" : r.error;
      }
      const n = Number(arg);
      if (Number.isInteger(n) && selectTab(S.store, n - 1)) return null;
      return `uso: /aba [nova|fechar|<1..${S.store.tabs.length}>]`;
    },
    listTabs: () =>
      ["abas:", ...S.store.tabs.map((t, i) => `  ${i === S.store.active ? "▸" : " "} ${i + 1}. ${t.title} · modo ${t.mode} · ${t.running ? `EXECUTANDO (${t.phase || "…"})` : "ociosa"} · ${t.transcript.length} msgs`)].join("\n"),
    renameTab: (arg) => {
      if (!arg) return "uso: /renomear <título>";
      tab().title = arg.slice(0, 24);
      persist(S.store);
      return null;
    },

    provider: (arg) => {
      const rows = listProviders();
      if (!arg) {
        const cur = tab().provider ? `\nprovedor desta aba: ${tab().provider}` : "\nesta aba usa a nuvem Mukta (padrão)";
        if (!rows.length) return "nenhum provedor BYOK configurado — use `mz config set-provider <nome> --key <k>`" + cur;
        return ["provedores BYOK:", ...rows.map((r) => `  ${r.name}  ${r.base_url || "-"}  ${r.api_key_masked}  ${r.default_model || "-"}`), "", "/provedor <nome> usa um nesta aba · /provedor mukta volta para a nuvem"].join("\n") + cur;
      }
      if (arg === "mukta" || arg === "nuvem") { tab().provider = null; return "esta aba voltou para a nuvem Mukta"; }
      if (!rows.some((r) => r.name === arg)) return `provedor "${arg}" não configurado`;
      tab().provider = arg;
      return `esta aba passa a chamar ${arg} diretamente (BYOK)`;
    },
    target: () => `alvo: ${ACTIVE_TARGET_KIND}\n  auth:    ${SUPABASE_URL}\n  runtime: ${COMPANION_RUNTIME_BASE_URL}`,
    init: (arg) => {
      try {
        const out = execFileSync(process.execPath, [CLI_ENTRY, "init", ...(arg === "global" ? ["--global"] : [])], { cwd: workspaceRoot(), encoding: "utf8" });
        return out.trim();
      } catch (e) { return `init falhou: ${String(e.stdout || e.message).slice(0, 300)}`; }
    },
    version: () => {
      try {
        const out = execFileSync(process.execPath, [CLI_ENTRY, "version"], { encoding: "utf8" });
        return `mz-cli ${out.trim()}`;
      } catch { return "versão indisponível"; }
    },
  };

  const REGISTRY = buildRegistry(actions);

  /* ───────────────── execução ───────────────── */

  /** Dispara um trabalho na aba (não bloqueia a janela). */
  function startTask(t, task) {
    if (t.running) { footer("esta aba já está executando — /parar cancela", "warn"); return; }
    const token = makeCancelToken();
    t.running = true;
    t.phase = "iniciando";
    t.startedAt = Date.now();
    t.lastError = "";
    t.cancel = () => token.cancel();

    const onEvent = (e) => {
      if (e.type === "phase") { t.phase = e.phase; }
      else if (e.type === "note") push(t, "sys", e.text);
      else if (e.type === "diff") push(t, "diff", [`── ${e.file} ──`, ...e.lines].join("\n"));
      else if (e.type === "approve") {
        // A aprovação mora NA ABA, não na janela: uma aba de fundo pedindo
        // aprovação não pode sequestrar as teclas da aba em foco. Ela pisca e
        // espera você chegar lá.
        t.approve = { file: e.file, resolve: e.resolve };
        if (t.id !== tab().id) t.unread = true;
      }
      render();
    };

    const done = (fn) => {
      t.running = false;
      t.cancel = null;
      t.phase = "";
      fn();
      if (t.id !== tab().id) t.unread = true;
      render();
    };

    const p = task.kind === "review"
      ? runReview({ file: task.file, token, onEvent })
      : engineRun({ prompt: task.prompt, rawText: task.rawText, tab: t, token, onEvent, attachments: task.attachments || [] });

    p.then((r) => done(() => {
      if (r.ok) push(t, "mz", r.text || "(vazio)");
      else { t.lastError = r.error || "falhou"; push(t, "err", r.error || "falhou"); }
      if (task.restoreMode) t.mode = task.restoreMode;
    })).catch((e) => done(() => {
      if (e instanceof Cancelled) push(t, "sys", "cancelado — a espera parou aqui; se havia job no servidor, ele segue e volta com `mz ask --resume <job_id>`");
      else push(t, "err", `erro: ${e && e.message ? e.message : String(e)}`);
      if (task.restoreMode) t.mode = task.restoreMode;
    }));
    render();
  }

  /** Envia o texto do input (ou um texto dado) como pedido. */
  function submit(text, opts = {}) {
    const t = tab();
    const raw = String(text).trim();
    if (!raw) return;
    if (t.running) { footer("aba ocupada — abra outra com Ctrl+T ou pare com /parar", "warn"); return; }

    // `@caminho` citado no texto entra como anexo automático (uma vez cada).
    for (const m of extractMentions(raw)) {
      if (t.attachments.some((x) => x.label === m)) continue;
      const r = attachFile(m);
      if (r.ok) t.attachments.push(r.att);
      else push(t, "err", r.error);
    }

    push(t, "user", raw);
    if (t.attachments.length) push(t, "sys", `com ${t.attachments.length} anexo(s): ${t.attachments.map((x) => x.label).join(", ")}`);
    if (t.title.startsWith("aba ") || t.title === "principal") {
      const guess = raw.replace(/\s+/g, " ").slice(0, 18);
      if (guess.length > 3) { t.title = guess; persist(S.store); }
    }

    const prompt = composePrompt(raw, t.attachments);
    const anexosDoTurno = t.attachments;
    t.attachments = [];
    t.history.unshift(raw);
    t.histIdx = -1;
    startTask(t, { prompt, rawText: raw, attachments: anexosDoTurno, restoreMode: opts.restoreMode });
  }

  /** `!comando` — o USUÁRIO roda um comando (não o agente). Confirma se o modo não permite exec. */
  function runShell(cmd) {
    const t = tab();
    const chk = checkAccess(t.mode, "exec");
    const go = () => {
      const r = attachCommand(cmd);
      push(t, "user", `!${cmd}`);
      push(t, "shell", r.att.content.slice(0, 4000));
      t.attachments.push(r.att);
      footer(`saída anexada ao próximo pedido (${chip(r.att)})`, "ok");
      render();
    };
    if (chk.allowed) { go(); return; }
    S.ask = {
      label: `rodar "${cmd}"? o modo ${t.mode} não roda comandos — [s/n]`,
      value: "",
      confirm: true,
      onSubmit: (v) => { if (/^s|^y/i.test(v.trim())) go(); },
    };
  }

  /* ───────────────── login ───────────────── */

  /**
   * Login por senha, dentro da janela. A senha vai DIRETO de S.ask para
   * createAuthedClient (o mesmo caminho do `mz login`): não entra no transcript,
   * não vira anexo, não é registrada no histórico e não sobrevive à chamada.
   */
  async function doPasswordLogin(username, password) {
    if (!password) { say("senha vazia — login cancelado.", "err"); render(); return; }
    say(`autenticando ${username}…`, "sys");
    render();
    try {
      const auth = await createAuthedClient(username, password);
      saveSession(username, auth.session);
      resetAuth();
      resetContext();
      say(`✓ logado como ${username} · sessão ${sessionLabel()}`, "sys");
      footer("login ok", "ok");
    } catch (e) {
      // Mensagem do GoTrue, sem enfeite: "Invalid login credentials" é
      // informação útil (usuário/senha errados), e mascarar isso faria o usuário
      // caçar um problema de rede que não existe.
      say(`login falhou: ${e.message}`, "err");
      footer("login falhou", "err");
    }
    render();
  }

  /**
   * Device-flow (o mesmo do `mz auth`) conduzido pela janela: pede o código,
   * mostra URL + código no transcript, tenta abrir o navegador e faz o poll até
   * aprovar/expirar. Roda como TRABALHO DA ABA, então Esc cancela e a janela
   * continua utilizável enquanto você autoriza no navegador.
   */
  function startDeviceFlow() {
    const t = tab();
    if (t.running) { footer("aba ocupada — abra outra com Ctrl+T", "warn"); return; }
    const token = makeCancelToken();
    t.running = true;
    t.phase = "solicitando código";
    t.startedAt = Date.now();
    t.cancel = () => token.cancel();

    const H = { apikey: SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" };
    const done = (fn) => { t.running = false; t.cancel = null; t.phase = ""; fn(); render(); };

    (async () => {
      const r = await token.race(fetch(CLI_AUTH_URL, { method: "POST", headers: H, body: JSON.stringify({ action: "start", client_name: "mz-cli" }) }));
      const s = await r.json();
      if (!s || !s.device_code) throw new Error(`o servidor de auth não devolveu código: ${s && s.error ? s.error : `HTTP ${r.status}`}`);

      push(t, "sys", [`Abra no navegador:  ${s.verification_url}`, `Código de verificação:  ${s.user_code}`, "", "Aguardando você autorizar… (Esc cancela)"].join("\n"));
      t.phase = "aguardando autorização";
      render();
      try {
        const opener = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
        const oargs = process.platform === "win32" ? ["/c", "start", "", s.verification_url] : [s.verification_url];
        spawn(opener, oargs, { stdio: "ignore", detached: true }).unref();
      } catch { /* o usuário abre o link à mão */ }

      const interval = (s.interval || 3) * 1000;
      const deadline = Date.now() + (s.expires_in || 600) * 1000;
      while (Date.now() < deadline) {
        await token.race(new Promise((res) => setTimeout(res, interval)));
        let p;
        try {
          const pr = await token.race(fetch(CLI_AUTH_URL, { method: "POST", headers: H, body: JSON.stringify({ action: "poll", device_code: s.device_code }) }));
          p = await pr.json();
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          continue; // rede oscilou — segue tentando até o prazo
        }
        if (p.status === "approved" && p.access_token) {
          let username = "mz-user";
          try {
            const c = JSON.parse(Buffer.from(p.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
            username = c.email || c.sub || username;
          } catch { /* token sem claim legível — o login vale igual */ }
          saveSession(username, { access_token: p.access_token, refresh_token: null, expires_at: Math.floor(Date.now() / 1000) + (p.expires_in || 86400) });
          resetAuth();
          resetContext();
          return `✓ autorizado como ${username} — sessão de 24h salva`;
        }
        if (["expired", "not_found", "denied", "consumed", "rate_limited"].includes(p.status)) {
          throw new Error(`autorização ${p.status} — rode /entrar de novo`);
        }
      }
      throw new Error("tempo esgotado sem aprovação — rode /entrar de novo");
    })()
      .then((msg) => done(() => { push(t, "sys", msg); footer("login ok", "ok"); }))
      .catch((e) => done(() => {
        if (e instanceof Cancelled) push(t, "sys", "login cancelado.");
        else push(t, "err", `login falhou: ${e.message}`);
      }));
    render();
  }

  /* ───────────────── painéis (`/`, `@`, `+`) ───────────────── */

  function openSlashPopup(query) {
    const items = matchSlash(REGISTRY, query);
    S.popup = { kind: "slash", items, index: 0, query };
  }
  function openFilePopup(query) {
    const items = matchFiles(query, MAX_POPUP_ROWS);
    S.popup = { kind: "file", items, index: 0, query };
  }
  function openAttachMenu(arg) {
    if (arg) { doAttach("arquivo", arg); return; }
    S.popup = { kind: "attach", items: ATTACH_TYPES, index: 0, query: "" };
  }

  async function doAttach(typeId, arg) {
    const t = tab();
    let r;
    if (typeId === "arquivo") r = attachFile(arg);
    else if (typeId === "pasta") r = attachDir(arg);
    else if (typeId === "diff") r = attachGitDiff();
    else if (typeId === "comando") r = attachCommand(arg);
    else if (typeId === "texto") r = attachText(arg);
    else if (typeId === "url") { footer("baixando…", "info"); render(); r = await attachUrl(arg); }
    else r = { ok: false, error: `tipo desconhecido: ${typeId}` };

    if (r.ok) { t.attachments.push(r.att); footer(`anexado: ${chip(r.att)}`, "ok"); }
    else { footer(r.error, "err"); }
    render();
  }

  /** Reavalia se um painel deve estar aberto, a partir do texto e do cursor. */
  function syncPopupFromInput() {
    const t = tab();
    const left = t.input.slice(0, t.cursor);
    if (S.popup && S.popup.kind === "attach") return; // menu do `+` não segue o texto
    if (/^\/\S*$/.test(t.input.trimStart()) && t.input.trimStart() === t.input) {
      openSlashPopup(t.input.slice(1));
      return;
    }
    const at = left.match(/(?:^|\s)@([^\s@]*)$/);
    if (at) { openFilePopup(at[1]); return; }
    if (S.popup && (S.popup.kind === "slash" || S.popup.kind === "file")) S.popup = null;
  }

  function acceptPopup({ execute = false } = {}) {
    const t = tab();
    const p = S.popup;
    if (!p || !p.items.length) return;
    const item = p.items[p.index];

    if (p.kind === "file") {
      const left = t.input.slice(0, t.cursor);
      const m = left.match(/(?:^|\s)@([^\s@]*)$/);
      if (m) {
        const start = t.cursor - m[1].length;
        t.input = t.input.slice(0, start) + item + t.input.slice(t.cursor);
        t.cursor = start + item.length;
      }
      S.popup = null;
      return;
    }
    if (p.kind === "slash") {
      const parsed = parseSlash(t.input) || { name: "", arg: "" };
      if (!execute) {
        t.input = `/${item.name}${item.arg ? " " : ""}`;
        t.cursor = t.input.length;
        S.popup = null;
        return;
      }
      S.popup = null;
      t.input = "";
      t.cursor = 0;
      runSlash(item, parsed.arg);
      return;
    }
    if (p.kind === "attach") {
      S.popup = null;
      if (!item.needsArg) { doAttach(item.id); return; }
      S.ask = {
        label: `${item.label} — ${item.argHint}`,
        value: "",
        picker: item.id === "arquivo" ? "file" : null,
        onSubmit: (v) => { if (v.trim()) doAttach(item.id, v.trim()); },
      };
    }
  }

  function runSlash(cmd, arg) {
    try {
      const out = cmd.run(arg);
      if (typeof out === "string" && out) say(out, "sys");
    } catch (e) {
      say(`/${cmd.name} falhou: ${e.message}`, "err");
    }
  }

  function handleLine(line) {
    const t = tab();
    if (line.startsWith("!")) { runShell(line.slice(1).trim()); return; }
    if (line.startsWith("/")) {
      const parsed = parseSlash(line);
      const found = REGISTRY.find((c) => c.name === parsed.name);
      if (!found) {
        const near = matchSlash(REGISTRY, parsed.name).slice(0, 4).map((c) => `/${c.name}`);
        say(`comando /${parsed.name} não existe.${near.length ? ` Quis dizer: ${near.join(", ")}?` : " Veja /ajuda."}`, "err");
        return;
      }
      runSlash(found, parsed.arg);
      return;
    }
    if (line.startsWith("+")) { openAttachMenu(line.slice(1).trim() || null); return; }
    submit(line);
  }

  /* ───────────────── render ───────────────── */

  function render() {
    const { cols, rows } = screen.size();
    const t = tab();
    const lines = [];

    // 1) barra de abas
    lines.push(renderTabBar(cols));

    // 3) input (altura dinâmica) + 4) rodapé
    const askMode = Boolean(S.ask);
    // Campo SECRETO (senha) nunca é pintado em claro: a caixa de pedido fica
    // visível o tempo todo, e o terminal costuma estar compartilhado numa call.
    // O valor real segue em S.ask.value; só a pintura vira bolinha.
    const inputText = askMode ? (S.ask.secret ? "•".repeat(S.ask.value.length) : S.ask.value) : t.input;
    const inputLabel = askMode ? S.ask.label : `pedido · ${t.title}`;
    const innerW = cols - 4;
    const inputWrapped = wrapText(inputText || "", innerW);
    const inputRows = Math.min(Math.max(inputWrapped.length, 1), MAX_INPUT_ROWS);
    const chipsRows = t.attachments.length ? wrapText(t.attachments.map((x) => `[${x.id}] ${chip(x)}`).join("   "), cols - 2).slice(0, 2) : [];

    // 2) painel sobreposto — encolhe para caber. Num terminal baixo quem cede é
    // o painel, nunca a caixa de pedido: perder o input é perder a janela.
    const popupRoom = rows - (1 + 1 + inputRows + 2 + chipsRows.length + 3);
    const popupLines = renderPopup(cols, Math.min(MAX_POPUP_ROWS, Math.max(0, popupRoom)));

    const used = 1 + chipsRows.length + popupLines.length + (inputRows + 2) + 1;
    const bodyRows = Math.max(3, rows - used);

    lines.push(...renderTranscript(t, cols, bodyRows));
    for (const c of chipsRows) lines.push(C.chip(truncate(` ${c}`, cols)));
    lines.push(...popupLines);

    // caixa do pedido
    const label = truncate(inputLabel, Math.max(8, cols - 8));
    lines.push(dim(`┌─ ${label} ` + "─".repeat(Math.max(0, cols - width(label) - 5)) + "┐"));

    // Posição do cursor: quebra o TRECHO ANTES do cursor com a mesma largura —
    // a última linha desse trecho dá (linha, coluna) dentro da caixa.
    const caret = askMode ? S.ask.value.length : t.cursor;
    const before = wrapText(String(inputText).slice(0, caret), innerW);
    const caretAbsRow = Math.max(0, before.length - 1);
    const caretCol = 2 + width(before[before.length - 1] ?? "");
    const firstShown = Math.max(0, inputWrapped.length - inputRows);
    const shown = inputWrapped.slice(firstShown);
    const boxTop = lines.length;
    for (let i = 0; i < inputRows; i += 1) {
      const text = shown[i] ?? "";
      const body = text || (i === 0 && !inputText ? dim(truncate(placeholder(t), innerW)) : "");
      lines.push(dim("│ ") + (text ? truncate(text, innerW) : body));
    }
    const cursorRow = boxTop + Math.min(inputRows - 1, Math.max(0, caretAbsRow - firstShown));
    const cursorCol = caretCol;
    lines.push(dim("└" + "─".repeat(Math.max(0, cols - 2)) + "┘"));

    // rodapé
    lines.push(renderStatus(cols, t));

    screen.paint(lines.map((l) => truncate(l, cols)));
    if (!t.approve) screen.showCursorAt(cursorRow, Math.min(cols - 1, cursorCol));
    else screen.hideCursor();
  }

  function placeholder(t) {
    if (t.approve) return "";
    return `escreva o pedido · / comandos · @ arquivos · + anexos · Shift+Tab modo (${t.mode})`;
  }

  function renderTabBar(cols) {
    const cells = tabBarCells(S.store);
    let s = "";
    cells.forEach((c, i) => {
      const label = c.text;
      s += c.active ? inverse(bold(label)) : c.running ? C.warn(label) : c.unread ? C.ok(label) : dim(label);
      if (i < cells.length - 1) s += dim("│");
    });
    const right = S.store.tabs.length < MAX_TABS ? dim("  Ctrl+T nova aba ") : dim("  (máx. abas) ");
    const padN = Math.max(0, cols - width(s) - width(right));
    return s + " ".repeat(padN) + right;
  }

  function renderTranscript(t, cols, bodyRows) {
    // O splash é o CABEÇALHO do transcript, não um estado vazio: assim ele não
    // some no instante em que chega a primeira mensagem de sistema — ele rola
    // para cima como qualquer conteúdo, e volta com PgUp.
    const all = [...welcomeLines(cols, t)];
    for (const e of t.transcript) all.push(...renderEntry(e, cols));

    if (t.running) {
      const sp = SPINNER[S.tick % SPINNER.length];
      const secs = Math.floor((Date.now() - t.startedAt) / 1000);
      all.push("");
      all.push(C.accent(`${sp} ${t.phase || "trabalhando"}… ${secs}s`) + dim("   (Esc cancela)"));
    }
    if (t.approve) {
      all.push("");
      all.push(C.warn(`aplicar a mudança em ${t.approve.file}?  [s] aplica   [n] pula   [Esc] cancela tudo`));
    }

    const maxScroll = Math.max(0, all.length - bodyRows);
    t.scroll = Math.min(t.scroll, maxScroll);
    const start = Math.max(0, all.length - bodyRows - t.scroll);
    const view = all.slice(start, start + bodyRows);
    while (view.length < bodyRows) view.unshift("");
    if (t.scroll > 0) view[0] = dim(`↑ ${t.scroll} linha(s) acima — PgUp/PgDn rola, End volta ao fim`);
    return view;
  }

  function renderEntry(e, cols) {
    const w = cols - 2;
    const out = [];
    if (e.role === "user") {
      for (const [i, l] of wrapText(e.text, w - 2).entries()) out.push(C.user(i === 0 ? `❯ ${l}` : `  ${l}`));
      return out;
    }
    if (e.role === "mz") {
      out.push(C.accent("◆ mz"));
      for (const l of wrapText(e.text, w)) out.push(`  ${l}`);
      out.push("");
      return out;
    }
    if (e.role === "err") {
      for (const [i, l] of wrapText(e.text, w - 2).entries()) out.push(C.err(i === 0 ? `✗ ${l}` : `  ${l}`));
      out.push("");
      return out;
    }
    if (e.role === "diff") {
      for (const l of e.text.split("\n")) {
        out.push(l.startsWith("+") ? C.ok(truncate(l, w)) : l.startsWith("-") ? C.err(truncate(l, w)) : dim(truncate(l, w)));
      }
      out.push("");
      return out;
    }
    if (e.role === "shell") {
      for (const l of e.text.split("\n").slice(0, 40)) out.push(dim(truncate(`  ${l}`, w)));
      out.push("");
      return out;
    }
    if (e.role === "help") {
      for (const l of e.text.split("\n")) out.push(truncate(l, w));
      out.push("");
      return out;
    }
    for (const [i, l] of wrapText(e.text, w - 2).entries()) out.push(dim(i === 0 ? `· ${l}` : `  ${l}`));
    return out;
  }

  function renderPopup(cols, maxRows = MAX_POPUP_ROWS) {
    const p = S.popup;
    if (!p || maxRows < 3) return [];
    const rowsN = Math.min(p.items.length, maxRows - 2);
    if (!rowsN) {
      return [dim(`┌─ ${p.kind === "file" ? "arquivos" : "comandos"} ` + "─".repeat(Math.max(0, cols - 14)) + "┐"), dim("│ ") + C.muted("nada casa a busca")];
    }
    const title = p.kind === "file" ? `@ arquivos — ${p.query || "recentes"}` : p.kind === "slash" ? `/ comandos — ${p.query || "todos"}` : "+ anexar";
    const out = [dim(`┌─ ${title} ` + "─".repeat(Math.max(0, cols - width(title) - 5)) + "┐")];
    const start = Math.max(0, Math.min(p.index - rowsN + 1, p.items.length - rowsN));
    for (let i = start; i < start + rowsN; i += 1) {
      const it = p.items[i];
      const text =
        p.kind === "file" ? it
          : p.kind === "slash" ? `/${it.name}${it.arg ? " " + it.arg : ""}   ${dim(it.desc)}`
            : `${it.label}   ${dim(it.hint)}`;
      const line = ` ${i === p.index ? "▸" : " "} ${text}`;
      out.push(dim("│") + (i === p.index ? inverse(pad(truncate(line, cols - 2), cols - 2)) : truncate(line, cols - 2)));
    }
    out.push(dim("│ ") + C.muted("↑↓ navega · Tab completa · Enter usa · Esc fecha"));
    return out;
  }

  function renderStatus(cols, t) {
    const m = getMode(t.mode);
    const modeCell = useColor() ? `${CSI}1;48;5;${modeColorCode(m.id)};38;5;235m ${m.label} ${CSI}0m` : `[${m.label}]`;
    const id = localIdentity();
    const who = id && !id.expired ? (id.username || id.sub || "?").split("@")[0] : "deslogado";
    const ws = path.basename(workspaceRoot());
    const left = `${modeCell} ${dim("│")} ${C.chip(who)} ${dim("│")} ${C.chip(ws)} ${dim("│")} ${dim(`aba ${S.store.active + 1}/${S.store.tabs.length}`)}`;
    // A dica do rodapé encolhe conforme a largura — em terminal estreito ela
    // some antes de empurrar o estado (modo/usuário/aba), que é o que importa.
    const room = cols - width(left) - 2;
    const hints = ["Shift+Tab modo · Ctrl+T aba · Alt+←/→ troca · /ajuda", "Shift+Tab modo · /ajuda", "/ajuda", ""];
    const msg = S.footer
      ? (S.footerKind === "err" ? C.err(truncate(S.footer, Math.max(8, room))) : S.footerKind === "warn" ? C.warn(truncate(S.footer, Math.max(8, room))) : S.footerKind === "ok" ? C.ok(truncate(S.footer, Math.max(8, room))) : dim(truncate(S.footer, Math.max(8, room))))
      : dim(hints.find((h) => width(h) <= room) ?? "");
    const padN = Math.max(1, cols - width(left) - width(msg));
    return left + " ".repeat(padN) + msg;
  }

  function welcomeLines(cols, t) {
    const artW = cols >= 74 ? 22 : 16;
    const art = markLines(artW);
    const info = [
      bold("MUKTA ZERO"),
      dim("mão local · cérebro nuvem"),
      "",
      `${C.accent("/")}  comandos da janela        ${C.accent("@")}  referenciar arquivos`,
      `${C.accent("+")}  anexar contexto           ${C.accent("!")}  rodar um comando`,
      `${C.accent("Shift+Tab")}  troca o modo    ${C.accent("Ctrl+T")}  nova aba de execução`,
      "",
      dim(`modo atual: ${t.mode} — ${getMode(t.mode).hint}`),
    ];
    const out = [""];
    const off = Math.max(0, Math.floor((art.length - info.length) / 2));
    // A marca tem largura irregular (meio-bloco), então cada linha é ACOLCHOADA
    // até artW — senão a coluna de texto ao lado sai serrilhada.
    for (let i = 0; i < Math.max(art.length, info.length + off); i += 1) {
      const left = "  " + pad(art[i] || "", artW);
      const right = info[i - off] || "";
      out.push(truncate(right ? `${left}   ${right}` : left.replace(/\s+$/, ""), cols));
    }
    out.push("");
    return out;
  }

  function helpText() {
    const byCat = {};
    for (const c of REGISTRY) (byCat[c.cat] = byCat[c.cat] || []).push(c);
    const out = [bold("COMANDOS  /")];
    for (const [cat, cmds] of Object.entries(byCat)) {
      out.push(C.accent(`  ${cat}`));
      for (const c of cmds) out.push(`    /${pad(c.name + (c.arg ? " " + c.arg : ""), 26)} ${dim(c.desc)}`);
    }
    out.push("");
    out.push(bold("ATALHOS"));
    const keys = [
      ["Enter", "envia o pedido"],
      ["Ctrl+J / Alt+Enter", "quebra linha sem enviar"],
      ["Shift+Tab", "cicla o modo de execução"],
      ["Ctrl+T / Ctrl+W", "abre / fecha aba de execução"],
      ["Alt+← Alt+→ / Alt+1..9", "troca de aba"],
      ["@ / + / !", "arquivo · anexo · comando"],
      ["Esc", "cancela o que está rodando (ou fecha o painel)"],
      ["PgUp/PgDn/End", "rola o transcript"],
      ["Ctrl+C ×2 / Ctrl+D", "sai"],
    ];
    for (const [k, d] of keys) out.push(`  ${pad(k, 26)} ${dim(d)}`);
    out.push("");
    out.push(bold("MODOS  (Shift+Tab)"));
    for (const m of MODES) out.push(`  ${pad(m.id, 10)} ${dim(m.hint)}`);
    return out.join("\n");
  }

  /* ───────────────── teclado ───────────────── */

  function onKey(key) {
    const t = tab();
    S.footer = "";

    // 1) aprovação de escrita da ABA EM FOCO tem precedência: é um gate, não um
    // campo de texto — nenhuma outra tecla passa enquanto ela está aberta.
    if (t.approve) {
      if (key.name === "char" && /^[sy]$/i.test(key.char)) { t.approve.resolve(true); t.approve = null; return; }
      if (key.name === "char" && /^n$/i.test(key.char)) { t.approve.resolve(false); t.approve = null; return; }
      if (key.name === "escape") { t.approve.resolve(false); t.approve = null; if (t.cancel) t.cancel(); return; }
      return;
    }

    // 2) pergunta de uma linha (argumento de anexo, confirmação…)
    if (S.ask) {
      if (key.name === "escape") { S.ask = null; S.popup = null; return; }
      if (key.name === "enter") { const a = S.ask; S.ask = null; S.popup = null; a.onSubmit(a.value); return; }
      if (key.name === "tab" && S.popup) { acceptPopupAsk(); return; }
      if (key.name === "up" && S.popup) { S.popup.index = Math.max(0, S.popup.index - 1); return; }
      if (key.name === "down" && S.popup) { S.popup.index = Math.min(S.popup.items.length - 1, S.popup.index + 1); return; }
      if (key.name === "backspace") { S.ask.value = S.ask.value.slice(0, -1); }
      else if (key.name === "char" && !key.alt) { S.ask.value += key.char; }
      if (S.ask.picker === "file") { const items = matchFiles(S.ask.value, MAX_POPUP_ROWS); S.popup = { kind: "file", items, index: 0, query: S.ask.value }; }
      return;
    }

    // 3) globais
    if (key.name === "c" && key.ctrl) {
      if (t.running && t.cancel) { t.cancel(); footer("cancelando…", "warn"); return; }
      if (S.quitArmed) { S.running = false; return; }
      S.quitArmed = true;
      footer("Ctrl+C de novo para sair", "warn");
      return;
    }
    S.quitArmed = false;
    if (key.name === "d" && key.ctrl && !t.input) { S.running = false; return; }
    if (key.name === "t" && key.ctrl) { const r = addTab(S.store, {}); footer(r.ok ? "aba nova" : r.error, r.ok ? "ok" : "err"); return; }
    if (key.name === "w" && key.ctrl) {
      const r = closeTab(S.store, S.store.active, { force: S.closeArmed });
      S.closeArmed = Boolean(r.needsForce);
      if (!r.ok) footer(r.error, "warn");
      return;
    }
    if (key.name === "tab" && key.shift) { t.mode = nextMode(t.mode); persist(S.store); footer(`modo ${t.mode} — ${getMode(t.mode).hint}`, "info"); return; }
    if (key.alt && key.name === "char" && /^[1-9]$/.test(key.char)) { selectTab(S.store, Number(key.char) - 1); return; }
    if (key.alt && (key.name === "left" || key.name === "right")) { cycleTab(S.store, key.name === "right" ? 1 : -1); return; }
    if (key.name === "pageup") { t.scroll += 5; return; }
    if (key.name === "pagedown") { t.scroll = Math.max(0, t.scroll - 5); return; }
    if (key.name === "end" && !t.input) { t.scroll = 0; return; }

    // 4) painel aberto. Tab/Enter só são INTERCEPTADOS quando há o que aceitar —
    // com o painel vazio ("/xpto"), Enter tem que seguir para o envio normal e
    // receber o erro, em vez de sumir sem resposta nenhuma.
    if (S.popup) {
      if (key.name === "escape") { S.popup = null; return; }
      if (key.name === "up") { S.popup.index = Math.max(0, S.popup.index - 1); return; }
      if (key.name === "down") { S.popup.index = Math.min(S.popup.items.length - 1, S.popup.index + 1); return; }
      if (S.popup.items.length) {
        if (key.name === "tab") { acceptPopup({ execute: false }); return; }
        if (key.name === "enter") { acceptPopup({ execute: true }); return; }
      }
    }

    if (key.name === "escape") {
      if (t.running && t.cancel) { t.cancel(); footer("cancelando…", "warn"); return; }
      S.popup = null;
      return;
    }

    // 5) edição de texto
    if (key.name === "enter" && !key.alt) {
      const line = t.input;
      t.input = "";
      t.cursor = 0;
      S.popup = null;
      handleLine(line.trim());
      return;
    }
    if ((key.name === "enter" && key.alt) || (key.name === "j" && key.ctrl)) { insert(t, "\n"); return; }
    if (key.name === "backspace") {
      if (t.cursor > 0) { t.input = t.input.slice(0, t.cursor - 1) + t.input.slice(t.cursor); t.cursor -= 1; }
      syncPopupFromInput();
      return;
    }
    if (key.name === "delete") { t.input = t.input.slice(0, t.cursor) + t.input.slice(t.cursor + 1); return; }
    if (key.name === "left") { t.cursor = Math.max(0, t.cursor - 1); return; }
    if (key.name === "right") { t.cursor = Math.min(t.input.length, t.cursor + 1); return; }
    if (key.name === "home") { t.cursor = 0; return; }
    if (key.name === "end") { t.cursor = t.input.length; return; }
    if (key.name === "u" && key.ctrl) { t.input = t.input.slice(t.cursor); t.cursor = 0; return; }
    if (key.name === "k" && key.ctrl) { t.input = t.input.slice(0, t.cursor); return; }
    if (key.name === "a" && key.ctrl) { t.cursor = 0; return; }
    if (key.name === "e" && key.ctrl) { t.cursor = t.input.length; return; }
    if (key.name === "up" || key.name === "down") {
      if (!t.history.length) return;
      t.histIdx = key.name === "up" ? Math.min(t.history.length - 1, t.histIdx + 1) : Math.max(-1, t.histIdx - 1);
      t.input = t.histIdx >= 0 ? t.history[t.histIdx] : "";
      t.cursor = t.input.length;
      return;
    }
    if (key.name === "char" && !key.alt) {
      insert(t, key.char);
      if (key.char === "+" && t.input === "+") { t.input = ""; t.cursor = 0; openAttachMenu(null); return; }
      syncPopupFromInput();
    }
  }

  function acceptPopupAsk() {
    const p = S.popup;
    if (!p || !p.items.length || !S.ask) return;
    S.ask.value = p.kind === "file" ? p.items[p.index] : String(p.items[p.index]);
    S.popup = null;
  }

  function insert(t, s) {
    t.input = t.input.slice(0, t.cursor) + s + t.input.slice(t.cursor);
    t.cursor += s.length;
  }

  /* ───────────────── loop ───────────────── */

  screen.enter();
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const onData = (chunk) => {
    // Um chunk pode trazer várias teclas (paste, repetição); cada sequência é
    // decodificada em separado para não engolir escape de tecla especial.
    for (const seq of splitSequences(chunk)) {
      try { onKey(decodeKey(seq)); } catch (e) { footer(`erro de UI: ${e.message}`, "err"); }
      if (!S.running) break;
    }
    render();
    if (!S.running) shutdown();
  };
  stdin.on("data", onData);

  const timer = setInterval(() => {
    S.tick += 1;
    if (anyRunning()) render();
  }, 120);

  const onResize = () => render();
  process.stdout.on("resize", onResize);

  let closed = false;
  function shutdown() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    stdin.off("data", onData);
    process.stdout.off("resize", onResize);
    stdin.setRawMode?.(false);
    stdin.pause();
    persist(S.store);
    screen.exit();
  }
  process.on("exit", shutdown);

  // Aviso de sessão logo no primeiro frame — melhor saber agora que na 1ª pergunta.
  engineAuth().then((a) => {
    if (!a) { say("você não está logado nesta sessão — rode `mz auth` noutro terminal (ou /entrar).", "err"); render(); }
  }).catch(() => {});

  render();
  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (!S.running) { clearInterval(check); shutdown(); resolve(); }
    }, 60);
  });
}

/** Quebra um chunk cru em sequências de tecla individuais. */
export function splitSequences(chunk) {
  const s = String(chunk);
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1b") {
      // CSI: ESC [ … letra final
      if (s[i + 1] === "[") {
        let j = i + 2;
        while (j < s.length && !/[A-Za-z~]/.test(s[j])) j += 1;
        out.push(s.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      // ESC sozinho ou Alt+char
      if (i + 1 < s.length) { out.push(s.slice(i, i + 2)); i += 2; continue; }
      out.push("\x1b");
      i += 1;
      continue;
    }
    // texto colado: agrupa imprimíveis contíguos numa inserção só
    let j = i;
    while (j < s.length && s[j] !== "\x1b" && s.charCodeAt(j) >= 32 && s[j] !== "\x7f") j += 1;
    if (j > i) { out.push(s.slice(i, j)); i = j; continue; }
    out.push(s[i]);
    i += 1;
  }
  return out;
}

const cryptoUUID = () => crypto.randomUUID();
