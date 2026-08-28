// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * @fileoverview mz-cli target — aponta o app para uma INSTÂNCIA própria (não-Supabase)
 * de forma persistente e NÃO-DESTRUTIVA. Grava ~/.mukta/target.json {supabase_url,
 * runtime_base_url, anon_key}; config.mjs lê isso com precedência: env MZ_* > target.json
 * > default hospedado. `mz target clear` volta ao hospedado. O anon_key é público (role anon).
 *
 * Superfície independente do Mukta Zero: o instance tem GoTrue/PostgREST/edge próprios,
 * com user control separado da Mukta principal.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TARGET_PATH = path.join(os.homedir(), ".mukta", "target.json");

export function targetPath() {
  return TARGET_PATH;
}

/** Lê o target atual, ou null se não houver (usa o hospedado). Nunca lança. */
export function loadTarget() {
  try {
    if (!existsSync(TARGET_PATH)) return null;
    const t = JSON.parse(readFileSync(TARGET_PATH, "utf8"));
    return t && t.supabase_url ? t : null;
  } catch {
    return null;
  }
}

/** Persiste o target (0600). runtimeUrl default = url. */
export function setTarget({ url, runtimeUrl = null, anonKey }) {
  if (!url) throw new Error("url é obrigatório");
  if (!anonKey) throw new Error("anon_key é obrigatório");
  mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
  const t = {
    supabase_url: url.replace(/\/+$/, ""),
    runtime_base_url: (runtimeUrl || url).replace(/\/+$/, ""),
    anon_key: anonKey,
  };
  writeFileSync(TARGET_PATH, JSON.stringify(t, null, 2), "utf8");
  try {
    chmodSync(TARGET_PATH, 0o600);
  } catch {
    // best-effort no Windows/NTFS
  }
  return t;
}

/** Remove o target (volta ao hospedado). Retorna true se removeu. */
export function clearTarget() {
  try {
    if (!existsSync(TARGET_PATH)) return false;
    rmSync(TARGET_PATH);
    return true;
  } catch {
    return false;
  }
}
