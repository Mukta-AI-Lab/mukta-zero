// Portions Copyright 2023 The Google Research Authors.
// Ported from google-research/instruction_following_eval
// (instructions.py, instructions_util.py, evaluation_lib.py).
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at LICENSES/Apache-2.0.txt or http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software distributed
// under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
// CONDITIONS OF ANY KIND, either express or implied.
//
// NOTICE OF MODIFICATIONS (Apache-2.0 section 4b)
// Modifications Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// This file was ported from Python to JavaScript and changed as follows; each
// deviation is also documented in place, at the function it affects:
//   1. count_sentences - the upstream NLTK punkt statistical tokenizer was
//      replaced by split_into_sentences, the regex+abbreviation splitter from the
//      same upstream file. May differ from punkt on ambiguous punctuation.
//   2. language:response_language - upstream uses langdetect and returns True on
//      exception; this port returns False when detection is not confident.
//   3. change_case:english_lowercase / english_capital - the upstream langdetect
//      == "en" precondition is intentionally omitted.
//   4. change_case:capital_word_frequency - upstream counts any word matching
//      isupper(); this port requires two or more letters.
//
// SPDX-License-Identifier: Apache-2.0
// mz-bench/ifeval-checkers.cjs — verificador IFEval FIEL, portado LINHA-A-LINHA do source oficial
// google-research/instruction_following_eval (instructions.py + instructions_util.py + evaluation_lib.py,
// buscado ao vivo do GitHub em 2026-07-12 para checar a semântica exata, não de memória).
// Cobre os 23 instruction_id presentes no dataset local (ver ifeval.json). Sem chamada de LLM aqui —
// módulo puro, reusado tanto por ifeval-validate.cjs (self-test) quanto por ifeval-official.cjs (medição).
//
// DESVIOS DOCUMENTADOS do oficial (Node não tem nltk/langdetect):
//  1. count_sentences: oficial usa o tokenizer estatístico NLTK punkt (treinado). Portamos em vez disso
//     `split_into_sentences` — o OUTRO splitter por regex que já existe no MESMO arquivo oficial
//     (instructions_util.py, usado por KeySentenceChecker) — é regex+abreviações, não um port aproximado
//     nosso; é código oficial real, só que da função-irmã. Deve divergir do punkt em casos raros de
//     pontuação ambígua.
//  2. language:response_language: oficial usa `langdetect.detect()` (biblioteca estatística treinada) e,
//     PROPOSITALMENTE diferente do oficial, quando não detecta com confiança RETORNA FALSE aqui (oficial
//     retorna True on exception — é exatamente esse "sempre-true" disfarçado que motivou este rewrite).
//     Implementação: bloco Unicode para scripts não-latinos (kn/pa/mr/fa/etc., ratio>=0.5 dos chars-letra)
//     + heurística de stopwords para línguas latinas. Não distingue línguas queComPartilham script
//     (hi/mr/ne todas em Devanagari; ru/uk/bg todas em Cirílico; zh/ja Han) — ver checkLanguage().
//  3. change_case:english_lowercase / english_capital: oficial EXIGE também langdetect==\"en\". Omitido
//     aqui (ver comentário na função) — decisão deliberada, não descuido.
//  4. change_case:capital_word_frequency: oficial usa nltk.word_tokenize + word.isupper() (conta até
//     palavras de 1 letra maiúscula, ex. "I"). Aqui exigimos 2+ letras (\b[A-Z]{2,}\b) para não inflar
//     com o artefato conhecido de "I"/"A" maiúsculos naturais do inglês — mais RESTRITIVO que o oficial.
//
// Fora isso, todo checker abaixo é port 1:1 do regex/lógica oficial (mesmas fontes, mesmos operadores).

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rel(value, relation, target) {
  if (relation === "less than") return value < target;
  return value >= target; // "at least" (e qualquer fallback, não deve ocorrer neste dataset)
}

