// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// svg-rasterizer.ts
//
// Onda 5 — Wave D (V5 insert_icon).
//
// Pure SVG → PNG rasterizer for Deno edge functions, backed by @resvg/resvg-wasm.
// Designed to run inside the project-studio-runtime function so the runtime can
// embed Iconify (or arbitrary URL) icons into PPTX media without depending on
// external rasterization services.
//
// Initialization is lazy: the WASM module is fetched once per cold start and
// reused across calls in the same isolate.
//
// Public API:
//   rasterizeSvgToPng(svg, opts?) → Promise<Uint8Array>
//   buildIconifyUrl(spec) → string
//   normalizeSvgRoot(svg, opts?) → string  (helper for sizing/coloring)

// @ts-ignore — esm.sh resolves the WASM module at runtime in Deno
import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const RESVG_WASM_URL = "https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

// 2026-06-14 FIX: resvg com loadSystemFonts:false e SEM fontBuffers DROPA todo <text> silenciosamente
// (texto invisível em TODO chart/diagram PNG). Carregamos um TTF (DejaVu Sans, open, cobre acentos PT)
// uma vez e registramos via font.fontBuffers + defaultFontFamily.
const FONT_URLS = [
  "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
  "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf",
];
const DEFAULT_FONT_FAMILY = "DejaVu Sans";
let fontBuffers: Uint8Array[] | null = null;
let fontFetchTried = false;
async function ensureFontLoaded(): Promise<Uint8Array[] | null> {
  if (fontBuffers || fontFetchTried) return fontBuffers;
  fontFetchTried = true;
  const buffers: Uint8Array[] = [];
  for (const url of FONT_URLS) {
    try {
      const r = await fetch(url);
      if (r.ok) buffers.push(new Uint8Array(await r.arrayBuffer()));
    } catch (_e) { /* segue */ }
  }
  if (buffers.length) { fontBuffers = buffers; return fontBuffers; }
  console.warn("[svg-rasterizer] nenhuma fonte carregada — texto pode não renderizar");
  return null;
}

let resvgInitPromise: Promise<void> | null = null;

async function ensureResvgInitialized(): Promise<void> {
  if (!resvgInitPromise) {
    resvgInitPromise = (async () => {
      const res = await fetch(RESVG_WASM_URL);
      if (!res.ok) {
        throw new Error(`Failed to fetch resvg-wasm binary: HTTP ${res.status}`);
      }
      const wasmBytes = await res.arrayBuffer();
      // @ts-ignore — initWasm accepts ArrayBuffer in this build
      await initWasm(wasmBytes);
    })().catch((err) => {
      // Reset so a subsequent call can retry after a transient failure
      resvgInitPromise = null;
      throw err;
    });
  }
  return resvgInitPromise;
}

export interface RasterizeOptions {
  /** Output width in pixels (default 512). Height is derived from aspect ratio unless explicitly provided. */
  width?: number;
  /** Output height in pixels. */
  height?: number;
  /** Background fill (CSS color string). Default: transparent. */
  background?: string;
}

/**
 * Rasterizes an SVG string to a PNG byte array.
 *
 * Throws if the SVG is malformed or the WASM init fails.
 */
export async function rasterizeSvgToPng(
  svg: string,
  opts: RasterizeOptions = {},
): Promise<Uint8Array> {
  if (!svg || typeof svg !== "string") {
    throw new Error("rasterizeSvgToPng: svg argument must be a non-empty string");
  }
  await ensureResvgInitialized();
  const fonts = await ensureFontLoaded();

  const fitTo = opts.width
    ? { mode: "width", value: Math.max(1, Math.round(opts.width)) }
    : opts.height
      ? { mode: "height", value: Math.max(1, Math.round(opts.height)) }
      : { mode: "original" };

  const resvg = new Resvg(svg, {
    fitTo,
    background: opts.background ?? "rgba(0,0,0,0)",
    font: fonts && fonts.length
      ? { loadSystemFonts: false, fontBuffers: fonts, defaultFontFamily: DEFAULT_FONT_FAMILY }
      : { loadSystemFonts: false },
  });

  const pngData = resvg.render();
  const bytes = pngData.asPng();
  // resvg's wasm sometimes returns its own typed array view; copy to a fresh
  // Uint8Array so callers can safely store the result independent of the
  // wasm memory lifecycle.
  return new Uint8Array(bytes);
}

// ─── Onda 5 V18: Sector icon packs ──────────────────────────────────────────

