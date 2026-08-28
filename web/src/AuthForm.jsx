// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React, { useState } from "react";
import { Bot, User, Lock, Mail, LogIn, AlertCircle, CheckCircle2 } from "lucide-react";
import { useT } from "./lib/i18n.jsx";

const STRINGS = {
  pt: { welcome: "Bem-vindo", access: "Acesse o Mukta Zero", tabLogin: "Usuário e Senha", tabSignup: "Criar conta",
        username: "Usuário", password: "Senha", fullName: "Nome completo", email: "E-mail",
        signingIn: "Entrando…", login: "Entrar", sending: "Enviando…", requestSignup: "Solicitar cadastro", forgot: "Esqueci minha senha", confirmPassword: "Confirmar senha", passwordMismatch: "As senhas não conferem" },
  en: { welcome: "Welcome", access: "Access Mukta Zero", tabLogin: "Username & Password", tabSignup: "Create account",
        username: "Username", password: "Password", fullName: "Full name", email: "Email",
        signingIn: "Signing in…", login: "Log in", sending: "Sending…", requestSignup: "Request signup", forgot: "Forgot my password", confirmPassword: "Confirm password", passwordMismatch: "Passwords do not match" },
  es: { welcome: "Bienvenido", access: "Accede a Mukta Zero", tabLogin: "Usuario y Contraseña", tabSignup: "Crear cuenta",
        username: "Usuario", password: "Contraseña", fullName: "Nombre completo", email: "Correo",
        signingIn: "Entrando…", login: "Entrar", sending: "Enviando…", requestSignup: "Solicitar registro", forgot: "Olvidé mi contraseña", confirmPassword: "Confirmar contraseña", passwordMismatch: "Las contraseñas no coinciden" },
};

// Card de login/cadastro estilo Mukta (tile teal + Bot, inputs com ícone, botão de ação marrom/primary).
// Só chama as props onLogin(username,password) / onSignup({fullName,email,password}).
export default function AuthForm({ onLogin, onSignup, onForgot, busy, error, noticeKind = "error" }) {
  const t = useT(STRINGS);
  const [tab, setTab] = useState("login");
  const [f, setF] = useState({ username: "", password: "", fullName: "", email: "", confirmPassword: "" });
  const [formError, setFormError] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    setFormError("");
    if (tab === "login") { onLogin(f.username, f.password); return; }
    if (f.password !== f.confirmPassword) { setFormError(t.passwordMismatch); return; }
    onSignup({ fullName: f.fullName, email: f.email, password: f.password });
  };

  const inputCls =
    "h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-modal">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
        <Bot className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="mb-6 text-center">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{t.welcome}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.access}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
        {[["login", t.tabLogin], ["signup", t.tabSignup]].map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => { setTab(v); setFormError(""); }}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${tab === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {(formError || error) && (() => {
        const ok = !formError && noticeKind === "success";
        return (
          <div role="alert" aria-live="assertive"
            className={`mb-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
            {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{formError || error}</span>
          </div>
        );
      })()}

      <form onSubmit={submit} className="space-y-3">
        {tab === "login" ? (
          <>
            <div className="relative">
              <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input aria-label={t.username} autoComplete="username" placeholder={t.username} value={f.username} onChange={set("username")} required disabled={busy} className={inputCls} />
            </div>
            <div className="relative">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="password" aria-label={t.password} autoComplete="current-password" placeholder={t.password} value={f.password} onChange={set("password")} required disabled={busy} className={inputCls} />
            </div>
            <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-60">
              <LogIn aria-hidden="true" className="h-4 w-4" />
              {busy ? t.signingIn : t.login}
            </button>
            {onForgot && (
              <button type="button" onClick={onForgot} disabled={busy} className="w-full text-center text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-60">
                {t.forgot}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="relative">
              <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input aria-label={t.fullName} autoComplete="name" placeholder={t.fullName} value={f.fullName} onChange={set("fullName")} required disabled={busy} className={inputCls} />
            </div>
            <div className="relative">
              <Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="email" aria-label={t.email} autoComplete="email" placeholder={t.email} value={f.email} onChange={set("email")} required disabled={busy} className={inputCls} />
            </div>
            <div className="relative">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="password" aria-label={t.password} autoComplete="new-password" placeholder={t.password} value={f.password} onChange={set("password")} required disabled={busy} className={inputCls} />
            </div>
            <div className="relative">
              <Lock aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="password" aria-label={t.confirmPassword} autoComplete="new-password" placeholder={t.confirmPassword} value={f.confirmPassword} onChange={set("confirmPassword")} required disabled={busy} className={inputCls} />
            </div>
            <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-60">
              <User aria-hidden="true" className="h-4 w-4" />
              {busy ? t.sending : t.requestSignup}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
