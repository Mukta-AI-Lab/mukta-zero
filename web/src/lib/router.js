// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Roteamento por hash do Mukta Zero (defeito F-4). Antes: 8 views de topo + N conversas + missões
// vivendo numa única URL — não se compartilhava um run, não se linkava uma missão, e o "voltar" do
// navegador SAÍA do app. Este canal cita artefato por id o tempo todo; no front isso era incolável.
//
// Por que HASH e não history/pushState: o front é servido pelo CF Pages e um path real (/torre)
// exigiria regra de rewrite no _redirects — e a jurisprudência de 2026-07-30 (white-screen por
// cache envenenado de SPA fallback) diz para não mexer nesse arquivo sem necessidade. O hash é
// resolvido 100% no cliente, não toca no edge, e dá histórico + back button de graça.
//
// Formato: `#/<view>` e, para o chat, `#/chat/<conversationId>`.

export const VIEWS = ["chat", "projects", "obs", "studio", "missions", "plano", "torre", "settings", "admin"];

export function parseHash(hash) {
  const raw = typeof hash === "string" ? hash : (typeof location !== "undefined" ? location.hash : "");
  const parts = String(raw || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  const view = VIEWS.includes(parts[0]) ? parts[0] : "chat";
  // Só o chat carrega um id de recurso na URL; as outras views têm estado próprio interno.
  const conversationId = view === "chat" && parts[1] ? decodeURIComponent(parts[1]) : null;
  return { view, conversationId };
}

export function buildHash(view, conversationId) {
  const v = VIEWS.includes(view) ? view : "chat";
  return v === "chat" && conversationId ? `#/chat/${encodeURIComponent(conversationId)}` : `#/${v}`;
}

// Sincroniza a URL com o estado. `replace` evita empilhar uma entrada de histórico na 1ª pintura
// (senão o primeiro "voltar" do usuário não faz nada visível).
export function writeHash(view, conversationId, replace) {
  try {
    const next = buildHash(view, conversationId);
    if (location.hash === next) return;
    if (replace) history.replaceState(null, "", next);
    else location.hash = next; // dispara hashchange → o app reage por um caminho só
  } catch { /* ignore */ }
}
