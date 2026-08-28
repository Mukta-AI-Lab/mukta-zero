// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli logo — a MARCA da Mukta (círculo + seta ascendente entre
 * duas barras chanfradas) RASTERIZADA a partir da geometria do próprio logo,
 * não desenhada à mão em ASCII.
 *
 * Por que rasterizar: arte ASCII escrita à mão fica presa num tamanho e
 * "quase parece" a marca. Aqui a marca é uma MÁSCARA VETORIAL (ink(x,y) em
 * coordenadas normalizadas [-1,1]) e o render amostra essa máscara na
 * resolução pedida, usando meio-blocos (▀ ▄ █) para dobrar a resolução
 * vertical — a célula do terminal é ~2:1, então com meio-bloco o pixel fica
 * QUADRADO e o círculo sai redondo em qualquer largura.
 *
 * A marca é MONOCROMÁTICA (como o arquivo original: branco sobre preto), então
 * o default é o foreground do terminal em negrito — legível em tema claro E
 * escuro. MZ_LOGO_COLOR=<n> (256-color) força uma cor.
 */

/** Geometria da marca, em coordenadas normalizadas x,y ∈ [-1,1] (y para cima). */
const GEO = {
  ringOuter: 1.0,
  ringInner: 0.8,
  interiorClip: 0.78, // elementos internos são cortados pela curva do círculo
  shaftHalf: 0.13,
  shaftBottom: -0.95,
  headApex: 0.78,
  headBase: 0.26,
  headHalf: 0.34,
  barOuter: 0.74, // |x| da borda externa das barras laterais
  barInner: 0.28, // |x| da borda interna
  barTopOuter: -0.22, // altura do topo na borda externa
  barTopInner: 0.10, // altura do topo na borda interna (sobe em direção à seta)
  barBottom: -0.95,
  stroke: 0.15, // espessura do traço das barras (elas são OUTLINE, não sólidas)
};

/**
 * ink(x, y) — a máscara da marca. `true` = tinta.
 * Ordem: anel (fora) → recorte do interior → seta sólida → barras em outline.
 */
export function ink(x, y, g = GEO) {
  const r = Math.hypot(x, y);
  if (r <= g.ringOuter && r >= g.ringInner) return true; // o anel do círculo
  if (r > g.interiorClip) return false; // nada vaza para fora do anel

  // Seta central — sólida (haste + cabeça triangular).
  if (Math.abs(x) <= g.shaftHalf && y >= g.shaftBottom && y <= g.headBase + 0.02) return true;
  if (y >= g.headBase && y <= g.headApex) {
    const half = (g.headHalf * (g.headApex - y)) / (g.headApex - g.headBase);
    if (Math.abs(x) <= half) return true;
  }

  // Barras laterais — espelhadas, desenhadas em OUTLINE (interior vazado).
  const ax = Math.abs(x);
  const inBand = ax >= g.barInner && ax <= g.barOuter && y >= g.barBottom;
  if (inBand) {
    // topo inclinado: mais baixo na borda externa, mais alto na interna
    const t = (g.barOuter - ax) / (g.barOuter - g.barInner);
    const top = g.barTopOuter + t * (g.barTopInner - g.barTopOuter);
    if (y <= top) {
      const innerBand = ax >= g.barInner + g.stroke && ax <= g.barOuter - g.stroke;
      const innerTop = top - g.stroke * 1.35; // o topo inclinado também tem espessura
      if (!(innerBand && y <= innerTop)) return true; // é traço, não vazio
    }
  }
  return false;
}

/**
 * Rasteriza a marca em linhas de texto usando meio-blocos.
 * @param {number} width colunas do terminal (a altura sai width/2 linhas)
 * @returns {string[]} linhas SEM cor (a cor é aplicada por logo()/mark())
 */
export function rasterize(width = 24) {
  const W = Math.max(6, Math.floor(width));
  const H = W; // pixel quadrado: W colunas × W linhas de pixel = W/2 linhas do terminal
  // Traços ADAPTATIVOS: o anel e o contorno das barras têm espessura fixa em
  // PROPORÇÃO no arquivo original, mas abaixo de ~2px o meio-bloco os fragmenta.
  // Piso em pixels (fina em tamanho grande, garantida em tamanho pequeno).
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const px2n = 2 / W; // 1 pixel em unidades normalizadas
  const g = {
    ...GEO,
    ringInner: 1 - clamp(2.4 * px2n, 0.13, 0.24),
    stroke: clamp(2.2 * px2n, 0.11, 0.17),
  };
  g.interiorClip = g.ringInner - 0.02;
  const px = [];
  for (let row = 0; row < H; row += 1) {
    const y = 1 - ((row + 0.5) / H) * 2;
    const line = [];
    for (let col = 0; col < W; col += 1) {
      const x = ((col + 0.5) / W) * 2 - 1;
      line.push(ink(x, y, g));
    }
    px.push(line);
  }
  const out = [];
  for (let row = 0; row < H; row += 2) {
    let s = "";
    for (let col = 0; col < W; col += 1) {
      const top = px[row][col];
      const bottom = row + 1 < H ? px[row + 1][col] : false;
      s += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    out.push(s.replace(/\s+$/, ""));
  }
  return out;
}

const useColor = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

/** Sequência de cor da marca: default = foreground do terminal em negrito (mono, como o logo). */
export function logoColor() {
  if (!useColor()) return { on: "", off: "" };
  const forced = process.env.MZ_LOGO_COLOR;
  if (forced && /^\d{1,3}$/.test(forced)) return { on: `\x1b[1;38;5;${forced}m`, off: "\x1b[0m" };
  return { on: "\x1b[1m", off: "\x1b[0m" };
}

/** A marca colorida, como array de linhas (para compor lado a lado com texto). */
export function markLines(width = 24) {
  const { on, off } = logoColor();
  return rasterize(width).map((l) => (on ? on + l + off : l));
}

/**
 * banner — a marca + wordmark, para o startup do CLI e do `mz help`.
 * Compõe a marca à esquerda e o texto verticalmente centrado à direita.
 */
export function banner({ width = 22, tagline = true } = {}) {
  const c = useColor();
  const T = c ? "\x1b[1m" : "";
  const D = c ? "\x1b[2m" : "";
  const R = c ? "\x1b[0m" : "";
  const art = rasterize(width);
  const { on, off } = logoColor();
  const text = [
    `${T}MUKTA ZERO${R}`,
    ...(tagline
      ? [
          `${D}agente open-weight · mão local, cérebro nuvem${R}`,
          `${D}\`mz\` abre a janela · \`mz help\` lista os comandos${R}`,
        ]
      : []),
  ];
  const pad = Math.max(0, Math.floor((art.length - text.length) / 2));
  const lines = [""];
  for (let i = 0; i < art.length; i += 1) {
    const left = (on ? on + art[i] + off : art[i]).padEnd(width + (on ? on.length + off.length : 0));
    const right = text[i - pad] || "";
    lines.push(`  ${left}  ${right}`.replace(/\s+$/, ""));
  }
  lines.push("");
  return lines.join("\n");
}