// ── length_constraints:number_words — instructions_util.count_words (nltk RegexpTokenizer r"\w+", unicode) ──
function countWords(text) {
  return (text.match(/[\p{L}\p{N}_]+/gu) || []).length;
}

// ── length_constraints:number_sentences — port de instructions_util.split_into_sentences (regex+abreviações) ──
const _ALPHA = "([A-Za-z])";
const _PREFIXES = "(Mr|St|Mrs|Ms|Dr)[.]";
const _SUFFIXES = "(Inc|Ltd|Jr|Sr|Co)";
const _STARTERS = "(Mr|Mrs|Ms|Dr|Prof|Capt|Cpt|Lt|He\\s|She\\s|It\\s|They\\s|Their\\s|Our\\s|We\\s|But\\s|However\\s|That\\s|This\\s|Wherever)";
const _ACRONYMS = "([A-Z][.][A-Z][.](?:[A-Z][.])?)";
const _WEBSITES = "[.](com|net|org|io|gov|edu|me)";
const _DIGITS = "([0-9])";

function splitIntoSentences(text) {
  let t = " " + String(text) + "  ";
  t = t.replace(/\n/g, " ");
  t = t.replace(new RegExp(_PREFIXES, "g"), "$1<prd>");
  t = t.replace(new RegExp(_WEBSITES, "g"), "<prd>$1");
  t = t.replace(new RegExp(_DIGITS + "[.]" + _DIGITS, "g"), "$1<prd>$2");
  t = t.replace(/\.{2,}/g, (m) => "<prd>".repeat(m.length) + "<stop>");
  if (t.includes("Ph.D")) t = t.split("Ph.D.").join("Ph<prd>D<prd>");
  t = t.replace(new RegExp("\\s" + _ALPHA + "[.] ", "g"), " $1<prd> ");
  t = t.replace(new RegExp(_ACRONYMS + " " + _STARTERS, "g"), "$1<stop> $2");
  t = t.replace(new RegExp(_ALPHA + "[.]" + _ALPHA + "[.]" + _ALPHA + "[.]", "g"), "$1<prd>$2<prd>$3<prd>");
  t = t.replace(new RegExp(_ALPHA + "[.]" + _ALPHA + "[.]", "g"), "$1<prd>$2<prd>");
  t = t.replace(new RegExp(" " + _SUFFIXES + "[.] " + _STARTERS, "g"), " $1<stop> $2");
  t = t.replace(new RegExp(" " + _SUFFIXES + "[.]", "g"), " $1<prd>");
  t = t.replace(new RegExp(" " + _ALPHA + "[.]", "g"), " $1<prd>");
  if (t.includes("”")) t = t.split(".”").join("”.");
  if (t.includes('"')) t = t.split('."').join('".');
  if (t.includes("!")) t = t.split('!"').join('"!');
  if (t.includes("?")) t = t.split('?"').join('"?');
  t = t.split(".").join(".<stop>");
  t = t.split("?").join("?<stop>");
  t = t.split("!").join("!<stop>");
  t = t.split("<prd>").join(".");
  let sentences = t.split("<stop>").map((s) => s.trim());
  if (sentences.length && !sentences[sentences.length - 1]) sentences = sentences.slice(0, -1);
  return sentences;
}
function countSentences(text) {
  return splitIntoSentences(text).length;
}

// ── length_constraints:number_paragraphs — port exato de ParagraphChecker.check_following (divisor ***) ──
function checkNumberParagraphs(text, numParagraphs) {
  const paragraphs = String(text).split(/\s?\*\*\*\s?/);
  let n = paragraphs.length;
  for (let i = 0; i < paragraphs.length; i++) {
    if (!paragraphs[i].trim()) {
      if (i === 0 || i === paragraphs.length - 1) n -= 1;
      else return false;
    }
  }
  return n === numParagraphs;
}

