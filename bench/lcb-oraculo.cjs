// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// lcb-oraculo.cjs — o invólucro de execução do LiveCodeBench, em UM lugar só.
//
// POR QUE EXTRAÍDO. Este código já teve dois defeitos graves (io.StringIO sem `.buffer` quebrando o
// idioma que o próprio prompt manda usar; resultado emitido só no fim, então um estouro apagava todo
// o diagnóstico). Ter duas cópias dele em harnesses diferentes é garantir que uma delas fique com o
// defeito de volta. O runbook do R&D nomeia o padrão: "todo conserto de instrumento é uma mudança de
// instrumento" — e duas cópias dobram a superfície onde isso acontece.
const path = require("path");

// Programa-invólucro: roda a solução contra cada caso e devolve JSON, um caso por linha.
// A solução vai em base64 para não colidir com aspas/crases do próprio código.
function montaPrograma(codigo, testes, timeoutMsG3) {
  const b64 = Buffer.from(codigo, "utf8").toString("base64");
  const casos = JSON.stringify(testes.map((t) => ({ i: String(t.input), o: String(t.output) })));
  const TMO = Math.max(4, Math.floor((Number(timeoutMsG3 || process.env.G3_TIMEOUT_MS || 60000) / 1000 - 8) / Math.max(1, testes.length)));
  // SUBPROCESSO com stdin REAL, que é o que um juiz faz. Simular a entrada foi o nono instrumento
  // silencioso desta campanha: `sys.stdin.buffer.read()` — o idioma padrão de leitura rápida, que o
  // system prompt INSTRUI — estourava AttributeError contra um io.StringIO.
  return `import base64,json,subprocess,sys,os,tempfile
SOL = base64.b64decode(${JSON.stringify(b64)}).decode("utf-8")
CASOS = json.loads(${JSON.stringify(casos)})
def norm(s):
    return "\\n".join(l.rstrip() for l in str(s).replace("\\r\\n","\\n").split("\\n")).rstrip("\\n")
d = tempfile.mkdtemp()
alvo = os.path.join(d, "sol.py")
open(alvo, "w", encoding="utf-8").write(SOL)
TMO = ${TMO}
for k, c in enumerate(CASOS):
    err = ""; got = ""
    try:
        p = subprocess.run([sys.executable, alvo], input=c["i"].encode("utf-8"),
                           capture_output=True, timeout=TMO)
        got = norm(p.stdout.decode("utf-8", "replace"))
        if p.returncode != 0:
            err = "exit " + str(p.returncode) + ": " + p.stderr.decode("utf-8", "replace").strip().split("\\n")[-1][:300]
    except subprocess.TimeoutExpired:
        err = "TIMEOUT (" + str(TMO) + "s) — solucao lenta demais para os limites"
    except BaseException as e:
        err = type(e).__name__ + ": " + str(e)[:300]
    esp = norm(c["o"])
    # ⚠️ DECIMO QUARTO INSTRUMENTO SILENCIOSO — e o mais caro, porque transforma ACERTO em erro.
    # A comparacao era "got == esp", string EXATA. O AtCoder aceita erro absoluto OU relativo <= 1e-6
    # (nota: aspas simples aqui de proposito — este bloco vive DENTRO de um template literal JS, e uma
    #  crase no comentario FECHA a string. Foi o que aconteceu na primeira versao desta edicao.)
    # em resposta de ponto flutuante. Medido no abc350_e: 11 tentativas em 3 corridas, TODAS 2/3, e o
    # caso que reprovava tinha erro relativo 7.4e-16 — ou EXATAMENTE ZERO, isto e, numeros identicos
    # com strings diferentes (6418410657.7408381 contra 6418410657.740842819213867). A tarefa estava
    # resolvida desde a primeira tentativa e o oraculo a rejeitou onze vezes, aparecendo no placar
    # como "o modelo nao resolve".
    # Alcance auditado: 20 casos de teste em 4 tarefas (abc324_f abc350_e abc385_f abc327_e).
    # A comparacao numerica so entra quando AMBOS os lados parseiam como float E ha ponto decimal no
    # gabarito — resposta inteira continua exigindo igualdade exata, senao 1 e 1.0000001 passariam.
    ok = (err == "" and got == esp)
    if not ok and err == "":
        ge, gg = esp.split(), got.split()
        if len(ge) == len(gg) and any("." in t for t in ge):
            try:
                ok = all(abs(float(a) - float(b)) <= 1e-6 or
                         abs(float(a) - float(b)) <= 1e-6 * max(1.0, abs(float(a)))
                         for a, b in zip(ge, gg))
            except ValueError:
                ok = False
    # UMA LINHA POR CASO, emitida na hora: se o orcamento do G3 estourar no meio, o que ja rodou
    # continua legivel. Antes o resultado saia so no fim e um estouro apagava TODO o diagnostico,
    # devolvendo feedback VAZIO — e feedback vazio nao ensina: o modelo regerou o mesmo programa 3x.
    print("<<<LCB1>>>" + json.dumps({"n": k+1, "ok": ok, "err": err, "inp": c["i"][:600], "got": got[:400], "esp": esp[:400]}), flush=True)
print("<<<FIM>>>")
`;
}

