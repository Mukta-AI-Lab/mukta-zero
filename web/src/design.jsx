// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { Globe, Menu, Sun, Moon, Monitor } from "lucide-react";
import Rail from "./Rail.jsx";
import Chat from "./Chat.jsx";
import { LangProvider, useLang, LANGS, LANG_NAMES } from "./lib/i18n.jsx";
import { ThemeProvider, useTheme } from "./lib/theme.jsx";
import "./index.css";

// HARNESS DE DESIGN — dev-only, NÃO entra no build de produção (o vite só empacota index.html).
//
// Por que existe: 7 das 8 views do MZ só renderizam com sessão autenticada, e o front não tem
// credencial de teste (ordem MZF-CRED pendente com o MZEng). Sem isto, "melhorar o layout" seria
// design cego — eu editaria classes e nunca veria o resultado. O harness monta os COMPONENTES
// REAIS (Rail, Chat) com dados stub, então o que se vê aqui é o que embarca.
//
// Rodar:  npx vite --port 4320   →  http://localhost:4320/design.html

const CONVERSATIONS = [
  { id: "c1", title: "Auditoria do front publicado em app.example.com", created_at: new Date().toISOString(), pinned_at: new Date().toISOString() },
  { id: "c2", title: "Trilha de observabilidade — spec Q6", created_at: new Date().toISOString(), project_id: "p1" },
  { id: "c3", title: "BigCodeBench /604: contrato da chamada", created_at: new Date(Date.now() - 3 * 86400000).toISOString(), project_id: "p2" },
  { id: "c4", title: "Holdout selado de 24 tarefas", created_at: new Date(Date.now() - 5 * 86400000).toISOString(), pinned_at: new Date(Date.now() - 3600000).toISOString() },
  { id: "c5", title: "Relatório de custo por provider", created_at: new Date(Date.now() - 20 * 86400000).toISOString(), project_id: "p1" },
  { id: "c6", title: "Migração MZ-0 para a .107", created_at: new Date(Date.now() - 41 * 86400000).toISOString() },
];

const LONG_ANSWER = `Levantei o estado do front e medi o que está publicado. Segue o achado principal e a tabela de evidência.

## Resultado

O build local do HEAD reproduz **exatamente** o bundle servido pelo domínio — logo \`main\` está live e não há trabalho preso sem deploy.

| Verificação | Esperado | Medido | Veredito |
|---|---|---|---|
| bundle servido | \`index-DgNckwc3.js\` | \`index-DgNckwc3.js\` | ✅ bate |
| MIME dos assets | \`text/javascript\` | \`text/javascript\` | ✅ |
| \`#root\` renderiza | > 500 bytes | 9.408 bytes | ✅ |
| tema escuro aplica | fundo escuro | \`rgb(12,12,14)\` | ✅ |

### O que checar no código

O gate do botão exigia uma propriedade que nunca era definida:

\`\`\`jsx
{typeof m.onRetry === "function" && (
  <button onClick={m.onRetry}>Tentar novamente</button>
)}
\`\`\`

Como o \`App\` empurra \`{ role: "error", text }\` sem \`onRetry\`, a condição nunca era satisfeita — e o \`retryLastSend\` ficava inalcançável.

> O denominador honesto: 12/12 é o placar do que foi medido, e duas das quatro correções não estão nele.

O entregável completo está em [relatório-front.docx](mzfile:abc123) para download.`;

const MESSAGES = [
  { role: "user", text: "Audite o front publicado e me diga o que está pior que as plataformas do mesmo espectro." },
  { role: "assistant", text: LONG_ANSWER },
  { role: "user", text: "Gere o mesmo relatório em .docx e inclua os screenshots do UAT." },
  { role: "error", text: "A resposta demorou mais que o esperado.\nTente novamente em instantes." },
];

const TABS = [
  { id: "chat", label: "Chat" }, { id: "projects", label: "Projetos" }, { id: "obs", label: "Obs" },
  { id: "studio", label: "Studio" }, { id: "missions", label: "Missões" }, { id: "plano", label: "Plano" },
  { id: "torre", label: "Torre" }, { id: "admin", label: "Admin" },
];

function Harness() {
  const { lang, setLang } = useLang();
  const { pref, cyclePref } = useTheme();
  const [view, setView] = useState("chat");
  const [currentId, setCurrentId] = useState("c2");
  const [railOpen, setRailOpen] = useState(false);
  const [scope, setScope] = useState(new URLSearchParams(location.search).get("proj") || "");
  const [railCollapsed, setRailCollapsed] = useState(new URLSearchParams(location.search).get("rail") === "collapsed");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deep, setDeep] = useState(false);
  // ?state=empty renderiza o estado vazio; ?state=sending renderiza as fases em progresso
  const q = new URLSearchParams(location.search).get("state");
  const ThemeIcon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  const currentTab = TABS.find((tb) => tb.id === view) || TABS[0];

  const railProps = {
    tabs: TABS, view, lang, onSelectView: setView,
    conversations: CONVERSATIONS, currentId, onSelectConversation: setCurrentId,
    onNew: () => setCurrentId(null),
    projects: [{ id: "p1", name: "Mukta Zero — front" }, { id: "p2", name: "AGI-2" }],
    selectedProjectId: scope, onSelectProject: setScope,
    onMoveConversation: (id, pid) => console.log("mover", id, "->", pid),
    email: "herbert.o.moller@gmail.com", walletTotal: 184320,
    onWallet: () => {}, onAccount: () => {}, onLogout: () => {},
    onRenameConversation: (id, title) => console.log("rename", id, title),
    onTogglePin: (id) => console.log("pin", id),
    collapsed: railCollapsed, onToggleCollapse: () => setRailCollapsed((v) => !v),
  };

  const phases = q === "sending" ? [
    { phase: "received", at: new Date(Date.now() - 74000).toISOString() },
    { phase: "planning", at: new Date(Date.now() - 61000).toISOString() },
    { phase: "swarm", at: new Date(Date.now() - 38000).toISOString() },
    { phase: "reasoning", at: new Date(Date.now() - 9000).toISOString() },
  ] : [];

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className={`hidden shrink-0 md:block ${railCollapsed ? "w-[60px]" : "w-[264px]"}`}><Rail {...railProps} /></div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
          <button onClick={() => setRailOpen(true)} aria-label="Navegação" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 md:hidden">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">{currentTab.label}</h1>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Idioma"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold uppercase text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
                <Globe className="h-4 w-4" aria-hidden="true" />{lang}
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-border bg-popover p-1 shadow-popup">
                  {LANGS.map((l) => (
                    <button key={l.code} role="menuitem" onClick={() => { setLang(l.code); setMenuOpen(false); }}
                      className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm capitalize transition-colors ${lang === l.code ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"}`}>
                      {LANG_NAMES[l.code] || l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={cyclePref} aria-label="Tema" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
              <ThemeIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Chat
            messages={q === "empty" || q === "sending" ? (q === "sending" ? [MESSAGES[0]] : []) : MESSAGES}
            sending={q === "sending"}
            phases={phases}
            onSend={() => {}}
            onRetry={() => {}}
            deepResearch={deep}
            onToggleDeepResearch={() => setDeep((v) => !v)}
            userName="Herbert"
            onCommand={(cmd) => console.log("comando:", cmd)}
            onDownloadFile={() => {}}
          />
        </main>
      </div>
      {railOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setRailOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="absolute left-0 top-0 h-full w-[288px] max-w-[86%]" onClick={(e) => e.stopPropagation()}>
            <Rail {...railProps} onClose={() => setRailOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ThemeProvider><LangProvider><Harness /></LangProvider></ThemeProvider>
);
