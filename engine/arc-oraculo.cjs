// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// ORÁCULO DE INDUÇÃO DE REGRA (capability `rule_induction`) — e o portão que o torna utilizável.
//
// ⚠️ O PROBLEMA CENTRAL, e ele decide todo o desenho.
// "O `transform` reproduz os pares de treino" é NECESSÁRIO e NÃO É SUFICIENTE. Um dicionário que
// memoriza os pares passa trivialmente:
//     def transform(g): return {str(train_in): train_out}[str(g)]
// Isso é o modo de falha que o runbook chama de "verificador permissivo credita erro" — pior que não
// ter verificador, porque produz número que parece medida. No LCB eu escrevi um checker que reprovava
// o próprio gabarito e só não o usei porque o autoteste virou PORTÃO. Aqui o risco é o simétrico:
// aprovar o que não deveria.
//
// TRÊS PORTÕES, e nenhum sozinho basta:
//   1. REPRODUÇÃO — o transform reproduz TODOS os pares de treino
//   2. ANTI-LOOKUP — nenhuma grade de saída de treino aparece LITERAL no fonte
//   3. ANTI-DEGENERADO — identidade é rejeitada quando algum par tem entrada != saída
//
// E o oráculo só é aplicado se passar no PRÓPRIO autoteste (`autoTeste` abaixo): aprovar um transform
// sabidamente bom E rejeitar identidade, lookup e o que erra um par. Verificador que não sabe reprovar
// não é verificador — é decoração que dá licença.
//
// O executor é INJETADO: o autoteste roda Python local; a produção roda na fronteira G3. Uma fonte só
// para a lógica, dois transportes.

const MARCA = "ARCIND";

// Monta o programa que roda o transform contra os pares de treino e imprime o resumo.
// Grades vão em base64/JSON para não colidir com aspas do fonte gerado.
function montaPrograma(codigo, pares) {
  // ⚠️ P0-1 (SOL#4): a versão anterior punha `_PARES` — com input E OUTPUT — no MESMO namespace
  //    que `transform`. Um programa de 4 linhas lendo `globals()['_PARES']` recebia aprovado=true,
  //    e o anti-lookup não pegava (só procura a saída como LITERAL no texto, não o acesso ao
  //    namespace). Confirmado com o exploit exacto do Sol. Correção: só a ENTRADA entra no
  //    namespace do programa; o harness compara com o output do LADO DE FORA (ver `julga`).
  //    Este molde só carrega ENTRADAS — nunca outputs.
  const entradas = pares.map((p) => p.input);
  const b64 = Buffer.from(JSON.stringify(entradas), "utf8").toString("base64");
  return String(codigo || "") + `

# --- oraculo de inducao de regra · ISOLADO (SOL#4 P0-1): só ENTRADAS aqui, nenhum gabarito ---
import base64 as _ab, json as _aj, sys as _as, traceback as _at
_ENTRADAS = _aj.loads(_ab.b64decode("${b64}").decode("utf-8"))
if "transform" not in dir():
    _as.stderr.write("o programa nao define transform(grid)\\n"); _as.exit(1)
# devolve APENAS as saídas produzidas; a comparação com o esperado é feita FORA deste processo.
_OUT = []
for _ent in _ENTRADAS:
    try:
        _g = transform([list(_l) for _l in _ent])
        _OUT.append([list(_l) for _l in _g] if isinstance(_g, list) else None)
    except BaseException:
        _OUT.append({"__erro__": _at.format_exc().strip().split("\\n")[-1][:80]})
print("${MARCA} " + _aj.dumps({"out": _OUT}))
_as.exit(0)
`;
}

function leMarca(stdout) {
  // ⚠️ `\\s*$` com flag `m` NÃO consome `\r` antes do `\n` — no Windows a linha vinha com CRLF e a
  //    marca válida era descartada. `[\\r\\n]*$` conserta. E a guarda passou a exigir `out` (formato
  //    P0-1), não `pass/total` — este último já não existe no molde isolado.
  const ms = [...String(stdout || "").matchAll(new RegExp("^" + MARCA + " (\\{.*\\})[\\r\\n]*$", "gm"))];
  if (!ms.length) return null;
  try {
    const o = JSON.parse(ms[ms.length - 1][1]);
    if (!Array.isArray(o.out)) return null;
    return o;
  } catch { return null; }
}

