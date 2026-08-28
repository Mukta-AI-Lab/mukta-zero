// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { createContext, useContext, useState, useCallback } from "react";

// i18n leve do Mukta Zero. O idioma vive num contexto (persistido em localStorage).
// Cada componente co-loca seu próprio dicionário { pt, en, es } e lê via useT(STRINGS).
// Sem dicionário central => componentes podem ser traduzidos em paralelo sem conflito de merge.

const LangContext = createContext({ lang: "pt", setLang: () => {} });
export const LANGS = [
  { code: "pt", label: "PT" },
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];
export const LANG_NAMES = { pt: "português", en: "inglês", es: "espanhol" };

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem("mz_lang") || "pt"; } catch { return "pt"; }
  });
  const setLang = useCallback((c) => {
    setLangState(c);
    // o seletor de idioma controla a UI E o idioma das RESPOSTAS do agente (mz_content_lang) — uma preferência só, persistida.
    // (antes mz_content_lang ficava sempre 'auto' sem controle; agora escolher PT/EN/ES faz o agente responder nesse idioma.)
    try { localStorage.setItem("mz_lang", c); localStorage.setItem("mz_content_lang", c); } catch { /* ignore */ }
  }, []);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

// useT(STRINGS) → objeto de strings do idioma atual (fallback pt). STRINGS = { pt:{...}, en:{...}, es:{...} }
export function useT(strings) {
  const { lang } = useLang();
  return strings[lang] || strings.pt;
}