// ── keywords:letter_frequency — port exato (Counter sobre value.lower(), letra também lowered) ──
function letterFrequencyCheck(text, letter, relation, frequency) {
  const low = String(text).toLowerCase();
  const L = String(letter == null ? "" : letter).toLowerCase();
  let count = 0;
  for (const ch of low) if (ch === L) count++;
  return rel(count, relation, frequency);
}

// ── change_case — port de str.islower()/isupper() (Unicode: precisa >=1 char cased, e nenhum do outro caso) ──
function pyIslower(s) {
  const hasLower = /\p{Ll}/u.test(s);
  const hasUpper = /\p{Lu}/u.test(s);
  return hasLower && !hasUpper;
}
function pyIsupper(s) {
  const hasUpper = /\p{Lu}/u.test(s);
  const hasLower = /\p{Ll}/u.test(s);
  return hasUpper && !hasLower;
}

// ── detectable_format:number_highlighted_sections — port exato de HighlightSectionChecker (2 passes: * e **) ──
function countHighlights(text) {
  let n = 0;
  const singles = String(text).match(/\*[^\n*]*\*/g) || [];
  const doubles = String(text).match(/\*\*[^\n*]*\*\*/g) || [];
  for (const h of singles) {
    const s = h.replace(/^\*+/, "").replace(/\*+$/, "").trim();
    if (s) n++;
  }
  for (const h of doubles) {
    let s = h;
    if (s.startsWith("**")) s = s.slice(2);
    if (s.endsWith("**")) s = s.slice(0, -2);
    if (s.trim()) n++;
  }
  return n;
}

// ── detectable_format:number_bullet_lists — port exato de BulletListChecker (linhas "* x" [não "**"] + "-") ──
function countBullets(text) {
  const a = String(text).match(/^\s*\*[^*].*$/gm) || [];
  const b = String(text).match(/^\s*-.*$/gm) || [];
  return a.length + b.length;
}

// ── detectable_format:title — port exato de TitleChecker (<<...>> sem \n, não-vazio após strip) ──
function titleCheck(text) {
  const titles = String(text).match(/<<[^\n]+>>/g) || [];
  return titles.some((t) => t.replace(/^<+/, "").replace(/>+$/, "").trim().length > 0);
}

// ── detectable_format:json_format — port exato de JsonFormat (strip fences ```json/```JSON/```Json/```) ──
function jsonFormatCheck(text) {
  let v = String(text).trim();
  const prefixes = ["```json", "```Json", "```JSON", "```"];
  for (const p of prefixes) {
    if (v.startsWith(p)) {
      v = v.slice(p.length);
      break;
    }
  }
  if (v.endsWith("```")) v = v.slice(0, -3);
  v = v.trim();
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

// ── detectable_format:multiple_sections — port exato de SectionChecker (split "\s?SPLITER\s?\d+\s?") ──
function sectionCheck(text, spliter, numSections) {
  const pat = new RegExp("\\s?" + escapeRegex(String(spliter || "")) + "\\s?\\d+\\s?");
  const sections = String(text).split(pat);
  return sections.length - 1 >= numSections;
}

// ── detectable_content:postscript — port exato de PostscriptChecker (casos especiais P.S./P.P.S) ──
function postscriptCheck(text, marker) {
  const low = String(text).toLowerCase();
  let pat;
  if (marker === "P.P.S") pat = /\s*p\.\s?p\.\s?s.*$/m;
  else if (marker === "P.S.") pat = /\s*p\.\s?s\..*$/m;
  else pat = new RegExp("\\s*" + escapeRegex(String(marker || "").toLowerCase()) + ".*$", "m");
  return pat.test(low);
}

// ── startend:quotation — port exato de QuotationChecker ──
function quotationCheck(text) {
  const v = String(text).trim();
  return v.length > 1 && v[0] === '"' && v[v.length - 1] === '"';
}

// ── startend:end_checker — port exato de EndChecker (strip() + strip('"') + lower(), depois endswith) ──
function endCheck(text, endPhrase) {
  let v = String(text).trim();
  v = v.replace(/^"+/, "").replace(/"+$/, "").toLowerCase();
  const ep = String(endPhrase || "").trim().toLowerCase();
  return v.endsWith(ep);
}

// ── combination:repeat_prompt — port exato de RepeatPromptThenAnswer (prefixo COMPLETO, não truncado) ──
function repeatPromptCheck(text, promptToRepeat) {
  return String(text).trim().toLowerCase().startsWith(String(promptToRepeat || "").trim().toLowerCase());
}

// ── combination:two_responses — port exato de TwoResponsesChecker (exige 2 partes válidas E diferentes) ──
function twoResponsesCheck(text) {
  const valid = [];
  const parts = String(text).split("******");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.trim()) {
      if (i !== 0 && i !== parts.length - 1) return false;
    } else {
      valid.push(p);
    }
  }
  return valid.length === 2 && valid[0].trim() !== valid[1].trim();
}

