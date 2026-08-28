// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// arc-agi.cjs — ARC-AGI program-synthesis harness for Mukta Zero (MZ).
//
// DOUTRINA MZ (verificação-por-execução): o BRAIN (reasoning, SSOT .107 role mz_chat_brain) ESCREVE uma função
// Python transform(grid)->grid a partir SÓ dos train-pairs; a FRONTEIRA G3 (code-exec, o ORÁCULO) RODA a função
// sobre TODOS os train-pairs (exact-match). Se falhar em algum, o erro volta como feedback → re-prompt (máx N tentativas).
// Quando passa em TODOS os train, aplica ao test.input → predicted. Score = EXACT-MATCH predicted vs test.output
// (ARC é all-or-nothing por task). SÓ conta como "solved" o que o PROGRAMA REALMENTE PRODUZIU no G3 — nunca o que o LLM alega.
// A ground-truth do teste NUNCA entra no programa (o brain jamais a vê) — a comparação final é feita AQUI, no harness.
//
// SSOT: zero slug hardcoded (brain via resolve107 role mz_chat_brain — .107), zero PRO fechado (guard tier no mz107-brain).
// G3: token code:exec lido do Vault (get_vault_secret CODEEXEC_API_TOKEN) via SRK. Env: SUPABASE_ACCESS_TOKEN.
//
// Uso:  node scripts/agent/mz-bench/arc-agi.cjs --n 30 --split evaluation --seed 42 --round 1
//       node scripts/agent/mz-bench/arc-agi.cjs --n 30 --rounds 10          (10 rodadas, MESMOS N tasks, temp variando -> agrega)
// Args: --n <int> --split evaluation|training --seed <int> --round <int> --rounds <int>
//       --concurrency <int> --max-attempts <int> --max-tokens <int>
// Temp SO em .mz-tmp/arc/. Saidas em scripts/agent/mz-bench/out/arc-agi*.json

const fs = require("fs");
const path = require("path");
const brain = require("./mz107-brain.cjs");     // resolve107({role}) + dispatch107 — SSOT .107
const { parseGridToObjects } = require("./arc-scene-graph.cjs"); // sensor deterministico (flag --scene-graph)
const { makeFragmentedSolver } = require("./arc-frag.cjs");
const { makeGuiaSolver } = require("./arc-guia.cjs");                 // REGIME DE GUIA (flag --guia): §12 do runbook        // ARM-C pipeline fragmentado (flag --fragmented)
const { makeSketchTranscribeSolver } = require("./arc-sketch.cjs"); // LEVER iter4: reasoner-na-regra(sketch) + coder transcreve (--sketch-transcribe)
const { makeSampleNSolver } = require("./arc-samplen.cjs");         // RANK-1: K draws independentes sem early-stop, mede fork geracao-vs-selecao (--sample-n)
const GET_OBJECTS_PY = fs.readFileSync(path.join(__dirname, "arc-get-objects.py"), "utf8"); // grafo-como-FERRAMENTA (--exec-tool)
// token do G3: lê de arquivo gitignored se não vier no env — evita segredo INLINE no comando (Herbert 2026-07-19: comando com token+nohup trava pedindo aprovação a cada passo)
if (!process.env.SUPABASE_ACCESS_TOKEN) { try { process.env.SUPABASE_ACCESS_TOKEN = fs.readFileSync(path.join(process.cwd(), ".mz-tmp", ".sb-access-token"), "utf8").trim(); } catch (e) {} }
const rt = require("../agent-runtime.cjs");      // getSRK, codeExecToken, execG3, extractCode — fronteira G3
const prov = require("../bench-provenance.cjs"); // LINHA DURA de observabilidade: proveniência carimbada no nascimento

const REPO = path.resolve(__dirname, "..", "..", "..");
const OUT = path.join(__dirname, "out");
let PROV = null;  // proveniência do run, preenchida quando o brain é resolvido

