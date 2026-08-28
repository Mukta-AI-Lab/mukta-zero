// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React from "react";
import {
  Plus, MessageSquare, FolderOpen, Activity, Sparkles, Target, ListChecks, Settings2,
  RadioTower, Shield, Users, Repeat2, Coins, UserCog, UserCircle2, LogOut, X, Search, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Pencil, ChevronDown, FolderInput,
} from "lucide-react";
import { useState } from "react";
import { useT } from "./lib/i18n.jsx";
import MuktaMark from "./MuktaMark.jsx";

// Rail de navegação do Mukta Zero.
//
// PROBLEMA QUE RESOLVE: as 8 views de topo viviam atrás de UM dropdown de texto no header
// ("Chat ▾"), e a lista de conversas vivia num painel separado — dois sistemas de navegação
// desconexos, e nenhum deles visível. Nenhuma plataforma do mesmo espectro faz isso: todas
// têm um rail persistente onde a navegação e o histórico coexistem, e a conta no pé.
//
// Aqui: marca → ação primária → navegação → histórico (rola) → conta. Uma coluna, uma
// hierarquia, tudo alcançável em um clique.

const STRINGS = {
  pt: { newChat: "Novo Chat", nav: "Navegação", chats: "Chats", emptyChats: "Nenhum chat ainda",
        untitled: "Novo Chat", project: "Projeto", noProject: "Sem projeto (chat livre)",
        projectHint: "Vincule este chat a um projeto — o agente usa os documentos do projeto como base de conhecimento",
        points: "Pontos", persona: "Persona", account: "Conta", logout: "Sair", close: "Fechar",
        search: "Buscar conversas", noMatch: "Nenhuma conversa encontrada", collapse: "Recolher menu", expand: "Expandir menu",
        pinned: "Fixadas", pin: "Fixar conversa", unpin: "Desafixar", rename: "Renomear conversa",
        navExpand: "Mostrar todas as seções", navCollapse: "Mostrar só a seção em uso",
        showAll: "ver todos", addCurrent: "Adicionar o chat atual", emptyScoped: "Nenhum chat neste projeto ainda",
        scopedHint: (k) => `mostrando só os ${k} chats deste projeto` },
  en: { newChat: "New Chat", nav: "Navigation", chats: "Chats", emptyChats: "No chats yet",
        untitled: "New Chat", project: "Project", noProject: "No project (free chat)",
        projectHint: "Link this chat to a project — the agent uses its documents as a knowledge base",
        points: "Points", persona: "Persona", account: "Account", logout: "Log out", close: "Close",
        search: "Search conversations", noMatch: "No conversation found", collapse: "Collapse menu", expand: "Expand menu",
        pinned: "Pinned", pin: "Pin conversation", unpin: "Unpin", rename: "Rename conversation",
        navExpand: "Show all sections", navCollapse: "Show only the current section",
        showAll: "show all", addCurrent: "Add the current chat", emptyScoped: "No chats in this project yet",
        scopedHint: (k) => `showing only the ${k} chats in this project` },
  es: { newChat: "Nuevo Chat", nav: "Navegación", chats: "Chats", emptyChats: "Aún no hay chats",
        untitled: "Nuevo Chat", project: "Proyecto", noProject: "Sin proyecto (chat libre)",
        projectHint: "Vincula este chat a un proyecto — el agente usa sus documentos como base de conocimiento",
        points: "Puntos", persona: "Persona", account: "Cuenta", logout: "Salir", close: "Cerrar",
        search: "Buscar conversaciones", noMatch: "Ninguna conversación encontrada", collapse: "Contraer menú", expand: "Expandir menú",
        pinned: "Fijadas", pin: "Fijar conversación", unpin: "Quitar fijado", rename: "Renombrar conversación",
        navExpand: "Mostrar todas las secciones", navCollapse: "Mostrar solo la sección en uso",
        showAll: "ver todos", addCurrent: "Añadir el chat actual", emptyScoped: "Aún no hay chats en este proyecto",
        scopedHint: (k) => `mostrando solo los ${k} chats de este proyecto` },
};

export const VIEW_ICONS = {
  chat: MessageSquare, projects: FolderOpen, obs: Activity, studio: Sparkles,
  missions: Target, plano: ListChecks, torre: RadioTower, workspaces: Users, loops: Repeat2, settings: Settings2, admin: Shield,
};

