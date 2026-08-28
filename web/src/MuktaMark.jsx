// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
import React from "react";

// Marca do Mukta Zero. GERADA por mz-web/scripts/vectorize-mark.cjs a partir do ativo real
// (Examples/Marketing/Mukta_Logo_Black.png, 1024²) via threshold + potrace — NÃO desenhada
// à mão. Duas tentativas de traçar de olho falharam; medir substituiu o olho.
//
// A moldura (anel + pilares) e a seta são paths SEPARADOS, o que permite a variante clara em
// duas cores (anel cinza + seta marrom) e a escura monocromática — as cores vêm de
// --mark-frame / --mark-arrow no index.css, então um componente serve os dois temas.
// NÃO EDITAR à mão: rode o script novamente.
export default function MuktaMark({ className = "h-7 w-7", title }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
    >
      <path d="M 29.56 0.75 C 28.56 0.83, 26.28 1.18, 25.14 1.43 C 18.98 2.79, 13.71 5.74, 9.39 10.23 C 4.58 15.24, 1.59 21.63, 0.81 28.55 C 0.64 30.07, 0.67 33.71, 0.86 35.27 C 1.54 40.68, 3.34 45.49, 6.20 49.54 C 7.38 51.22, 8.21 52.20, 9.85 53.83 C 11.61 55.59, 13.28 56.98, 14.89 58.03 C 15.46 58.40, 15.94 58.71, 15.97 58.71 C 16.00 58.71, 16.02 53.25, 16.03 46.57 L 16.03 34.44 18.35 32.22 L 20.67 29.99 20.70 45.64 L 20.72 61.29 21.02 61.42 C 21.18 61.49, 21.74 61.69, 22.26 61.87 L 23.21 62.20 23.21 45.78 C 23.21 36.75, 23.23 27.98, 23.27 26.29 C 23.31 24.34, 23.30 23.24, 23.24 23.26 C 23.19 23.28, 21.70 24.81, 19.94 26.66 C 18.17 28.51, 15.98 30.77, 15.08 31.68 L 13.44 33.34 13.44 43.59 C 13.44 52.35, 13.43 53.82, 13.32 53.76 C 12.94 53.54, 11.27 51.99, 10.43 51.06 C 6.93 47.21, 4.61 42.64, 3.60 37.62 C 3.16 35.46, 3.08 34.57, 3.09 31.86 C 3.10 29.22, 3.19 28.16, 3.64 25.97 C 4.98 19.33, 8.74 13.34, 14.17 9.17 C 16.20 7.61, 18.74 6.16, 21.14 5.17 C 26.67 2.90, 33.53 2.47, 39.37 4.01 C 47.67 6.21, 54.38 11.67, 58.18 19.34 C 62.02 27.07, 62.08 36.33, 58.33 44.05 C 56.86 47.09, 55.40 49.21, 53.32 51.37 C 52.42 52.31, 50.85 53.73, 50.72 53.73 C 50.68 53.73, 50.65 49.12, 50.65 43.48 L 50.65 33.23 48.10 30.61 C 46.70 29.17, 44.52 26.90, 43.24 25.57 L 40.93 23.14 40.91 42.64 C 40.90 53.37, 40.90 62.16, 40.92 62.17 C 40.96 62.22, 41.88 61.90, 42.75 61.54 L 43.46 61.25 43.46 45.50 L 43.46 29.75 45.72 32.00 L 47.98 34.25 47.98 46.48 C 47.98 54.11, 48.01 58.71, 48.06 58.71 C 48.22 58.71, 50.04 57.44, 51.08 56.61 C 56.19 52.54, 59.46 48.12, 61.59 42.41 C 63.34 37.70, 63.89 32.33, 63.12 27.35 C 62.13 20.96, 59.38 15.27, 55.00 10.55 C 49.83 5.00, 42.58 1.49, 34.81 0.79 C 33.84 0.70, 30.55 0.68, 29.56 0.75 " fill="hsl(var(--mark-frame))" />
      <path d="M 30.93 9.70 C 28.64 12.80, 27.12 14.84, 25.24 17.36 C 24.16 18.80, 23.32 19.99, 23.36 20.00 C 23.41 20.02, 23.73 19.93, 24.08 19.81 C 24.44 19.69, 25.63 19.27, 26.73 18.89 L 28.73 18.19 28.75 40.68 L 28.78 63.17 29.79 63.29 C 30.83 63.41, 34.96 63.40, 35.16 63.27 C 35.24 63.22, 35.27 57.41, 35.27 40.76 C 35.27 28.41, 35.29 18.29, 35.32 18.26 C 35.34 18.23, 36.59 18.63, 38.08 19.13 C 39.58 19.64, 40.82 20.03, 40.85 20.00 C 40.91 19.95, 32.15 8.24, 32.06 8.25 C 32.03 8.25, 31.52 8.90, 30.93 9.70" fill="hsl(var(--mark-arrow))" />
    </svg>
  );
}
