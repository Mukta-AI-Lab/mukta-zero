// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
const MarkdownBody = lazy(() => import("./MarkdownBody.jsx"));
import { Bot, Send, Loader2, Sparkles, Paperclip, X, Check, AlertCircle, RefreshCw, Telescope, Copy, Volume2, Square, Code2, Bug, FileBarChart, UserCog, Coins, Repeat2, Target } from "lucide-react";
import { readFileAsText } from "./lib/upload.js";
import { useLang, useT } from "./lib/i18n.jsx";

// Custo em pontos com 3 decimais e sem zeros à direita: 0,343 pts · 1,5 pts · 12 pts.
// Função em vez de regex inline porque a 1ª versão era `/.?0+$/` (o escape do ponto perdeu-se ao
// passar pelo shell) e esse padrão come um dígito SIGNIFICATIVO: "0.340" → "0.3". Um formatador de
// dinheiro que arredonda para menos em silêncio é a última coisa que se quer numa tela de cobrança.
const trimZeros = (n) => {
  const s = Number(n).toFixed(3);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

const STRINGS = {
  pt: { emptyTitle: "O que o Mukta Zero deve fazer por você?", greeting: (n) => `Sua vez, ${n}!`,
        emptySub: "Descreva a tarefa — código, arquitetura, debugging, automação. Anexe arquivos se precisar.",
        chips: ["Revise meu código", "Explique este erro", "Gere um relatório"],
        placeholder: "Pergunte ao Mukta Zero…", agent: "Mukta Zero",
        send: "Enviar", attachFile: "Anexar arquivo", removeAttach: "Remover anexo", retry: "Tentar novamente",
        showMore: "Ver mais", showLess: "Ver menos", working: "Trabalhando…",
        hint: "Enter envia · Shift+Enter quebra linha",
        copy: "Copiar", copied: "Copiado", readAloud: "Ler em voz alta", stopReading: "Parar leitura",
        charged: (n) => `${trimZeros(Number(n))} pts`, balanceAfter: (n) => `Saldo apos este turno: ${Number(n).toFixed(3)} pts`,
        document: "Documento", download: "Baixar",
        commands: "Comandos", cmdPersona: "Configurar a persona do agente",
        cmdLoop: "Repetir uma tarefa com condicao de parada", cmdGoal: "Insistir num objetivo ate a condicao ser cumprida",
        deepResearch: "Pesquisa profunda", deepResearchHint: "Estudo aterrado com fontes citadas e .docx real (leva alguns minutos)" },
  en: { emptyTitle: "What should Mukta Zero do for you?", greeting: (n) => `Your turn, ${n}!`,
        emptySub: "Describe the task — code, architecture, debugging, automation. Attach files if needed.",
        chips: ["Review my code", "Explain this error", "Generate a report"],
        placeholder: "Ask Mukta Zero…", agent: "Mukta Zero",
        send: "Send", attachFile: "Attach file", removeAttach: "Remove attachment", retry: "Try again",
        showMore: "Show more", showLess: "Show less", working: "Working…",
        hint: "Enter to send · Shift+Enter for a new line",
        copy: "Copy", copied: "Copied", readAloud: "Read aloud", stopReading: "Stop reading",
        charged: (n) => `${trimZeros(Number(n))} pts`, balanceAfter: (n) => `Balance after this turn: ${Number(n).toFixed(3)} pts`,
        document: "Document", download: "Download",
        commands: "Commands", cmdPersona: "Configure the agent persona",
        cmdLoop: "Repeat a task with a stopping condition", cmdGoal: "Keep at a goal until the condition is met",
        deepResearch: "Deep research", deepResearchHint: "Grounded study with cited sources and a real .docx (takes a few minutes)" },
  es: { emptyTitle: "¿Qué debe hacer Mukta Zero por ti?", greeting: (n) => `¡Tu turno, ${n}!`,
        emptySub: "Describe la tarea — código, arquitectura, depuración, automatización. Adjunta archivos si lo necesitas.",
        chips: ["Revisa mi código", "Explica este error", "Genera un informe"],
        placeholder: "Pregúntale a Mukta Zero…", agent: "Mukta Zero",
        send: "Enviar", attachFile: "Adjuntar archivo", removeAttach: "Quitar adjunto", retry: "Intentar de nuevo",
        showMore: "Ver más", showLess: "Ver menos", working: "Trabajando…",
        hint: "Enter envía · Shift+Enter salto de línea",
        copy: "Copiar", copied: "Copiado", readAloud: "Leer en voz alta", stopReading: "Detener lectura",
        charged: (n) => `${trimZeros(Number(n))} pts`, balanceAfter: (n) => `Saldo tras este turno: ${Number(n).toFixed(3)} pts`,
        document: "Documento", download: "Descargar",
        commands: "Comandos", cmdPersona: "Configurar la persona del agente",
        cmdLoop: "Repetir una tarea con condicion de parada", cmdGoal: "Insistir en un objetivo hasta cumplir la condicion",
        deepResearch: "Investigación profunda", deepResearchHint: "Estudio fundamentado con fuentes citadas y un .docx real (tarda unos minutos)" },
};

const CHIP_ICONS = [Code2, Bug, FileBarChart];

// Catalogo de comandos de barra. Cresce aqui: cada entrada e {name, icon, descKey, id}.
const SLASH_COMMANDS = [
  { id: "persona", name: "/persona", icon: UserCog, descKey: "cmdPersona" },
  { id: "loop", name: "/loop", icon: Repeat2, descKey: "cmdLoop" },
  { id: "goal", name: "/goal", icon: Target, descKey: "cmdGoal" },
];

// Rótulos das FASES do pensamento (stream do backend via mz-async → mz_jobs.phase). i18n por chave de fase;
// fallback para o label que o backend mandou. SÓ o rótulo — nunca o conteúdo verbatim (regra de privacidade P0).
const PHASE_LABELS = {
  received:    { pt: "Recebi seu pedido",                    en: "Got your request",             es: "Recibí tu solicitud" },
  analyzing:   { pt: "Analisando a complexidade",            en: "Assessing complexity",         es: "Analizando la complejidad" },
  planning:    { pt: "Planejando as etapas",                 en: "Planning the steps",           es: "Planificando los pasos" },
  council:     { pt: "Convocando o Conselho de especialistas", en: "Convening the expert Council", es: "Convocando el Consejo" },
  council_synth: { pt: "Sintetizando os pareceres do Conselho", en: "Synthesizing the Council's opinions", es: "Sintetizando los dictámenes del Consejo" },
  perimeter:   { pt: "Definindo o perímetro do estudo",       en: "Defining the study perimeter",  es: "Definiendo el perímetro del estudio" },
  decompose:   { pt: "Decompondo em sub-questões",            en: "Decomposing into sub-questions", es: "Descomponiendo en sub-preguntas" },
  swarm:       { pt: "Pesquisando fontes (busca aterrada)",   en: "Researching sources (grounded)", es: "Investigando fuentes (fundamentado)" },
  facts:       { pt: "Verificando fatos por fonte",           en: "Verifying facts against sources", es: "Verificando hechos por fuente" },
  researching: { pt: "Pesquisando na internet",              en: "Searching the web",            es: "Buscando en internet" },
  reading:     { pt: "Lendo as fontes",                      en: "Reading sources",              es: "Leyendo las fuentes" },
  reasoning:   { pt: "Raciocinando",                         en: "Reasoning",                    es: "Razonando" },
  drafting:    { pt: "Redigindo",                            en: "Drafting",                     es: "Redactando" },
  generating:  { pt: "Gerando o documento",                  en: "Generating the document",      es: "Generando el documento" },
  finalizing:  { pt: "Finalizando",                          en: "Finishing up",                 es: "Finalizando" },
};

const fmtElapsed = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}` : `${s}s`; };

// Chat do Mukta Zero — CONTROLADO pelo App (messages/sending/phases/onSend).
//
// APRESENTAÇÃO: a resposta do agente é FULL-WIDTH sem balão. Não é estética — o MZ entrega
// relatórios, tabelas e blocos de código, e balão com max-w-[85%] estrangula esse conteúdo.
// A distinção usuário/agente é ESTRUTURAL (contido vs. corrido), como nas plataformas do espectro.
//
// No estado VAZIO o composer fica CENTRADO (padrão do ChatGPT/Gemini): o primeiro pedido é o
// centro da tela, não um rodapé. Ao existir conversa, ele desce e ancora embaixo.
export default function Chat({ messages, sending, phases = [], onSend, onRetry, deepResearch = false, onToggleDeepResearch, userName, onDownloadFile, onCommand }) {
  const { lang } = useLang();
  const t = useT(STRINGS);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const [expanded, setExpanded] = useState({}); // preview+more por mensagem (conteúdo grande não faz scroll infinito)
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const [now, setNow] = useState(Date.now()); // relógio p/ tempo decorrido na fase atual (não parece travado)
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const isEmpty = messages.length === 0 && !sending;

  useEffect(() => { if (!isEmpty) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending, isEmpty]);

  // Tick de 1s enquanto processa → atualiza o tempo decorrido da fase atual (mostra que está vivo).
  useEffect(() => {
    if (!sending) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sending, phases]);

  // Textarea cresce com o conteúdo até o teto — sem isto um pedido longo fica numa fenda de 1 linha.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, isEmpty]);

  // Cancela a leitura em voz alta ao desmontar — senão o navegador continua falando.
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }, []);

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttaching(true);
    try {
      const content = await readFileAsText(file);
      setAttachment({ name: file.name, content, file });
    } catch {
      setAttachment(null);
    } finally {
      setAttaching(false);
    }
  };

  // Um comando NAO vai para o agente: e configuracao local do MZ. O input e consumido aqui.
  const slashMatches = input.startsWith("/")
    ? SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(input.trim().toLowerCase()))
    : [];
  const runCommand = (name) => {
    const cmd = SLASH_COMMANDS.find((x) => x.name === name);
    setInput("");
    if (cmd && typeof onCommand === "function") onCommand(cmd.id);
  };

  const send = () => {
    const tx = input.trim();
    if (slashMatches.length > 0) { runCommand(slashMatches[0].name); return; }
    if ((!tx && !attachment) || sending) return;
    setInput("");
    const att = attachment;
    setAttachment(null);
    onSend(tx, att);
  };
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // COPIAR: a ação que mais faltava — não havia como tirar uma resposta do MZ da tela.
  const copyMessage = async (idx, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1600);
    } catch { /* clipboard bloqueado pelo contexto — sem ação útil aqui */ }
  };

  // LER EM VOZ ALTA: SpeechSynthesis é nativo do navegador (zero backend, zero custo).
  const toggleSpeak = (idx, text) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (speakingIdx === idx) { synth.cancel(); setSpeakingIdx(null); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 6000)); // teto: relatórios são longos
    u.lang = lang === "en" ? "en-US" : lang === "es" ? "es-ES" : "pt-BR";
    u.onend = () => setSpeakingIdx((s) => (s === idx ? null : s));
    u.onerror = () => setSpeakingIdx((s) => (s === idx ? null : s));
    setSpeakingIdx(idx);
    synth.speak(u);
  };

  const AgentMark = () => (
    <div className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary" aria-hidden="true">
      <Bot className="h-3.5 w-3.5" />
    </div>
  );

  const iconBtn = "grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground";

  // O CONTROLE do composer, sem moldura externa — usado nos DOIS lugares (centrado e ancorado).
  const composerBox = (
    <>
      {/* COMANDOS DE BARRA — a persona é configuração DO AGENTE, então mora no chat, com o
          agente, e não num ícone de conta no rodapé do rail. Digite "/" para ver o que há. */}
      {slashMatches.length > 0 && (
        <div role="listbox" aria-label={t.commands}
          className="mb-2 overflow-hidden rounded-xl border border-border bg-popover shadow-popup">
          {slashMatches.map((cmd, idx) => (
            <button key={cmd.name} role="option" aria-selected={idx === 0}
              onClick={() => runCommand(cmd.name)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${idx === 0 ? "bg-surface-2" : "hover:bg-surface-2"}`}>
              <cmd.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="font-mono text-[13px] font-semibold text-foreground">{cmd.name}</span>
              <span className="truncate text-xs text-muted-foreground">{t[cmd.descKey]}</span>
            </button>
          ))}
        </div>
      )}
      {(attachment || deepResearch) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {attachment && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              <span className="max-w-[220px] truncate text-foreground">{attachment.name}</span>
              <button onClick={() => setAttachment(null)} aria-label={t.removeAttach} className="ml-0.5 transition-colors hover:text-destructive">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}
          {deepResearch && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
              <Telescope className="h-3 w-3" aria-hidden="true" />{t.deepResearch}
            </span>
          )}
        </div>
      )}
      <div className="flex items-end gap-1 rounded-2xl border border-border bg-surface-2 p-1.5 shadow-composer transition-colors focus-within:border-border-strong">
        <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
        {typeof onToggleDeepResearch === "function" && (
          <button onClick={onToggleDeepResearch} disabled={sending} title={t.deepResearchHint} aria-label={t.deepResearch} aria-pressed={deepResearch}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors disabled:opacity-50 ${deepResearch ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground"}`}>
            <Telescope className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={attaching || sending} title={t.attachFile} aria-label={t.attachFile}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50">
          {attaching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
        </button>
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={sending}
          placeholder={t.placeholder}
          className="max-h-[200px] min-h-[36px] w-full flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none disabled:opacity-60"
        />
        <button onClick={send} disabled={sending || (!input.trim() && !attachment)} aria-label={t.send}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </>
  );

  // ── ESTADO VAZIO: composer no CENTRO, saudação acima, sugestões abaixo ──
  if (isEmpty) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full w-full max-w-[720px] flex-col justify-center gap-7 px-4 py-10 sm:px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-[30px] font-semibold leading-tight tracking-tight text-foreground sm:text-[34px]">
              {userName ? t.greeting(userName) : t.emptyTitle}
            </h2>
            <p className="max-w-md text-[15px] text-muted-foreground">{t.emptySub}</p>
          </div>

          <div>{composerBox}</div>

          {/* Sugestões ABAIXO do composer, em lista com ícone (padrão do ChatGPT) */}
          <div className="flex flex-col gap-1">
            {t.chips.map((c, i) => {
              const Icon = CHIP_ICONS[i] || Code2;
              return (
                <button key={c} onClick={() => setInput(c)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
                  <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                  <span>{c}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── CONVERSA: rolagem + composer ancorado ──
  return (
    <>
      <div role="log" aria-live="polite" aria-relevant="additions" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-4 py-6 sm:px-6">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end animate-fade-in">
                <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border bg-surface-2 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{m.text}</p>
                </div>
              </div>
            ) : m.role === "error" ? (
              <div key={i} role="alert" className="flex flex-col gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 animate-fade-in">
                <div className="flex gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                  <p className="whitespace-pre-wrap break-words text-sm text-destructive [overflow-wrap:anywhere]">{m.text}</p>
                </div>
                {/* Só o ÚLTIMO erro é re-tentável: o retryLastSend do App reenvia o último envio,
                    então oferecer o botão em erros antigos prometeria reenviar outra coisa. */}
                {typeof onRetry === "function" && i === messages.length - 1 && !sending && (
                  <button onClick={onRetry} className="ml-6 inline-flex w-fit items-center gap-1.5 rounded-lg border border-destructive/30 bg-surface px-2.5 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t.retry}
                  </button>
                )}
              </div>
            ) : (
              <div key={i} className="group flex flex-col gap-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <AgentMark />
                  <span className="text-[13px] font-semibold text-foreground">{t.agent}</span>
                </div>
                {(() => {
                  const long = m.text && m.text.length > 1400; // PREVIEW por padrão: conteúdo grande não faz scroll infinito
                  const isExp = !!expanded[i];
                  const isLast = i === messages.length - 1;
                  return (
                    <div>
                      <div className="relative">
                        <div className={`prose-mz text-[15px] ${long && !isExp ? "max-h-96 overflow-hidden" : ""}`}>
                          <Suspense fallback={<p className="whitespace-pre-wrap break-words">{m.text}</p>}>
                            <MarkdownBody text={m.text} onDownloadFile={onDownloadFile} t={t} />
                          </Suspense>
                        </div>
                        {long && !isExp && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" aria-hidden="true" />}
                      </div>
                      {long && (
                        <button onClick={() => setExpanded((e) => ({ ...e, [i]: !e[i] }))}
                          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                          {isExp ? t.showLess : t.showMore}
                        </button>
                      )}

                      {/* AÇÕES DA MENSAGEM — não existiam: não havia como copiar uma resposta do MZ.
                          Visíveis no hover, e sempre na última (padrão das plataformas do espectro). */}
                      <div className={`mt-1.5 flex items-center gap-0.5 transition-opacity ${isLast ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"}`}>
                        <button onClick={() => copyMessage(i, m.text)} title={copiedIdx === i ? t.copied : t.copy} aria-label={copiedIdx === i ? t.copied : t.copy} className={iconBtn}>
                          {copiedIdx === i ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>
                        <button onClick={() => toggleSpeak(i, m.text)} title={speakingIdx === i ? t.stopReading : t.readAloud} aria-label={speakingIdx === i ? t.stopReading : t.readAloud} className={iconBtn}>
                          {speakingIdx === i ? <Square className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
                        </button>

                        {/* CUSTO DO TURNO. Até 2026-08-08 o backend cobrava e o front não mostrava
                            nada — foi o que o Herbert notou ("não parece que está sendo debitado").
                            Só aparece quando REALMENTE houve débito (reason === "charged"); os
                            outros motivos são estado do sistema, não informação para o usuário. */}
                        {m.billing?.reason === "charged" && m.billing.charged != null ? (
                          <span className="ml-1 inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground"
                                title={m.billing.balance != null ? t.balanceAfter(m.billing.balance) : undefined}>
                            <Coins className="h-3 w-3" aria-hidden="true" />
                            {t.charged(m.billing.charged)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )
          )}

          {sending && (
            <div className="flex flex-col gap-2 animate-fade-in">
              <div className="flex items-center gap-2">
                <AgentMark />
                <span className="text-[13px] font-semibold text-foreground">{t.agent}</span>
              </div>
              <div aria-live="polite">
                {phases.length === 0 ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                    <span>{t.working}</span>
                  </div>
                ) : (
                  <ul className="flex w-fit min-w-[260px] flex-col gap-2 rounded-xl border border-border bg-surface p-3">
                    {phases.map((p, i) => {
                      const current = i === phases.length - 1;
                      const lbl = (PHASE_LABELS[p.phase] && PHASE_LABELS[p.phase][lang]) || p.label || p.phase;
                      return (
                        <li key={i} className="flex items-center gap-2 text-[13px]">
                          {current
                            ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                            : <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />}
                          <span className={current ? "font-medium text-foreground" : "text-muted-foreground"}>{lbl}{current ? "…" : ""}</span>
                          {current && p.at && <span className="ml-auto shrink-0 pl-3 text-[11px] tabular-nums text-muted-foreground/70">{fmtElapsed(now - new Date(p.at).getTime())}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-surface px-4 pb-3 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-[820px]">
          {composerBox}
          <p className="mt-1.5 px-1 text-center text-[11px] text-muted-foreground/70">{t.hint}</p>
        </div>
      </div>
    </>
  );
}