// ── args ──
function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def; }
const CFG = {
  n: Number(arg("n", 30)),
  split: String(arg("split", "evaluation")),
  seed: Number(arg("seed", 42)),
  round: Number(arg("round", 1)),
  rounds: Number(arg("rounds", 1)),
  concurrency: Number(arg("concurrency", 4)),
  maxAttempts: Number(arg("max-attempts", 3)),
  maxTokens: Number(arg("max-tokens", 20000)), // reasoning-model queima ~8660 tok SO no raciocinio -> teto alto p/ nao esvaziar o content (brain_empty st=200)
  brainTimeout: Number(arg("brain-timeout", 300000)), // DeepSeek-V4-Pro reasona ate ~186s/chamada em ARC (queima 8660 reasoning-tokens) -> timeout > 186s p/ nao abortar+retentar cego
  g3Max: Number(arg("g3-max", 2)),
  dataRoot: String(arg("data-root", ".mz-tmp/arc-agi")), // v1=.mz-tmp/arc-agi ; v2=.mz-tmp/arc-agi-2
  outTag: String(arg("out-tag", "arc-agi")),           // prefixo dos arquivos de saída (arc-agi / arc-agi-2)
  sceneGraph: process.argv.includes("--scene-graph"),  // injeta OBJECTS: scene-graph deterministico no prompt
  fragmented: process.argv.includes("--fragmented"),   // ARM-C: pipeline multi-passo (deltas->regra->codigo)
  guia: process.argv.includes("--guia"),               // regime de guia: estado medido pelo harness + veredicto por passo
  guiaPartes: process.argv.includes("--guia-partes"),  // A1: codigo POR PARTES
  guiaRota: process.argv.includes("--guia-rota"),
  guiaReversivel: process.argv.includes("--guia-reversivel"), // RD-5: coder falha o treino -> devolve ao raciocinio (1 volta)
  // MEM-6 (PL# `hhhhhhhh·C`): caminho de um FICHEIRO com o método candidato. Vem por ficheiro e não
  // inline porque o método tem milhares de caracteres e aspas — a linha de comando destrói ambos.
  // AUSENTE (default) ⇒ `CFG.metodo` fica `null` e o regime de guia é bit-a-bit o que foi medido.
  // É o braço-AUSENTE do par obrigatório: o controlo não é um modo especial, é NÃO passar a flag.
  metodo: (() => { const f = arg("guia-metodo", null); try { return f ? require("fs").readFileSync(f, "utf8") : null; } catch (e) { console.error(`[--guia-metodo] não li ${f}: ${e.message}`); process.exit(2); } })(),
  stepMaxTokens: Number(arg("step-max-tokens", 10000)),
  extractModel: arg("extract-model", null),              // slug NAO-reasoning p/ deltas+regra (ex. Qwen/Qwen3-30B-A3B-Instruct-2507)
  extractMaxTokens: Number(arg("extract-max-tokens", 4000)),
  codeUsesExtract: process.argv.includes("--frag-code-extract"), // ARM-C3: passo de codigo tambem no modelo nao-reasoning (pipeline 100% nao-reasoning)
  protocolo: process.argv.includes("--protocolo"),     // PROTOCOLO das 9 leis (ver PROTOCOLO acima) — tratamento do A/B; sem a flag = baseline
  execTool: process.argv.includes("--exec-tool"),      // grafo-como-FERRAMENTA: get_objects(grid) chamavel no programa G3
  capture: process.argv.includes("--capture"),         // salva code + flags de SEGUIMENTO (calls_get_objects / reimplements_flood) por task
  reasoningMaxTokens: Number(arg("reasoning-max-tokens", 0)), // correção D: capa o RACIOCÍNIO (ataca brain_empty — força emitir código antes de espiralar)
  reasoningEffort: arg("reasoning-effort", null),      // alternativa: low|medium|high
  brainModel: arg("brain-model", null),                // override do brain por slug (ex.: deepseek-ai/DeepSeek-V4-Pro p/ desviar de provedor sem crédito) — SSOT, anti-PRO no resolve
  sketchTranscribe: process.argv.includes("--sketch-transcribe"), // LEVER iter4: reasoner na REGRA (sketch gerador) + coder nao-reasoning transcreve
  coderModel: arg("coder-model", null),                // slug do coder nao-reasoning que TRANSCREVE o sketch (ex. Qwen/Qwen3-30B-A3B-Instruct-2507)
  ruleMaxTokens: Number(arg("rule-max-tokens", 40000)),// teto ALTO do passo de sketch (o reasoner raciocina a inducao)
  sampleN: Number(arg("sample-n", 0)),                 // RANK-1: K draws independentes (sem early-stop) p/ medir pass@k em camadas
  taskIds: arg("task-ids", null),                      // filtro de tasks especificas (csv) — sobrepoe o shuffle+slice
};

// ── util ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seededShuffle(arr, seed) { const rnd = mulberry32(seed >>> 0); for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; } return arr; }
function wilson(passed, n, z) { z = z || 1.96; if (!n) return { lo: 0, hi: 0 }; const p = passed / n, z2 = z * z, denom = 1 + z2 / n; const center = (p + z2 / (2 * n)) / denom; const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom; return { lo: Math.max(0, center - margin), hi: Math.min(1, center + margin) }; }
const dims = (g) => (g.length) + "x" + (g && g[0] ? g[0].length : 0);
const renderGrid = (g) => g.map((r) => r.join("")).join("\n");
const gEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── semaphore p/ throttle do G3 (rate-limit ~2/token) ──
function semaphore(max) {
  let active = 0; const waiters = [];
  return {
    acquire: () => active < max ? (active++, Promise.resolve()) : new Promise((r) => waiters.push(r)).then(() => { active++; }),
    release: () => { active--; if (waiters.length) waiters.shift()(); },
  };
}

