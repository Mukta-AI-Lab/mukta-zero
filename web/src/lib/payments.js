// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// payments.js — PONTO DE EXTENSÃO DE PAGAMENTO (por tenant).
//
// A distribuição pública do Mukta Zero NÃO inclui um provedor de pagamento. A quota (pontos)
// é parte da plataforma — é como o admin aloca capacidade entre os usuários e é o freio dos
// laços autônomos — mas COMPRAR quota com cartão é decisão de quem opera a instância.
//
// Deixe desligado e a carteira funciona como painel de quota: saldo, plano e consumo, com a
// recarga feita pelo admin (`mz_admin_grant_points`).
//
// Para cobrar dos seus próprios tenants, aponte `VITE_MZ_PAYMENT_ENDPOINT` para um endpoint
// SEU que implemente o contrato abaixo. Nada além disto precisa ser tocado na UI.
//
// CONTRATO ESPERADO DO ENDPOINT
//   POST <endpoint>  { action: "tiers" }
//     → 200 { tiers: [ { id, label, amount, currency, points, mode: "subscription"|"payment" } ] }
//   POST <endpoint>  { action: "checkout", tier: "<id>" }
//     → 200 { url: "https://…" }   // a UI redireciona o usuário para esta URL
//   Autenticação: o mesmo Bearer do usuário que a UI já envia; o endpoint decide o resto.
//   Retorno ao app: redirecione de volta com `?payment=success` ou `?payment=cancel`.
//
// Quem credita os pontos após o pagamento é o SEU endpoint (ou o webhook do seu provedor),
// chamando a função de crédito da instância. A UI só inicia o fluxo e mostra o resultado.

const ENDPOINT = (import.meta.env && import.meta.env.VITE_MZ_PAYMENT_ENDPOINT) || "";

/** Há provedor de pagamento configurado? Se não, a UI esconde a seção de compra. */
export function isPaymentEnabled() {
  return typeof ENDPOINT === "string" && ENDPOINT.length > 0;
}

async function post(accessToken, anonKey, body) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/** Planos/recargas oferecidos. Devolve lista vazia quando não há provedor — nunca lança. */
export async function paymentTiers(accessToken, anonKey) {
  if (!isPaymentEnabled()) return { tiers: [] };
  try {
    return await post(accessToken, anonKey, { action: "tiers" });
  } catch {
    return { tiers: [] };
  }
}

/** Inicia a compra e devolve a URL para onde redirecionar. Lança se o provedor recusar. */
export async function paymentCheckout(accessToken, anonKey, tier) {
  if (!isPaymentEnabled()) throw new Error("nenhum provedor de pagamento configurado");
  const d = await post(accessToken, anonKey, { action: "checkout", tier });
  if (!d.url) throw new Error("o provedor não devolveu uma URL de checkout");
  return d.url;
}
