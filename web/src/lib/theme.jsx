// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { createContext, useContext, useEffect, useState, useCallback } from "react";

// Tema do Mukta Zero (defeito F-2). O projeto já tinha TODA a estilização escura pronta —
// `darkMode: ["class"]` no tailwind.config, o bloco `.dark` no index.css e centenas de classes
// `dark:*` nas 18 telas — mas NADA nunca escrevia a classe `.dark` no documento. Metade da
// estilização era inalcançável: pagávamos o custo (CSS no bundle, revisão) sem entregar o
// recurso. Este módulo é a peça que faltava, no mesmo padrão do i18n (contexto + localStorage).
//
// A preferência tem TRÊS estados, não dois: 'system' respeita o SO (e continua a seguir se o
// usuário trocar o tema do SO com a aba aberta), 'light'/'dark' fixam. O anti-flash de tema
// mora no index.html (script inline antes da 1ª pintura) — sem ele a página pisca claro.

const KEY = "mz_theme";
const PREFS = ["light", "dark", "system"];
const ThemeContext = createContext({ pref: "system", setPref: () => {}, mode: "light" });

const prefersDark = () => {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
};
const resolve = (pref) => (pref === "system" ? (prefersDark() ? "dark" : "light") : pref);

// Escreve o modo EFETIVO no documento. `color-scheme` faz os controles nativos (scrollbar,
// date picker, autofill) acompanharem — sem isso o dark fica com scrollbar branca.
function applyMode(mode) {
  try {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
  } catch { /* ambiente sem DOM */ }
}

const readPref = () => {
  try {
    const v = localStorage.getItem(KEY);
    return PREFS.includes(v) ? v : "system";
  } catch { return "system"; }
};

export function ThemeProvider({ children }) {
  const [pref, setPrefState] = useState(readPref);
  const [mode, setMode] = useState(() => resolve(readPref()));

  useEffect(() => {
    const next = resolve(pref);
    setMode(next);
    applyMode(next);
    try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }

    // Só em 'system' seguimos o SO ao vivo; em light/dark a escolha do usuário manda.
    if (pref !== "system") return;
    let mq;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return; }
    const onChange = () => { const m = resolve("system"); setMode(m); applyMode(m); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const setPref = useCallback((p) => setPrefState(PREFS.includes(p) ? p : "system"), []);
  // Ciclo do botão do header: claro → escuro → sistema → claro.
  const cyclePref = useCallback(() => {
    setPrefState((p) => (p === "light" ? "dark" : p === "dark" ? "system" : "light"));
  }, []);

  return (
    <ThemeContext.Provider value={{ pref, setPref, cyclePref, mode }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