// Agrupa conversas por faixa de tempo — uma lista corrida de 50 títulos não tem
// hierarquia; "Hoje / Últimos 7 dias / Antes" dá varredura visual em O(1).
function groupConversations(list, labels) {
  // As FIXADAS formam o primeiro grupo e saem das faixas de tempo — senao apareceriam duas vezes.
  const pinned = list.filter((c) => c.pinned_at);
  list = list.filter((c) => !c.pinned_at);
  const now = Date.now();
  const DAY = 86400000;
  const buckets = [
    { key: "today", label: labels.today, items: [] },
    { key: "week", label: labels.week, items: [] },
    { key: "older", label: labels.older, items: [] },
  ];
  for (const c of list) {
    const ts = c.created_at ? new Date(c.created_at).getTime() : now;
    const age = now - ts;
    if (age < DAY) buckets[0].items.push(c);
    else if (age < 7 * DAY) buckets[1].items.push(c);
    else buckets[2].items.push(c);
  }
  const out = buckets.filter((b) => b.items.length > 0);
  return pinned.length ? [{ key: "pinned", label: labels.pinned, items: pinned }, ...out] : out;
}

const GROUP_LABELS = {
  pt: { today: "Hoje", week: "Últimos 7 dias", older: "Antes", pinned: "Fixadas" },
  en: { today: "Today", week: "Last 7 days", older: "Earlier", pinned: "Pinned" },
  es: { today: "Hoy", week: "Últimos 7 días", older: "Antes", pinned: "Fijadas" },
};

