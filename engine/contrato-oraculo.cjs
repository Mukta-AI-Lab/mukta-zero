// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// ORÁCULO EXTRAÍDO POR MÁQUINA A PARTIR DO CONTRATO DO ENUNCIADO.
//
// ⚠️ POR QUE ISTO SUBSTITUI OS CASOS INVENTADOS PELO MODELO. Medido em 2026-08-07, na condição do
// produto: das 5 tarefas, 4 tinham solução que passa a suíte OFICIAL, e o oráculo que o próprio
// modelo derivou REPROVOU 3 delas. As causas não eram do código:
//     OSError (caminho falso do doctest) · NameError (variável que não existe) ·
//     AttributeError (caminho de import errado) · SyntaxError (defeito do meu extractor)
// Descartar os casos partidos parou de destruir código certo, mas deixou o oráculo VAZIO ou frouxo
// — e um oráculo que não decide não fecha nada.
//
// 🎯 É O MESMO PRINCÍPIO QUE FEZ O ENUMERADOR FUNCIONAR: **a máquina extrai, o modelo não inventa.**
// Enquanto o modelo escrevia o programa de busca, ele podia medir o valor esperado e cravá-lo;
// enquanto escreve o oráculo, ele pode escrever o teste que a sua própria solução passa. Nos dois
// casos a saída é a mesma — confiança fabricada.
//
// O contrato ESTÁ no enunciado e não precisa de adivinhação. Medido em 300 enunciados do
// BigCodeBench: `Returns:` em 300, doctest em 300, `Raises:` em 99.

// mapa de nome-de-tipo do docstring → expressão isinstance executável
const TIPOS = {
  DataFrame: "pd.DataFrame", Series: "pd.Series", ndarray: "np.ndarray",
  Axes: "matplotlib.axes.Axes", Figure: "matplotlib.figure.Figure",
  list: "list", dict: "dict", tuple: "tuple", str: "str", int: "int",
  float: "float", bool: "bool", set: "set", bytes: "bytes",
};

// assinatura: nome da função e se TODOS os parâmetros têm valor por omissão
function assinatura(prompt) {
  const m = String(prompt).match(/^\s*def\s+(\w+)\s*\(([^)]*)\)/m);
  if (!m) return null;
  const params = m[2].split(",").map((s) => s.trim()).filter(Boolean);
  const todosComDefault = params.length === 0 || params.every((p) => p.includes("="));
  return { nome: m[1], params, todosComDefault };
}

