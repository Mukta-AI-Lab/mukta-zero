// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { useState, useEffect } from "react";
import { X, Wallet as WalletIcon, Loader2, Coins, Sparkles, ArrowRight, Check } from "lucide-react";
import { useT } from "./lib/i18n.jsx";
import { myWallet } from "./lib/mzApi.js";
import { paymentTiers, paymentCheckout, isPaymentEnabled } from "./lib/payments.js";
import config from "./config.js";

const STRINGS = {
  pt: {
    title: "Carteira de pontos", balance: "Saldo atual", points: "pontos",
    free: "Gratuitos", purchased: "Comprados", plan: "Plano",
    planFree: "Gratuito", planPaid: "Mensal",
    buyTitle: "Comprar pontos", subscribe: "Assinatura mensal", topups: "Recargas avulsas",
    hint: "1 ponto = R$ 0,01 em uso. Recargas não expiram; o plano mensal renova todo mês.",
    perMonth: "/mês", pts: "pts", loading: "Carregando…", redirecting: "Abrindo o pagamento…",
    err: "Não foi possível carregar. Tente novamente.", notConfigured: "Compra indisponível no momento.",
    close: "Fechar", subscribeCta: "Assinar", buyCta: "Comprar", best: "Melhor valor",
    successMsg: "Pagamento recebido! Seus pontos serão creditados em instantes.",
    cancelMsg: "Pagamento cancelado. Nenhum valor foi cobrado.",
  },
  en: {
    title: "Points wallet", balance: "Current balance", points: "points",
    free: "Free", purchased: "Purchased", plan: "Plan",
    planFree: "Free", planPaid: "Monthly",
    buyTitle: "Buy points", subscribe: "Monthly subscription", topups: "One-time top-ups",
    hint: "1 point = R$ 0.01 in usage. Top-ups don't expire; the monthly plan renews each month.",
    perMonth: "/mo", pts: "pts", loading: "Loading…", redirecting: "Opening checkout…",
    err: "Couldn't load. Please try again.", notConfigured: "Purchases are unavailable right now.",
    close: "Close", subscribeCta: "Subscribe", buyCta: "Buy", best: "Best value",
    successMsg: "Payment received! Your points will be credited shortly.",
    cancelMsg: "Payment canceled. You were not charged.",
  },
  es: {
    title: "Cartera de puntos", balance: "Saldo actual", points: "puntos",
    free: "Gratuitos", purchased: "Comprados", plan: "Plan",
    planFree: "Gratuito", planPaid: "Mensual",
    buyTitle: "Comprar puntos", subscribe: "Suscripción mensual", topups: "Recargas únicas",
    hint: "1 punto = R$ 0,01 en uso. Las recargas no vencen; el plan mensual se renueva cada mes.",
    perMonth: "/mes", pts: "pts", loading: "Cargando…", redirecting: "Abriendo el pago…",
    err: "No se pudo cargar. Inténtalo de nuevo.", notConfigured: "Compra no disponible por ahora.",
    close: "Cerrar", subscribeCta: "Suscribir", buyCta: "Comprar", best: "Mejor valor",
    successMsg: "¡Pago recibido! Tus puntos se acreditarán en breve.",
    cancelMsg: "Pago cancelado. No se realizó ningún cobro.",
  },
};

const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
const num = (n) => Number(n || 0).toLocaleString("pt-BR");