// lê os casos JÁ EMITIDOS, mesmo que o invólucro tenha sido cortado no meio
function leSaida(stdout) {
  const linhas = [...String(stdout || "").matchAll(/<<<LCB1>>>(.*)/g)]
    .map((x) => { try { return JSON.parse(x[1]); } catch { return null; } }).filter(Boolean);
  return { casos: linhas, completou: /<<<FIM>>>/.test(String(stdout || "")) };
}

// o feedback carrega a ENTRADA que reprovou: sem ela o modelo tem de adivinhar a qual exemplo o caso
// corresponde, e para os casos que não aparecem no enunciado o erro é indepurável.
// ── DIFF POSICIONAL: quais TOKENS da saída divergem, não só que ela diverge ──────────────────────
// O feedback já carregava a ENTRADA que reprova desde o começo. O que ele NÃO dizia é QUAL POSIÇÃO
// da saída está errada — e em dez tarefas do resíduo isso é a informação que falta.
// Retrato: abc359_e esperava `4 5 13 14 26` e produziu `4 8 13 18 24`. O 1º e o 3º BATEM; erram o
// 2º, 4º e 5º. Uma abordagem declarada, quatro saídas distintas — assinatura de erro de índice ou
// de fronteira, não de conceito. Dizer "erre menos" não ajuda; dizer "os itens 2, 4 e 5" ajuda.
//
// ⚠️ E ISTO PRECISA DE CONTROLE. O contra-exemplo dirigido é o tratamento que o grupo D do perímetro
// recebeu, e o grupo D fechou 2 de 7 — pior que o B+E. A alavanca já foi tentada e não ordenou nada.
// A diferença é que lá o contra-exemplo era GENÉRICO (a entrada que reprova); aqui é POSICIONAL.
// Essa distinção é real mas NÃO foi medida — por isso `--diffpos on` é uma flag, para que o braço
// sem ela seja controle simultâneo em vez de comparação com corrida antiga.
function diffPosicional(esp, got) {
  const a = String(esp).trim().split(/\s+/), b = String(got).trim().split(/\s+/);
  if (a.length !== b.length) return `\nYour output has ${b.length} value(s); ${a.length} were expected.`;
  const maus = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) maus.push(i + 1);
  if (!maus.length || maus.length === a.length) return "";   // nada a apontar, ou tudo errado
  const lista = maus.slice(0, 12).join(", ") + (maus.length > 12 ? `, … (${maus.length} total)` : "");
  const certos = a.length - maus.length;
  return `\nPOSITIONS THAT DIFFER: ${lista}. The other ${certos} value(s) are CORRECT — your approach is`
    + ` right for them, so do not rewrite from scratch; find what makes exactly these positions differ.`;
}

