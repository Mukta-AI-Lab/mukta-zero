// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// classifica-literais.cjs — separa STRING-DE-ESPECIFICAÇÃO de FIXTURE numa suíte de testes.
//
// PORQUÊ: o `guard-literais.cjs` encontra literais mas não os classifica, e por isso acusou de
// batota o que era cumprimento de contrato. Duas vezes em dois dias:
//   · /77  — `'Login successful.'` / `'Login failed.'` são o CORPO da resposta que a função deve
//            devolver. Uma implementação correta TEM de as conter. Marcadas como HARDCODE.
//   · /728 — a REGRA que eu próprio escrevi foi descartada por citar `', encoding='`, que é
//            sintaxe de Python, não dado da suíte.
// Guard que classifica mal é pior que guard nenhum: ensina a ignorá-lo.
//
// A DISCRIMINAÇÃO, e é sintática, não semântica:
//   SPEC     o literal aparece DENTRO de uma asserção sobre a SAÍDA da função
//            (assertEqual/assertIn/assertListEqual sobre o retorno) ⇒ é o contrato. Citá-lo é
//            cumprir, não copiar.
//   FIXTURE  o literal aparece em setUp, em configuração de mock (`return_value`, `side_effect`),
//            ou numa atribuição de dados de entrada ⇒ é material do teste. Citá-lo é decorar.
//   AMBOS    aparece nos dois sítios ⇒ inconclusivo, reportado como tal e não como veredito.
//
// O que NUNCA é literal de dados (já vinha do guard-literais): nome pontuado de módulo/API
// (`shutil.move`, `os.walk`) e identificador curto solto. Aqui junta-se: fragmento de sintaxe.
const SINTAXE = /^(,\s*)?\w+=$|^[(),\[\]{}=\s]+$|^(r|w|rb|wb|a)$/;

function linhasDe(testSrc) { return String(testSrc || "").split("\n"); }

// ⚠️ OCORRÊNCIA É POR TOKEN, NÃO POR SUBSTRING — e esta é a causa-raiz que travou a /144 e as
// outras quatro que não fechei martelando caso a caso.
//   a linha `ip_range = '192.168.1.0/30'` CONTÉM a sequência `192.168.1.0`
//   ⇒ com `includes`, o classificador dava-a como "aparece na entrada", e o que era SPEC virava
//     FIXTURE. O resultado ficava INVERTIDO: mutava-se a expectativa e deixava-se a entrada.
// A correção não é mais um regex: é comparar com as strings REAIS da linha, por igualdade.
const { stringsDe } = require("./guard-literais.cjs");
const _cacheLinha = new Map();
function ocorreEm(linha, literal) {
  let strs = _cacheLinha.get(linha);
  if (!strs) { strs = new Set(stringsDe(linha)); _cacheLinha.set(linha, strs); }
  if (strs.has(literal)) return true;
  // um literal também ocorre se for CAMPO de uma string estruturada da linha (CSV/tabela): aí a
  // igualdade estrita perderia `Name` dentro de `"Name,Age\nAlice,30"`. Fronteira de campo, nunca
  // substring solta — é a fronteira que impede `25` de casar dentro de `cp1251`.
  const esc = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const campo = new RegExp(`(^|[ ,;|\\t]|\\\\n|\\\\t)${esc}($|[ ,;|\\t]|\\\\n|\\\\t)`);
  for (const s of strs) if (s !== literal && campo.test(s)) return true;
  return false;
}

