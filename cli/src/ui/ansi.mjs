// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli ui/ansi — primitivas de terminal SEM dependência externa
 * (o mz-cli tem 1 dep só; um TUI não vai arrastar ink/react/blessed p/ dentro).
 *
 * Cobre o mínimo necessário p/ uma janela única: buffer alternativo, tamanho,
 * cor degradável (NO_COLOR / não-TTY), medida de largura visível (ignorando
 * escapes e contando emoji/CJK como 2 colunas), quebra de linha por palavra e
 * DECODIFICAÇÃO DE TECLA — inclusive as combinações que o TUI usa como atalho
 * (Shift+Tab p/ modo, Ctrl+T p/ aba nova, Alt+1..9 p/ pular de aba).
 */

export const ESC = "\x1b";
export const CSI = "\x1b[";

export const isTTY = () => Boolean(process.stdout.isTTY);
export const useColor = () => isTTY() && !process.env.NO_COLOR;

const wrapSgr = (code) => (s) => (useColor() ? `${CSI}${code}m${s}${CSI}0m` : String(s));
export const bold = wrapSgr(1);
export const dim = wrapSgr(2);
export const italic = wrapSgr(3);
export const underline = wrapSgr(4);
export const inverse = wrapSgr(7);
/** Cor de primeiro plano 256; devolve identidade quando sem cor. */
export const fg = (n) => (s) => (useColor() ? `${CSI}38;5;${n}m${s}${CSI}0m` : String(s));
export const bg = (n) => (s) => (useColor() ? `${CSI}48;5;${n}m${s}${CSI}0m` : String(s));

/** Paleta do TUI — poucos tons, alto contraste em tema claro E escuro. */
export const C = {
  accent: fg(37), // teal — identidade Mukta no front
  muted: dim,
  warn: fg(178),
  err: fg(167),
  ok: fg(71),
  user: fg(39),
  agentTag: fg(140),
  chip: fg(245),
};

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const stripAnsi = (s) => String(s).replace(ANSI_RE, "");