export default function Rail({
  tabs = [], view, onSelectView,
  conversations = [], currentId, onSelectConversation, onNew,
  projects = [], selectedProjectId = "", onSelectProject,
  email, walletTotal, onWallet, onAccount, onLogout,
  lang = "pt", onClose, collapsed = false, onToggleCollapse, onRenameConversation, onTogglePin, onMoveConversation,
}) {
  const t = useT(STRINGS);
  const [q, setQ] = useState("");
  const [navOpen, setNavOpen] = useState(() => { try { return localStorage.getItem("mz_nav_open") === "1"; } catch { return false; } });
  const setNavOpenPersist = (v) => { setNavOpen(v); try { localStorage.setItem("mz_nav_open", v ? "1" : "0"); } catch { /* ignore */ } };
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const initial = (email || "?").trim().charAt(0).toUpperCase();
  const activeTab = tabs.find((tb) => tb.id === view) || tabs[0];
  const shownTabs = navOpen ? tabs : (activeTab ? [activeTab] : tabs);

  // BUSCA de conversas (Claude e ChatGPT têm; o MZ não tinha). Filtro no cliente: a lista
  // já está carregada, então não custa chamada — e com dezenas de chats a rolagem não basta.
  // ESCOPO DE PROJETO primeiro, busca depois: buscar dentro do projeto e não no acervo todo.
  const scopedProject = selectedProjectId ? projects.find((pr) => pr.id === selectedProjectId) : null;
  const currentConv = conversations.find((cv) => cv.id === currentId) || null;
  const inScope = scopedProject
    ? conversations.filter((cv) => cv.project_id === scopedProject.id)
    : conversations;
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? inScope.filter((cv) => (cv.title || "").toLowerCase().includes(needle))
    : inScope;
  const groups = groupConversations(filtered, GROUP_LABELS[lang] || GROUP_LABELS.pt);

  const commitRename = (id) => {
    const v = draft.trim();
    setEditingId(null);
    setDraft("");
    if (v && onRenameConversation) onRenameConversation(id, v);
  };

  // ── COLAPSADO: só ícones (o Gemini nasce assim; Claude e ChatGPT têm o toggle) ──
  if (collapsed) {
    return (
      <nav aria-label={t.nav} className="flex h-full w-full flex-col items-center gap-2 border-r border-border bg-surface px-2 py-3">
        <MuktaMark className="h-8 w-8 shrink-0" />
        <button onClick={onToggleCollapse} title={t.expand} aria-label={t.expand}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
          <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
        </button>
        <button onClick={onNew} title={t.newChat} aria-label={t.newChat}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-hover">
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="mt-1 flex flex-1 flex-col gap-0.5">
          {tabs.map((tb) => {
            const Icon = VIEW_ICONS[tb.id] || MessageSquare;
            return (
              <button key={tb.id} onClick={() => onSelectView(tb.id)} title={tb.label} aria-label={tb.label}
                aria-current={view === tb.id ? "page" : undefined}
                className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${view === tb.id ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <button onClick={onWallet} title={t.points} aria-label={t.points}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-primary transition-colors hover:bg-surface-2">
          <Coins className="h-4 w-4" aria-hidden="true" />
        </button>
        <button onClick={onAccount} title={email} aria-label={t.account}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
          {initial}
        </button>
      </nav>
    );
  }

  return (
    <nav aria-label={t.nav} className="flex h-full w-full flex-col gap-3 border-r border-border bg-surface px-3 py-3">
      {/* Marca + fechar (mobile) */}
      <div className="flex items-center gap-2 px-1">
        <MuktaMark className="h-7 w-7 shrink-0" />
        <span className="truncate text-[15px] font-semibold tracking-tight text-foreground">Mukta Zero</span>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} title={t.collapse} aria-label={t.collapse}
            className="ml-auto hidden h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground md:grid">
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {onClose && (
          <button onClick={onClose} aria-label={t.close} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 md:hidden">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Ação primária */}
      <button
        onClick={onNew}
        className="inline-flex w-full items-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t.newChat}
      </button>

      {/* NAVEGAÇÃO RETRÁTIL — por padrão mostra SÓ a view em uso.
          Motivo: são 8 destinos, e mantê-los sempre abertos rouba a altura do histórico, que é
          o que o usuário mais usa. Recolhida: a view ativa (destacada) + chevron. Expandida: as
          8. Escolher uma view RECOLHE de novo — senão a economia dura um clique só.
          A preferência é persistida; quem prefere as 8 abertas não reabre a cada sessão. */}
      <div id="rail-nav" className="flex flex-col gap-0.5">
        {shownTabs.map((tb) => {
          const Icon = VIEW_ICONS[tb.id] || MessageSquare;
          const isActive = activeTab && tb.id === activeTab.id;
          return (
            <div key={tb.id} className="flex items-center gap-1">
              <button
                onClick={() => { onSelectView(tb.id); setNavOpenPersist(false); }}
                aria-current={isActive ? "page" : undefined}
                className="nav-item min-w-0 flex-1 text-left"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{tb.label}</span>
              </button>
              {isActive && (
                <button
                  onClick={() => setNavOpenPersist(!navOpen)}
                  aria-expanded={navOpen}
                  aria-controls="rail-nav"
                  title={navOpen ? t.navCollapse : t.navExpand}
                  aria-label={navOpen ? t.navCollapse : t.navExpand}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
                  <ChevronDown className={`h-4 w-4 transition-transform ${navOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Projeto do chat corrente */}
      {projects.length > 0 && (
        <div className="px-0.5">
          <label htmlFor="rail-project" className="sr-only">{t.project}</label>
          <select
            id="rail-project"
            value={selectedProjectId || ""}
            onChange={(e) => onSelectProject && onSelectProject(e.target.value)}
            title={t.projectHint}
            className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <option value="">{t.noProject}</option>
            {projects.map((pr) => (
              <option key={pr.id} value={pr.id}>{t.project}: {pr.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Histórico — ocupa o espaço restante e rola */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col">
        {/* CABEÇALHO DO HISTÓRICO — quando há projeto no escopo, DIZ que a lista está filtrada.
            Uma lista que encurta sem explicação parece perda de dado, não filtro. */}
        {scopedProject ? (
          <div className="mb-1 flex flex-col gap-1 rounded-lg border border-primary/25 bg-primary-soft px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-primary" title={scopedProject.name}>
                {scopedProject.name}
              </span>
              <button onClick={() => onSelectProject && onSelectProject("")}
                title={t.showAll} aria-label={t.showAll}
                className="shrink-0 rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-primary/80 transition-colors hover:text-primary">
                {t.showAll}
              </button>
            </div>
            <span className="text-[10px] text-primary/70">{t.scopedHint(filtered.length)}</span>
            {/* O chat aberto pode não pertencer ao projeto no escopo — e nesse caso ele não
                aparece na lista. Vincular é AÇÃO EXPLÍCITA, aqui, e não efeito de navegar. */}
            {currentId && currentConv && currentConv.project_id !== scopedProject.id && onMoveConversation && (
              <button onClick={() => onMoveConversation(currentId, scopedProject.id)}
                className="mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-md border border-primary/30 bg-surface px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft">
                <FolderInput className="h-3 w-3" aria-hidden="true" />{t.addCurrent}
              </button>
            )}
          </div>
        ) : (
          <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t.chats}
          </div>
        )}
        {inScope.length > 4 && (
          <div className="relative mb-1.5 px-0.5">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t.search} aria-label={t.search}
              className="h-8 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:border-border-strong"
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {inScope.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">{scopedProject ? t.emptyScoped : t.emptyChats}</p>
          ) : filtered.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">{t.noMatch}</p>
          ) : (
            groups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-muted-foreground/60">
                  {g.key === "pinned" && <Pin className="h-3 w-3" aria-hidden="true" />}
                  {g.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((c) => {
                    const active = currentId === c.id;
                    const isEditing = editingId === c.id;

                    // RENAME INLINE: o item vira um campo. Enter salva, Esc cancela, blur salva —
                    // sem modal, que para renomear um título é cerimônia demais.
                    if (isEditing) {
                      return (
                        <form key={c.id} className="px-1 py-0.5"
                          onSubmit={(e) => { e.preventDefault(); commitRename(c.id); }}>
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => commitRename(c.id)}
                            onKeyDown={(e) => { if (e.key === "Escape") { setEditingId(null); setDraft(""); } }}
                            aria-label={t.rename}
                            maxLength={120}
                            className="h-8 w-full rounded-lg border border-primary/50 bg-surface-2 px-2 text-[13px] text-foreground focus:outline-none"
                          />
                        </form>
                      );
                    }

                    return (
                      <div key={c.id}
                        className={`group/item flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                          active ? "bg-primary-soft" : "hover:bg-surface-2"
                        }`}>
                        <button
                          onClick={() => onSelectConversation(c.id)}
                          onDoubleClick={() => { if (onRenameConversation) { setEditingId(c.id); setDraft(c.title || ""); } }}
                          aria-current={active ? "true" : undefined}
                          title={c.title || t.untitled}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                            active ? "font-medium text-primary" : "text-muted-foreground group-hover/item:text-foreground"
                          }`}>
                          {c.pinned_at
                            ? <Pin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                            : <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />}
                          <span className="truncate">{c.title || t.untitled}</span>
                        </button>

                        {/* Ações por conversa — aparecem no hover/foco, como nas plataformas do espectro */}
                        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/item:opacity-100">
                          {onRenameConversation && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setDraft(c.title || ""); }}
                              title={t.rename} aria-label={t.rename}
                              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground">
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                            </button>
                          )}
                          {onTogglePin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onTogglePin(c.id); }}
                              title={c.pinned_at ? t.unpin : t.pin}
                              aria-label={c.pinned_at ? t.unpin : t.pin}
                              aria-pressed={!!c.pinned_at}
                              className={`grid h-6 w-6 place-items-center rounded-md transition-colors hover:bg-surface ${
                                c.pinned_at ? "text-primary" : "text-muted-foreground hover:text-foreground"
                              }`}>
                              {c.pinned_at ? <PinOff className="h-3 w-3" aria-hidden="true" /> : <Pin className="h-3 w-3" aria-hidden="true" />}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Conta — no pé, onde os pares a põem (antes: espalhada pelo header) */}
      <div className="shrink-0 border-t border-border pt-2.5">
        <button
          onClick={onWallet}
          className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-sm transition-colors hover:border-border-strong"
        >
          <Coins className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">{t.points}</span>
          <span className="ml-auto font-semibold tabular-nums text-foreground">
            {walletTotal != null ? walletTotal.toLocaleString("pt-BR") : "—"}
          </span>
        </button>
        <div className="flex items-center gap-1.5 px-0.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted-foreground" aria-hidden="true">
            {initial}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={email}>{email}</span>
          <button onClick={onAccount} title={t.account} aria-label={t.account} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
            <UserCircle2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <button onClick={onLogout} title={t.logout} aria-label={t.logout} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-destructive">
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}
