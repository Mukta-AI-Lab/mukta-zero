// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Code-splitting do mz-web (alvo PRÉ-REGISTRADO no canal PL#, entrada jjjjjjjj·F, antes de
// tocar código: chunk inicial ≤ 300 kB bruto, com o UAT F-1..F-4 obrigado a continuar 12/12
// e desistência declarada em 400 kB para não recortar o alvo depois de ver o resultado).
//
// Duas frentes: (1) as 7 views não-chat e os 4 modais entram por React.lazy no App;
// (2) as dependências grandes viram chunks próprios aqui. A pilha de markdown é a mais
// pesada e NÃO é necessária para a primeira pintura (o estado vazio não renderiza markdown),
// então ela sai do caminho crítico junto com o corpo da mensagem.
const MARKDOWN_DEPS = [
  "react-markdown", "remark-", "micromark", "mdast", "unist", "hast", "vfile",
  "property-information", "space-separated-tokens", "comma-separated-tokens",
  "character-entities", "decode-named-character-reference", "trim-lines",
  "html-url-attributes", "estree", "devlop", "zwitch", "longest-streak",
  "ccount", "markdown-table", "escape-string-regexp", "bail", "is-plain-obj",
  "trough", "unified", "extend",
];

// ── MARCADOR DE BUILD (/version.json) ────────────────────────────────────────────────────
// Pedido do Persona-Workflow-eng, e a lacuna é real: sem isto quem testa o app.example.com não
// consegue registar CONTRA QUE BUILD testou, e resultado sem essa âncora não é reproduzível.
// O mukta-app tem version.json desde sempre; o mz-web não tinha porque deploya por wrangler
// (manual), não pela integração git do CF — logo `CF_PAGES_COMMIT_SHA` nunca é populado aqui
// e o SHA tem de vir do git local.
//
// `dirty` NÃO é enfeite: o mz-web deploya do diretório de TRABALHO, então um build pode conter
// alterações não commitadas, e um marcador que anuncia um SHA sem dizer isso MENTE sobre o que
// está no ar.
//
// ⚠️ O pathspec é relativo ao CWD e o vite roda DENTRO de `mz-web`: usar `-- mz-web` viraria
// `mz-web/mz-web` e não casaria com nada. A primeira versão deste marcador tinha esse defeito
// e reportou `dirty:false` com o vite.config.js modificado — o instrumento criado contra
// marcador mentiroso mentiu na estreia, e no sentido pior (dizendo "limpo"). Só apareceu
// porque conferi a afirmação dele contra o `git status` real em vez de aceitar a saída bonita.
const gitInfo = () => {
  const run = (c) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return ""; } };
  const sha = run("git rev-parse HEAD");
  return { commitSha: sha || "desconhecido", shaCurto: (sha || "").slice(0, 8), dirty: run("git status --porcelain -- .").length > 0 };
};

const buildMarker = () => ({
  name: "mz-build-marker",
  closeBundle() {
    const dist = join(process.cwd(), "dist");
    // O nome do bundle vem do index.html — que é a ÚNICA fonte autoritativa do que este build
    // referencia. A 1ª versão listava `assets/` e pegava `.pop()`, mas o `dist` NÃO é limpo
    // entre builds (acumula dezenas de index-*.js), então `.pop()` devolvia um bundle
    // arbitrário e antigo: o marcador criado para dizer o que está no ar mentia sobre o que
    // está no ar. Apanhado ao conferir /version.json vivo contra o bundle que o CF servia —
    // segundo defeito deste marcador, e o segundo apanhado por confrontar a saída dele com a
    // realidade em vez de aceitá-la.
    let bundle = "";
    try {
      const html = readFileSync(join(dist, "index.html"), "utf8");
      bundle = (html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || "";
    } catch { /* dist novo */ }
    mkdirSync(dist, { recursive: true }); // tarball não tem dist/ prévio
    const info = { app: "mz-web", ...gitInfo(), builtAt: new Date().toISOString(), bundle };
    writeFileSync(join(dist, "version.json"), JSON.stringify(info, null, 2), "utf8");
    console.log(`  version.json  ${info.shaCurto}${info.dirty ? "  ⚠️ DIRTY: build contém alterações não commitadas" : ""}`);
  },
});

export default defineConfig({
  plugins: [react(), buildMarker()],
  build: {
    // O teto passa a ser 320 kB para que um chunk inicial fora do alvo QUEBRE o aviso
    // em vez de passar calado — o guard vive no build, não na minha memória.
    chunkSizeWarningLimit: 320,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const p = id.split("node_modules/")[1] || "";
          if (MARKDOWN_DEPS.some((d) => p.includes(d))) return "vendor-markdown";
          if (p.startsWith("@supabase") || p.includes("supabase")) return "vendor-supabase";
          if (p.startsWith("lucide-react")) return "vendor-icons";
          if (p.startsWith("react-dom") || p.startsWith("react/") || p.startsWith("scheduler")) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
});