// o bloco `Returns:` até à próxima secção
// ⚠️ `$` COM A FLAG `m` CASA FIM DE LINHA, não fim de texto — e por isso o bloco `Returns:`
// terminava na PRIMEIRA linha. Medido na /45, cujo retorno declara duas entradas:
//     Returns:
//         DataFrame: …
//         Axes: …
// Eu via só a primeira, emitia `isinstance(task_func(df), pd.DataFrame)` para uma função que
// devolve um par, e produzia um FALSO-NEGATIVO contra código correto. O fim de texto é `(?![\s\S])`.
function blocoReturns(prompt) {
  const m = String(prompt).match(/^[ \t]*Returns:[ \t]*\n([\s\S]*?)(?=\n[ \t]*(Raises|Requirements|Example|Notes?|Parameters):|\n[ \t]*"""|(?![\s\S]))/m);
  return m ? m[1] : "";
}

// a tarefa consome aleatoriedade? (import, Requirements, ou parâmetro de semente na assinatura)
function ehAleatoria(prompt) {
  const P = String(prompt);
  return /^\s*(import|from)\s+(random|numpy)\b/m.test(P)
    || /^\s*-\s*(random|numpy\.random)\b/m.test(P)
    || /\b(seed|random_state)\s*[=:)]/.test((P.match(/^\s*def\s+\w+\s*\(([^)]*)\)/m) || ["", ""])[1]);
}

function contratoDoEnunciado(prompt) {
  const casos = [];
  const notas = [];
  const aleatoria = ehAleatoria(prompt);
  const sig = assinatura(prompt);
  if (!sig) return { casos, notas: ["sem assinatura reconhecível"] };
  const fn = sig.nome;

  // ── 1 · SMOKE DA ASSINATURA ────────────────────────────────────────────────────────────────
  // Se todos os parâmetros têm valor por omissão, `task_func()` TEM de correr. Isto não é uma
  // expectativa sobre o comportamento — é o contrato mínimo da própria assinatura que o enunciado
  // escreveu, e apanha import em falta, erro de sintaxe e explosão trivial.
  if (sig.todosComDefault) {
    casos.push({ fonte: "assinatura", codigo: `${fn}()` , tipo: "smoke" });
    notas.push("smoke: todos os parâmetros têm default, logo a chamada nua tem de correr");
  }

  // ── 2 · ARIDADE E TIPO DO RETORNO ──────────────────────────────────────────────────────────
  const ret = blocoReturns(prompt);
  if (ret && sig.todosComDefault) {
    // `Returns:\n    tuple:\n        a (X): …\n        b (Y): …`  ⇒ tupla de N
    const mTupla = ret.match(/^\s*tuple\s*:/m);
    if (mTupla) {
      const sub = [...ret.matchAll(/^\s{6,}\w+\s*\(([^)]+)\)\s*:/gm)];
      if (sub.length >= 2) {
        casos.push({ fonte: "contrato", codigo: `isinstance(${fn}(), tuple) and len(${fn}()) == ${sub.length}`, tipo: "aridade" });
        notas.push(`retorno declarado: tupla de ${sub.length}`);
      } else {
        casos.push({ fonte: "contrato", codigo: `isinstance(${fn}(), tuple)`, tipo: "tipo" });
      }
    } else {
      // ⚠️ VÁRIAS ENTRADAS DE TOPO SÃO UMA TUPLA, mesmo sem o cabeçalho `tuple:`. Medido na /45:
      //     Returns:
      //         DataFrame: …
      //         Axes: …
      // O parser lia a PRIMEIRA e emitia `isinstance(task_func(df), pd.DataFrame)` — que é falso
      // para uma função que devolve um par, e produzia um FALSO-NEGATIVO contra código correto.
      // Ler só a primeira de uma lista é a mesma família do «verifiquei um número da conjunção».
      const topo = [...ret.matchAll(/^\s{2,6}(\w+)\s*:/gm)].map((x) => x[1]).filter((n) => TIPOS[n]);
      if (topo.length >= 2) {
        casos.push({ fonte: "contrato", codigo: `isinstance(${fn}(), tuple) and len(${fn}()) == ${topo.length}`, tipo: "aridade" });
        notas.push(`retorno declarado: ${topo.length} valores (${topo.join(", ")})`);
      } else if (topo.length === 1) {
        casos.push({ fonte: "contrato", codigo: `isinstance(${fn}(), ${TIPOS[topo[0]]})`, tipo: "tipo" });
        notas.push(`retorno declarado: ${topo[0]}`);
      }
    }
  }

  // ── 2b · A SESSÃO DO DOCTEST DÁ OS ARGUMENTOS QUE A ASSINATURA NÃO TEM ─────────────────────
  // ⚠️ MEDIDO: exigir que TODOS os parâmetros tenham default deixou 10 de 24 tarefas «sem contrato
  // extraível» — e a cobertura era o único limite do instrumento, já que onde ele decide acerta
  // 8 em 8. O enunciado traz os argumentos no próprio exemplo:
  //     >>> df = pd.DataFrame(...)
  //     >>> task_func(df, 'col')
  // As linhas `>>>` anteriores são a MONTAGEM, e a última é a chamada. Reconstruir a sessão dá
  // smoke e verificação de tipo a tarefas cuja assinatura exige argumentos — sem inventar nada:
  // tudo o que se usa está escrito no enunciado.
  const linhasDoc = [];
  {
    const L2 = String(prompt).split("\n");
    for (let i = 0; i < L2.length; i++) {
      const mm = L2[i].match(/^\s*(?:>>>|\.\.\.)\s?(.*)$/);
      if (mm) linhasDoc.push(mm[1]);
    }
  }
  const chamadaNoDoc = [...linhasDoc].reverse().find((l) => new RegExp(`(?<![\\w.])${fn}\\s*\\(`).test(l));
  if (!sig.todosComDefault && chamadaNoDoc) {
    // ⚠️ UMA LINHA TERMINADA EM `\` NÃO É UMA INSTRUÇÃO — É METADE DE UMA. Medido na /604: a
    // montagem saía `with open('x.cpp', 'x') as f: \` e mais nada, porque a continuação vinha depois
    // da chamada e eu cortava a lista ali. Isso nunca compila, TODAS as entradas morriam antes de
    // rodar, e o veredito ficava `NAO-MEDIDA` — que eu lia como «o juiz não opinou» quando a
    // verdade era «eu nunca lhe dei nada para julgar».
    // Junta-se a continuação quando ela existe; quando não existe, descarta-se a metade, porque
    // meia instrução não é best-effort, é erro garantido.
    const brutas = linhasDoc.slice(0, linhasDoc.indexOf(chamadaNoDoc)).filter((l) => l.trim() && !new RegExp(`(?<![\\w.])${fn}\\s*\\(`).test(l));
    const montagem = [];
    for (const l of brutas) {
      if (montagem.length && /\\\s*$/.test(montagem[montagem.length - 1])) {
        montagem[montagem.length - 1] = montagem[montagem.length - 1].replace(/\\\s*$/, "") + " " + l.trim();
      } else montagem.push(l);
    }
    while (montagem.length && /\\\s*$/.test(montagem[montagem.length - 1])) montagem.pop();
    // ⚠️ EXTRAIR A CHAMADA EXIGE CONTAR PARÊNTESES. Levar «tudo a partir do nome» produziu
    // `task_func(data))` a partir de `>>> print(task_func(data))` — um parêntese a mais, e o caso
    // morria em SyntaxError. Comparar por aparência em vez de por estrutura, outra vez.
    const expr = (() => {
      const i = chamadaNoDoc.search(new RegExp(`(?<![\\w.])${fn}\\s*\\(`));
      if (i < 0) return "";
      const abre = chamadaNoDoc.indexOf("(", i);
      let n = 0, aspa = null;
      for (let k = abre; k < chamadaNoDoc.length; k++) {
        const c = chamadaNoDoc[k];
        if (aspa) { if (c === "\\") k++; else if (c === aspa) aspa = null; continue; }
        if (c === '"' || c === "'") { aspa = c; continue; }
        if (c === "(") n++;
        else if (c === ")") { n--; if (n === 0) return chamadaNoDoc.slice(i, k + 1).trim(); }
      }
      return "";
    })();
    if (expr) {
      casos.push({ fonte: "enunciado", codigo: expr, tipo: "smoke", montagem });
      notas.push("smoke reconstruído da sessão do doctest (assinatura exige argumentos)");
      const ret2 = blocoReturns(prompt);
      if (ret2) {
        // mesma leitura do bloco 2: VÁRIAS entradas de topo são uma tupla, mesmo sem `tuple:`
        const topo2 = /^\s*tuple\s*:/m.test(ret2)
          ? [...ret2.matchAll(/^\s{6,}\w+\s*\(([^)]+)\)\s*:/gm)].map((x) => x[1])
          : [...ret2.matchAll(/^\s{2,6}(\w+)\s*:/gm)].map((x) => x[1]).filter((n2) => TIPOS[n2]);
        if (topo2.length >= 2) casos.push({ fonte: "contrato", codigo: `isinstance(${expr}, tuple) and len(${expr}) == ${topo2.length}`, tipo: "aridade", montagem });
        else if (topo2.length === 1 && TIPOS[topo2[0]]) casos.push({ fonte: "contrato", codigo: `isinstance(${expr}, ${TIPOS[topo2[0]]})`, tipo: "tipo", montagem });
      }
    }
  }

  // ── 2c · `Raises:` — A ÚNICA PARTE DO CONTRATO QUE FALA DE COMPORTAMENTO ───────────────────
  // ⚠️ POR QUE ISTO É O PASSO SEGUINTE, e não mais cobertura do mesmo: o oráculo até aqui verifica
  // *se corre*, *que tipo devolve* e *quantos valores devolve* — e NENHUMA dessas é sobre estar
  // certo. Medido: a /944 passa o smoke (a função corre) e reprova 4/5 na suíte oficial (a lógica
  // está errada). Um oráculo assim aprova código errado, e foi por isso que o laço nunca reparou.
  //
  // `Raises:` aparece em 130 de 400 enunciados e afirma COMPORTAMENTO: «ValueError se n_components
  // não for um inteiro positivo» distingue uma implementação certa de uma errada.
  //
  // 🎯 E O GATILHO NÃO SE PEDE AO MODELO. Pedir-lhe que construa a entrada que dispara a excepção
  // reintroduziria exatamente o defeito que acabei de remover — quando o gatilho está errado, o
  // teste falha contra código CORRETO, e isso é um falso-negativo que o laço transforma em
  // reescrita. Só entram as condições cujo gatilho é **inequívoco e mecânico**: parâmetro NOMEADO
  // na assinatura, e uma violação que só tem uma leitura.
  const VIOLACOES = [
    { re: /['"`]?(\w+)['"`]?\s+is\s+None(\s+or\s+(an\s+)?empty)?/i, valor: "None", nome: "None" },
    { re: /['"`]?(\w+)['"`]?\s+is\s+not\s+a\s+positive\s+integer/i, valor: "0", nome: "não-positivo" },
    { re: /['"`]?(\w+)['"`]?\s+is\s+(a\s+)?negative/i, valor: "-1", nome: "negativo" },
    { re: /['"`]?(\w+)['"`]?\s+is\s+not\s+an?\s+(pandas\s+)?DataFrame/i, valor: "42", nome: "tipo errado" },
    { re: /['"`]?(\w+)['"`]?\s+is\s+not\s+an?\s+list/i, valor: "42", nome: "tipo errado" },
    { re: /['"`]?(\w+)['"`]?\s+is\s+not\s+an?\s+(str|string)/i, valor: "42", nome: "tipo errado" },
    { re: /['"`]?(\w+)['"`]?\s+is\s+(an\s+)?empty(\s+(list|string|dict))?/i, valor: "[]", nome: "vazio" },
  ];
  const mRaises = String(prompt).match(/^[ \t]*Raises:[ \t]*\n([\s\S]*?)(?=\n[ \t]*(Returns|Requirements|Example|Notes?|Parameters):|\n[ \t]*"""|(?![\s\S]))/m);
  // ⚠️ EXIGIR QUE TODOS OS PARÂMETROS TENHAM DEFAULT DEIXOU 1 TAREFA EM 400 — a cobertura era o
  // único limite, tal como no smoke. A chamada do doctest dá os outros argumentos; basta juntar o
  // parâmetro violado como PALAVRA-CHAVE. Mas só é seguro se ele não estiver já lá: os argumentos
  // POSICIONAIS do doctest ligam-se aos primeiros parâmetros da assinatura, e juntar `x=…` a um `x`
  // já passado posicionalmente dá `TypeError: got multiple values` — que o meu portão leria como
  // «gatilho inválido» e descartaria em silêncio, perdendo o caso sem dizer porquê.
  // Por isso conta-se quantos posicionais o doctest passa e só se aceita parâmetro de índice ≥ esse.
  const baseChamada = (() => {
    if (sig.todosComDefault) return { prefixo: "", posicionais: 0 };
    const alvo = casos.find((c) => c.tipo === "smoke" && c.montagem);
    if (!alvo) return null;
    const dentro = String(alvo.codigo).slice(String(alvo.codigo).indexOf("(") + 1, -1).trim();
    if (!dentro) return { prefixo: "", posicionais: 0, argsTop: [], montagem: alvo.montagem };
    // parte por vírgula de NÍVEL ZERO — `f(a, g(x, y), b)` são três argumentos, não quatro
    const argsTop = []; let nivel = 0, aspa = null, ini = 0;
    for (let i = 0; i < dentro.length; i++) {
      const ch = dentro[i];
      if (aspa) { if (ch === "\\") i++; else if (ch === aspa) aspa = null; continue; }
      if (ch === '"' || ch === "'") { aspa = ch; continue; }
      if ("([{".includes(ch)) nivel++;
      else if (")]}".includes(ch)) nivel--;
      else if (ch === "," && nivel === 0) { argsTop.push(dentro.slice(ini, i).trim()); ini = i + 1; }
    }
    argsTop.push(dentro.slice(ini).trim());
    const posicionais = argsTop.filter((a) => !/^\w+\s*=(?!=)/.test(a)).length;
    return { prefixo: dentro + ", ", posicionais, argsTop, montagem: alvo.montagem };
  })();
  if (mRaises && baseChamada) {
    const nomesParam = sig.params.map((p) => p.split("=")[0].trim());
    const vistos = new Set();
    for (const linha of mRaises[1].split("\n")) {
      const c = linha.trim();
      if (!c) continue;
      const mExc = c.match(/^(\w*(?:Error|Exception))\b/);
      if (!mExc) continue;
      const exc = mExc[1];
      // ⚠️ uma linha com «X or Y» declara DUAS condições e um gatilho só não as cobre — nesse caso
      // testa-se apenas a primeira, e o registo di-lo. Fingir que uma verificação cobre duas é a
      // mesma família do «verifiquei um número da conjunção e herdei o outro».
      for (const v of VIOLACOES) {
        const mm = c.match(v.re);
        if (!mm) continue;
        const param = mm[1];
        const idx = nomesParam.indexOf(param);
        if (idx < 0 || vistos.has(param)) continue;
        // ⚠️ SALTAR O PARÂMETRO POSICIONAL CUSTAVA 17 DOS 20 CASOS. Juntá-lo por palavra-chave daria
        // `got multiple values`; o que se faz é SUBSTITUIR o argumento posicional correspondente na
        // chamada do exemplo. Os posicionais ligam-se por ordem aos primeiros parâmetros da
        // assinatura, logo o índice é conhecido e a substituição é mecânica — não há adivinhação.
        // ⚠️ TRÊS SITUAÇÕES, e fundir duas delas gera argumento DUPLICADO. Apanhado ao ler a saída:
        // a /84 saiu `task_func(products, n_samples=50, …, n_samples=0)` — o parâmetro já ia como
        // NOMEADO no exemplo, e eu acrescentei outro igual. `n_samples=50` diz «não-positivo» na
        // etiqueta e leva 50 no código: um caso que se contradiz a si próprio e morreria em
        // SyntaxError, descartado em silêncio.
        const partes = baseChamada.argsTop || [];
        const iNomeado = partes.findIndex((a) => new RegExp(`^${param}\\s*=(?!=)`).test(a));
        let chamadaArgs;
        if (iNomeado >= 0) {                       // já vai nomeado ⇒ substitui-se o valor
          const novos = partes.slice(); novos[iNomeado] = `${param}=${v.valor}`;
          chamadaArgs = novos.join(", ");
        } else if (idx < baseChamada.posicionais) { // vai posicional ⇒ substitui-se a posição
          if (idx >= partes.length) { notas.push(`Raises sobre '${param}': não localizei o argumento posicional`); continue; }
          const novos = partes.slice(); novos[idx] = v.valor;
          chamadaArgs = novos.join(", ");
        } else {                                    // não vai de todo ⇒ acrescenta-se
          chamadaArgs = `${baseChamada.prefixo}${param}=${v.valor}`;
        }
        vistos.add(param);
        casos.push({
          fonte: "contrato", tipo: "raises",
          codigo: `__levanta(lambda: ${fn}(${chamadaArgs}), ${exc})`,
          detalhe: `${exc} quando ${param} é ${v.nome}`,
          montagem: baseChamada.montagem,
        });
        break;
      }
    }
    if (vistos.size) notas.push(`Raises: ${vistos.size} condição(ões) com gatilho mecânico`);
  }

  // ── 3 · DOCTESTS, mas só os EXECUTÁVEIS ────────────────────────────────────────────────────
  // ⚠️ o fecho da docstring vira «valor esperado» se não for excluído (produziu `== (""")`), e
  // doctests com caminhos falsos não correm no sandbox (OSError com cara de defeito do modelo).
  const L = String(prompt).split("\n");
  for (let i = 0; i < L.length - 1; i++) {
    const m = L[i].match(/^\s*>>>\s+(.+?)\s*$/);
    if (!m) continue;
    const e = String(L[i + 1] || "").trim();
    if (!e || /^>>>/.test(e) || /^("""|''')/.test(e)) continue;
    if (!/^[-+]?[\d.]|^["'[{(]|^(True|False|None)\b/.test(e)) continue;
    if (/['"]\/(path|home|var|etc|usr)\//.test(m[1])) { notas.push("doctest com caminho falso, ignorado"); continue; }
    // ⚠️ `>>> print(x)` COMPARA STDOUT, não o valor devolvido — e `print(...)` devolve `None`.
    // Medido na /902: gerava `(print(task_func(data))) == ({'x': Counter(...)})`, falso por
    // construção, e o oráculo reprovava uma solução que passa 5/5 na suíte oficial. O doctest
    // estava certo; a minha tradução dele para um `==` é que era errada.
    if (/^\s*print\s*\(/.test(m[1])) { notas.push("doctest com print() compara stdout, ignorado"); continue; }
    // ⚠️ NUMA FUNÇÃO ALEATÓRIA O DOCTEST É UMA ILUSTRAÇÃO, NÃO UMA EXPECTATIVA. Medido na /1 em
    // 2026-08-07: a solução passa 3/3 na suíte OFICIAL e o oráculo reprovou-a durante TRÊS rondas
    // por causa de
    //     >>> task_func(10)
    //     {'h': 1, 'B': 2, 'O': 1, …}
    // que é UMA amostra de letras sorteadas. Nenhuma implementação correta a reproduz. Eu tratava
    // todo `>>> expr` + literal como igualdade e transformei uma ilustração numa afirmação que ela
    // nunca foi — a mesma família de erro que este ficheiro inteiro existe para não repetir, e
    // desta vez a produzir o modo de falha PERIGOSO: reescrever código certo.
    //
    // A deteção é mecânica: a tarefa consome aleatoriedade (Requirements/imports com `random` ou
    // `numpy.random`, ou parâmetro de semente) E a chamada do exemplo não fixa semente. Havendo
    // semente explícita na chamada, o resultado é reprodutível e o doctest volta a valer.
    if (aleatoria && !/(seed|random_state)\s*=/.test(m[1])) { notas.push("doctest de função aleatória sem semente: é ilustração, não expectativa"); continue; }
    casos.push({ fonte: "enunciado", codigo: `(${m[1]}) == (${e})`, tipo: "doctest" });
  }

  return { casos, notas };
}

// monta o programa: cada caso corre isolado, e um caso que NÃO CORRE é descartado, nunca reprovado
function programaDoContrato(codigo, casos) {
  const exprs = casos.map((c) => c.codigo);
  const fontes = casos.map((c) => `${c.fonte}/${c.tipo}`);
  // a MONTAGEM da sessão do doctest corre uma vez, antes dos casos — são as linhas `>>>` que
  // definem os argumentos, e sem elas a chamada reconstruída morre em NameError (que seria
  // descartado, mas descartar por falta de montagem é perder cobertura por preguiça minha)
  const montagem = [...new Set(casos.flatMap((c) => c.montagem || []))];
  return [
    "try:\n    import pandas as pd\nexcept Exception:\n    pd = None",
    "try:\n    import numpy as np\nexcept Exception:\n    np = None",
    "try:\n    import matplotlib, matplotlib.axes, matplotlib.figure\nexcept Exception:\n    pass",
    // ⚠️ O TESTE DE `Raises:` TEM DE DISTINGUIR TRÊS DESFECHOS, e fundir dois deles daria falso
    // veredito: levantou a excepção CERTA (contrato cumprido) · não levantou nada (contrato
    // violado) · levantou OUTRA coisa (o gatilho pode estar errado — não se acusa a solução).
    // O terceiro é o caso perigoso: um `TypeError` porque o parâmetro nem existe seria lido como
    // «a solução não valida» quando o defeito é do meu gatilho.
    "def __levanta(f, exc):",
    "    try:",
    "        f()",
    "    except exc:",
    "        return True",
    "    except BaseException as _e:",
    "        raise NameError('gatilho invalido: levantou %s e nao %s' % (type(_e).__name__, exc.__name__))",
    "    return False",
    codigo, "",
    ...(montagem.length ? [
      "# montagem vinda da sessão do doctest do enunciado (best-effort: se falhar, os casos que",
      "# dependerem dela caem em NameError e são DESCARTADOS, nunca contados como reprovação)",
      "try:",
      ...montagem.map((l) => "    " + l),
      "except BaseException as _e:",
      "    print('MONTAGEM FALHOU :: %s' % (type(_e).__name__ + ': ' + str(_e)[:140]))",
      "",
    ] : []),
    `_E = ${JSON.stringify(exprs)}`,
    `_F = ${JSON.stringify(fontes)}`,
    "_QUEBRADO = ('NameError','SyntaxError','ImportError','ModuleNotFoundError','AttributeError','OSError','FileNotFoundError','PermissionError','IndentationError')",
    "_p = 0; _val = 0",
    "for _i, _c in enumerate(_E):",
    "    try:",
    "        _r = eval(_c, globals())",
    "        _val += 1",
    "        if _r is False:",
    "            print('CONTRATO %d VIOLADO :: %s :: %s' % (_i, _F[_i], _c[:140]))",
    "        else:",
    "            _p += 1",
    "    except AssertionError as _e:",
    "        _val += 1; print('CONTRATO %d VIOLADO :: %s :: %s' % (_i, _F[_i], _c[:140]))",
    "    except BaseException as _e:",
    "        _t = type(_e).__name__",
    "        if _t in _QUEBRADO:",
    "            print('CONTRATO %d DESCARTADO :: %s :: %s :: %s' % (_i, _F[_i], _c[:100], _t + ': ' + str(_e)[:120]))",
    "        else:",
    "            _val += 1; print('CONTRATO %d VIOLADO :: %s :: %s :: %s' % (_i, _F[_i], _c[:100], _t + ': ' + str(_e)[:120]))",
    "print('CONTRATO PASSED=%d TOTAL=%d DESCARTADOS=%d' % (_p, _val, len(_E) - _val))",
  ].join("\n");
}

module.exports = { contratoDoEnunciado, programaDoContrato, assinatura };
