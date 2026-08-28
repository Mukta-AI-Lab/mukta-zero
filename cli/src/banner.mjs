// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli banner — a marca da Mukta no startup.
 *
 * A arte não é mais desenhada à mão: ela é RASTERIZADA da geometria do logo
 * (círculo + seta ascendente entre duas barras chanfradas) por ui/logo.mjs, o
 * que mantém a mesma marca em qualquer largura — do banner do `mz help` ao
 * splash da janela (`mz`) e ao ícone pequeno. Ver ui/logo.mjs.
 */
export { banner, markLines, rasterize } from "./ui/logo.mjs";