// PORTÃO 2 — ANTI-LOOKUP, estático. Se uma grade de SAÍDA de treino aparece literal no fonte, o
// programa não induziu a regra: ele a copiou. Normaliza espaço para não ser enganado por formatação.
function pareceLookup(codigo, pares) {
  const seco = String(codigo || "").replace(/\s+/g, "");
  const achadas = [];
  for (const [i, p] of pares.entries()) {
    // grade 1x1 é literal demais para acusar (um `return [[0]]` legítimo casaria)
    if (p.output.length * (p.output[0] || []).length <= 1) continue;
    if (seco.includes(JSON.stringify(p.output).replace(/\s+/g, ""))) achadas.push(i + 1);
  }
  return achadas;
}

// PORTÃO 3 — ANTI-DEGENERADO. Identidade reproduz os pares em que entrada == saída; se algum par tem
// entrada != saída e o programa ainda "passa", ou ele não é identidade, ou o oráculo está quebrado.
function ehIdentidadeSuspeita(pares) {
  return pares.some((p) => JSON.stringify(p.input) !== JSON.stringify(p.output));
}

// ── SONDA DE PERTURBAÇÃO — responde à pergunta do R&D: "qual mutação o anti-lookup NÃO reprova?" ──
// MEDIDO (`.mz-tmp/evasores-antilookup.cjs`): o portão estático barra 2 de 6 memorizadores. Evadem
// TUPLAS no lugar de listas, construção célula a célula, literal em base64, e achatado-e-remontado.
// Todos reproduzem os pares sem induzir regra nenhuma. O estático só vê o ingênuo.
//
// A assinatura que o estático não alcança é COMPORTAMENTAL: um memorizador está casado com as
// ENTRADAS exatas. Perturbe uma célula e ele (a) estoura, ou (b) devolve uma saída de treino
// MEMORIZADA — a do outro par.
//
// ⚠️ E aqui está o limite honesto: em produção eu NÃO SEI a resposta certa da entrada perturbada,
// então não posso checar acerto. Os dois sinais acima são os únicos verificáveis às cegas.
//
// ⚠️⚠️ POR ISSO ISTO É FLAG, NÃO PORTÃO. A taxa de FALSO POSITIVO contra soluções ARC reais é
// desconhecida — uma regra legítima sensível a forma pode estourar numa perturbação, e rejeitá-la
// perderia tarefa resolvida. Medir antes de promover a portão é a disciplina que eu exigiria do R&D;
// vale para mim. O flag entra na trilha e vira portão quando houver base.
function perturba(grade) {
  const g = grade.map((l) => l.slice());
  if (!g.length || !g[0].length) return g;
  const usados = new Set(g.flat());
  let novo = 0; while (usados.has(novo) && novo < 9) novo++;
  g[0][0] = novo;
  return g;
}

async function sondaMemorizacao(codigo, pares, exec) {
  if (!pares.length) return { suspeito: false, motivo: "sem_pares" };
  const entrada = perturba(pares[0].input);
  const saidasTreino = pares.map((p) => JSON.stringify(p.output));
  const prog = montaPrograma(codigo, [{ input: entrada, output: [] }]);
  const r = await exec(prog);
  const c = leMarca(r && r.stdout);
  if (!c) return { suspeito: true, motivo: "estourou na entrada perturbada" };
  const f = (c.falhos || [])[0] || "";
  // o invólucro reporta a FORMA do que saiu; se o programa devolveu uma grade de treino inteira, o
  // marcador não a carrega — então perguntamos direto, num segundo programa mínimo.
  const prog2 = String(codigo || "") + `

import json as _j, sys as _s
try:
    _r = transform(${JSON.stringify(entrada)})
    print("ARCPERT " + _j.dumps([[int(c) for c in l] for l in _r]))
except BaseException:
    print("ARCPERT null")
`;
  const r2 = await exec(prog2);
  const m = String((r2 && r2.stdout) || "").match(/^ARCPERT (.*)$/m);
  if (!m || m[1] === "null") return { suspeito: true, motivo: "estourou na entrada perturbada" };
  if (saidasTreino.includes(m[1].replace(/\s+/g, ""))) {
    return { suspeito: true, motivo: "devolveu uma saída de TREINO para entrada que não é de treino" };
  }
  return { suspeito: false, motivo: "sobrevive à perturbação", ignore: f };
}