export default function Wallet({ supabase, onClose, banner }) {
  const t = useT(STRINGS);
  const [wallet, setWallet] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [buying, setBuying] = useState(null); // id do tier em checkout

  const load = async () => {
    setLoading(true); setError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token;
      if (!tok) throw new Error("no session");
      const [w, tr] = await Promise.all([
        myWallet(config.SUPABASE_URL, tok, config.ANON_KEY).catch(() => null),
        paymentTiers( tok, config.ANON_KEY).catch(() => ({ tiers: [] })),
      ]);
      setWallet(w && w.ok ? w : null);
      setTiers(Array.isArray(tr?.tiers) ? tr.tiers : []);
    } catch { setError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const buy = async (tierId) => {
    setBuying(tierId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = await paymentCheckout( session?.access_token, config.ANON_KEY, tierId);
      window.location.href = url; // redireciona ao Stripe Checkout
    } catch {
      setBuying(null); setError(true);
    }
  };

  const total = wallet ? Number(wallet.total || 0) : 0;
  const isPaid = wallet?.plan === "paid";
  const sub = tiers.find((x) => x.mode === "subscription");
  const topups = tiers.filter((x) => x.mode !== "subscription").sort((a, b) => a.amount - b.amount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t.title} onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-teal-600 text-white shadow-sm"><WalletIcon className="h-4 w-4" aria-hidden="true" /></div>
            <h2 className="text-base font-semibold text-foreground">{t.title}</h2>
          </div>
          <button onClick={onClose} aria-label={t.close} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {banner && (
            <div className={`mb-4 rounded-xl border px-3 py-2 text-sm ${banner === "success" ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300" : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"}`}>
              {banner === "success" ? t.successMsg : t.cancelMsg}
            </div>
          )}

          {loading ? (
            <div role="status" className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" /><span className="sr-only">{t.loading}</span></div>
          ) : (
            <>
              {/* Saldo */}
              <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 to-white p-4 dark:border-teal-500/20 dark:from-teal-500/10 dark:to-transparent">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-teal-700/80 dark:text-teal-300/80"><Coins className="h-3.5 w-3.5" aria-hidden="true" />{t.balance}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tabular-nums text-foreground">{num(total)}</span>
                  <span className="text-sm text-muted-foreground">{t.points}</span>
                  <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${isPaid ? "bg-teal-600 text-white" : "bg-muted text-muted-foreground"}`}>{t.plan}: {isPaid ? t.planPaid : t.planFree}</span>
                </div>
                {wallet && (
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <span>{t.free}: <b className="tabular-nums text-foreground">{num(wallet.free_points)}</b></span>
                    <span>{t.purchased}: <b className="tabular-nums text-foreground">{num(wallet.purchased_points)}</b></span>
                  </div>
                )}
              </div>

              {/* Comprar */}
              <div className="mt-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">{t.buyTitle}</h3>
                {!isPaymentEnabled() ? null : tiers.length === 0 ? (
                  <p className="rounded-xl border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">{t.notConfigured}</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* Assinatura mensal */}
                    {sub && (
                      <div>
                        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.subscribe}</div>
                        <button onClick={() => buy(sub.id)} disabled={!!buying}
                          className="group flex w-full items-center gap-3 rounded-2xl border-2 border-teal-500 bg-teal-50 px-4 py-3.5 text-left transition hover:bg-teal-100 disabled:opacity-60 dark:bg-teal-500/10 dark:hover:bg-teal-500/20">
                          <Sparkles className="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 font-semibold text-foreground">{sub.label}<span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">{t.best}</span></div>
                            <div className="text-sm text-muted-foreground"><span className="tabular-nums">{num(sub.points)}</span> {t.pts}{t.perMonth}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-lg font-bold tabular-nums text-foreground">{brl(sub.amount)}<span className="text-xs font-normal text-muted-foreground">{t.perMonth}</span></div>
                          </div>
                          {buying === sub.id ? <Loader2 className="h-4 w-4 animate-spin text-teal-600" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 shrink-0 text-teal-600 transition group-hover:translate-x-0.5 dark:text-teal-400" aria-hidden="true" />}
                        </button>
                      </div>
                    )}

                    {/* Recargas avulsas */}
                    {topups.length > 0 && (
                      <div>
                        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.topups}</div>
                        <div className="grid gap-2">
                          {topups.map((tp) => (
                            <button key={tp.id} onClick={() => buy(tp.id)} disabled={!!buying}
                              className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition hover:border-teal-400 hover:bg-muted disabled:opacity-60">
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-foreground">{tp.label}</div>
                                <div className="text-sm text-muted-foreground"><span className="tabular-nums">{num(tp.points)}</span> {t.pts}</div>
                              </div>
                              <div className="text-base font-semibold tabular-nums text-foreground shrink-0">{brl(tp.amount)}</div>
                              {buying === tp.id ? <Loader2 className="h-4 w-4 animate-spin text-teal-600" aria-hidden="true" /> : <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t.hint}</p>
                {error && <p className="mt-2 text-xs text-red-500">{t.err}</p>}
                {buying && <p className="mt-2 flex items-center gap-1.5 text-xs text-teal-600 dark:text-teal-400"><Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />{t.redirecting}</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