/** Largura de UM code point em colunas do terminal (2 p/ CJK/emoji, 0 p/ combining). */
function cpWidth(cp) {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0; // ZWJ / variation selectors
  if (cp >= 0x0300 && cp <= 0x036f) return 0; // combining
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Largura VISÍVEL (colunas) de uma string, ignorando escapes ANSI. */
export function width(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += cpWidth(ch.codePointAt(0));
  return w;
}

/** Corta uma string para no máximo `max` colunas visíveis (preserva escapes já fechados). */
export function truncate(s, max, ellipsis = "…") {
  if (width(s) <= max) return s;
  const plain = stripAnsi(s);
  let out = "";
  let w = 0;
  for (const ch of plain) {
    const cw = cpWidth(ch.codePointAt(0));
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}

/** Preenche à direita até `n` colunas visíveis. */
export function pad(s, n) {
  const d = n - width(s);
  return d > 0 ? s + " ".repeat(d) : s;
}

/**
 * Quebra texto em linhas de no máximo `max` colunas, por PALAVRA, preservando
 * quebras explícitas e não estourando em palavras gigantes (URL/hash/base64).
 */
export function wrapText(text, max) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    if (width(raw) <= max) {
      out.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(/(\s+)/)) {
      if (!word) continue;
      if (width(line) + width(word) <= max) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.replace(/\s+$/, ""));
      line = "";
      let chunk = word.replace(/^\s+/, "");
      while (width(chunk) > max) {
        // palavra maior que a linha inteira — parte no limite
        let cut = "";
        let w = 0;
        for (const ch of chunk) {
          const cw = cpWidth(ch.codePointAt(0));
          if (w + cw > max) break;
          cut += ch;
          w += cw;
        }
        out.push(cut);
        chunk = chunk.slice(cut.length);
      }
      line = chunk;
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}

/* ─────────────────────────── tela ─────────────────────────── */

export const screen = {
  enter() {
    process.stdout.write(`${CSI}?1049h${CSI}?25l${CSI}H${CSI}2J`); // buffer alternativo + esconde cursor
  },
  exit() {
    process.stdout.write(`${CSI}?25h${CSI}?1049l`); // mostra cursor + volta ao buffer normal
  },
  size() {
    return {
      cols: Math.max(40, process.stdout.columns || 80),
      rows: Math.max(12, process.stdout.rows || 24),
    };
  },
  /** Escreve um frame INTEIRO de uma vez (sem flicker): home → linhas → limpa o resto. */
  paint(lines) {
    const { rows } = screen.size();
    let buf = `${CSI}H`;
    for (let i = 0; i < Math.min(lines.length, rows); i += 1) {
      buf += `${CSI}K${lines[i]}`;
      if (i < Math.min(lines.length, rows) - 1) buf += "\r\n";
    }
    buf += `${CSI}J`;
    process.stdout.write(buf);
  },
  showCursorAt(row, col) {
    process.stdout.write(`${CSI}${row + 1};${col + 1}H${CSI}?25h`);
  },
  hideCursor() {
    process.stdout.write(`${CSI}?25l`);
  },
};

/* ─────────────────────────── teclado ─────────────────────────── */

/**
 * decodeKey — traduz um chunk cru do stdin (raw mode) em {name, ctrl, alt, shift, seq}.
 * Cobre o conjunto que o TUI usa: setas, Home/End/PgUp/PgDn/Delete, Tab/Shift+Tab,
 * Enter, Backspace, Esc, Ctrl+<letra>, Alt+<char>, e texto imprimível.
 */
export function decodeKey(seq) {
  const s = String(seq);
  const k = { name: "", ctrl: false, alt: false, shift: false, seq: s, char: "" };

  if (s === "\r" || s === "\n") return { ...k, name: "enter" };
  if (s === "\t") return { ...k, name: "tab" };
  if (s === "\x1b[Z") return { ...k, name: "tab", shift: true };
  if (s === "\x7f" || s === "\b") return { ...k, name: "backspace" };
  if (s === "\x1b") return { ...k, name: "escape" };

  // CSI
  if (s.startsWith(CSI)) {
    const body = s.slice(2);
    const simple = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" };
    if (simple[body]) return { ...k, name: simple[body] };
    // com modificador: ESC [ 1 ; <mod> <letra>   (mod: 2=shift 3=alt 5=ctrl)
    const mod = body.match(/^1;(\d)([A-Z])$/);
    if (mod && simple[mod[2]]) {
      const m = Number(mod[1]) - 1;
      return { ...k, name: simple[mod[2]], shift: Boolean(m & 1), alt: Boolean(m & 2), ctrl: Boolean(m & 4) };
    }
    const tilde = body.match(/^(\d+)(?:;(\d))?~$/);
    if (tilde) {
      const names = { 1: "home", 3: "delete", 4: "end", 5: "pageup", 6: "pagedown" };
      const m = tilde[2] ? Number(tilde[2]) - 1 : 0;
      const name = names[Number(tilde[1])] || "";
      if (name) return { ...k, name, shift: Boolean(m & 1), alt: Boolean(m & 2), ctrl: Boolean(m & 4) };
    }
    return { ...k, name: "unknown" };
  }

  // Alt+<char> chega como ESC seguido do char
  if (s.length >= 2 && s[0] === ESC) {
    const rest = s.slice(1);
    if (rest === "\r" || rest === "\n") return { ...k, name: "enter", alt: true };
    return { ...k, name: "char", alt: true, char: rest };
  }

  // Ctrl+<letra> = 0x01..0x1a
  const code = s.charCodeAt(0);
  if (s.length === 1 && code >= 1 && code <= 26) {
    return { ...k, name: String.fromCharCode(code + 96), ctrl: true };
  }
  if (s.length === 1 && code === 0) return { ...k, name: "space", ctrl: true };

  // texto imprimível (pode vir colado, ex.: paste)
  if (!/[\x00-\x08\x0b-\x1f]/.test(s)) return { ...k, name: "char", char: s };
  return { ...k, name: "unknown" };
}