// ── GRADIENTE — o sinal que faltava, e o cuidado que ele exige ──────────────────────────────────
// MEDIDO (sonda-p5-assinatura v2, N=3 tarefas, k=4): no AGI-2 os draws frios produzem 3 hipóteses
// DISTINTAS em 3 válidos — o modelo NÃO está preso a um entendimento, ele gera um entendimento
// diferente a cada vez. E o MZ-Eng rodou o controle positivo (hhhh·Z): em codegen, onde a compreensão
// está travada de facto, o mesmo discriminador dá 1–2 assinaturas em 4. Ele discrimina.
// Logo a trilha imóvel `0/4 → 0/4 → 0/4` não é compreensão presa: é SINAL SURDO. `0/N` não ordena
// nada, e o laço de reparo recebe "errou tudo" quatro vezes — informação zero.
//
// ⚠️ RISCO PRÉ-REGISTRADO PELO MZ-Eng, e ele é real: em ARC a solução é DESCONTÍNUA. 90% das células
// certas pode estar MAIS LONGE da regra do que uma hipótese "pior" que acertou a estrutura. Um
// gradiente que ordena mal é bússola quebrada — pior que nenhuma, porque dá direção com confiança.
// Por isso o gradiente NÃO entra no laço antes de medir o seu poder de ordenação fora da amostra
// (`estudo-ordenacao-gradiente.cjs`), e NUNCA entra no veredito.
function resumeGradiente(grad) {
  if (!Array.isArray(grad) || !grad.length) return null;
  const celOk = grad.reduce((a, g) => a + (g.cel_ok || 0), 0);
  const celTot = grad.reduce((a, g) => a + (g.cel_tot || 0), 0);
  const formas = grad.filter((g) => g.forma_ok).length;
  return {
    // as três facetas são reportadas SEPARADAS de propósito: colapsá-las num escalar único é o
    // convite ao Goodhart. Quem consumir decide o peso, e o estudo de ordenação decide se pode.
    formas_ok: formas, nPares: grad.length,
    cel_ok: celOk, cel_tot: celTot,
    cel_frac: celTot > 0 ? Number((celOk / celTot).toFixed(4)) : null,
    por_par: grad,
  };
}

// gradiente de célula, do lado de fora (era `_mede` no Python; migrou com o P0-1). ADITIVO — nunca
// entra no veredito, só diagnostica.
function medeCel(got, exp) {
  if (!Array.isArray(got) || !got.length || !Array.isArray(got[0])) return { forma_ok: false, cel_ok: 0, cel_tot: 0, erro: "saida nao e grade" };
  const er = exp.length, ec = exp[0] ? exp[0].length : 0;
  const fr = got.length, fc = got[0] ? got[0].length : 0;
  if (fr !== er || fc !== ec) return { forma_ok: false, cel_ok: 0, cel_tot: er * ec, forma: [fr, fc], esperada: [er, ec] };
  let ok = 0;
  for (let a = 0; a < er; a++) for (let b = 0; b < ec; b++) if (got[a][b] === exp[a][b]) ok++;
  return { forma_ok: true, cel_ok: ok, cel_tot: er * ec };
}

