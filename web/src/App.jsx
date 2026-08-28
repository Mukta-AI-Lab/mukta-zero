// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import { X, Globe, LogIn, Menu, Sun, Moon, Monitor } from "lucide-react";
import AuthForm from "./AuthForm.jsx";
import Chat from "./Chat.jsx";
import Rail from "./Rail.jsx";
import MuktaMark from "./MuktaMark.jsx";

const Projects = lazy(() => import("./Projects.jsx"));
const Observability = lazy(() => import("./Observability.jsx"));
const Studio = lazy(() => import("./Studio.jsx"));
const Missions = lazy(() => import("./Missions.jsx"));
const Plano = lazy(() => import("./Plano.jsx"));
const Torre = lazy(() => import("./Torre.jsx"));
const Admin = lazy(() => import("./Admin.jsx"));
const ChangePassword = lazy(() => import("./ChangePassword.jsx"));
const ForgotPassword = lazy(() => import("./ForgotPassword.jsx"));
const Persona = lazy(() => import("./Persona.jsx"));
const Wallet = lazy(() => import("./Wallet.jsx"));
const Settings = lazy(() => import("./Settings.jsx"));
const Workspaces = lazy(() => import("./Workspaces.jsx"));
const Loops = lazy(() => import("./Loops.jsx"));
import { askMz, askMzResearch, pollMz, generateSite, runMission, auditMission, myWallet } from "./lib/mzApi.js";
import { uploadFile } from "./lib/upload.js";
import { useLang, useT, LANG_NAMES, LANGS } from "./lib/i18n.jsx";
import { useTheme } from "./lib/theme.jsx";
import { parseHash, writeHash } from "./lib/router.js";
import config from "./config.js";

const supabase = createClient(config.SUPABASE_URL, config.ANON_KEY);

const STRINGS = {
  pt: {
    tabs: { chat: "Chat", projects: "Projetos", obs: "Observabilidade", studio: "Studio", missions: "Missões", plano: "Plano", torre: "Torre", workspaces: "SharedWorkspaces", loops: "Laços e Webhooks", settings: "Configurações", admin: "Admin" },
    signupOk: "Cadastro recebido! Enviamos um e-mail de validação — confirme para prosseguir com a aprovação.",
    signupFail: "Falha no cadastro", loginFail: "Usuário ou senha inválidos", loginErr: "Erro ao tentar fazer login",
    needLogin: "🔒 Faça login para o Mukta Zero responder ao seu pedido.", commErr: "Erro: falha na comunicação",
    untitledRun: "Novo Chat", attachedLabel: "[Arquivo anexado:", analyzeDefault: "Analise o arquivo acima.",
    errPrefix: "Erro:", retryHint: "Tente novamente em instantes.",
    errTimeout: "A resposta demorou mais que o esperado.",
    errNetwork: "Não foi possível conectar. Verifique sua conexão.",
    errServer: "O servidor encontrou um problema ao processar seu pedido.",
    errGeneric: "Algo deu errado ao processar seu pedido.",
    navLabel: "Navegação", loginTitle: "Entrar", close: "Fechar",
    logout: "Sair", changePw: "Trocar senha", langLabel: "Idioma",
    themeLight: "Tema claro", themeDark: "Tema escuro", themeSystem: "Tema do sistema",
  },
  en: {
    tabs: { chat: "Chat", projects: "Projects", obs: "Observability", studio: "Studio", missions: "Missions", plano: "Plan", torre: "Tower", workspaces: "SharedWorkspaces", loops: "Loops and Webhooks", settings: "Settings", admin: "Admin" },
    signupOk: "Signup received! We sent a validation email — confirm it to proceed with approval.",
    signupFail: "Signup failed", loginFail: "Invalid username or password", loginErr: "Error trying to log in",
    needLogin: "🔒 Log in for Mukta Zero to answer your request.", commErr: "Error: communication failure",
    untitledRun: "New Chat", attachedLabel: "[Attached file:", analyzeDefault: "Analyze the file above.",
    errPrefix: "Error:", retryHint: "Please try again in a moment.",
    errTimeout: "The response took longer than expected.",
    errNetwork: "Couldn't connect. Check your connection.",
    errServer: "The server ran into a problem handling your request.",
    errGeneric: "Something went wrong processing your request.",
    navLabel: "Navigation", loginTitle: "Log in", close: "Close",
    logout: "Log out", changePw: "Change password", langLabel: "Language",
    themeLight: "Light theme", themeDark: "Dark theme", themeSystem: "System theme",
  },
  es: {
    tabs: { chat: "Chat", projects: "Proyectos", obs: "Observabilidad", studio: "Studio", missions: "Misiones", plano: "Plan", torre: "Torre", workspaces: "SharedWorkspaces", loops: "Bucles y Webhooks", settings: "Configuración", admin: "Admin" },
    signupOk: "¡Registro recibido! Enviamos un correo de validación — confírmalo para continuar con la aprobación.",
    signupFail: "Fallo en el registro", loginFail: "Usuario o contraseña inválidos", loginErr: "Error al iniciar sesión",
    needLogin: "🔒 Inicia sesión para que Mukta Zero responda tu solicitud.", commErr: "Error: fallo de comunicación",
    untitledRun: "Nuevo Chat", attachedLabel: "[Archivo adjunto:", analyzeDefault: "Analiza el archivo anterior.",
    errPrefix: "Error:", retryHint: "Inténtalo de nuevo en un momento.",
    errTimeout: "La respuesta tardó más de lo esperado.",
    errNetwork: "No se pudo conectar. Revisa tu conexión.",
    errServer: "El servidor tuvo un problema al procesar tu solicitud.",
    errGeneric: "Algo salió mal al procesar tu solicitud.",
    navLabel: "Navegación", loginTitle: "Entrar", close: "Cerrar",
    logout: "Salir", changePw: "Cambiar contraseña", langLabel: "Idioma",
    themeLight: "Tema claro", themeDark: "Tema oscuro", themeSystem: "Tema del sistema",
  },
};