// uma linha é de ASSERÇÃO SOBRE A SAÍDA se afirma algo sobre o que a função devolveu.
// `self.assert*` não é a única forma: `pd.testing.assert_frame_equal` e `np.testing.assert_*`
// afirmam sobre a saída sem passar por `self`.
const ASSERCAO_SAIDA = /self\.assert\w*\s*\(|\bassert_\w+\s*\(|\bassert\s/;

// ⚠️ ESTAR DENTRO DE UMA ASSERÇÃO NÃO É SER O VALOR ESPERADO, e confundi-los deixou tarefas por
// decidir. Medido em 2026-08-07 nas BigCodeBench/670 e /733: a suíte escreve
//     self.assertEqual(task_func('aabc'), 'aa')
// e o classificador via a linha, casava `ASSERCAO_SAIDA`, e marcava **os dois** literais como SPEC
// — «só em asserção sobre a saída, é o contrato». Mas `'aabc'` é a ENTRADA: entra pela porta da
// frente, a solução não precisa de o conhecer, e é fixture perfeitamente mutável. Sem fixtures, a
// tarefa saía `SEM-FIXTURE — este teste não decide`, que num placar se lê como limite do MZ.
//
// A discriminação é posicional e não precisa de julgamento: o literal está DENTRO dos parênteses da
// chamada à função sob teste, ou fora dela? `assertEqual(task_func(X), Y)` — X é entrada, Y é
// contrato. Um argumento da função sob teste nunca é o valor que ela tem de produzir.
function nomeDaFuncaoSobTeste(src) {
  if (/\btask_func\s*\(/.test(String(src))) return "task_func";   // convenção do BigCodeBench
  const cont = new Map();
  for (const m of String(src).matchAll(/(?<![\w.])([a-z_]\w*)\s*\(/g)) {
    const n = m[1];
    if (/^(assert\w*|print|len|str|int|float|list|dict|set|tuple|range|open|sorted|sum|max|min|super|isinstance|patch|mock\w*|setUp|tearDown|main)$/.test(n)) continue;
    cont.set(n, (cont.get(n) || 0) + 1);
  }
  let melhor = null, n = 0;
  for (const [k, v] of cont) if (v > n) { melhor = k; n = v; }
  return melhor;
}
// o literal ocorre dentro dos parênteses de alguma chamada a `fn` nesta linha?
function ehArgumentoDaChamada(linha, literal, fn) {
  if (!fn) return false;
  const s = String(linha);
  const re = new RegExp(`(?<![\\w.])${fn}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(s))) {
    const abre = m.index + m[0].length - 1;
    let nivel = 0, aspa = null, fim = -1;
    for (let i = abre; i < s.length; i++) {
      const c = s[i];
      if (aspa) { if (c === "\\") i++; else if (c === aspa) aspa = null; continue; }
      if (c === '"' || c === "'") { aspa = c; continue; }
      if (c === "(") nivel++;
      else if (c === ")") { nivel--; if (nivel === 0) { fim = i; break; } }
    }
    if (fim < 0) continue;
    const dentro = s.slice(abre + 1, fim);
    // ⚠️ `dentro.includes(literal)` seria o MESMO defeito que já custou o extractor (aspa que fecha
    // `Dog` casada com a que abre `Cat`), o mutador (troca parcial) e o guarda de fuga (`id` dentro
    // de `hidden`): comparar por APARÊNCIA em vez de por UNIDADE. Em
    // `assertEqual(task_func('aabc'), 'aa')` o argumento é `'aabc'`, e procurar `aa` como substring
    // acha-o lá dentro — o VALOR ESPERADO seria classificado como entrada, invertendo exactamente a
    // distinção que esta função existe para fazer. O literal tem de aparecer como string COMPLETA.
    const esc = String(literal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(['"\`])${esc}\\1`).test(dentro)) return true;
  }
  return false;
}
// uma linha é de MONTAGEM se prepara o mundo antes da chamada
const MONTAGEM = /def setUp|return_value|side_effect|@patch|self\.\w+\s*=|mock_\w+\s*=/;

// ⚠️ O VALOR ESPERADO RARAMENTE ESTÁ DENTRO DA ASSERÇÃO — e ignorar isso custou um veredito
// invertido. Na /614 o padrão é:
//     expected_data = {'Team': ['Team A', ...], ...}
//     expected_df   = pd.DataFrame(expected_data)
//     pd.testing.assert_frame_equal(df, expected_df)
// Os nomes dos times são o RESULTADO EXIGIDO, mas a linha onde aparecem não contém `assert`.
// Lidos como "montagem", viraram FIXTURE — e a solução correta foi acusada de decorar. Pior: a
// regra que escrevi para a "corrigir" proibiu o que a suíte exige, e derrubou 5/5 para 2/5.
//
// A correção segue a LIGAÇÃO POR NOME: quais identificadores chegam a uma asserção, e quais
// linhas os atribuem (dois níveis, que cobre `expected_data` → `expected_df` → assert).
// ⚠️ E a propagação tem de PARAR na entrada, senão engole a suíte inteira. Medido: na /147 a
// expectativa é DERIVADA da entrada — `expected_ips = {str(ip) for ip in IPv4Network(ip_range)}`
// com `ip_range = '192.168.0.0/30'`. Seguindo a ligação cegamente, o CIDR de ENTRADA virava SPEC,
// a tarefa perdia toda fixture mutável e um `GENERALIZA` legítimo virava `SEM-FIXTURE`.
// Corrigir um viés não pode apagar evidência que já era válida.
//
// O corte é semântico e simples: **variável que alimenta a função sob teste é ENTRADA, ponto** —
// mutá-la muda entrada e expectativa derivada em conjunto, e a suíte continua coerente. Só é
// expectativa o que é constante do lado do resultado e nunca entra na chamada.
function varsDeEntrada(linhas) {
  const ent = new Set();
  for (const l of linhas) {
    const m = l.match(/task_func\s*\(([^)]*)\)/);
    if (!m) continue;
    for (const id of m[1].match(/[A-Za-z_]\w*/g) || []) ent.add(id);
  }
  return ent;
}

function varsDeExpectativa(linhas) {
  const entradas = varsDeEntrada(linhas);
  const alvo = new Set();
  for (const l of linhas) {
    if (!ASSERCAO_SAIDA.test(l)) continue;
    const args = (l.match(/\(([^)]*)\)/) || [])[1] || "";
    for (const id of args.match(/[A-Za-z_]\w*/g) || []) if (!entradas.has(id)) alvo.add(id);
  }
  for (let nivel = 0; nivel < 2; nivel++) {
    for (const l of linhas) {
      const m = l.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/);
      if (!m || !alvo.has(m[1])) continue;
      for (const id of m[2].match(/[A-Za-z_]\w*/g) || []) if (!entradas.has(id)) alvo.add(id);
    }
  }
  for (const e of entradas) alvo.delete(e);
  return alvo;
}