// `exec(programa) -> {stdout, stderr, exit_code}`. Injetado: Python local no autoteste, G3 na produção.
async function julga(codigo, pares, exec) {
  if (!codigo || !String(codigo).trim()) return { aprovado: false, motivo: "sem_programa", nPass: null, nTotal: null };
  const lookup = pareceLookup(codigo, pares);
  if (lookup.length) {
    return { aprovado: false, motivo: "lookup: saída do par " + lookup.join(",") + " literal no fonte", nPass: null, nTotal: pares.length };
  }
  const r = await exec(montaPrograma(codigo, pares));
  const c = leMarca(r && r.stdout);
  if (!c || !Array.isArray(c.out)) {
    // sem marcador: o programa morreu antes de reportar. NÃO SEI, e não-sei não é reprovação do
    // transform — é ausência de veredito. Mesmo corte do `infra` no verifyG3.
    return { aprovado: false, motivo: "sem_veredito", nPass: null, nTotal: pares.length,
             detalhe: String((r && r.stderr) || "").slice(-300) };
  }
  // ⚠️ P0-1 (SOL#4): a COMPARAÇÃO acontece AQUI, fora do processo do programa. O Python só devolveu
  //    saídas; os `output` esperados nunca saíram deste namespace Node. Um programa que leia o seu
  //    próprio namespace não encontra gabarito nenhum — não há gabarito lá.
  const grad = [], falhos = [];
  let pass = 0;
  const iguais = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((l, i) => Array.isArray(l) && Array.isArray(b[i]) && l.length === b[i].length
      && l.every((v, j) => v === b[i][j]));
  for (let i = 0; i < pares.length; i++) {
    const got = c.out[i], exp = pares[i].output;
    if (got && got.__erro__) { falhos.push(`par ${i + 1}: ${got.__erro__}`); grad.push({ forma_ok: false, cel_ok: 0, cel_tot: 0, erro: "excecao" }); continue; }
    if (iguais(got, exp)) { pass++; grad.push(medeCel(got, exp)); }
    else {
      falhos.push(`par ${i + 1}: forma ${got ? got.length + 'x' + (got[0] ? got[0].length : 0) : 'nao-grade'}, esperada ${exp.length}x${exp[0] ? exp[0].length : 0}`);
      grad.push(medeCel(got, exp));
    }
  }
  const todos = pass === pares.length && pares.length > 0;
  return { aprovado: todos, motivo: todos ? "ok" : "reprova " + (pares.length - pass) + " par(es)",
           nPass: pass, nTotal: pares.length, falhos: falhos.slice(0, 8), gradiente: resumeGradiente(grad.slice(0, 16)) };
}

// ── AUTOTESTE — o portão que torna o oráculo aplicável ──────────────────────────────────────────
// Doutrina herdada do LCB: verificador só entra se APROVAR o que deve e REPROVAR o que não deve.
// Aqui o risco é aprovar demais, então três dos quatro casos são negativos.
async function autoTeste(exec) {
  const pares = [
    { input: [[1, 2], [3, 4]], output: [[2, 4], [6, 8]] },
    { input: [[0, 5], [1, 1]], output: [[0, 10], [2, 2]] },
  ];
  const BOM = "def transform(g):\n    return [[c * 2 for c in l] for l in g]\n";
  const IDENT = "def transform(g):\n    return g\n";
  const LOOKUP = "def transform(g):\n    t = {str([[1, 2], [3, 4]]): [[2, 4], [6, 8]], str([[0, 5], [1, 1]]): [[0, 10], [2, 2]]}\n    return t[str(g)]\n";
  // ⚠️ ESTE CASO PRECISA ERRAR EXATAMENTE UM PAR — é a fronteira que interessa: o oráculo rejeita
  // acerto PARCIAL? A primeira versão (`[:1] + [[0,0]]`) errava os DOIS, então o rótulo mentia e o
  // caso era redundante com a identidade. Aqui o `5` só existe no par 2: o par 1 passa, o 2 não.
  const QUASE = "def transform(g):\n    return [[(99 if c == 5 else c * 2) for c in l] for l in g]\n";

  const casos = [
    ["transform CORRETO", BOM, true, { nPass: 2 }],
    ["identidade", IDENT, false, { nPass: 0 }],
    ["lookup dos pares", LOOKUP, false, {}],          // barrado antes de rodar, sem contagem
    ["erra EXATAMENTE 1 par", QUASE, false, { nPass: 1 }],
  ];
  const linhas = []; let falhas = 0;
  for (const [nome, prog, esperado, exp] of casos) {
    const v = await julga(prog, pares, exec);
    // não basta o veredito bater: a CONTAGEM tem de bater também. Um oráculo que reprova tudo
    // acertaria três dos quatro vereditos e não estaria medindo nada.
    const contagemOk = exp.nPass === undefined || v.nPass === exp.nPass;
    const ok = v.aprovado === esperado && contagemOk;
    if (!ok) falhas++;
    linhas.push(`  ${ok ? "ok    " : "FALHA "}${nome.padEnd(22)} aprovado=${v.aprovado} (esperado ${esperado})`
      + (exp.nPass !== undefined ? `  nPass=${v.nPass}/${exp.nPass}` : "") + `  ${v.motivo}`);
  }
  if (!ehIdentidadeSuspeita(pares)) { falhas++; linhas.push("  FALHA os pares do autoteste não distinguem identidade"); }
  return { ok: falhas === 0, falhas, relatorio: linhas.join("\n") };
}

module.exports = { montaPrograma, leMarca, pareceLookup, sondaMemorizacao, julga, autoTeste, MARCA };