// Fallback enquanto o chunk da view baixa. Skeleton discreto: um spinner centrado
// piscaria a tela a cada troca de aba.
function ViewFallback() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4 sm:p-6" role="status" aria-label="Carregando">
      <div className="h-7 w-56 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />)}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}

export default function App() {
  const { lang, setLang } = useLang();
  const { pref: themePref, cyclePref: cycleTheme } = useTheme();
  const t = useT(STRINGS);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [noticeKind, setNoticeKind] = useState("error"); // "error" | "success" — sucesso e falha NÃO podem parecer iguais
  const [busy, setBusy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false); // modo PESQUISA PROFUNDA (mz-research) vs chat normal (mz-async)
  const [phases, setPhases] = useState([]); // fases do pensamento (stream do backend via mz-async)
  const [view, setView] = useState(() => parseHash().view); // F-4: a view vem da URL, não de um default fixo
  const [isAdmin, setIsAdmin] = useState(false);
  const [lastSend, setLastSend] = useState(null); // { prompt, attachment, userDisplay } → retry do último envio

  const loginDialogRef = useRef(null);
  const [railOpen, setRailOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => { try { return localStorage.getItem("mz_rail_collapsed") === "1"; } catch { return false; } }); // drawer das RUNS no mobile (o rail é escondido < md)
  const [walletOpen, setWalletOpen] = useState(false); // modal da carteira de pontos (compra via Stripe)
  const [projects, setProjects] = useState([]); // projetos do user (p/ vincular um Chat a um projeto)
  const [selectedProjectId, setSelectedProjectId] = useState(""); // projeto do chat corrente (base de conhecimento + edição)
  const [walletTotal, setWalletTotal] = useState(null); // saldo p/ o pill do header
  const [paymentBanner, setPaymentBanner] = useState(null); // 'success' | 'cancel' após retorno do Stripe
  const resumedRef = useRef(false); // evita reconectar o run mais de uma vez por sessão
  const hashSyncedRef = useRef(false); // a 1ª sincronia da URL usa replaceState (não empilha histórico)
  const deepLinkRef = useRef(parseHash().conversationId); // conversa pedida pela URL na abertura

  // Idioma da GERAÇÃO segue a SOLICITAÇÃO do usuário (não o idioma da UI). Preferência opcional de conteúdo
  // (localStorage 'mz_content_lang': auto|pt|en|es) sobrepõe; 'auto' = idioma do pedido. Fix: entrega saía no
  // idioma do portal mesmo com pedido em PT.
  const contentLang = (typeof localStorage !== "undefined" && localStorage.getItem("mz_content_lang")) || "auto";
  const systemPrompt = contentLang === "auto"
    ? `Você é o Mukta Zero, o agente autônomo da Mukta. Responda e gere TODO o conteúdo (documentos, estudos, relatórios, código) NO MESMO IDIOMA da solicitação do usuário — detecte pelo texto do pedido. O idioma da interface (${LANG_NAMES[lang] || "português"}) é apenas da UI e NÃO deve forçar o idioma da resposta. Na dúvida, use ${LANG_NAMES[lang] || "português"}.`
    : `Você é o Mukta Zero, o agente autônomo da Mukta. Responda e gere TODO o conteúdo em ${LANG_NAMES[contentLang] || "português"} (preferência de idioma de conteúdo do usuário), independentemente do idioma da UI ou do pedido.`;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) setShowLogin(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // saldo de pontos (pill do header + modal da carteira). Best-effort: falha silenciosa não quebra o app.
  const refreshWallet = async () => {
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s?.access_token) { setWalletTotal(null); return; }
      const w = await myWallet(config.SUPABASE_URL, s.access_token, config.ANON_KEY);
      if (w?.ok) setWalletTotal(Number(w.total || 0));
    } catch { /* silencioso */ }
  };

  useEffect(() => {
    if (session) {
      loadConversations();
      loadProjects();
      supabase.rpc("is_mz_admin").then(({ data }) => setIsAdmin(data === true)).catch(() => setIsAdmin(false));
      refreshWallet();
    } else {
      setConversations([]); setMessages([]); setCurrentId(null); setIsAdmin(false); setWalletTotal(null);
      if (view === "admin") setView("chat");
    }
  }, [session]);

  // Retorno do provedor de pagamento (opcional, ver lib/payments.js)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("payment");
      if (p === "success" || p === "cancel") {
        setPaymentBanner(p); setWalletOpen(true);
        if (p === "success") { setTimeout(refreshWallet, 2500); setTimeout(refreshWallet, 7000); }
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch { /* ignore */ }
  }, []);

  // Diálogo de login: move o foco para dentro ao abrir e o devolve ao gatilho ao fechar.
  useEffect(() => {
    if (!showLogin || session) return;
    const prev = typeof document !== "undefined" ? document.activeElement : null;
    loginDialogRef.current?.focus();
    return () => { try { if (prev && prev.focus) prev.focus(); } catch { /* ignore */ } };
  }, [showLogin, session]);


  // F-4 · ESTADO → URL. Toda troca de view/conversa fica endereçável (`#/torre`, `#/chat/<id>`).
  useEffect(() => {
    writeHash(view, view === "chat" ? currentId : null, !hashSyncedRef.current);
    hashSyncedRef.current = true;
  }, [view, currentId]);

  // F-4 · URL → ESTADO. Cobre o "voltar/avançar" do navegador e link colado com a aba já aberta.
  useEffect(() => {
    const onHash = () => {
      const { view: v, conversationId } = parseHash();
      setView((cur) => (cur === v ? cur : v));
      if (v !== "chat") return;
      if (conversationId && conversationId !== currentId) selectConversation(conversationId);
      else if (!conversationId && currentId) { setCurrentId(null); setMessages([]); }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [currentId]);

  // F-4 · link direto para uma conversa: só dá para carregar depois de autenticar (RLS).
  useEffect(() => {
    if (!session) return;
    const id = deepLinkRef.current;
    if (!id) return;
    deepLinkRef.current = null;
    selectConversation(id);
  }, [session]);

  // RECONECTA a um run em andamento após refresh/reload — o job continua server-side; sem isto o status somia.
  useEffect(() => {
    if (!session || resumedRef.current) return;
    let pend; try { pend = JSON.parse(localStorage.getItem("mz_pending_run") || "null"); } catch { pend = null; }
    if (!pend || !pend.jobId) return;
    resumedRef.current = true;
    (async () => {
      try {
        if (pend.conversationId) { setCurrentId(pend.conversationId); await selectConversation(pend.conversationId); }
        setSending(true); setPhases([]);
        await pollMz(config.SUPABASE_URL, session.access_token, config.ANON_KEY, pend.jobId, (_ph, hist) => { if (Array.isArray(hist) && hist.length) setPhases(hist); }, pend.deep ? "mz-research" : "mz-async");
        // recarrega a conversa: a resposta já foi PERSISTIDA pelo mz-async no mz_messages (evita duplicar).
        if (pend.conversationId) await selectConversation(pend.conversationId);
      } catch (e) {
        setMessages((p) => [...p, { role: "error", text: mapSendError(e) }]);
      } finally {
        setSending(false); setPhases([]);
        try { localStorage.removeItem("mz_pending_run"); } catch { /* */ }
      }
    })();
  }, [session]);

  async function loadConversations() {
    // Fixadas primeiro (pinned_at desc, nulos por último), depois as mais recentes.
    const { data } = await supabase.from("mz_conversations").select("id,title,created_at,project_id,pinned_at")
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false });
    setConversations(data || []);
  }
  async function loadProjects() {
    const { data } = await supabase.from("mz_projects").select("id,name").order("created_at", { ascending: false });
    setProjects(data || []);
  }
  async function selectConversation(id) {
    setCurrentId(id);
    // Numa conversa aberta por LINK DIRETO (F-4) a lista local ainda não tem a linha — sem este
    // fallback o vínculo de projeto apareceria vazio numa conversa que tem projeto.
    // NAO toca no escopo de projeto: abrir um chat de outro projeto nao deve re-filtrar a lista.
    const { data } = await supabase.from("mz_messages").select("role,content").eq("conversation_id", id).order("created_at", { ascending: true });
    setMessages((data || []).map((m) => ({ role: m.role, text: m.content })));
  }
  function newConversation() { setCurrentId(null); setMessages([]); }

  // RENAME — a coluna title ja existia; só faltava a superfície. Otimista na tela e
  // revertido se o banco recusar (mostrar sucesso que não persistiu é pior que mostrar erro).
  async function renameConversation(id, title) {
    const clean = String(title || "").trim().slice(0, 120);
    if (!clean) return;
    const prev = conversations;
    setConversations((p) => p.map((cv) => (cv.id === id ? { ...cv, title: clean } : cv)));
    const { error } = await supabase.from("mz_conversations").update({ title: clean }).eq("id", id);
    if (error) { console.error("rename falhou", error); setConversations(prev); }
  }

  // PIN — pinned_at e timestamp, nao boolean: permite ordenar as fixadas por quando
  // foram fixadas. Migration em mz-cli/instance/migrations/, aplicada na .107.
  async function togglePinConversation(id) {
    const cur = conversations.find((cv) => cv.id === id);
    const next = cur?.pinned_at ? null : new Date().toISOString();
    const prev = conversations;
    setConversations((p) => {
      const upd = p.map((cv) => (cv.id === id ? { ...cv, pinned_at: next } : cv));
      return upd.sort((a, b) => (b.pinned_at ? 1 : 0) - (a.pinned_at ? 1 : 0));
    });
    const { error } = await supabase.from("mz_conversations").update({ pinned_at: next }).eq("id", id);
    if (error) { console.error("pin falhou", error); setConversations(prev); }
  }
  // Vincula/desvincula o chat corrente a um projeto. Se o chat já existe no banco, persiste o vínculo.
  // ESCOPO de projeto (Herbert: "quando um projeto estiver selecionado somente os chats do
  // projeto devem aparecer"). O seletor era DUAS coisas ao mesmo tempo: filtro visual e
  // ESCRITA no chat aberto (gravava project_id). Virando filtro, essa escrita passaria a
  // reatribuir conversas so por navegar entre projetos — mutacao silenciosa numa acao de
  // leitura. Agora o seletor SO define escopo: filtra a lista e vale para chats NOVOS.
  // Vincular um chat EXISTENTE passou a ser acao explicita (moveConversationToProject).
  function onSelectProject(pid) {
    setSelectedProjectId(pid);
  }

  // Vinculo EXPLICITO de um chat existente a um projeto (o que antes acontecia de lado).
  async function moveConversationToProject(id, pid) {
    const prev = conversations;
    setConversations((p) => p.map((cv) => (cv.id === id ? { ...cv, project_id: pid || null } : cv)));
    const { error } = await supabase.from("mz_conversations").update({ project_id: pid || null }).eq("id", id);
    if (error) { console.error("mover para projeto falhou", error); setConversations(prev); }
  }

  const handleLogin = async (username, password) => {
    setBusy(true); setError("");
    try {
      const email = username.includes("@") ? username : `${username}@local.internal`;
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setNoticeKind("error"); setError(t.loginFail); }
    } catch { setNoticeKind("error"); setError(t.loginErr); } finally { setBusy(false); }
  };

  const handleSignup = async ({ fullName, email, password }) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${config.SUPABASE_URL}/functions/v1/signup-request`, {
        method: "POST",
        headers: { apikey: config.ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, password }),
      });
      const j = await res.json();
      if (res.ok) { setNoticeKind("success"); setError(t.signupOk); }
      else { setNoticeKind("error"); setError(j.error || t.signupFail); }
    } catch { setNoticeKind("error"); setError(t.signupFail); } finally { setBusy(false); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  // Baixa um documento do chat a partir do marcador mzfile:<file_id>. Re-assina uma signed URL FRESCA
  // no clique (mz-workspace sign_file) — o link do chat não expira mais (mesmo padrão da aba de arquivos).
  const handleChatFileDownload = async (fileId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${config.SUPABASE_URL}/functions/v1/mz-workspace`, {
        method: "POST",
        headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sign_file", file_id: fileId }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const name = data.file_name || "documento";
      const a = document.createElement("a");
      if (data.signed_url) {
        const sep = data.signed_url.includes("?") ? "&" : "?";
        a.href = `${data.signed_url}${sep}download=${encodeURIComponent(name)}`;
        a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      } else if (data.content_text != null) {
        const url = URL.createObjectURL(new Blob([data.content_text], { type: "text/plain;charset=utf-8" }));
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } else {
        throw new Error(data.error || "sem conteúdo");
      }
    } catch (err) {
      console.error("Erro ao baixar documento do chat:", err);
    }
  };

  async function handleGenerateSite(spec) {
    if (!session) { setShowLogin(true); return null; }
    return await generateSite(config.SUPABASE_URL, session.access_token, config.ANON_KEY, spec);
  }
  async function handleRunMission(goal) {
    if (!session) { setShowLogin(true); return null; }
    return await runMission(config.SUPABASE_URL, session.access_token, config.ANON_KEY, goal);
  }
  async function handleAuditMission(missionId) {
    if (!session) { setShowLogin(true); return null; }
    return await auditMission(config.SUPABASE_URL, session.access_token, config.ANON_KEY, missionId);
  }

  // Mapeia os erros crus lançados por mzApi (HTTP 5xx, "tempo esgotado", "Failed to fetch", "job falhou")
  // para uma copy amigável e localizada, com dica de ação. Nunca expõe a stack técnica no caminho conhecido.
  function mapSendError(e) {
    const raw = e && e.message ? String(e.message) : "";
    const m = raw.toLowerCase();
    let friendly;
    if (m.includes("tempo esgotado") || m.includes("timeout")) friendly = t.errTimeout;
    else if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")) friendly = t.errNetwork;
    else if (/http\s*5\d\d/.test(m) || m.includes("job falhou") || m.includes("job failed") || m.includes("job_id")) friendly = t.errServer;
    else if (raw) friendly = `${t.errPrefix} ${raw}`;
    else friendly = t.errGeneric;
    return `${friendly}\n${t.retryHint}`;
  }

  // Executa um turno de chat. isRetry=true reusa a mensagem do usuário já presente (não re-adiciona bolha
  // nem re-persiste no banco) — usado pelo botão "tentar novamente" do estado de erro.
  async function runTurn({ prompt, attachment, userDisplay, isRetry }) {
    setLastSend({ prompt, attachment, userDisplay });
    setSending(true);
    setPhases([]);
    try {
      let convId = currentId;
      if (!convId) {
        const title = (prompt || attachment?.name || t.untitledRun).slice(0, 48);
        const { data } = await supabase.from("mz_conversations").insert({ title, project_id: selectedProjectId || null }).select("id,title,created_at,project_id").single();
        convId = data.id;
        setCurrentId(convId);
        setConversations((p) => [data, ...p]);
      }
      if (!isRetry) {
        await supabase.from("mz_messages").insert({ conversation_id: convId, role: "user", content: userDisplay });
      }
      if (attachment?.file) uploadFile(supabase, attachment.file).catch(() => {});
      const context = attachment
        ? `${t.attachedLabel} ${attachment.name}]\n${attachment.content}\n\n${prompt || t.analyzeDefault}`
        : prompt;
      const onPhaseCb = (_ph, hist) => { if (Array.isArray(hist) && hist.length) setPhases(hist); };
      const onJobCb = (jobId) => { try { localStorage.setItem("mz_pending_run", JSON.stringify({ jobId, conversationId: convId, deep: deepResearch })); } catch { /* persistência do run p/ sobreviver a refresh */ } };
      // CUSTO DO TURNO. O backend já devolvia points_charged/points_balance/billing_reason e o
      // cliente deitava-os fora (o pollMz só retornava o texto): o usuário era debitado e não via.
      // Guardo o veredito para o anexar À MENSAGEM, não a um estado global — duas respostas
      // seguidas têm custos diferentes, e um custo global mostraria o da última em todas.
      let billing = null;
      const onMetaCb = (r) => {
        billing = { charged: r?.points_charged ?? null, balance: r?.points_balance ?? null, reason: r?.billing_reason ?? null };
        // Saldo VIVO: sem isto o pill do header mostrava o saldo do login até o próximo refresh.
        if (r?.points_balance != null) setWalletTotal(Number(r.points_balance)); else refreshWallet();
      };
      const resp = deepResearch
        ? await askMzResearch(config.SUPABASE_URL, session.access_token, config.ANON_KEY, context, convId, onPhaseCb, onJobCb, onMetaCb)
        : await askMz(config.SUPABASE_URL, session.access_token, config.ANON_KEY, context, systemPrompt, convId, onPhaseCb, onJobCb, selectedProjectId || null, onMetaCb);
      setMessages((p) => [...p, { role: "assistant", text: resp, billing }]); // exibe; o mz-async já PERSISTE a resposta no mz_messages (robusto a refresh/timeout)
      await supabase.from("mz_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    } catch (e) {
      // Estado de ERRO distinto (role:"error") — renderizado como balão destrutivo acionável no Chat, não como resposta.
      setMessages((p) => [...p, { role: "error", text: mapSendError(e) }]);
    } finally {
      setSending(false);
      setPhases([]);
      try { localStorage.removeItem("mz_pending_run"); } catch { /* */ }
    }
  }

  async function handleSend(prompt, attachment) {
    const userDisplay = (prompt || "") + (attachment ? `\n📎 ${attachment.name}` : "");
    if (!session) {
      setMessages((p) => [...p, { role: "user", text: userDisplay }, { role: "assistant", text: t.needLogin }]);
      setShowLogin(true);
      return;
    }
    setMessages((p) => [...p, { role: "user", text: userDisplay }]);
    await runTurn({ prompt, attachment, userDisplay, isRetry: false });
  }

  async function retryLastSend() {
    if (!lastSend || sending) return;
    // Remove o(s) balão(ões) de erro finais, preservando a mensagem do usuário, e re-tenta o envio.
    setMessages((p) => { const n = [...p]; while (n.length && n[n.length - 1].role === "error") n.pop(); return n; });
    await runTurn({ ...lastSend, isRetry: true });
  }

  function onLoginKeyDown(e) {
    if (e.key === "Escape") { setShowLogin(false); return; }
    if (e.key !== "Tab") return;
    const root = loginDialogRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    const list = Array.prototype.filter.call(nodes, (el) => el.offsetParent !== null || el === document.activeElement);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const TABS = [
    { id: "chat", label: t.tabs.chat },
    { id: "projects", label: t.tabs.projects },
    { id: "obs", label: t.tabs.obs },
    { id: "studio", label: t.tabs.studio },
    { id: "missions", label: t.tabs.missions },
    { id: "plano", label: t.tabs.plano },
    { id: "torre", label: t.tabs.torre },
    { id: "workspaces", label: t.tabs.workspaces },
    { id: "loops", label: t.tabs.loops },
    { id: "settings", label: t.tabs.settings },
    ...(isAdmin ? [{ id: "admin", label: t.tabs.admin }] : []),
  ];
  const currentTab = TABS.find((tb) => tb.id === view) || TABS[0];
  // Primeiro nome, do e-mail, para a saudação do estado vazio ("Sua vez, Herbert!").
  const firstName = (() => {
    const local = String(session?.user?.email || "").split("@")[0];
    const raw = local.split(/[._-]/)[0];
    return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
  })();
  // No chat, o TÍTULO DA CONVERSA no topo (padrão do Claude) — antes só aparecia "Chat".
  const headerTitle = (view === "chat" && currentId
    ? (conversations.find((cv) => cv.id === currentId)?.title || currentTab.label)
    : currentTab.label);
  const ThemeIcon = themePref === "light" ? Sun : themePref === "dark" ? Moon : Monitor;
  const themeTitle = themePref === "light" ? t.themeLight : themePref === "dark" ? t.themeDark : t.themeSystem;

  // Props do rail — o mesmo conjunto serve o rail fixo (desktop) e o drawer (mobile).
  const railProps = {
    tabs: TABS, view, lang,
    onSelectView: (id) => { setView(id); setRailOpen(false); },
    conversations, currentId,
    onSelectConversation: (id) => { setView("chat"); selectConversation(id); setRailOpen(false); },
    onNew: () => { setView("chat"); newConversation(); setRailOpen(false); },
    projects, selectedProjectId, onSelectProject,
    onRenameConversation: renameConversation, onTogglePin: togglePinConversation,
    onMoveConversation: moveConversationToProject,
    email: session?.user?.email, walletTotal,
    collapsed: railCollapsed,
    onToggleCollapse: () => setRailCollapsed((v) => { const nv = !v; try { localStorage.setItem("mz_rail_collapsed", nv ? "1" : "0"); } catch {} return nv; }),
    onWallet: () => { setPaymentBanner(null); setWalletOpen(true); },

    onAccount: () => setChangePwOpen(true),
    onLogout: handleLogout,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* RAIL FIXO (desktop) — navegação, histórico e conta numa coluna só.
          Antes: 8 views atrás de um dropdown de texto + um painel de conversas separado. */}
      {session && (
        <div className={`hidden shrink-0 transition-[width] duration-150 md:block ${railCollapsed ? "w-[60px]" : "w-[264px]"}`}>
          <Rail {...railProps} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* BARRA CONTEXTUAL — fina (h-14) e só com o que é do contexto. Idioma, pontos e
            conta saíram daqui para o rail: o topo não é lugar de despejo de controles. */}
        <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
          {session ? (
            <>
              <button onClick={() => setRailOpen(true)} aria-label={t.navLabel} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 md:hidden">
                <Menu className="h-5 w-5" aria-hidden="true" />
              </button>
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">{headerTitle}</h1>
            </>
          ) : (
            <>
              <MuktaMark className="h-7 w-7 shrink-0" />
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-foreground">Mukta Zero</h1>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            {/* IDIOMA — controle SEGMENTADO, sempre visível. Eu havia trocado por um menu
                argumentando que idioma era "escolha rara": errado. O MZ é trilíngue e o seletor
                é de primeira classe; esconder atrás de um clique fez o controle desaparecer para
                quem o usa. Discoverability vence economia de pixel. */}
            <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label={t.langLabel}>
              <Globe className="ml-1 mr-0.5 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
              {LANGS.map((l) => (
                <button key={l.code} onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
                  title={LANG_NAMES[l.code] || l.label}
                  className={`rounded-md px-1.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${lang === l.code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"}`}>
                  {l.label}
                </button>
              ))}
            </div>
            <button onClick={cycleTheme} title={themeTitle} aria-label={themeTitle}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
              <ThemeIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            {!session && (
              <button onClick={() => setShowLogin(true)} className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover">
                <LogIn className="h-4 w-4" aria-hidden="true" />{t.loginTitle}
              </button>
            )}
          </div>
        </header>

        {/* CONTEÚDO — superfícies flush, sem cartão flutuando sobre gradiente.
            O chat gerencia o próprio scroll; Projetos é master-detail que preenche; o resto rola aqui. */}
        <Suspense fallback={<ViewFallback />}>
        {session && view === "projects" ? (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden"><Projects supabase={supabase} /></main>
        ) : session && view === "obs" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Observability supabase={supabase} /></main>
        ) : session && view === "studio" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Studio supabase={supabase} onGenerate={handleGenerateSite} /></main>
        ) : session && view === "missions" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Missions supabase={supabase} onRunMission={handleRunMission} /></main>
        ) : session && view === "plano" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Plano supabase={supabase} onAudit={handleAuditMission} /></main>
        ) : session && view === "torre" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Torre supabase={supabase} /></main>
        ) : session && view === "loops" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Loops supabase={supabase} lang={lang} /></main>
        ) : session && view === "workspaces" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Workspaces supabase={supabase} lang={lang} /></main>
        ) : session && view === "settings" ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Settings supabase={supabase} lang={lang} /></main>
        ) : session && view === "admin" && isAdmin ? (
          <main className="min-h-0 flex-1 overflow-y-auto"><Admin supabase={supabase} /></main>
        ) : (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Chat
              messages={messages}
              sending={sending}
              phases={phases}
              onSend={handleSend}
              onRetry={retryLastSend}
              deepResearch={deepResearch}
              onToggleDeepResearch={() => setDeepResearch((v) => !v)}
              userName={firstName}
              // /persona abre modal; /loop e /goal levam à tela de Laços — ambos vivem lá, e a
              // diferença entre eles é o TIPO escolhido no formulário, não duas superfícies.
              onCommand={(cmd) => {
                if (cmd === "persona") setPersonaOpen(true);
                else if (cmd === "loop" || cmd === "goal") setView("loops");
              }}
              onDownloadFile={handleChatFileDownload}
            />
          </main>
        )}
        </Suspense>
      </div>

      {/* DRAWER do rail (mobile) — o MESMO componente do desktop, não uma segunda navegação. */}
      {session && railOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setRailOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
          <div className="absolute left-0 top-0 h-full w-[288px] max-w-[86%] animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <Rail {...railProps} onClose={() => setRailOpen(false)} />
          </div>
        </div>
      )}

      {showLogin && !session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" onClick={() => setShowLogin(false)}>
          <div ref={loginDialogRef} role="dialog" aria-modal="true" aria-label={t.loginTitle} tabIndex={-1} onKeyDown={onLoginKeyDown} className="relative outline-none" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowLogin(false)} aria-label={t.close} className="absolute -top-3 -right-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-secondary">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <AuthForm onLogin={handleLogin} onSignup={handleSignup} onForgot={() => { setShowLogin(false); setError(""); setForgotOpen(true); }} busy={busy} error={error} noticeKind={noticeKind} />
          </div>
        </div>
      )}

      <Suspense fallback={null}>
      {personaOpen && session && (
        <Persona supabase={supabase} onClose={() => setPersonaOpen(false)} />
      )}
      {changePwOpen && session && (
        <ChangePassword supabase={supabase} email={session.user.email} onClose={() => setChangePwOpen(false)} />
      )}
      {forgotOpen && !session && (
        <ForgotPassword supabase={supabase} onClose={() => setForgotOpen(false)} onBackToLogin={() => { setForgotOpen(false); setShowLogin(true); }} />
      )}

      {walletOpen && session && (
        <Wallet supabase={supabase} banner={paymentBanner} onClose={() => { setWalletOpen(false); setPaymentBanner(null); refreshWallet(); }} />
      )}
      </Suspense>
    </div>
  );
}