/** Maps business sectors to preferred Iconify icon pack prefixes. */
export const SECTOR_ICON_PACKS: Record<string, string[]> = {
  finance: ["mdi", "tabler"],
  fintech: ["mdi", "tabler"],
  banking: ["mdi", "tabler"],
  health: ["mdi", "medical-icon"],
  healthcare: ["mdi", "medical-icon"],
  pharma: ["mdi", "medical-icon"],
  tech: ["mdi", "devicon", "simple-icons"],
  technology: ["mdi", "devicon", "simple-icons"],
  software: ["mdi", "devicon", "simple-icons"],
  logistics: ["mdi", "tabler"],
  supply_chain: ["mdi", "tabler"],
  transport: ["mdi", "tabler"],
  education: ["mdi", "ph"],
  edtech: ["mdi", "ph"],
  energy: ["mdi", "tabler"],
  oil_gas: ["mdi", "tabler"],
  retail: ["mdi", "tabler"],
  ecommerce: ["mdi", "tabler"],
  consulting: ["mdi", "lucide"],
  legal: ["mdi", "lucide"],
  real_estate: ["mdi", "tabler"],
  manufacturing: ["mdi", "tabler"],
  agriculture: ["mdi", "tabler"],
  media: ["mdi", "tabler"],
  telecom: ["mdi", "tabler"],
};

/** Default icon packs when no sector is matched. */
export const DEFAULT_ICON_PACKS = ["mdi", "tabler"];

/**
 * Resolves preferred icon packs for a given sector string.
 * Falls back to DEFAULT_ICON_PACKS if the sector is unknown.
 */
export function resolveIconPacksForSector(sector: string | null | undefined): string[] {
  if (!sector) return DEFAULT_ICON_PACKS;
  const normalized = sector.toLowerCase().replace(/[\s\-]/g, "_").trim();
  return SECTOR_ICON_PACKS[normalized] || DEFAULT_ICON_PACKS;
}

/**
 * Resolves the best Iconify identifier for a given icon name and sector.
 * If the identifier already contains a prefix (e.g. "mdi:brain"), returns as-is.
 * If only a name is provided (e.g. "brain"), prepends the sector's preferred pack.
 */
export function resolveIconIdentifier(
  name: string,
  sector?: string | null,
): string {
  const trimmed = name.trim();
  if (!trimmed) return "mdi:help-circle";
  // Already has a prefix
  if (trimmed.includes(":") || trimmed.includes("/")) return trimmed;
  // Add the sector's preferred prefix
  const packs = resolveIconPacksForSector(sector);
  return `${packs[0]}:${trimmed}`;
}

// ─── Iconify helpers ─────────────────────────────────────────────────────────

export interface IconifyIconSpec {
  /** Iconify identifier in the form "prefix:name", e.g. "mdi:brain". */
  identifier: string;
  /** Optional hex color (no leading #) — applied via Iconify's ?color query. */
  color?: string;
  /** Optional pixel width to request from Iconify. */
  width?: number;
  /** Optional pixel height to request from Iconify. */
  height?: number;
}

/**
 * Builds an Iconify CDN URL for the given spec.
 *
 * Identifier is normalized to support both "prefix:name" and "prefix/name".
 */
export function buildIconifyUrl(spec: IconifyIconSpec): string {
  const ident = String(spec.identifier || "").trim();
  if (!ident) throw new Error("buildIconifyUrl: identifier is required");

  // Normalize "prefix/name" → "prefix:name"
  const normalized = ident.includes(":") ? ident : ident.replace("/", ":");
  const [prefix, name] = normalized.split(":");
  if (!prefix || !name) {
    throw new Error(`buildIconifyUrl: invalid identifier "${ident}" — expected prefix:name`);
  }

  const url = new URL(`https://api.iconify.design/${prefix}/${name}.svg`);
  if (spec.color) {
    const cleaned = spec.color.startsWith("#") ? spec.color.slice(1) : spec.color;
    if (/^[0-9a-fA-F]{3,8}$/.test(cleaned)) {
      url.searchParams.set("color", `#${cleaned}`);
    }
  }
  if (spec.width && spec.width > 0) url.searchParams.set("width", String(Math.round(spec.width)));
  if (spec.height && spec.height > 0) url.searchParams.set("height", String(Math.round(spec.height)));
  return url.toString();
}

/**
 * Fetches an SVG from a remote URL with sane defaults: 5s timeout, 256KB max
 * body, content-type guard.
 */
export async function fetchSvg(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`fetchSvg: HTTP ${res.status} for ${url}`);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("svg") && !contentType.includes("xml") && !contentType.includes("text")) {
      throw new Error(`fetchSvg: unexpected content-type "${contentType}" for ${url}`);
    }
    const text = await res.text();
    if (text.length > maxBytes) {
      throw new Error(`fetchSvg: payload exceeds ${maxBytes} bytes (${text.length} received)`);
    }
    if (!text.includes("<svg")) {
      throw new Error("fetchSvg: response does not contain an <svg> element");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Encodes PNG bytes as a data: URL — used to bridge into applyImagePatches,
 * which already accepts data URLs via resolveImageBytes().
 */
export function pngBytesToDataUrl(bytes: Uint8Array): string {
  // Manual base64 encode to avoid relying on btoa/Buffer differences across
  // Deno versions when bytes contain high values.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  // @ts-ignore — btoa is available in Deno
  return `data:image/png;base64,${btoa(binary)}`;
}
