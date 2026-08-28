// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Oráculo (definido pelo SUPERVISOR): `mz version` deve imprimir a versão do package.json.
// O Mukta Zero edita index.mjs para satisfazer este teste. Uso: node mz-cli/test/version-check.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(dir, "..", "package.json"), "utf8"));
const expected = pkg.version;

let out = "";
try {
  out = execSync(`node "${path.join(dir, "..", "src", "index.mjs")}" version`, { encoding: "utf8" });
} catch (e) {
  console.error("FAIL: `mz version` saiu com erro (comando não implementado?):", String(e.stdout || e.message).slice(0, 200));
  process.exit(1);
}

if (!out.includes(expected)) {
  console.error(`FAIL: saída de \`mz version\` não contém a versão esperada ${expected}. Saída: ${JSON.stringify(out.slice(0, 120))}`);
  process.exit(1);
}
console.log(`VERSION-CHECK PASS: \`mz version\` imprimiu a versão ${expected}`);
process.exit(0);
