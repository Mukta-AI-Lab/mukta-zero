// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, FileText } from "lucide-react";

// Corpo markdown da resposta do agente, em módulo SEPARADO para sair do caminho crítico.
// A pilha markdown (react-markdown + remark-gfm + micromark/mdast/hast) pesa ~151 kB e NÃO é
// necessária para a primeira pintura: o estado vazio não renderiza markdown nenhum. O Chat a
// carrega por lazy(), e o fallback mostra o TEXTO CRU — legível de imediato, sem salto de layout.

// O react-markdown v9 sanitiza href e DESCARTA esquemas fora de http/https/mailto/tel. O
// marcador `mzfile:` era apagado, o href chegava vazio e o handler de download NUNCA disparava.
// Liberamos SOMENTE mzfile: e mantemos o sanitizador para o resto: o conteúdo vem de um modelo,
// e um urlTransform permissivo abriria a porta para javascript: (XSS).
const mzUrlTransform = (url) => (String(url).startsWith("mzfile:") ? url : defaultUrlTransform(url));

// `mzfile:<file_id>` vira um CARD de arquivo, não um link inline: o MZ existe para entregar
// documentos, e o entregável merece peso visual de resultado. A URL é re-assinada no clique.
function components(onDownloadFile, t) {
  return {
    a: ({ href, children, ...props }) => {
      if (typeof href === "string" && href.startsWith("mzfile:")) {
        const fileId = href.slice(7);
        const name = React.Children.toArray(children).filter((x) => typeof x === "string").join("") || t.document;
        const ext = (name.includes(".") ? name.split(".").pop() : "").toUpperCase();
        return (
          <button type="button" onClick={() => onDownloadFile && onDownloadFile(fileId)}
            className="not-prose my-2 flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              <span className="block text-xs text-muted-foreground">{t.document}{ext ? ` · ${ext}` : ""}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />{t.download}
            </span>
          </button>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
  };
}

export default function MarkdownBody({ text, onDownloadFile, t }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={mzUrlTransform} components={components(onDownloadFile, t)}>
      {text}
    </ReactMarkdown>
  );
}