// ── pool de concorrencia ──
async function runPool(items, size, worker) {
  const results = new Array(items.length); let idx = 0;
  async function lane() { while (idx < items.length) { const i = idx++; results[i] = await worker(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

// ── prompts ──
const SYS = [
  "You are an expert at solving ARC-AGI abstract reasoning puzzles by PROGRAM SYNTHESIS.",
  "You are given several TRAINING examples: each has an INPUT grid and its OUTPUT grid. Grids are rectangular matrices of integers 0-9 (0 is usually background). Rows are shown as strings of digits.",
  "Infer the SINGLE transformation rule that maps EVERY training input to its output, then implement it as a Python function.",
  "",
  "Hard requirements:",
  "- Define exactly: def transform(grid): where grid is a list of lists of ints, and it RETURNS a list of lists of ints.",
  "- Use ONLY the Python standard library. NO numpy, NO external packages.",
  "- The rule must GENERALIZE (work on an unseen input of the same rule); do NOT hardcode/lookup the training outputs.",
  "- Output ONLY ONE python code block: ```python ... ``` containing transform (and any helpers). No prose outside the block.",
].join("\n");

// ── PROTOCOLO DAS 9 LEIS (flag --protocolo) ──────────────────────────────────
// Destilado da campanha que fechou o eval do ARC-AGI-1 pelos dois times.
// Entra atrás de flag DE PROPÓSITO: sem flag = baseline, com flag = tratamento.
// É o único jeito de medir o que a técnica contribui SOZINHA no modelo aberto —
// misturar ao prompt padrão tornaria o A/B impossível.
// As leis entram como CLASSES, nunca com a constante concreta de uma tarefa
// resolvida: dizer "costuma ser X" é vazamento de distribuição (o grep não pega).
const PROTOCOLO = [
  "",
  "=== PROTOCOL: 9 LAWS OF RULE DISCOVERY (distilled from ~400 solved tasks) ===",
  "",
  "LAW 1 - THE READING UNIT. The obvious representation is almost never the right one. Before any hypothesis about the transformation, find the UNIT the grid must be read in. DIAGNOSTIC: if each training pair seems to ask for a DIFFERENT operation, the unit is wrong - in the right unit they all collapse into the SAME operation. DEBUG RULE: if the rule seems almost right but errs a lot, doubt the UNIT, not the rule. The right unit is task-specific and must be DISCOVERED, not picked from a list (a closed catalog of units was measured at 0/91).",
  "",
  "LAW 2 - DERIVE THE GENERATOR, NOT THE RULE. Ask what PROCESS would produce these outputs if run step by step. Test: a solution needing a CLAUSE PER PARAMETER VALUE fitted a formula; one that needs none captured the mechanism. An error of a few cells out of hundreds is NOT noise to tolerate - it is usually the only sign the hypothesis is structurally wrong.",
  "",
  "LAW 3 - ENUMERATE, DO NOT GUESS THE CANONICAL. Never assume the obvious default: reading order, identity orientation, axis at the geometric center, obvious phase, rotation direction, distance metric, touch-vs-stop-before, nearest target. NO value is 'the right one' by default. Sweep the whole parameter space IN CODE and let verification choose.",
  "",
  "LAW 4 - A RIVAL CAN PASS ALL TRAINING PAIRS. Measured: in 7 of 9 analyzed cases a rival passed at least one pair by coincidence; one passed ALL and would fail the test. 'Fits every example' is the floor, not the ceiling. Re-sampling does not fix this: two independent attempts produced IDENTICAL wrong output.",
  "",
  "LAW 5 - THE TIE-BREAK LADDER, in measured order of strength. When more than one candidate fits all pairs, apply IN THIS ORDER:",
  "  (0) ABSENCE DISCRIMINATES THE READING. If the training systematically avoids a configuration, ask: which READING is that absence a consequence of? Under the right reading that case would leave the rule ill-defined, so the generator avoids it; under the rival it would be harmless and WOULD have appeared. This ranks the UNIT, so it comes first. Check honesty: does the generator use that configuration in OTHER contexts? If never, it may be sampling, not decision.",
  "  (1) DEGENERATE CASE exercised by training - direct measurement. The typical case does not discriminate; the atypical one does. Look for holes, gaps, parities, ties, unique objects, perfect diagonals, corner-only contact.",
  "  (2) ISOLATED CONTROL - build the rival that tests ONLY the suspect factor. If it passes just the pair where the coincidence held, that factor was never the cause.",
  "  (3) CANVAS NECESSITY - compare the TEST input dimensions with training. Compute the minimum canvas each candidate needs. If the grid grew, the hypothesis that REQUIRES that size is favored: under rivals that fit loosely the extra space is gratuitous. Lower bound, not equality.",
  "  (4) TOTALITY - is the candidate well-defined for EVERY parameter value, or only in the demonstrated range? One that breaks, overwrites or overshoots outside the shown regime is suspect. Ranks without executing anything. Test it especially ON THE TEST INPUT.",
  "  (5) STRUCTURAL INVARIANT - DEMOTED. A training invariant is an OBSERVED PATTERN, not a law. Measured: an invariant holding across every training pair of 277 tasks is violated by ground truth in 11 of them; and in one real case an agent KILLED THE CORRECT CANDIDATE with an invariant holding 5/5. Only use it to KILL a rival if (a) the number of INDEPENDENT INSTANCES is large - dozens, not units - or (b) it is STRUCTURAL (about the shape of the transformation) rather than INCIDENTAL (about which concrete value happened to appear). Otherwise it only ORDERS, and the rival stays alive. Count instances, not pairs.",
  "",
  "LAW 6 - THREE KINDS OF PARAMETER. (a) the INPUT already says it (extract - that is reading, not learning); (b) only the PAIRS pin it (learn it, never guess); (c) WHICH OPERATOR from a discrete set (enumerate the whole set). TRAP: a constant matching every example may be a VARIABLE whose value coincided - look for the dimension where it varies.",
  "",
  "LAW 7 - HIGHER-LEVEL UNIT. After deriving the rule, ask whether the SET of outputs forms an object (order, partition, count, permutation, link structure) with a property training respects throughout. A rule producing N independent things can be wrong because of a constraint that exists only BETWEEN them.",
  "",
  "LAW 8 - LACK OF DEMONSTRATION IS NOT EVIDENCE AGAINST. If a candidate requires a decision training never exercises, that does NOT disqualify it - the generator does leave decisive choices undemonstrated. Rank by what the candidate GUARANTEES BY CONSTRUCTION, not by how well it was taught.",
  "",
  "LAW 9 - THE TEST INPUT IS DATA. You cannot see its answer, but its statement is yours: its SIZE (law 5.3) and its CONTENT both inform the rule's domain.",
  "",
  "Work the laws IN CODE where possible: enumerate candidates, measure, and let verification decide. State which ladder rung decided, if any.",
].join("\n");

function buildUser(trainRender, testRender, prevCode, feedback) {
  const sgNote = CFG.sceneGraph ? "Each grid is followed by OBJECTS: a DETERMINISTIC scene-graph (connected components) with color/size/bbox/shape + relations — authoritative ground truth for object structure; do NOT re-derive object positions from the raw digits.\n\nUse the OBJECTS to FRAGMENT your reasoning into firm, segmented steps (do NOT emit one long undirected reasoning stream — that wastes the budget):\n1) Per training pair, briefly state how the OBJECTS/relations change input->output (per object and per relation) and COMMIT each as a firm intermediate fact.\n2) Synthesize the SINGLE rule that explains ALL pairs.\n3) THEN write transform(grid) operating on that object structure.\nAnchor every reasoning step on a named object/relation and firm it up before moving on — the object breakdown REPLACES deriving structure digit by digit.\n\n" : "";
  const execNote = CFG.execTool ? "A DETERMINISTIC helper get_objects(grid) is ALREADY DEFINED and callable in your code (returns objects with color, size, bbox [r0,c0,r1,c1], and cells [[r,c],...]; 4-connected same-color components, background excluded). CALL get_objects(grid) in your transform INSTEAD of re-implementing connected-components.\n\n" : "";
  const protoNote = CFG.protocolo ? PROTOCOLO + "\n\n" : "";
  const head = protoNote + sgNote + execNote + "Training examples (grids as rows of digits 0-9):\n\n" + trainRender + "\n\n" + testRender;
  if (prevCode == null) {
    return head + "\n\nInfer the single rule and write def transform(grid). Output ONLY one ```python code block.";
  }
  return head +
    "\n\nYour PREVIOUS transform:\n```python\n" + prevCode + "\n```\n\n" +
    "It FAILED verification on the training set:\n" + feedback +
    "\n\nFix the rule and rewrite def transform(grid). Output ONLY one ```python code block.";
}

// programa que RODA no G3: embute train (input+output) e test (so input), roda transform, emite ARCJSON.
// A ground-truth do TESTE nunca entra aqui. train_verified reflete SO o treino; predicted vem da execucao real.
function buildProgram(trainJson, testsJson, code) {
  return [
    "import json, sys, traceback",
    "_TRAIN = " + trainJson,
    "_TESTS = " + testsJson,
    "",
    ...(CFG.execTool ? ["# ==== EXEC-TOOL (grafo-como-ferramenta) ====", GET_OBJECTS_PY, "# ==== /EXEC-TOOL ====", ""] : []),
    "# ==== BRAIN CODE ====",
    code,
    "# ==== /BRAIN CODE ====",
    "",
    "def _norm(g):",
    "    return [[int(x) for x in row] for row in g]",
    "",
    "def _main():",
    '    res = {"train_verified": True, "train": [], "predicted": [], "predict_error": None}',
    "    for _i, _pr in enumerate(_TRAIN):",
    "        try:",
    '            _got = _norm(transform([row[:] for row in _pr["input"]]))',
    '            _exp = _pr["output"]',
    "            _m = (_got == _exp)",
    '            _e = {"i": _i, "match": bool(_m), "got_dims": [len(_got), (len(_got[0]) if _got else 0)], "exp_dims": [len(_exp), (len(_exp[0]) if _exp else 0)]}',
    "            if not _m:",
    '                _e["got"] = _got',
    '                res["train_verified"] = False',
    '            res["train"].append(_e)',
    "        except Exception:",
    '            res["train_verified"] = False',
    '            res["train"].append({"i": _i, "match": False, "error": traceback.format_exc()[-600:]})',
    '    if res["train_verified"]:',
    "        for _t in _TESTS:",
    "            try:",
    '                res["predicted"].append(_norm(transform([row[:] for row in _t])))',
    "            except Exception:",
    '                res["predicted"].append(None)',
    '                res["predict_error"] = traceback.format_exc()[-600:]',
    '    sys.stdout.write("ARCJSON:" + json.dumps(res) + "\\n")',
    "",
    "_main()",
    "",
  ].join("\n");
}

function parseArc(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  for (let k = lines.length - 1; k >= 0; k--) {
    const idx = lines[k].indexOf("ARCJSON:");
    if (idx >= 0) { try { return JSON.parse(lines[k].slice(idx + 8)); } catch (e) { return null; } }
  }
  return null;
}

// EV-3: o retorno deixa de ser "ache a diferenca nestas duas grades" e passa a DECLARAR o padrao
// do erro. Medido: das 13 pendentes, 8 falham por regra errada e 3 dessas erram <5% das celulas --
// a regra esta quase certa. Achar 9 celulas divergentes em 272 por inspeccao visual gasta o
// orcamento de raciocinio que justamente falta.
const CE = require("./caracteriza-erro.cjs");
function trainFeedback(taskObj, parsed) {
  const fail = (parsed.train || []).find((e) => !e.match);
  if (!fail) return "Unknown training verification failure.";
  const i = fail.i;
  let msg = "Verification FAILED on training example #" + (i + 1) + ".\n";
  if (fail.error) return msg + "Your transform raised an exception:\n" + fail.error;
  msg += "INPUT (" + dims(taskObj.train[i].input) + "):\n" + renderGrid(taskObj.train[i].input) + "\n";
  msg += "EXPECTED OUTPUT (" + dims(taskObj.train[i].output) + "):\n" + renderGrid(taskObj.train[i].output) + "\n";
  if (fail.got) {
    msg += "YOUR transform PRODUCED (" + (fail.got_dims || []).join("x") + "):\n" + renderGrid(fail.got);
    const car = CE.caracteriza(taskObj.train[i].output, fail.got);
    if (car) msg += "\n\n>>> PADRAO DO ERRO, medido pelo harness (nao procure, esta aqui):\n     " + car;
  } else msg += "Your output dims were " + (fail.got_dims || []).join("x") + ", expected " + (fail.exp_dims || []).join("x") + ".";
  return msg;
}

// ── G3 com throttle + retry ──
async function runG3(sem, token, program) {
  await sem.acquire();
  try {
    let r;
    for (let a = 1; a <= 3; a++) {
      r = await rt.execG3(token, "python", program);
      if (r.ok) return r;
      if (String(r.error || "").startsWith("refused")) return r; // nao re-tenta recusa do gate
      await sleep(700 * a);
    }
    return r;
  } finally { sem.release(); }
}

// ── solve de UMA task (loop de verificacao-por-execucao no treino; ao verificar, aplica no teste e para) ──
async function solveTask(model, sem, token, taskId, taskObj, baseTemp) {
  const t0 = Date.now();
  const sgOf = (g) => CFG.sceneGraph ? "\nOBJECTS: " + JSON.stringify(parseGridToObjects(g)) : "";
  const trainRender = taskObj.train.map((pr, i) =>
    "# Example " + (i + 1) + "\nINPUT (" + dims(pr.input) + "):\n" + renderGrid(pr.input) + sgOf(pr.input) + "\nOUTPUT (" + dims(pr.output) + "):\n" + renderGrid(pr.output) + sgOf(pr.output)).join("\n\n");
  const testRender = taskObj.test.map((t, i) =>
    "# Test " + (i + 1) + " (apply your transform; expected output is HIDDEN)\nINPUT (" + dims(t.input) + "):\n" + renderGrid(t.input) + sgOf(t.input)).join("\n\n");
  const trainJson = JSON.stringify(taskObj.train.map((pr) => ({ input: pr.input, output: pr.output })));
  const testsJson = JSON.stringify(taskObj.test.map((t) => t.input));

  let prevCode = null, feedback = "", trainVerified = false, solved = false, attempts = 0, lastErr = null, mismatch = null;
  let _lastRaw = null;
  // TRILHA POR TENTATIVA — sem isto não dá para saber ONDE o tempo foi gasto. Motivou-a um bloco em
  // que uma tarefa levou 534s e outra 28s (variância de 19x) sem nenhum registro que explicasse a
  // diferença: o per_task só guardava a latência TOTAL, então "o refino é caro" era palpite.
  // Aqui fica: tokens de raciocínio vs de saída, latência do cérebro, latência do G3, por tentativa.
  const trilha = [];
  for (let att = 1; att <= CFG.maxAttempts; att++) {
    attempts = att;
    const temp = Math.min(0.85, baseTemp + 0.1 * (att - 1));
    const user = buildUser(trainRender, testRender, prevCode, feedback);
    const tBrain0 = Date.now();
    // dispatchWithFallback: mesmo MODELO, próximo PROVEDOR quando o primeiro falha ou devolve content
    // vazio. Era `dispatch107` direto — e foi assim que um provedor com modo de raciocínio ligado
    // queimou os 20.000 max_tokens pensando, devolveu content vazio em 888s e o harness registrou
    // `solved:false`. Escalar de provedor não descaracteriza a medição; escalar de modelo sim.
    const resp = await brain.dispatchWithFallback(model, { system: SYS, user, temperature: temp, max_tokens: CFG.maxTokens, timeoutMs: CFG.brainTimeout, reasoning: CFG.reasoningMaxTokens ? { max_tokens: CFG.reasoningMaxTokens } : (CFG.reasoningEffort ? { effort: CFG.reasoningEffort } : undefined) });
    const brainMs = Date.now() - tBrain0;
    const u = resp.usage || {};
    const reasoningTok = (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0;
    const passo = { att, brain_ms: brainMs, prompt_tok: u.prompt_tokens || 0, completion_tok: u.completion_tokens || 0, reasoning_tok: reasoningTok, servedBy: (resp.servedBy && resp.servedBy.provider) || null, modelo_slug: (resp.servedBy && resp.servedBy.model_slug) || null, escalou: resp.escalou || 0, upstream: resp.upstream || null };
    trilha.push(passo);
    // OBSERVABILIDADE: pedido != efetivo, e em silencio, e o defeito que mais nos custou.
    if (CFG.reasoningMaxTokens && reasoningTok > CFG.reasoningMaxTokens * 1.1) {
      passo.teto_raciocinio_ignorado = { pedido: CFG.reasoningMaxTokens, efetivo: reasoningTok };
      if (!runRound._avisouTeto || runRound._avisouTeto < 5) {
        runRound._avisouTeto = (runRound._avisouTeto || 0) + 1;
        console.error("[TETO DE RACIOCINIO IGNORADO] pedido " + CFG.reasoningMaxTokens + ", efetivo " + reasoningTok +
          " — o provedor nao honrou `reasoning.max_tokens`. O botao contra o modo de falha dominante NAO esta a atuar.");
      }
    }
    if (!resp.ok || !resp.rawText) { passo.fim = "brain_empty"; lastErr = "brain_empty(st=" + resp.status + ",ct=" + ((resp.usage && resp.usage.completion_tokens) || "?") + ")"; if (resp.status === 200) break; /* budget esgotado / nao-convergiu: retry nao ajuda */ feedback = "(no output — transient)"; prevCode = null; continue; }
    _lastRaw = resp.rawText;   // capture: bruto da última rodada (forense do no_code)
    const code = rt.extractCode(resp.rawText);
    prevCode = code;
    if (!code || code.replace(/\s/g, "").length < 12 || !/def\s+transform\s*\(/.test(code)) { passo.fim = "no_code"; lastErr = "no_code"; feedback = "You did not return a valid def transform(grid)."; continue; }
    passo.code_chars = code.length;
    const tG3 = Date.now();
    const r = await runG3(sem, token, buildProgram(trainJson, testsJson, code));
    passo.g3_ms = Date.now() - tG3;
    const parsed = parseArc(r.stdout);
    if (!parsed) { passo.fim = "exec_error"; passo.g3_stderr = String(r.stderr || r.error || ("exit " + r.exit_code)).slice(-300); lastErr = "exec_error"; feedback = "Your code did not run. Error:\n" + String(r.stderr || r.error || ("exit " + r.exit_code)).slice(-600); continue; }
    if (!parsed.train_verified) { passo.fim = "train_mismatch"; lastErr = "train_mismatch"; feedback = trainFeedback(taskObj, parsed); continue; }
    passo.fim = "train_ok";
    // TREINO VERIFICADO no G3 -> aplica ao teste (predicted vem da execucao real) e PARA (sem oraculo p/ o teste; usar a saida = vazamento)
    trainVerified = true;
    const predicted = parsed.predicted || [];
    const gt = taskObj.test.map((t) => t.output);
    solved = predicted.length === gt.length && predicted.every((p, j) => p !== null && gEq(p, gt[j]));
    if (!solved) mismatch = predicted.some((p) => p === null) ? "predict_crash" : "test_mismatch";
    lastErr = solved ? null : (mismatch || "test_mismatch");
    break;
  }
  const _code = String(prevCode || ""); const _cap = CFG.capture ? { raw_head: String(_lastRaw || "").slice(0, 1500), raw_tail: String(_lastRaw || "").slice(-1500), raw_len: String(_lastRaw || "").length, code_sample: _code.slice(0, 4000), calls_get_objects: _code.includes("get_objects("), reimplements_flood: ["deque", "from collections", "most_common", "visited ="].some(function (s) { return _code.includes(s); }) } : {};
  // LINHA DURA: artefato persistido no PASS **e na FALHA**. Sem o programa da falha não há forense —
  // não dá para saber se o laço EXPLOROU ou REPETIU, e é essa a pergunta que decide entre "mais uma
  // tentativa" e "retrieval de método". Custou uma re-rodada inteira descobrir isso no LiveCodeBench.
  try {
    const dirArt = path.join(OUT, CFG.outTag + "-artefatos", solved ? "solutions" : "falhas");
    fs.mkdirSync(dirArt, { recursive: true });
    if (prevCode) fs.writeFileSync(path.join(dirArt, taskId + ".py"), String(prevCode), "utf8");
  } catch (e) { }
  return { task: taskId, solved, attempts, train_verified: trainVerified, latency_ms: Date.now() - t0, n_test: taskObj.test.length, last_error: lastErr, mismatch_reason: mismatch, trilha, provenance: PROV, ..._cap };
}

// PROV e OUT passam por GETTER: PROV so e preenchido quando o brain resolve, e passa-lo por valor
// aqui capturaria null — proveniencia nula que parece proveniencia presente.
const solveTaskGuia = makeGuiaSolver({ SYS, buildProgram, runG3, parseArc, gEq, trainFeedback, rt, brain, CFG, renderGrid, dims, getPROV: () => PROV, OUT });
const solveTaskFragmented = makeFragmentedSolver({ SYS, buildProgram, runG3, parseArc, gEq, trainFeedback, rt, brain, CFG, parseGridToObjects, renderGrid, dims, getPROV: () => PROV, OUT });
const solveTaskSketch = makeSketchTranscribeSolver({ SYS, buildProgram, runG3, parseArc, gEq, trainFeedback, rt, brain, CFG, renderGrid, dims });
const solveTaskSampleN = makeSampleNSolver({ SYS, buildProgram, runG3, parseArc, gEq, trainFeedback, rt, brain, CFG, renderGrid, dims });

// ── uma rodada sobre os MESMOS taskObjs (temp nudge pelo round) ──
async function runRound(model, sem, token, taskObjs, round) {
  const baseTemp = Math.min(0.85, 0.15 + 0.06 * (round - 1));
  const startedAt = new Date().toISOString();
  const acc = []; // acumulador dos resultados JA concluidos (o const per_task fica na TDZ durante o runPool)
  let done = 0;
  const per_task = await runPool(taskObjs, CFG.concurrency, async (to) => {
    const r = await (CFG.sampleN > 0 ? solveTaskSampleN : CFG.sketchTranscribe ? solveTaskSketch : CFG.guia ? solveTaskGuia : CFG.fragmented ? solveTaskFragmented : solveTask)(model, sem, token, to.id, to.obj, baseTemp);
    done++; acc.push(r);
    process.stderr.write("  [r" + round + " " + done + "/" + taskObjs.length + "] " + r.task + ": " + (r.solved ? "SOLVED" : "fail") + " tv=" + (r.train_verified ? "Y" : "n") + " att=" + r.attempts + " " + (r.latency_ms / 1000).toFixed(0) + "s" + (r.last_error ? " (" + r.last_error + ")" : "") + "\n");
    try { fs.writeFileSync(path.join(OUT, CFG.outTag + ".partial.round" + round + ".json"), JSON.stringify({ round, done, per_task: acc }, null, 2)); } catch (e) {}
    return r;
  });
  const passed = per_task.filter((t) => t.solved).length;
  const tv = per_task.filter((t) => t.train_verified).length;
  const verifiedButFailed = per_task.filter((t) => t.train_verified && !t.solved).length;
  const avgLat = Math.round(per_task.reduce((a, t) => a + t.latency_ms, 0) / per_task.length);
  // LINHA DURA: infra separada do veredito, e denominador EXPLÍCITO.
  // Uma tarefa em que o cérebro não respondeu, ou em que a fronteira recusou por fila, não é evidência
  // sobre a capacidade do MZ — é ausência de evidência. Sem sair do denominador, ela vira "não resolveu",
  // que foi exatamente o mecanismo dos oito instrumentos silenciosos desta campanha.
  const infra = per_task.filter((t) => /brain_empty|g3_fila|no_response/.test(String(t.last_error || "")));
  const medidas = per_task.length - infra.length;
  return {
    split: CFG.split, n: per_task.length, seed: CFG.seed, round, base_temp: baseTemp,
    model: model.model_slug + " (" + model.provider + ", tier=" + model.tier + ", via " + model.via + ")",
    provenance: PROV,
    passed, medidas, api_fail: infra.length, api_fail_ids: infra.map((t) => t.task),
    pass_rate: medidas ? passed / medidas : null, wilson: wilson(passed, medidas || 1),
    pass_rate_bruta: passed / per_task.length,   // sobre TODAS, inclusive as sem veredito — só p/ comparação histórica
    train_verified_count: tv, verified_but_failed_test: verifiedButFailed,
    avg_latency_ms: avgLat, started_at: startedAt, finished_at: new Date().toISOString(),
    per_task,
  };
}

// ⚠️ PROVENIÊNCIA DA CORRIDA — não remover (R&D + Coordenação, 2026-08-07).
// O `exatos = 0 em 13/13` é a fundação de uma linha inteira de trabalho e a configuração que o
// produziu NÃO estava escrita em lado nenhum: nem em script, nem no canal, nem no artefacto (que
// gravava só `{round, done, per_task}`). A campanha de re-teste ficou bloqueada por isso — um
// número novo com flags diferentes PARECE comparável ao antigo e não é.
// O remédio não é achar a configuração perdida: é o controlo viajar DENTRO da corrida.
function proveniencia() {
  let commit = null;
  try { commit = require("child_process").execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) {}
  return {
    argv: process.argv.slice(2),                       // a invocação LITERAL, que é o que faltava
    // a configuração RESOLVIDA (argv não dá os defaults). Campos longos — `metodo` carrega o
    // CONTEÚDO de um ficheiro — entram resumidos: o artefacto é para reproduzir, não para arquivar.
    cfg: (typeof CFG === "undefined" || !CFG) ? null : Object.fromEntries(
      Object.entries(CFG).map(([k, v]) =>
        (typeof v === "string" && v.length > 200)
          ? [k, "«" + v.length + " chars, sha1 " + require("crypto").createHash("sha1").update(v).digest("hex").slice(0, 12) + "»"]
          : [k, v])),
    commit,
    node: process.version,
    iniciada_em: new Date().toISOString(),
  };
}

function writeOut(file, obj) {
  fs.mkdirSync(OUT, { recursive: true });
  const comProv = (obj && typeof obj === "object" && !Array.isArray(obj)) ? { proveniencia: proveniencia(), ...obj } : obj;
  fs.writeFileSync(file, JSON.stringify(comProv, null, 2));
}
const pct = (x) => (100 * x).toFixed(1) + "%";

function printRound(s) {
  console.log("\n── ARC-AGI · split=" + s.split + " · n=" + s.n + " · seed=" + s.seed + " · round=" + s.round + " (temp=" + s.base_temp.toFixed(2) + ") ──");
  console.log("model (SSOT): " + s.model);
  console.log("pass_rate:        " + s.passed + "/" + s.n + " = " + pct(s.pass_rate) + "   Wilson95% [" + pct(s.wilson.lo) + " .. " + pct(s.wilson.hi) + "]");
  console.log("train_verified:   " + s.train_verified_count + "/" + s.n + " (o G3 confirmou a regra em TODOS os train-pairs)");
  console.log("generalization Δ: " + s.verified_but_failed_test + " verificaram no train mas ERRARAM o test (gap de generalizacao)");
  console.log("avg latency/task: " + (s.avg_latency_ms / 1000).toFixed(1) + "s");
}

function aggregate(per_round, ids) {
  const solveCount = {}; ids.forEach((id) => (solveCount[id] = 0));
  per_round.forEach((s) => s.per_task.forEach((t) => { if (t.solved) solveCount[t.task]++; }));
  const passAtK = ids.filter((id) => solveCount[id] > 0).length;
  const meanPass = per_round.reduce((a, s) => a + s.pass_rate, 0) / per_round.length;
  const rates = per_round.map((s) => s.pass_rate);
  return {
    n: ids.length, rounds: per_round.length,
    mean_pass_rate: meanPass, pass_rate_by_round: rates,
    pass_at_k: passAtK / ids.length, pass_at_k_count: passAtK,
    per_task_solve_counts: solveCount,
  };
}

async function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) { console.error("FATAL: SUPABASE_ACCESS_TOKEN nao setado (necessario p/ SRK->Vault CODEEXEC_API_TOKEN)."); process.exit(1); }
  const DATA = path.join(REPO, CFG.dataRoot, "data", CFG.split);
  if (!fs.existsSync(DATA)) { console.error("FATAL: dataset nao encontrado em " + DATA); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true }); // garante o dir de saida ANTES de qualquer write parcial

  // selecao deterministica dos N tasks (MESMO conjunto em todas as rodadas -> comparavel/agregavel)
  const ids = fs.readdirSync(DATA).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  seededShuffle(ids, CFG.seed);
  const chosen = CFG.taskIds ? CFG.taskIds.split(",").map((s) => s.trim()) : ids.slice(0, CFG.n);
  const taskObjs = chosen.map((id) => ({ id, obj: JSON.parse(fs.readFileSync(path.join(DATA, id + ".json"), "utf8")) }));

  // brain SSOT .107 (fail-closed) + token G3
  const model = CFG.brainModel ? brain.resolve107({ slug: CFG.brainModel }) : brain.resolve107({ role: "mz_chat_brain" });
  PROV = prov.stamp(model, "g3");   // carimbo no NASCIMENTO: quem pensou (slug/provedor/role) e onde executou
  const srk = await rt.getSRK();
  const token = await rt.codeExecToken(srk);
  if (!token) { console.error("FATAL: sem token code:exec (CODEEXEC_API_TOKEN)."); process.exit(1); }
  const sem = semaphore(CFG.g3Max);

  console.error("ARC-AGI harness · brain=" + model.model_slug + " (" + model.provider + ", tier=" + model.tier + ") · G3 throttle=" + CFG.g3Max + " · pool=" + CFG.concurrency + " · max_attempts=" + CFG.maxAttempts);
  // o banner imprimia CFG.n mesmo com --task-ids: com 1 id na linha de comando ele anunciava "30 tasks",
  // o que fez matar uma corrida legítima achando que ia disparar tudo. Anuncia o que VAI rodar de fato.
  console.error("tasks: " + chosen.length + (CFG.taskIds ? " (--task-ids)" : " de " + CFG.split + " sorteadas (seed " + CFG.seed + ")") + " · rounds=" + CFG.rounds + "\n");

  if (CFG.rounds <= 1) {
    const s = await runRound(model, sem, token, taskObjs, CFG.round);
    writeOut(path.join(OUT, CFG.outTag + ".json"), s);
    printRound(s);
    console.log("\n→ scripts/agent/mz-bench/out/" + CFG.outTag + ".json");
  } else {
    const per_round = [];
    for (let r = 1; r <= CFG.rounds; r++) {
      const s = await runRound(model, sem, token, taskObjs, r);
      per_round.push(s);
      writeOut(path.join(OUT, CFG.outTag + ".round" + r + ".json"), s);
      printRound(s);
    }
    const agg = aggregate(per_round, chosen);
    writeOut(path.join(OUT, CFG.outTag + ".json"), { mode: "aggregate", split: CFG.split, seed: CFG.seed, model: per_round[0].model, ...agg, per_round: per_round.map((s) => ({ round: s.round, base_temp: s.base_temp, passed: s.passed, pass_rate: s.pass_rate, wilson: s.wilson, avg_latency_ms: s.avg_latency_ms })) });
    console.log("\n── AGREGADO (" + agg.rounds + " rodadas × " + agg.n + " tasks, MESMO conjunto) ──");
    console.log("pass@1 medio:     " + pct(agg.mean_pass_rate) + "  (por rodada: " + agg.pass_rate_by_round.map(pct).join(", ") + ")");
    console.log("pass@k (∪ rodadas): " + agg.pass_at_k_count + "/" + agg.n + " = " + pct(agg.pass_at_k) + "  (teto-oraculo: resolvido em ≥1 rodada)");
    console.log("\n→ scripts/agent/mz-bench/out/" + CFG.outTag + ".json");
  }
}

main().catch((e) => { console.error("FATAL:", e && e.stack ? e.stack : String(e)); process.exit(1); });
