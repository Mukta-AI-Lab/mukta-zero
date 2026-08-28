# Mukta Zero - Third-Party Notices

> **Status: partially completed (2026-08-25).** The npm dependency tree has been scanned
> mechanically (results below). Container images and ported source code still require
> confirmation before release — see “Open items”.

## Release rule

Do not publish a Mukta Zero release until all bundled, copied, vendored, statically linked,
dynamically linked, generated, or otherwise distributed third-party components have been
identified and reviewed for license compatibility and notice obligations.

## 1. npm dependency tree — scanned 2026-08-25

Full tree of the web front end (`mz-web`), 241 packages, read from the installed
`node_modules` `package.json` `license` fields:

| license | packages |
|---|---|
| MIT | 223 |
| ISC | 12 |
| Apache-2.0 | 3 |
| BSD-3-Clause | 1 |
| 0BSD | 1 |
| CC-BY-4.0 | 1 |

**No GPL, AGPL, SSPL, MPL, EUPL, CDDL, or CC-BY-SA component was found.** This is the
result that matters for the BUSL compatibility question raised in the legal memo: nothing in
the front-end dependency tree carries strong-copyleft terms before the Change Date.

### Non-MIT/ISC packages (all build-time only)

| package | version | license | notes |
|---|---|---|---|
| `caniuse-lite` | 1.0.30001805 | CC-BY-4.0 | browser-support **data**, build-time (autoprefixer); attribution required |
| `baseline-browser-mapping` | 2.10.43 | Apache-2.0 | build-time |
| `didyoumean` | 1.2.2 | Apache-2.0 | build-time (tailwind) |
| `ts-interface-checker` | 0.1.13 | Apache-2.0 | build-time |
| `source-map-js` | 1.2.1 | BSD-3-Clause | build-time (postcss) |
| `tslib` | 2.8.1 | 0BSD | runtime helper, permissive with no notice obligation |

### Shipped runtime dependencies (present in the built bundle)

| package | version | license |
|---|---|---|
| `react`, `react-dom` | 18.3.1 | MIT |
| `@supabase/supabase-js` | 2.110.3 | MIT |
| `react-markdown` | 9.1.0 | MIT |
| `remark-gfm` | 4.0.1 | MIT |
| `lucide-react` | 0.400.0 | ISC |

`mz-cli` and the VS Code extension declare a single runtime dependency each
(`@supabase/supabase-js`, MIT). The VS Code extension's build chain adds `typescript`
(Apache-2.0), `esbuild` (MIT), `mocha` (MIT), `glob` (ISC) — all build-time.

MIT and ISC require preservation of the copyright notice and permission text in
distributions. Apache-2.0 additionally requires preserving `NOTICE` content where the
upstream project supplies one, and stating significant changes.

## 2. Ported and derivative source code — REQUIRES ATTENTION

This is the category the legal memo singles out: code **copied or ported into** the work is
treated differently from a dependency executed separately.

| file | origin | upstream license | status |
|---|---|---|---|
| `bench/ifeval-checkers.cjs` | **Line-by-line port** of `google-research/instruction_following_eval` (`instructions.py`, `instructions_util.py`, `evaluation_lib.py`) | **Apache-2.0** | ✅ **Compliant.** The file carries the upstream copyright and Apache-2.0 notice, is marked `SPDX-License-Identifier: Apache-2.0` (it keeps its own licence rather than the repository's), and includes the **notice of modifications** required by Apache-2.0 §4(b). The full licence text ships at `LICENSES/Apache-2.0.txt`. |

**Modifications declared** (each is also documented in place, at the function it affects):

1. `count_sentences` — the upstream NLTK *punkt* statistical tokenizer was replaced by
   `split_into_sentences`, the regex-plus-abbreviations splitter from the same upstream file.
   May differ from punkt on ambiguous punctuation.
2. `language:response_language` — upstream uses `langdetect` and returns `True` on exception;
   this port returns `False` when detection is not confident.
3. `change_case:english_lowercase` / `english_capital` — the upstream `langdetect == "en"`
   precondition is intentionally omitted.
4. `change_case:capital_word_frequency` — upstream counts any word matching `isupper()`; this
   port requires two or more letters.

Apache-2.0 permits redistributing a derivative work under other terms, so this file sits
inside the BUSL-licensed distribution without conflict — the obligations it carries are
attribution, licence text, and the statement of changes, all satisfied above.

The remaining benchmark harnesses (`lcb-*`, `arc-*`) declare no upstream port in their
headers and are believed to be independent implementations that consume public datasets, but
this has **not** been confirmed line by line — see Open items.

## 3. Container images (referenced, not redistributed)

`deploy/docker-compose.yml` pulls these images at run time; Mukta Zero does not redistribute
them. Operators obtain them directly from their upstream registries under those projects'
own licenses.

`supabase/postgres` · `supabase/gotrue` · `postgrest/postgrest` · `kong` ·
`supabase/storage-api` · `supabase/realtime` · `supabase/postgres-meta` · the Deno-based edge
runtime image · the Python sandbox base image.

## 4. Open items before release

- [x] ~~Apply the Apache-2.0 header and change statement to `bench/ifeval-checkers.cjs`.~~
      **Done 2026-08-28**: header, `LICENSES/Apache-2.0.txt` (canonical text from the SPDX
      licence list), and the four declared modifications. Verified: the file loads as a module
      (12 exports) and carries no BUSL header.
- [ ] Confirm the license of each container image above and record it here.
- [ ] Confirm `lcb-*` and `arc-*` harnesses are independent implementations, or attribute them.
- [ ] Record the license of the Python packages baked into the sandbox image.
- [ ] Re-run the dependency scan against the final released tree and update the counts above.

## High-priority compatibility review

Before the BUSL Change Date, code subject to strong-copyleft terms may be incompatible with
the BUSL licensing model when combined into a single derivative or distributed work. Obtain
specific legal review before incorporating GPL- or AGPL-licensed code into Mukta Zero itself
prior to the Change Date. Permissive dependencies may still require preservation of
copyright, attribution, patent, or notice text.