function feedbackDe(res, total, opts) {
  const mau = res.find((r) => !r.ok);
  if (!mau) return "";
  const ent = mau.inp ? `\non this INPUT:\n${mau.inp}` : "";
  if (mau.err) return `Test ${mau.n}/${total} CRASHED: ${mau.err}${ent}`;
  const dp = (opts && opts.diffpos) ? diffPosicional(mau.esp, mau.got) : "";
  return `Test ${mau.n}/${total} produced the WRONG OUTPUT.${ent}\nexpected:\n${mau.esp}\ngot:\n${mau.got}${dp}`;
}

// ── JUIZ ESPECIAL, aplicado AQUI e não dentro do sandbox ────────────────────────────────────────
// 19 das 248 tarefas hard dizem "if there are multiple solutions, you may print any of them", e a
// comparação por string reprovava resposta válida: medido, 31 de 37 reprovações em 5 tarefas eram
// ACERTO (o abc343_e sozinho teve 12 de 13). Ver lcb-checkers.cjs.
//
// POR QUE EM JS E NÃO EM PYTHON NO INVÓLUCRO: portar os verificadores para dentro do programa que
// roda na G3 criaria uma SEGUNDA cópia da lógica — e foi exatamente assim que nasceu o 15º
// instrumento (a tolerância de float consertada no oráculo e ausente na cópia do harness). Uma
// fonte só. O invólucro continua emitindo `got`/`esp`/`inp` crus, e o julgamento acontece aqui.
//
// FAIL-CLOSED: sem verificador para a tarefa, ou verificador devolvendo `null` ("não sei julgar",
// como em "-1"/"No" que exigiriam provar inexistência), MANTÉM o veredito da comparação exata.
// Nunca aprovar por dúvida — verificador permissivo credita erro, o que é pior que o defeito.
let CHECKERS = null, APROVADOS = null;
try { CHECKERS = require("./lcb-checkers.cjs").CHECKERS; } catch (e) { CHECKERS = {}; }

// ⚠️ O AUTOTESTE VIRA PORTÃO, não aviso. Eu escrevi o verificador do abc333_e, o autoTeste apontou
// "REPROVA O PRÓPRIO GABARITO", e nada impedia que ele fosse usado assim mesmo — bastava eu não olhar
// o console. Aviso que depende de alguém ler é a mesma família dos dezessete instrumentos silenciosos.
// Agora um verificador só é aplicado se APROVAR TODOS os casos oficiais da sua tarefa. Reprovar o
// gabarito significa que quem está errado é o verificador, e ele fica de fora sozinho.
function _habilitados() {
  if (APROVADOS) return APROVADOS;
  APROVADOS = new Set();
  try {
    const fs = require("fs"), path = require("path");
    const T = {};
    for (const l of fs.readFileSync(path.join(".mz-tmp", "benches", "lcb-all.jsonl"), "utf8").split("\n").filter(Boolean)) {
      const t = JSON.parse(l); T[String(t.id)] = t;
    }
    for (const [id, fn] of Object.entries(CHECKERS)) {
      const t = T[id]; if (!t) continue;
      let mau = 0;
      for (const c of t.tests) {
        let v = null;
        try { v = fn(String(c.input), String(c.output), String(c.output)); } catch (e) { v = false; }
        if (v === false) mau++;
      }
      if (!mau) APROVADOS.add(id);
    }
  } catch (e) { APROVADOS = new Set(); }
  return APROVADOS;
}

function julga(id, casos) {
  const fn = CHECKERS && CHECKERS[String(id)];
  if (!fn) return { casos, aplicou: false };
  if (!_habilitados().has(String(id))) return { casos, aplicou: false, bloqueado: "reprova o próprio gabarito" };
  let corrigidos = 0;
  const novos = casos.map((c) => {
    if (c.ok || c.err) return c;
    let v = null;
    try { v = fn(String(c.inp || ""), String(c.got || ""), String(c.esp || "")); } catch (e) { v = null; }
    if (v === true) { corrigidos++; return Object.assign({}, c, { ok: true, por_propriedade: true }); }
    return c;
  });
  return { casos: novos, aplicou: true, corrigidos };
}

module.exports = { montaPrograma, leSaida, feedbackDe, julga };