// uma linha ATRIBUI uma variável de expectativa (ou continua tal atribuição multilinha)?
function ehLinhaDeExpectativa(linha, alvo, dentroDeBloco) {
  // a linha que CHAMA a função sob teste carrega os argumentos: os literais ali são ENTRADA,
  // mesmo que a variável que recebe o retorno (`result = task_func('192.168.0.0/30', 80)`) seja
  // depois passada a uma asserção. Sem este corte, todo argumento literal virava "expectativa".
  if (/task_func\s*\(/.test(linha)) return false;
  const m = linha.match(/^\s*([A-Za-z_]\w*)\s*=/);
  if (m) return alvo.has(m[1]);
  return dentroDeBloco;  // continuação de um dicionário/lista aberto numa atribuição de expectativa
}

// Divide a suíte em métodos de teste. O `setUp` é entrada de TODOS eles — é onde `self.animals`
// nasce, e ignorá-lo faria a /191 parecer que inventa os nomes do nada.
function porTeste(linhas) {
  const blocos = []; let atual = null; const comum = [];
  for (const l of linhas) {
    const m = l.match(/^\s*def\s+(\w+)\s*\(/);
    if (m) { atual = { nome: m[1], linhas: [] }; if (/^(setUp|setUpClass)$/.test(m[1])) atual.comum = true; blocos.push(atual); continue; }
    if (atual) atual.linhas.push(l);
  }
  for (const b of blocos) if (b.comum) comum.push(...b.linhas);
  return { testes: blocos.filter((b) => /^test/.test(b.nome)), comum };
}

// existe um teste em que o literal está na EXPECTATIVA e não na ENTRADA (nem no setUp)?
function apareceEmExpectativaSemEntrada(literal, linhas) {
  const alvo = varsDeExpectativa(linhas);
  const { testes, comum } = porTeste(linhas);
  for (const t of testes) {
    let naExpectativa = false, naEntrada = false, bloco = false;
    for (const l of t.linhas) {
      const abre = l.match(/^\s*([A-Za-z_]\w*)\s*=\s*[\[{(]\s*$/);
      if (abre) bloco = alvo.has(abre[1]);
      else if (/^\s*[\]})]/.test(l)) bloco = false;
      if (!ocorreEm(l, literal)) continue;
      if (ASSERCAO_SAIDA.test(l) || ehLinhaDeExpectativa(l, alvo, bloco)) naExpectativa = true;
      else naEntrada = true;
    }
    if (naExpectativa && !naEntrada && !comum.some((l) => ocorreEm(l, literal))) return t.nome;
  }
  return null;
}

function classifica(literal, testSrc) {
  if (SINTAXE.test(literal)) return { classe: "SINTAXE", motivo: "fragmento de sintaxe da linguagem, não dado" };
  const linhas = linhasDe(testSrc);
  const alvo = varsDeExpectativa(linhas);
  const fnSobTeste = nomeDaFuncaoSobTeste(testSrc);
  let emSpec = 0, emFixture = 0, bloco = false;
  for (const l of linhas) {
    const abre = l.match(/^\s*([A-Za-z_]\w*)\s*=\s*[\[{(]\s*$/);
    if (abre) bloco = alvo.has(abre[1]);
    else if (/^\s*[\]})]/.test(l)) bloco = false;
    if (!ocorreEm(l, literal)) continue;
    // dentro da chamada à função sob teste ⇒ é ENTRADA, mesmo que a linha seja uma asserção
    if (ASSERCAO_SAIDA.test(l) && ehArgumentoDaChamada(l, literal, fnSobTeste)) emFixture++;
    else if (ASSERCAO_SAIDA.test(l)) emSpec++;
    else if (ehLinhaDeExpectativa(l, alvo, bloco)) emSpec++;   // valor esperado ligado a uma asserção
    else if (MONTAGEM.test(l)) emFixture++;
    else emFixture++;   // fora de asserção, o default conservador é tratar como material do teste
  }
  // ⚠️ AMBOS não decide sozinho, e resolvê-lo com "SPEC prevalece" era grosseiro demais: derrubava
  // a /191, cuja solução é `{animal: 0 for animal in animals}` — genérica de forma indiscutível.
  // Lá `'Dog'` está no `setUp` E no `expected`, mas o `expected` DERIVA da entrada; mutar a suíte
  // inteira muda os dois juntos e continua coerente.
  //
  // O QUE SEPARA os dois casos é uma pergunta por TESTE: existe algum teste onde o literal aparece
  // no RESULTADO ESPERADO sem ter sido FORNECIDO na entrada? Se sim, a solução tem de o produzir de
  // conhecimento próprio — é contrato (a /614: `test_empty_input` passa `{}` e espera os cinco
  // nomes). Se não, ele sempre entra pela porta da frente — é material do teste.
  if (emSpec && emFixture) {
    const so = apareceEmExpectativaSemEntrada(literal, linhas);
    if (so) return { classe: "SPEC", motivo: `aparece no resultado esperado SEM vir na entrada (${so}) — a solução tem de o conhecer; mutá-lo quebra a spec` };
    return { classe: "FIXTURE", motivo: `aparece em expectativa e em entrada, e toda expectativa deriva do que foi fornecido — material do teste` };
  }
  if (emSpec) return { classe: "SPEC", motivo: `só em asserção sobre a saída (${emSpec}×) — é o contrato, citá-lo é cumprir` };
  return { classe: "FIXTURE", motivo: `só em montagem (${emFixture}×) — é material do teste, citá-lo é decorar` };
}

// veredito sobre uma CONVERSÃO: dado o código e a suíte, quais dos literais citados são batota?
function julgaConversao(codigo, testSrc, literaisCitados) {
  const det = literaisCitados.map((s) => ({ literal: s, ...classifica(s, testSrc) }));
  const batota = det.filter((d) => d.classe === "FIXTURE");
  const duvida = det.filter((d) => d.classe === "AMBOS");
  return {
    veredito: batota.length ? "HARDCODE" : duvida.length ? "SUSPEITO" : "LIMPO",
    detalhe: det,
    // um veredito de HARDCODE só se sustenta em literal de FIXTURE. SPEC e SINTAXE não acusam.
    razao: batota.length ? `cita ${batota.length} fixture(s): ${batota.map((d) => d.literal).slice(0, 3).join(", ")}`
      : duvida.length ? `${duvida.length} literal(is) inconclusivo(s) — precisa de leitura humana`
      : "só cita especificação e/ou sintaxe",
  };
}

module.exports = { classifica, julgaConversao };

if (require.main === module) {
  const fs = require("fs");
  const { vazou } = require("../../.mz-tmp/guard-literais.cjs");
  const B = fs.readFileSync(".mz-tmp/benches/bigcodebench.jsonl", "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const d = JSON.parse(fs.readFileSync(".mz-tmp/bcb9-mz-107-final.json", "utf8"));
  console.log("RE-JULGAMENTO dos hardcodes com o classificador:\n");
  for (const l of d.linhas.filter((x) => x.estado === "HARDCODE")) {
    const t = B.find((x) => x.task_id === l.id);
    const j = julgaConversao(l.codigo, t.test, vazou(String(l.codigo || ""), t.test));
    console.log(`${l.id.padEnd(20)} ${l.estado} → ${j.veredito.padEnd(9)} ${j.razao}`);
    for (const x of j.detalhe.slice(0, 4)) console.log(`     ${x.classe.padEnd(8)} ${JSON.stringify(x.literal).slice(0, 44)} — ${x.motivo}`);
  }
}