// ── language:response_language — detecção REAL (Unicode block p/ scripts não-latinos, stopwords p/ latinos) ──
const SCRIPT_RANGES = {
  ar: [[0x0600, 0x06ff], [0x0750, 0x077f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
  fa: [[0x0600, 0x06ff], [0x0750, 0x077f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
  ur: [[0x0600, 0x06ff], [0x0750, 0x077f]],
  he: [[0x0590, 0x05ff]],
  hi: [[0x0900, 0x097f]],
  mr: [[0x0900, 0x097f]],
  ne: [[0x0900, 0x097f]],
  bn: [[0x0980, 0x09ff]],
  gu: [[0x0a80, 0x0aff]],
  pa: [[0x0a00, 0x0a7f]],
  ta: [[0x0b80, 0x0bff]],
  te: [[0x0c00, 0x0c7f]],
  kn: [[0x0c80, 0x0cff]],
  ml: [[0x0d00, 0x0d7f]],
  th: [[0x0e00, 0x0e7f]],
  ko: [[0xac00, 0xd7a3], [0x1100, 0x11ff]],
  ja: [[0x3040, 0x30ff], [0x31f0, 0x31ff]],
  zh: [[0x4e00, 0x9fff]],
  ru: [[0x0400, 0x04ff]],
  uk: [[0x0400, 0x04ff]],
  bg: [[0x0400, 0x04ff]],
  el: [[0x0370, 0x03ff]],
};
const STOPWORDS = {
  en: ["the", "and", "is", "in", "to", "of", "a", "that", "it", "for", "on", "with", "as", "was", "are", "this", "be", "have", "i", "you"],
  es: ["el", "la", "de", "que", "y", "en", "los", "las", "un", "una", "es", "por", "con", "para", "su", "se"],
  pt: ["o", "a", "de", "que", "e", "em", "os", "as", "um", "uma", "é", "por", "com", "para", "não", "se", "do", "da"],
  fr: ["le", "la", "de", "et", "les", "des", "un", "une", "est", "dans", "pour", "que", "qui", "avec", "ce", "il"],
  de: ["der", "die", "das", "und", "ist", "in", "zu", "den", "mit", "dem", "ein", "eine", "nicht", "für", "auf", "sich"],
  it: ["il", "la", "di", "e", "che", "un", "una", "è", "per", "con", "non", "gli", "le", "sono", "del"],
  vi: ["là", "và", "của", "có", "không", "được", "trong", "này", "cho", "với", "một", "các"],
  fi: ["ja", "on", "ei", "se", "että", "joka", "kun", "tämä", "olla", "ovat"],
  sw: ["na", "ya", "wa", "kwa", "ni", "katika", "hii", "kuwa", "ana"],
  pl: ["i", "w", "na", "się", "z", "do", "nie", "że", "to", "jest", "jak", "co"],
};
function letterRatio(text, ranges) {
  let hit = 0, total = 0;
  for (const ch of String(text)) {
    if (!/\p{L}/u.test(ch)) continue;
    total++;
    const cp = ch.codePointAt(0);
    if (ranges.some(([a, b]) => cp >= a && cp <= b)) hit++;
  }
  return total === 0 ? 0 : hit / total;
}
function latinStopwordScore(text, words) {
  const tokens = String(text).toLowerCase().match(/[a-zà-öø-ÿ]+/gu) || [];
  if (tokens.length === 0) return 0;
  const set = new Set(words);
  let hits = 0;
  for (const t of tokens) if (set.has(t)) hits++;
  return hits / tokens.length;
}
function checkLanguage(text, langCode) {
  if (!langCode) return true; // sem alvo especificado -> vacuamente satisfeito
  const lang = String(langCode).toLowerCase();
  const R = String(text);
  if (SCRIPT_RANGES[lang]) {
    return letterRatio(R, SCRIPT_RANGES[lang]) >= 0.5;
  }
  if (STOPWORDS[lang]) {
    const latinRatio = letterRatio(R, [[0x0041, 0x024f], [0x1e00, 0x1eff]]);
    if (latinRatio < 0.5) return false; // não é predominantemente script latino
    const tokenCount = (R.toLowerCase().match(/[a-zà-öø-ÿ]+/gu) || []).length;
    if (tokenCount < 3) return false; // sinal insuficiente -> conservador
    let best = null, bestScore = -1;
    for (const [code, words] of Object.entries(STOPWORDS)) {
      const score = latinStopwordScore(R, words);
      if (score > bestScore) { bestScore = score; best = code; }
    }
    const targetScore = latinStopwordScore(R, STOPWORDS[lang]);
    if (targetScore <= 0) return false;
    return best === lang && targetScore > 0.03;
  }
  return false; // código de língua desconhecido -> não dá pra detectar com confiança
}

// ── dispatcher — todos os 23 instruction_id do dataset local ──
const SUPPORTED_IDS = [
  "punctuation:no_comma",
  "length_constraints:number_words",
  "length_constraints:number_sentences",
  "length_constraints:number_paragraphs",
  "keywords:existence",
  "keywords:frequency",
  "keywords:forbidden_words",
  "keywords:letter_frequency",
  "change_case:english_lowercase",
  "change_case:english_capital",
  "change_case:capital_word_frequency",
  "detectable_format:number_highlighted_sections",
  "detectable_format:number_bullet_lists",
  "detectable_format:title",
  "detectable_format:json_format",
  "detectable_format:multiple_sections",
  "detectable_content:postscript",
  "detectable_content:number_placeholders",
  "startend:quotation",
  "startend:end_checker",
  "combination:repeat_prompt",
  "combination:two_responses",
  "language:response_language",
];

function checkOne(id, kwargs, response) {
  const k = kwargs || {};
  const R = String(response == null ? "" : response);
  switch (id) {
    case "punctuation:no_comma":
      return !R.includes(",");
    case "length_constraints:number_words":
      return rel(countWords(R), k.relation, k.num_words);
    case "length_constraints:number_sentences":
      return rel(countSentences(R), k.relation, k.num_sentences);
    case "length_constraints:number_paragraphs":
      return checkNumberParagraphs(R, k.num_paragraphs);
    case "keywords:existence":
      return (k.keywords || []).every((w) => new RegExp(escapeRegex(String(w)), "i").test(R));
    case "keywords:frequency": {
      const c = (R.match(new RegExp(escapeRegex(String(k.keyword || "")), "gi")) || []).length;
      return rel(c, k.relation, k.frequency);
    }
    case "keywords:forbidden_words":
      return (k.forbidden_words || []).every((w) => !new RegExp("\\b" + escapeRegex(String(w)) + "\\b", "i").test(R));
    case "keywords:letter_frequency":
      return letterFrequencyCheck(R, k.letter, k.let_relation, k.let_frequency);
    case "change_case:english_lowercase":
      // oficial exige TAMBÉM langdetect==\"en\"; omitido de propósito (ver cabeçalho do arquivo).
      return pyIslower(R);
    case "change_case:english_capital":
      return pyIsupper(R);
    case "change_case:capital_word_frequency": {
      const c = (R.match(/\b[A-Z]{2,}\b/g) || []).length; // 2+ letras (ver desvio doc. no topo)
      return rel(c, k.capital_relation, k.capital_frequency);
    }
    case "detectable_format:number_highlighted_sections":
      return countHighlights(R) >= (k.num_highlights == null ? 1 : k.num_highlights);
    case "detectable_format:number_bullet_lists":
      return countBullets(R) === k.num_bullets;
    case "detectable_format:title":
      return titleCheck(R);
    case "detectable_format:json_format":
      return jsonFormatCheck(R);
    case "detectable_format:multiple_sections":
      return sectionCheck(R, k.section_spliter, k.num_sections == null ? 1 : k.num_sections);
    case "detectable_content:postscript":
      return postscriptCheck(R, k.postscript_marker);
    case "detectable_content:number_placeholders":
      return (R.match(/\[.*?\]/g) || []).length >= (k.num_placeholders == null ? 1 : k.num_placeholders);
    case "startend:quotation":
      return quotationCheck(R);
    case "startend:end_checker":
      return endCheck(R, k.end_phrase);
    case "combination:repeat_prompt":
      return repeatPromptCheck(R, k.prompt_to_repeat);
    case "combination:two_responses":
      return twoResponsesCheck(R);
    case "language:response_language":
      return checkLanguage(R, k.language);
    default:
      return null; // id não coberto (não deve ocorrer para os 23 do dataset)
  }
}

// ── strict: só a resposta original, guardada por response.strip() (evaluation_lib.test_instruction_following_strict) ──
function checkStrict(id, kwargs, response) {
  const R = response == null ? "" : String(response);
  if (!R.trim()) return false;
  return checkOne(id, kwargs, R) === true;
}

// ── loose: 8 variantes (evaluation_lib.test_instruction_following_loose), passa se QUALQUER uma satisfizer ──
function looseVariants(response) {
  const R = response == null ? "" : String(response);
  const lines = R.split("\n");
  const removeFirst = lines.slice(1).join("\n").trim();
  const removeLast = lines.slice(0, -1).join("\n").trim();
  const removeBoth = lines.slice(1, -1).join("\n").trim();
  const revised = R.split("*").join("");
  const revisedRemoveFirst = removeFirst.split("*").join("");
  const revisedRemoveLast = removeLast.split("*").join("");
  const revisedRemoveBoth = removeBoth.split("*").join("");
  return [R, revised, removeFirst, removeLast, removeBoth, revisedRemoveFirst, revisedRemoveLast, revisedRemoveBoth];
}
function checkLoose(id, kwargs, response) {
  for (const v of looseVariants(response)) {
    if (v.trim() && checkOne(id, kwargs, v) === true) return true;
  }
  return false;
}

// ── avalia um prompt inteiro (lista de instruções) num modo (strict|loose) ──
function evaluatePrompt(idList, kwargsList, response, loose) {
  const checker = loose ? checkLoose : checkStrict;
  const followList = (idList || []).map((id, idx) => checker(id, (kwargsList && kwargsList[idx]) || {}, response));
  return { followAll: followList.length > 0 && followList.every(Boolean), followList };
}

module.exports = {
  SUPPORTED_IDS,
  checkOne,
  checkStrict,
  checkLoose,
  looseVariants,
  evaluatePrompt,
  // exportados para o suite de validação inspecionar/testar isoladamente se preciso
  countWords,
  countSentences,
  splitIntoSentences,
  checkNumberParagraphs,
  checkLanguage,
  rel,
};
