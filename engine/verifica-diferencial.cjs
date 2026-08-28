// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// VERIFICADOR DIFERENCIAL — decide generalidade onde a MUTAÇÃO DE FIXTURE não alcança.
//
// ⚠️ POR QUE EXISTE, e é o limite estrutural do método que eu vinha usando:
//   /117  a EXPECTATIVA DERIVA DA ENTRADA — mutar a entrada exigiria recalcular o esperado, que é
//         saber a resposta. Provado: uma 2.ª solução independente, que passa a suíte ORIGINAL,
//         reprova a MUTADA exatamente como a 1.ª. A mutação é minha e é inválida.
//   /246  a SUÍTE NÃO TEM DADO NENHUM para mutar — nem string nem número. Não é lacuna do
//         extractor: é propriedade da suíte.
// Mais afinação do mutador não alcança nenhuma das duas. São 18 casos abertos em todas as
// campanhas (10 MUTACAO-INVALIDA + 8 SEM-FIXTURE) presos na mesma parede.
//
// 🎯 A IDEIA: a mutação da SUÍTE falha porque a expectativa tem de mudar junto. Um teste
// DIFERENCIAL não tem expectativa nenhuma — **as soluções computam-na**. Roda-se a solução do MZ e
// N soluções independentes sobre ENTRADAS NOVAS (que não estão na suíte) e compara-se a saída.
//     concordam  ⇒ a solução computa o contrato; não pode ter memorizado, porque estas entradas
//                  nunca estiveram em teste nenhum
//     divergem   ⇒ a que difere das outras é a que se comporta diferente fora da suíte
// A concordância entre soluções independentes É o oráculo. Não é preciso conhecer a resposta.
//
// ⚠️ E AS ARMADILHAS, todas pagas hoje noutros instrumentos:
//   · uma entrada que não CORRE não é evidência sobre o código — descarta-se, não se conta
//   · função ALEATÓRIA sem semente fixa dá saídas diferentes por construção — semeia-se igual antes
//     de cada chamada, senão o diferencial acusa toda a gente
//   · a 2.ª solução só serve de controlo se passar a suíte ORIGINAL — senão não é referência, é ruído
//   · duas soluções erradas do MESMO modo concordariam: por isso são N≥2 independentes e o veredito
//     exige MAIORIA, não unanimidade de duas
const { contratoDoEnunciado } = require("./contrato-oraculo.cjs");

// a tarefa consome aleatoriedade? (mesma leitura do contrato-oraculo)
function ehAleatoria(prompt) {
  const P = String(prompt);
  return /^\s*(import|from)\s+(random|numpy)\b/m.test(P)
    || /^\s*-\s*(random|numpy\.random)\b/m.test(P)
    || /\b(seed|random_state)\s*[=:)]/.test((P.match(/^\s*def\s+\w+\s*\(([^)]*)\)/m) || ["", ""])[1]);
}

// ── ENTRADAS NOVAS ───────────────────────────────────────────────────────────────────────────────
// Saem da SESSÃO DO DOCTEST do enunciado: as linhas `>>>` anteriores são a montagem, a última é a
// chamada. Variam-se os VALORES LITERAIS dos argumentos — nunca a estrutura, porque mudar a forma
// muda a tarefa em vez de a testar.
//
// ⚠️ Não se inventam entradas do nada nem se pede ao modelo que as invente: já medi hoje que quem
// escreve a solução não é testemunha isenta dela, e o mesmo vale para quem escreve a entrada.
function entradasNovas(prompt, quantas = 4) {
  const { casos } = contratoDoEnunciado(prompt);
  const smoke = casos.find((c) => c.tipo === "smoke");
  if (!smoke) return { chamadas: [], montagem: [], motivo: "sem chamada de exemplo no enunciado" };
  const montagem = smoke.montagem || [];
  const base = String(smoke.codigo);

  // ⚠️ A MESMA GUARDA TEM DE EXISTIR AQUI. Pus o freio de «nome de parâmetro que é FORMA» no
  // sintetizador por tipo e a /728 continuou a sair `task_func('x.csv', 'dr1251', 'vvi8')` — porque
  // esta chamada vem do MUTADOR do exemplo, não do sintetizador. Meia-correção pela nona vez.
  // Aqui não há nomes: o exemplo é posicional. Mas a ASSINATURA tem, e é ela que declara o default
  // de cada parâmetro — então os literais dos parâmetros que são forma (codec, fuso, locale,
  // formato, delimitador, modo) leem-se da assinatura e ficam PROTEGIDOS por valor, o que funciona
  // tanto na forma posicional como na nomeada.
  const FORMA = /(encoding|codec|charset|locale|timezone|^tz$|_tz$|format|delimiter|separator|^sep$|_sep$|^mode$|_mode$|regex|regexp|pattern)/i;
  // base64 CANÓNICO (re-encode bate) — um literal assim é FORMA: mutá-lo caractere-a-caractere quebra
  // o `b64decode` e devolve o caso ao «0 comparáveis». Detecta-se pela forma, não por palpite.
  const ehB64 = (s) => { if (!/^[A-Za-z0-9+/]{8,}={0,2}$/.test(s) || s.length % 4 !== 0) return false; try { const b = Buffer.from(s, "base64"); return b.length > 0 && b.toString("base64") === s; } catch { return false; } };
  const protegidos = new Set();
  {
    const ms = String(prompt).match(/def\s+\w+\s*\(([\s\S]*?)\)\s*:/);
    if (ms) {
      for (const seg of ms[1].split(/,(?![^[\](){}]*[\])}])/)) {
        const i = seg.indexOf("=");
        if (i < 0) continue;
        const nome = seg.slice(0, i).trim().split(":")[0].trim();
        const val = seg.slice(i + 1).trim();
        const lit = val.match(/^r?(['"])((?:\\.|[^\\])*?)\1$/);
        if (lit && FORMA.test(nome)) protegidos.add(lit[2]);
      }
    }
  }

  // ⚠️ A ENTRADA TEM DE SER VÁLIDA, E A 1.ª VERSÃO GERAVA ENTRADAS INVÁLIDAS. Medido na /140: mutei
  // `['A','B']` na CHAMADA e deixei o `df` da MONTAGEM com as colunas antigas — `KeyError` em todas
  // as soluções, as 4 entradas descartadas, e o controlo positivo exercitou ZERO casos.
  // A mesma incoerência que já me custou o eixo numérico: mudar um lado e não o outro.
  //
  // A rodação é mutar a SESSÃO INTEIRA com a MESMA substituição — montagem e chamada juntas. Assim
  // um nome de coluna trocado existe dos dois lados e a entrada continua válida.
  const variantes = [];
  for (let k = 0; k < quantas; k++) {
    const trocasNum = new Map(), trocasStr = new Map();
    const mutaTexto = (txt) => String(txt)
      .replace(/(?<![\w.])(\d{1,6})(?![\w.])/g, (m, _g, off, str) => {
        const n = Number(m); if (n <= 1) return m;             // 0 e 1 são estrutura
        // ⚠️ NÚMERO DENTRO DE `size=(...)`/`shape=(...)` É ACOPLADO A OUTRO ARGUMENTO. Medido na
        // /133: o exemplo é `pd.DataFrame(np.random.randint(0,100,size=(100,4)), columns=list('ABCD'))`
        // e eu mudei o `4` do size deixando as 4 colunas — sai
        // `Shape of passed values is (103, 7), indices imply (103, 4)`.
        // É a mesma lei do nome de coluna e do modo de arquivo: a dimensão é FORMA, a célula é
        // conteúdo. Mutar forma não gera entrada nova, gera entrada inválida.
        for (const s of String(str).matchAll(/\b(?:size|shape|axis|ndim)\s*=\s*(?:\([^)]*\)|\d+)/g)) {
          if (off >= s.index && off < s.index + s[0].length) return m;
        }
        // ⚠️ DATA/HORA/IP SÃO ESTRUTURA, NÃO CONTEÚDO. O mutador de dígitos corre sobre o texto todo,
        // inclusive dentro de `'2023-01-01'` — e embaralhava para `'2023-15-34'` (mês 15, dia 34),
        // inválida, ValueError/DateParseError em todas as soluções (/981). IP idem (/146). O dígito que
        // cai dentro de um padrão ISO-data / hora / IPv4-CIDR fica PROTEGIDO; a novidade vem dos outros
        // literais. Mesma lei da forma vs conteúdo: mutar a estrutura não gera entrada nova, gera inválida.
        for (const s of String(str).matchAll(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?/g)) {
          if (off >= s.index && off < s.index + s[0].length) return m;
        }
        // ⚠️ DIMENSÃO DE ML ACOPLADA AO DADO É FORMA. `n_components`/`n_clusters`/`n_samples`/`n_features`
        // couplam com a forma do dado (n_components<=n_features, n_clusters<=n_samples). Mutar o valor
        // gera combinações inválidas — PCA `n_components=4, N_FEATURES=... N_SAMPLES=2` → ValueError,
        // KMeans `n_clusters>pontos` → ValueError (medido em /451, /699, ambas FECHA mas com variantes a
        // errar). A variação tem de vir do DADO, não do hiperparâmetro: protege-se o valor.
        for (const s of String(str).matchAll(/\b(?:n_components|n_clusters|n_samples|n_features|n_neighbors|n_init)\s*=\s*\d+/gi)) {
          if (off >= s.index && off < s.index + s[0].length) return m;
        }
        if (!trocasNum.has(m)) {
          const d = String(n).length, base10 = Math.pow(10, d - 1);
          trocasNum.set(m, String(base10 + ((n - base10 + 3 * (k + 1)) % (9 * base10 || 9))));
        }
        return trocasNum.get(m);
      })
      // ⚠️ UM LITERAL COM BARRA INVERTIDA NÃO PODE SER MUTADO — NEM SEQUER PARCIALMENTE. A guarda
      // `[^'"\\]` impedia o literal INTEIRO de casar, mas não impedia o motor de começar a casar
      // DENTRO dele e emparelhar as aspas erradas. Medido na /395: o exemplo é
      // `task_func('./data/', '*.txt', r'([0-9]+)')` e a chamada gerada saiu
      // `regex='s'([0-9]+'` — deixou de ser Python. Um regex não tem «nome a variar»: variar-lhe os
      // caracteres não produz uma entrada nova, produz uma entrada inválida.
      // Casa-se agora o literal COMPLETO (incluindo escapes e prefixo `r`/`b`/`u`) e devolve-se
      // intacto quando é cru ou tem escape — assim o scanner consome-o e não reentra a meio.
      .replace(/([rbuRBU]{0,2})(['"])((?:\\.|[^\\'"])*)\2/g, (m, pref, q, s, off, str) => {
        if (/[rR]/.test(pref) || s.includes("\\")) return m;   // cru ou com escape: não se toca
        if (!s.length || s.length > 40) return m;
        // ⚠️ UM LITERAL EM POSIÇÃO DE CHAVE É UM NOME, E O CÓDIGO REFERE-SE A ELE. Medido na /232:
        // o exemplo constrói `pd.DataFrame([{'Name': ..., 'Age': ...}])` e eu embaralhei as chaves
        // para `'dwvxtslz'`/`'tcoix'`; a função continua a fazer `df['Name']` e sai `KeyError` em
        // todas as soluções — 3 entradas, 9 execuções, tudo contado contra a tarefa.
        // É a mesma lei que já apliquei ao DataFrame do fragmento, agora do lado do mutador: da
        // suíte herda-se a FORMA e varia-se o CONTEÚDO. Nome de coluna é forma; célula é conteúdo.
        if (/^\s*:/.test(String(str).slice(off + m.length))) return m;
        // ⚠️ LITERAL CURTO É TOKEN DE CONTROLE, NÃO DADO. Medido na /604: o exemplo é
        // `open(caminho, 'x')` e eu mutei o MODO de abertura para `'y'`, `'z'`, `'a'` — modos que
        // não existem. Todas as entradas morriam, o juiz de outra família não tinha o que julgar, e
        // a acusação que sustenta a regra 8 do playbook ficava sem confirmação por causa disto.
        // Modo de arquivo, delimitador (`','` na /728), separador e flag são a mesma coisa que nome
        // de coluna: o código INTERPRETA o literal em vez de o processar como dado. Variar não gera
        // entrada nova, gera entrada inválida — e um literal de 1 ou 2 caracteres quase nunca é o
        // dado que vale a pena variar.
        if (s.length < 3) return m;
        if (protegidos.has(s)) return m;   // codec/fuso/formato declarado na assinatura: é forma
        // HELPER base64: preserva a FORMA (base64 válido) e gera NOVIDADE — outro base64 real por k.
        if (ehB64(s)) {
          if (!trocasStr.has(s)) trocasStr.set(s, Buffer.from("Sample base64 payload variant " + (k + 1) + " for decoding.").toString("base64"));
          return q + trocasStr.get(s) + q;
        }
        // ⚠️ URL / EMAIL: o ESQUEMA (http/https/www, `://`) e o `@` SÃO a feature que a tarefa EXTRAI.
        // Embaralhá-los destrói a feature e um extrator CORRETO devolve vazio — o gate lê «degenera» e
        // acusa de overfit uma solução CERTA. Medido na /202: o mutador fez `https://www.example.com` →
        // `ivwtx://fgh.rlpcgdx.com` (o `.com` era preservado pela guarda de extensão, mas o esquema não),
        // e os 4 inputs ficaram sem URL nenhuma. Preserva-se o esquema/separador e varia-se só o domínio:
        // o extrator correto acha a URL VARIADA (generaliza ✓) e o overfit hardcodado devolve vazio
        // (flagrado ✓) — o gate fica MAIS forte, não mais frouxo. Mesma lei da extensão: forma preservada,
        // conteúdo varia. Precede o `mExt` porque `.com`/`.org` casariam como extensão e mutavam o esquema.
        const caesar = (str) => { const alf = "abcdefghijklmnopqrstuvwxyz"; return String(str).split("").map((ch, i) => (/[a-z]/i.test(ch) ? alf[(alf.indexOf(ch.toLowerCase()) + k + 1 + i) % 26] : ch)).join(""); };
        const mUrl = s.match(/^(https?:\/\/(?:www\.)?|www\.)([A-Za-z][\w.\-]*)((?:[\/?#].*)?)$/i);
        if (mUrl) {
          if (!trocasStr.has(s)) trocasStr.set(s, mUrl[1] + caesar(mUrl[2]) + mUrl[3]);
          return q + trocasStr.get(s) + q;
        }
        const mEmail = s.match(/^([A-Za-z][\w.\-]*)(@[\w.\-]+)$/);
        if (mEmail) {   // preserva `@dominio` (a feature de email); varia só a parte local
          if (!trocasStr.has(s)) trocasStr.set(s, caesar(mEmail[1]) + mEmail[2]);
          return q + trocasStr.get(s) + q;
        }
        // ⚠️ A GUARDA ERA ESTREITA: exigia `/^[\w.]+$/` e um caminho com BARRA escapava dela,
        // levando a extensão a ser embaralhada junto (`sales1.csv` → `bkwqf.rim`). O criador de
        // recursos decide o conteúdo pela extensão, logo escrevia texto onde a tarefa lê CSV.
        // Agora: qualquer string que TERMINE em extensão conhecida preserva a extensão, e só o
        // NOME varia — que é o que torna a entrada nova sem a tornar inválida.
        const mExt = s.match(/^(.*)(\.[A-Za-z][A-Za-z0-9]{0,4})$/);
        if (mExt) {
          if (!trocasStr.has(s)) {
            const alf = "abcdefghijklmnopqrstuvwxyz";
            trocasStr.set(s, mExt[1].split("").map((ch, i) => (/[a-z]/i.test(ch) ? alf[(alf.indexOf(ch.toLowerCase()) + k + 1 + i) % 26] : ch)).join("") + mExt[2]);
          }
          return q + trocasStr.get(s) + q;
        }
        if (!trocasStr.has(s)) {
          const alfabeto = "abcdefghijklmnopqrstuvwxyz";
          trocasStr.set(s, s.split("").map((ch, i) => (/[a-z]/i.test(ch) ? alfabeto[(alfabeto.indexOf(ch.toLowerCase()) + k + 1 + i) % 26] : ch)).join(""));
        }
        return q + trocasStr.get(s) + q;
      });

    const montMut = montagem.map(mutaTexto);
    const chamMut = mutaTexto(base);
    // ⚠️ ABSOLUTO → RELATIVO. `/rdxm/aw/x.csv` faz `os.makedirs('/rdxm/aw')` e o sandbox recusa:
    // o criador de recursos devolve False, o retry desiste, e sai `FileNotFoundError` que eu
    // contava como falha da solução. Medido em 8 chamadas geradas — raiz de 9 tarefas do resíduo.
    // O que a tarefa faz com o caminho não muda; muda ele passar a ser criável.
    const relativiza = (txt) => String(txt).replace(/(['"])\/+([^'"]*)\1/g, (mm, q, resto) => q + "_abs/" + resto + q);
    const chamRel = relativiza(chamMut);
    const montRel = montMut.map(relativiza);
    if ((trocasNum.size || trocasStr.size) && !variantes.some((x) => x.chamada === chamRel)) {
      variantes.push({ chamada: chamRel, montagem: montRel });
    }
  }
  if (!variantes.length) return { chamadas: [], montagem, motivo: "a chamada de exemplo não tem literal variável" };
  // ⚠️ cada variante leva a SUA montagem: montagens diferentes não podem partilhar namespace, senão
  // a última sobrescreve as anteriores e todas as entradas passam a ser a mesma.
  return { chamadas: variantes.map((v) => v.chamada), montagens: variantes.map((v) => v.montagem), montagem, motivo: null };
}

// ── ENTRADAS SINTETIZADAS A PARTIR DO TIPO DECLARADO ────────────────────────────────────────────
// ⚠️ O GERADOR ANTERIOR SÓ SABIA VARIAR LITERAL QUE JÁ EXISTIA na chamada de exemplo — e isso
// matou 5 de 13 tarefas no bloco 3 com «a chamada de exemplo não tem literal variável». Não era
// limite do método diferencial: era limite do meu gerador.
//
// O enunciado declara os tipos (`Parameters:` em 287 de 300) e a assinatura declara os valores por
// omissão. Um parâmetro com TIPO conhecido e DEFAULT conhecido dá entradas válidas por construção:
// o default é um valor legítimo, e variar dentro do mesmo tipo continua legítimo.
//     number_teams (int, optional) = 5   → task_func(number_teams=9)
//     periods (int) = 13                 → task_func(periods=21)
// Nada é inventado: o tipo vem do enunciado, o nome vem da assinatura, e a variação é do valor.
const SINTESE = {
  int: (base, k) => String(Math.max(2, (Number(base) || 5) + 2 * (k + 1))),
  float: (base, k) => String(((Number(base) || 1) + 0.5 * (k + 1)).toFixed(2)),
  str: (base, k) => {
    const s = String(base || "'abc'").replace(/^['"]|['"]$/g, "");
    // ⚠️ A EXTENSÃO NÃO SE MUTA. Sintetizei `'entrada.csv'` pela dica do nome do parâmetro e este
    // gerador devolveu `'fpwvfjh.lcg'` — embaralhou o `.csv` junto com o resto. O criador de
    // recursos decide o CONTEÚDO pela extensão, logo mutá-la anula a dica que a produziu: pedia-se
    // um CSV e criava-se um arquivo de texto qualquer. O outro eixo já preservava nome de arquivo;
    // este não, e a incoerência entre os dois geradores só apareceu ao olhar a entrada gerada.
    const ext = s.match(/^(.+)(\.[A-Za-z][A-Za-z0-9]{1,5})$/);
    if (ext) {
      const alf0 = "abcdefghijklmnopqrstuvwxyz";
      return `'${ext[1].split("").map((c, i) => (/[a-z]/i.test(c) ? alf0[(alf0.indexOf(c.toLowerCase()) + k + 1 + i) % 26] : c)).join("")}${ext[2]}'`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {                    // data: soma dias, mantém o formato
      const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7 * (k + 1));
      return `'${d.toISOString().slice(0, 10)}'`;
    }
    const alf = "abcdefghijklmnopqrstuvwxyz";
    return `'${s.split("").map((c, i) => (/[a-z]/i.test(c) ? alf[(alf.indexOf(c.toLowerCase()) + k + 1 + i) % 26] : c)).join("")}'`;
  },
  list: (base, k) => `[${Array.from({ length: 2 + k }, (_, i) => i + 1).join(", ")}]`,
  bool: (base, k) => (String(base) === "True" ? "False" : "True"),
};

function entradasPorTipo(prompt, quantas = 3) {
  // ⚠️ VARREDURA BALANCEADA da assinatura. Regex não conta parênteses: `[^)]*` trunca no `)` INTERNO
  // de um default de regex (/395 `regex=r'([0-9]+)'`, /642 `pattern=r"(?<!Dis...)"`) e `\)\s*:`
  // SUPER-captura em defs com anotação de retorno `-> dict:` (o `)` real é seguido de `-> ...:`, não
  // de `:`, medido em 20 defs). A varredura acha o `(` do `def`, conta profundidade respeitando
  // literais de string, e pára no `)` que zera a profundidade — o fecho verdadeiro em qualquer caso.
  const sig = (() => {
    const m = String(prompt).match(/^\s*def\s+(\w+)\s*\(/m);
    if (!m) return null;
    const s = String(prompt), ini = m.index + m[0].length;
    let dep = 1, i = ini, q = null;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === "\\") { i++; continue; } if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"') { q = ch; continue; }
      if (ch === "(" || ch === "[" || ch === "{") dep++;
      else if (ch === ")" || ch === "]" || ch === "}") { if (--dep === 0) break; }
    }
    return [m[0], m[1], s.slice(ini, i)];
  })();
  if (!sig) return { chamadas: [], montagens: [], motivo: "sem assinatura" };
  const fn = sig[1];
  // ⚠️ EXIGIR VALOR POR OMISSÃO ERA O ESTRANGULAMENTO. Medido no fim da campanha: das 53 tarefas,
  // 9 saíram `SEM-ENTRADAS` e as 9 pelo MESMO motivo — «a chamada de exemplo não tem literal
  // variável · nenhum parâmetro com valor por omissão». Não é limite do método diferencial: é o meu
  // gerador a recusar-se a olhar para o parâmetro OBRIGATÓRIO, que é justamente o que a função
  // sempre recebe. O `Parameters:` do enunciado declara o tipo dele igual ao dos opcionais.
  // Sem default não há valor-base, então a base vem do TIPO — e o risco está limitado por
  // construção: entrada que viole pré-condição rebenta, é descartada como não-comparável, e nunca
  // vira acusação. O pior caso é continuar sem medir; o melhor é medir 9 tarefas que não mediam.
  const BASE_POR_TIPO = { int: "5", float: "1.0", str: "'abc'", list: "[1, 2]", bool: "True" };
  // ⚠️ O NOME DO PARÂMETRO DIZ O QUE ELE É, e ignorá-lo custa a medição. `filepath` sintetizado como
  // `'abc'` não tem extensão, e o criador de recursos — que decide pela extensão — cria um
  // DIRETÓRIO onde a função espera um arquivo: `IsADirectoryError` em todas as soluções, entrada
  // descartada, tarefa `NAO-MEDIDA`. O tipo declarado diz `str`; é o NOME que diz `str que é caminho
  // de CSV`. Usar a dica não inventa nada: escolhe, dentro do tipo declarado, a forma que a função
  // consegue receber.
  const baseParaNome = (nome) => {
    const n = String(nome).toLowerCase();
    // ⚠️ FORMA ANTES DE ARQUIVO. `csv_delimiter` casa `/csv/` e recebia `'entrada.csv'` — um NOME DE
    // ARQUIVO onde a função quer um delimitador de 1 char (/96: TypeError). Um delimitador/separador/
    // codificação/modo é FORMA, não caminho: resolve-se ANTES das regras de extensão. (Estes nomes já
    // são protegidos de MUTAÇÃO na linha ~421; faltava dar-lhes o valor-base certo.)
    if (/(delimiter|separator|(^|_)sep($|_))/.test(n)) return "','";
    if (/(encoding|codec|charset)/.test(n)) return "'utf-8'";
    if (/(^|_)mode($|_)/.test(n)) return "'r'";
    if (/(^|_)(ip_range|cidr|subnet|netmask)($|_)|(^|_)ip($|_)/.test(n)) return "'192.168.1.0/24'";  // rede: CIDR válido (/146 AddressValueError)
    if (/(package_name|module_name|(^|_)module($|_)|(^|_)pkg($|_))/.test(n)) return "'json'";  // import por nome: pacote stdlib REAL, não string aleatória (/541 ImportError)
    // DATA: params de data sem default caíam em null → tarefa n=1/SEM-ENTRADAS (/85 start_date/end_date).
    // O SINTESE.str já VARIA data ISO validamente (+7 dias por k); só faltava o valor-base. start<end
    // para a janela não ficar vazia; ambos deslocam o mesmo por k, logo a ordem preserva-se.
    if (/(start|from|begin|since|initial).*(date|day|time)|^(start|from|begin)_?(date|day)$/.test(n)) return "'2023-01-01'";
    if (/(end|to|until|finish|final).*(date|day|time)|^(end|to|until)_?(date|day)$/.test(n)) return "'2023-06-01'";
    if (/(^|_)(date|day|dt)($|_)|datestr|date_str/.test(n)) return "'2023-01-01'";
    // ⚠️ CONSERTO FIXTURE-DIRETÓRIO (Coordenação §2, classe medida = 12). Dir recebia 'dados_dir' (sem '/')
    // → a criação proativa não dispara → dir vazio → tarefa de arquivo trivial ('moveu 0'). Path COM '/'
    // dispara `_cria_recurso`, que POPULA o dir. source/dest DISTINTOS (senão /759 move dir→ele-mesmo).
    if (/(^|_)(source|src|input|from|root)(_?(dir|directory|folder|path))?($|_)/.test(n) && /(dir|folder|directory|path|root)/.test(n)) return "'srcdir/data'";
    if (/(^|_)(dest|destination|output|out|target|backup|to)(_?(dir|directory|folder|path))?($|_)/.test(n) && /(dir|folder|directory|path|backup)/.test(n)) return "'dstdir/data'";
    if (/(^|_)(dir|folder|directory|path_to_dir)($|_)/.test(n)) return "'workdir/data'";
    if (/csv/.test(n)) return "'entrada.csv'";
    if (/json/.test(n)) return "'entrada.json'";
    if (/(xlsx|excel)/.test(n)) return "'entrada.xlsx'";
    if (/(log|txt|text_file)/.test(n)) return "'entrada.txt'";
    // SQLite: caminho de db → um `.db` (o `_cria_recurso` cria e POPULA a tabela `data_table`).
    if (/db_file|db_path|db_name|(^|_)database($|_)|sqlite|\.db\b/.test(n)) return "'test.db'";
    if (/(file|path)/.test(n)) return "'entrada.txt'";
    return null;
  };
  // ⚠️ SPLIT CIENTE DE COLCHETES. Medido: 8 tarefas (/62 `colors=['b','g','r',...]`, /909, /469,
  // /477, /86, /493) saíam com chamada MALFORMADA — `colors=['b')` — porque `split(",")` ingénuo
  // partia o DEFAULT de lista/dict nas vírgulas internas e o parâmetro herdava `['b'` truncado. O
  // `entradasNovas` já parte a assinatura com esta guarda; faltava aqui. Vírgula só separa parâmetro
  // quando NÃO está dentro de `[]`/`()`/`{}`.
  const brutos = sig[2].split(/,(?![^[\](){}]*[\])}])/).map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/^(self|cls|\*|\*\*)/.test(s));
  const params = brutos.map((s) => {
    const i = s.indexOf("=");
    if (i >= 0) return { nome: s.slice(0, i).trim().split(":")[0].trim(), padrao: s.slice(i + 1).trim(), obrigatorio: false };
    return { nome: s.split(":")[0].trim(), padrao: null, obrigatorio: true };
  }).filter((p) => /^\w+$/.test(p.nome));
  // ⚠️ FUNÇÃO SEM PARÂMETRO (parameterless, /859 e ~outras nas 53 SEM-ENTRADAS): não há eixo de entrada
  // para variar, mas o oráculo de generalidade ainda se aplica por OUTRA via (Herbert 2026-08-12): rodar
  // `fn()` com SEMENTE FIXA e comparar as FAMÍLIAS — se implementações independentes concordam sob a
  // mesma semente, computam o mesmo (o cenário é um ponto só, logo 1 entrada é a cobertura COMPLETA, não
  // n=1 parcial). O programa força a semente; o determinismo é checado por dupla-execução (ver programa).
  if (!params.length) return { chamadas: [`${fn}()`], montagens: [[]], motivo: null, semParametro: true };

  // tipo declarado no bloco `Parameters:` — a fonte é o enunciado, não o meu palpite
  const mp = String(prompt).match(/^[ \t]*Parameters:[ \t]*\n([\s\S]*?)(?=\n[ \t]*(Returns|Raises|Requirements|Example|Notes?):|(?![\s\S]))/m);
  const tipos = {};
  if (mp) for (const l of mp[1].split("\n")) {
    const m = l.match(/^\s*-?\s*(\w+)\s*\(([^),]+)/);
    if (m) tipos[m[1]] = m[2].trim().toLowerCase();
  }
  // ── DESCRIÇÃO de cada parâmetro (não só o tipo) — a semântica que decide o FORMATO do valor ──────
  // Medido (2026-08-11): params `str` cujo docstring diz «base64 encoded string» (/709) recebiam
  // 'abc' e TODAS as soluções falhavam no `base64.b64decode` → 0 comparáveis, tarefa NÃO-MEDIDA
  // (indistinguível de «o modelo não resolve»). O tipo diz `str`; a DESCRIÇÃO diz que forma exige.
  const descParam = {};
  if (mp) for (const l of mp[1].split("\n")) {
    const m = l.match(/^\s*-?\s*(\w+)\s*\([^)]*\)\s*:?\s*(.+)$/);
    if (m) descParam[m[1]] = m[2].trim();
  }
  // HELPER base64: descrição/nome indica base64 → um literal base64 VÁLIDO (senão o decode rebenta).
  const ehBase64 = (nome) => /base[\s-]?64|b64/i.test(descParam[nome] || "") || /base64|b64/i.test(String(nome));
  const B64_VALIDO = "'" + Buffer.from("Hello, World!  Sample text for testing base64 decoding.").toString("base64") + "'";
  // HELPER lista-de-listas (36 tarefas no bench): o sintetizador de `list` gerava `[1, 2]` (lista de
  // ESCALARES) onde a função quer lista de LISTAS (/1072) → todas as soluções falham ao iterar a
  // sublista → 0 comparáveis. Detecta-se pelo nome (`list_of_lists`, `matrix`, `nested`) ou docstring.
  const ehListaDeListas = (nome) => /list_of_lists|list_of_list|nested_list|^matrix$|_matrix$/i.test(String(nome))
    || /list of lists|nested list|list of list|2d (array|list)|\bmatrix\b|list\s*\[\s*list/i.test(descParam[nome] || "");
  // HELPER DataFrame (128 tarefas no bench): param `df`/`*_df`/tipo DataFrame recebia null (tipo não
  // mapeado) → SEM-ENTRADAS, ou variável nua no exemplo → n=1. Sintetiza um `pd.DataFrame` com as colunas
  // que o enunciado nomeia (número por nome numérico, senão rótulo). `pd` vem do _AMBIENTE do programa.
  const ehDataFrame = (nome) => /^df\d*$|_df$|dataframe/i.test(String(nome))
    || /dataframe|pandas\.?data|pd\.dataframe/i.test((descParam[nome] || "") + " " + (tipos[nome] || ""));
  // HELPER dict (/614 goals+penalties, /171 vegetable_dict, /186 dic): param tipo `dict` recebia null →
  // SEM-ENTRADAS ou n=1 (variável nua). Sintetiza um dict com chaves fixas; o tipo do VALOR lê-se do
  // docstring (número/contagem/score → int, senão str). NÃO cobre dict aninhado (/186 {Lat,Lon}).
  const ehDict = (nome) => /^dict$/.test((tipos[nome] || "").split(/[\s,([]/)[0])
    || /(^|_)dict$|_map$|(^|_)mapping$/i.test(String(nome));
  const dictValInt = (nome) => /\b(number|count|amount|score|goal|penalt|integer|quantity|total|frequenc|age|price|weight|point)\w*/i.test(descParam[nome] || "");
  const dictAninhado = (nome) => /\{[^}]*\{|dict of dict|nested dict|dictionary of dictionar|values are (dict|dictionar)/i.test(descParam[nome] || "");
  // ⚠️ CONSERTO FORMAT-AWARE (Coordenação §2, 2026-08-15): param de TEXTO cujo docstring EXIGE um formato
  // ('each line formatted as ...', 'of the form ...') recebia `'bdf'` (gerador cego ao formato) → a tarefa
  // não se exercita → indecisa por APARATO (medido: /56 `text='bdf'`, a referência falha em TODAS). Extrai
  // o EXEMPLO de formato do docstring e sintetiza instâncias VÁLIDAS (multi-linha, valores variados). PRECISO:
  // só dispara com exemplo de formato EXPLÍCITO num param de texto livre — não em regex/pattern/dir (senão
  // corrompe resíduo real, como o falso-positivo /6 que é filesystem, não format-blind).
  const formatoEx = (() => {
    const m = String(prompt).match(/(?:formatted as|of the form|each line[^'"\n]{0,30}|in the format|like|e\.?g\.?,?)[^'"\n]{0,20}(['"])([^'"\n]{5,80})\1/i);
    return m ? m[2] : null;
  })();
  const ehTextoFormatado = (nome) => !!formatoEx
    && /^(text|string|s|content|data|input_string|raw|body|lines?)$/i.test(String(nome))
    && !/regex|pattern|dir|path|file/i.test(String(nome));
  const POOL_FMT = ["Math", "Science", "History", "Art", "Bio", "Geo", "Music", "Chem", "Phys", "PE"];
  const genFormato = (base, k) => {
    const linha = (i) => String(formatoEx)
      .replace(/\d+/g, (mm) => String(Number(mm) + 7 * (k + 1) + i * 3))
      .replace(/:\s*([A-Za-z][A-Za-z ]*)/g, () => ": " + POOL_FMT[(k + i) % POOL_FMT.length]);
    const n = 2 + (k % 3);
    return "'" + Array.from({ length: n }, (_, i) => linha(i)).join("\\n") + "'";
  };
  // HELPER array/sinal numérico (113 tarefas): `data`/`signal`/`arr` numérico. 2D quando há PCA/cluster
  // (n_components), 1D quando há sinal/áudio (sample_rate/fft/frequency).
  const ehArraySinal = (nome) =>
    // ⚠️ TIPO EXPLÍCITO manda, independentemente do nome. `y (numpy.ndarray)` (/356) não estava no
    // conjunto de nomes e caía em valorBase=null → tarefa saltada. Se o docstring/assinatura declara
    // ndarray/numpy array, é array — o nome não precisa de estar na lista curta.
    (/\b(numpy\.?ndarray|ndarray|np\.array|numpy array)\b/i.test((descParam[nome] || "") + " " + (tipos[nome] || ""))
      || (/^(data|signal|arr|series|samples|values|x|y)$/i.test(String(nome))
        && (/\b(array|ndarray|numpy|list of (float|int|number)|signal|sequence)\b/i.test((descParam[nome] || "") + " " + (tipos[nome] || ""))
          || params.some((q) => /sample_rate|n_components|fft|frequency|sampling|amplitude|n_clusters/i.test(q.nome)))));
  const ehListaDeTuplas = (nome) => /list_of_tuple|tuples?$|_tuples?/i.test(String(nome))
    || /list of tuple|tuples?\b/i.test(descParam[nome] || "");
  // colunas nomeadas no enunciado (mesma inferência do CSV) — para montar o DataFrame com ELAS
  const colsDoEnunciado = (() => {
    const m = String(prompt).match(/columns?\b[^.]{0,60}?((?:['"][a-zA-Z_][\w ]*['"][,\s]*(?:and\s+)?){2,})/i);
    return m ? [...m[1].matchAll(/['"]([a-zA-Z_][\w ]*)['"]/g)].map((x) => x[1]).slice(0, 6) : [];
  })();
  // NUMÉRICO por padrão (o caso comum: stats/PCA/plot quebram com coluna de texto); texto SÓ quando o
  // nome da coluna sugere categórico. Assim um df serve tanto ops numéricas quanto groupby por categoria.
  const TEXTHINT = /(name|category|label|type|city|country|group|class|gender|status|title|product|item|color|region|dept)/i;
  const montaDF = (nrows, base0) => {
    const cols = colsDoEnunciado.length ? colsDoEnunciado : ["A", "B", "C"];
    const partes = cols.map((c, ci) => {
      const cel = Array.from({ length: nrows }, (_, i) => TEXTHINT.test(c)
        ? `'${c.split(" ")[0].toLowerCase()}${(i % 3) + 1}'` : String(10 * (i + 1) + base0 + ci));
      return `'${c}': [${cel.join(", ")}]`;
    });
    return `pd.DataFrame({${partes.join(", ")}})`;
  };

  // ⚠️ OS OBRIGATÓRIOS TÊM DE IR EM TODAS AS CHAMADAS, senão a chamada é inválida por omissão de
  // argumento e o erro seria `TypeError`, que eu leria como defeito da solução. Fixa-se um valor
  // para cada obrigatório e VARIA-SE UM DE CADA VEZ: assim as entradas diferem entre si por um
  // eixo só, que é o que torna a comparação legível.
  // SQLite: há um caminho de db entre os parâmetros? decide se pino `query` a um SELECT válido.
  const temDB = params.some((p) => /db_file|db_path|db_name|(^|_)database($|_)|sqlite/i.test(p.nome));
  // DataFrame + params que NOMEIAM colunas (col1/col2/column/group_col): têm de CASAR as colunas do df
  // gerado (senão KeyError/ValueError) — mesmo acoplamento do SQLite. Pino ao nome real da coluna.
  const temDF = params.some((p) => ehDataFrame(p.nome));
  const dfCols = colsDoEnunciado.length ? colsDoEnunciado : ["A", "B", "C"];
  const pinaColuna = (nomeL) => {
    if (!temDF) return null;
    const m = nomeL.match(/^col(?:umn)?_?([0-9]+)$/);
    if (m) return `'${dfCols[(parseInt(m[1], 10) - 1 + dfCols.length) % dfCols.length]}'`;
    if (/^(col|column|col_name|column_name|group_col|value_col|key_col|target_col|x_col|y_col)$/.test(nomeL)) return `'${dfCols[0]}'`;
    return null;
  };
  const valorBase = (p) => {
    // SQLite — os identificadores têm de CASAR com a tabela que o `_cria_recurso` cria (`data_table`,
    // coluna `text_column`); por isso pinam-se (MESMO com default declarado, senão /537 `table_name=
    // "People"` não bate a tabela criada) e são protegidos da mutação no laço abaixo. Nome aleatório
    // de tabela/coluna não existe no db → `no such table`/`no such column` em TODAS as soluções.
    const nomeL = String(p.nome).toLowerCase();
    if (/^(table_name|tablename|table)$/.test(nomeL)) return "'data_table'";
    if (/^(column_name|columnname|column)$/.test(nomeL) && temDB) return "'text_column'";
    if (/^query$/.test(nomeL) && temDB) return "'SELECT * FROM data_table'";
    const colPin = pinaColuna(nomeL); if (colPin) return colPin;   // col1/col2/column → coluna real do df
    // época perto de now (a função percorre epoch→now; longe de now = timeout). Expressão runtime.
    if (/(epoch|timestamp|_ms$|millis|_time$|since)/i.test(nomeL)) return "int((__import__('time').time() - 300) * 1000)";
    if (p.padrao !== null) return p.padrao;
    if (ehDataFrame(p.nome)) return montaDF(4, 0);                  // HELPER: DataFrame com colunas do enunciado
    if (ehDict(p.nome) && !dictAninhado(p.nome)) return dictValInt(p.nome) ? "{'A': 1, 'B': 2}" : "{'A': 'x1', 'B': 'y2'}";  // HELPER: dict base (valor int/str do docstring); o loop varia via genDict
    if (ehTextoFormatado(p.nome)) return genFormato("", 0);   // HELPER: texto com FORMATO do docstring (instância válida; o loop varia via genFormato)
    if (ehListaDeListas(p.nome)) return "[[1, 2, 3], [4, 5, 6]]";   // HELPER: lista de LISTAS, não de escalares
    if (ehListaDeTuplas(p.nome)) return "[(1, 2), (3, 4), (5, 6)]"; // HELPER: lista de TUPLAS
    if (ehArraySinal(p.nome)) {
      const lit = params.some((q) => /n_components|n_clusters|pca|cluster/i.test(q.nome))
        ? "[[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0], [2.0, 1.0, 0.5]]"   // 2D p/ PCA/cluster
        : "[0.1, 0.5, -0.3, 0.8, 0.2, -0.6, 0.4, 0.9, -0.1, 0.7]";                  // 1D sinal
      // ⚠️ TIPO ndarray → `np.array(...)`, não lista Python. A função faz operações de array
      // (`.reshape`, broadcasting) que uma lista não suporta → TypeError (/356). Só quando o tipo
      // declarado é ndarray; senão a lista basta (e algumas funções fazem `.append`). `np` vem do _AMBIENTE.
      const ehND = /\b(numpy\.?ndarray|ndarray|np\.array|numpy array)\b/i.test((descParam[p.nome] || "") + " " + (tipos[p.nome] || ""));
      return ehND ? `np.array(${lit})` : lit;
    }
    const t = (tipos[p.nome] || "").replace(/\s*of\s+.*$/, "").split(/[ ,]/)[0];
    // ⚠️ TIPO datetime/date → data ISO como STRING. O tipo declarado é `datetime` (/85 start_date,
    // end_date) e caía em BASE_POR_TIPO['datetime']=undefined → null → tarefa saltada (n=1/SEM). Uma
    // string ISO serve às funções de data comuns (`pd.date_range`, `pd.to_datetime`), e o SINTESE.str
    // varia-a validamente (+dias). Se a função exigir objeto datetime, a entrada é descartada — honesto.
    if (/^(datetime|date|timestamp|pd\.timestamp)$/.test(t)) { const dd = baseParaNome(p.nome); return dd || "'2023-01-01'"; }
    if (t === "str" || !t) {
      if (ehBase64(p.nome)) return B64_VALIDO;   // HELPER: docstring diz base64 → valor base64 VÁLIDO
      const dica = baseParaNome(p.nome); if (dica) return dica;
    }
    return BASE_POR_TIPO[t] || null;
  };
  const obrig = params.filter((p) => p.obrigatorio);
  if (obrig.some((p) => valorBase(p) === null)) {
    // ⚠️ FALHA FECHADA: um obrigatório sem tipo declarado não se inventa. Preencher com um palpite
    // faria a chamada correr e a saída ser sobre OUTRA coisa — pior que não medir.
    return { chamadas: [], montagens: [], motivo: `parâmetro obrigatório sem tipo declarado: ${obrig.filter((p) => valorBase(p) === null).map((p) => p.nome).join(", ")}` };
  }
  const chamadas = [];
  // síntese de LISTA-DE-LISTAS: varia nº de sublistas e de elementos, mantendo a forma ANINHADA (o
  // SINTESE.list geraria lista de escalares e a função quebraria ao iterar a sublista).
  const genLL = (base, k) => "[" + Array.from({ length: 2 + (k % 2) }, (_, i) => "[" + Array.from({ length: 2 + (k % 3) }, (_, j) => i * 3 + j + 1 + k).join(", ") + "]").join(", ") + "]";
  // síntese de DataFrame/tuplas/sinal: varia a MAGNITUDE (nº de linhas/valores) mantendo a FORMA, para
  // dar entradas comparáveis distintas onde antes havia 1 só (o nó dos n=1 medidos: 317 tarefas).
  const genDF = (base, k) => montaDF(3 + (k % 3), k + 1);
  const genTuplas = (base, k) => "[" + Array.from({ length: 2 + (k % 3) }, (_, i) => `(${i + 1 + k}, ${i + 2 + k})`).join(", ") + "]";
  // dict com chaves fixas ('A'..'D') — CHAVES iguais entre entradas (o código indexa por chave), VALORES
  // variam por k. Duas soluções com as mesmas chaves concordam ou divergem no conteúdo, não na forma.
  const genDict = (strVals) => (base, k) => {
    const n = 2 + (k % 3), keys = ["A", "B", "C", "D"].slice(0, n);
    return "{" + keys.map((key, i) => strVals
      ? `'${key}': '${"xyzabcuvw"[(i + k) % 9]}${i + 1}'`
      : `'${key}': ${i + 1 + k}`).join(", ") + "}";
  };
  const genArr2D = (base, k) => "[" + Array.from({ length: 3 + (k % 2) }, (_, i) => "[" + Array.from({ length: 3 }, (_, j) => (i + j + k + 1) + ".0").join(", ") + "]").join(", ") + "]";
  const genArr1D = (base, k) => "[" + Array.from({ length: 8 + k }, (_, i) => ((Math.sin(i + k) * 10) / 10).toFixed(1)).join(", ") + "]";
  for (const p of params) {
    const t = (tipos[p.nome] || "").replace(/\s*of\s+.*$/, "").split(/[ ,]/)[0];
    const base = valorBase(p);
    const is2D = params.some((q) => /n_components|n_clusters|pca|cluster/i.test(q.nome));
    const gen = ehDataFrame(p.nome) ? genDF
      : ehListaDeTuplas(p.nome) ? genTuplas
        : ehArraySinal(p.nome) ? (is2D ? genArr2D : genArr1D)
          : ehListaDeListas(p.nome) ? genLL
            : ehTextoFormatado(p.nome) ? genFormato
            : (ehDict(p.nome) && !dictAninhado(p.nome)) ? genDict(!dictValInt(p.nome))
              : (SINTESE[t] || (/^\d+$/.test(String(base)) ? SINTESE.int : /^['"]/.test(String(base)) ? SINTESE.str : null));
    if (!gen) continue;                       // tipo que não sei sintetizar: sai, e não se inventa
    // ⚠️ O SINTETIZADOR DE `str` SÓ SABE LER UM LITERAL SIMPLES, e eu aplicava-o a qualquer default
    // cujo TIPO DECLARADO fosse `str`. Medido na /395: a assinatura tem `regex=r'([0-9]+)'` e o
    // `Parameters:` diz `str`, então o sintetizador pegou num literal CRU que não sabe analisar e
    // devolveu `regex='s'([0-9]+'` — a chamada deixou de ser Python, e as 9 ocorrências de
    // `chamada:SyntaxError` desta tarefa eram isto.
    // Um default é, por definição, um valor válido: quando não o sei VARIAR, salto o parâmetro em
    // vez de o reescrever. Os outros parâmetros continuam a gerar entradas, e a tarefa continua
    // mensurável — é a mesma disciplina do «obrigatório sem tipo não se inventa», um nível abaixo.
    if (gen === SINTESE.str && !/^(['"])(?:\\.|[^\\])*?\1$/.test(String(base).trim())) continue;
    // ⚠️ O NOME DO PARÂMETRO DIZ QUANDO O VALOR É FORMA. Medido na /728: a assinatura tem
    // `from_encoding='cp1251'` e eu variava o nome do CODEC — `LookupError: unknown encoding` nas 9
    // execuções, contado contra a tarefa. Um codec, um fuso, um locale, um formato, um delimitador
    // ou um modo não são DADOS: o código usa-os como CHAVE numa tabela que alguém mantém, e um
    // valor inventado não existe nessa tabela.
    // É a árvore de nomes que já uso para saber QUE MUNDO construir, aplicada a outra pergunta:
    // que argumentos NÃO variar. O default declarado é um valor válido e fica como está.
    if (/(encoding|codec|charset|locale|timezone|^tz$|_tz$|format|delimiter|separator|^sep$|_sep$|^mode$|_mode$|regex|regexp|pattern|package_name|module_name)/i.test(p.nome)) continue;
    // base64 é FORMA (uma string codificada válida): mutá-la caractere-a-caractere quebra o decode e
    // devolve o caso à casa do «0 comparáveis». Fica na base válida; os OUTROS params geram a novidade.
    if (ehBase64(p.nome)) continue;
    // SQLite — nome de tabela/coluna, o SELECT e o caminho do db são CHAVES acopladas ao recurso que
    // o `_cria_recurso` monta; mutá-los descasa o arg da tabela criada. Ficam na base pinada.
    if (/^(table_name|tablename|table|column_name|columnname|column|query)$/i.test(p.nome)
        || /db_file|db_path|db_name|(^|_)database($|_)|sqlite/i.test(p.nome)) continue;
    // coluna do df pinada: mutá-la descasa do DataFrame gerado (KeyError/ValueError). Fica na base.
    if (pinaColuna(String(p.nome).toLowerCase())) continue;
    // ⚠️ MAGNITUDE COM CUSTO DE TEMPO — nem forma, nem conteúdo, e foi o que me faltava nomear.
    // Medido: 17 das 126 entradas PENDURAM, em 5 tarefas, e o padrão é sempre o mesmo —
    // `duration`, `intervals=100`, `epoch_milliseconds`. O valor que eu gero é VÁLIDO e CARO: a
    // função dorme, itera ou percorre datas. No sandbox isso bate no teto de tempo, não produz
    // saída, e chega como `NAO-MEDIDA` — indistinguível de «o modelo não resolveu».
    // Variar continua a ser o objetivo; o que não pode é variar para CIMA. Estes parâmetros passam
    // a variar dentro de um teto pequeno, que preserva a novidade da entrada sem comprar o custo.
    // ⚠️ E A MAGNITUDE TEM DOIS SENTIDOS OPOSTOS — quase embarquei a regra errada para metade deles.
    // Para uma CONTAGEM ou DURAÇÃO, pequeno é barato. Para uma ÉPOCA, pequeno é CARÍSSIMO:
    // `epoch_milliseconds=2` são 2 ms depois de 1970, e a tarefa percorre dali até hoje — 56 anos.
    // Verifiquei imprimindo as chamadas geradas antes de dar o conserto por bom, e a /489 tinha
    // ficado PIOR do que estava. É a mesma família de erro do dia inteiro: uma regra só aplicada a
    // dois sentidos opostos.
    const CONTAGEM = /(duration|interval|seconds|segundos|timeout|delay|sleep|^n_?iter|repeat|rounds|passos|steps|samples|n_?samples|limit|max_)/i;
    const EPOCA = /(epoch|timestamp|_ms$|millis|_time$|since)/i;
    for (let k = 0; k < quantas && chamadas.length < 6; k++) {
      let v = gen(base, k);
      if (v === base) continue;                // igual à base não é entrada nova
      // o teto vale para o parâmetro VARIADO e para os que ficam na base: uma entrada barata no
      // eixo variado não serve de nada se outro eixo continuar a pagar o tempo.
      const teto = (q, val) => {
        if (!/^-?\d+$/.test(String(val))) return val;
        // contagem/duração: pequeno é barato
        if (CONTAGEM.test(q.nome) && !EPOCA.test(q.nome)) return String(2 + (k % 3));
        // ⚠️ ÉPOCA que a função PERCORRE ATÉ «now»: âncora FIXA (Jan 2025) fica a MESES de now → a
        // função itera milhões de passos → timeout (NAO-MEDIDA), e nem é reproduzível — «now» avança a
        // cada corrida, então o range CRESCE. Medido /489. A única saída é epoch PERTO de now, por
        // EXPRESSÃO em runtime (minutos atrás): janela pequena, e dentro de UMA corrida todas as
        // soluções veem ~o mesmo now (deriva de ms << passo mínimo de 1s → MESMO nº de passos → comparável).
        if (EPOCA.test(q.nome)) return `int((__import__('time').time() - ${180 * (k + 1)}) * 1000)`;  // (k+1)×3min atrás
        return val;
      };
      v = teto(p, v);
      if (v === base) continue;
      const args = params.map((q) => `${q.nome}=${teto(q, q === p ? v : valorBase(q))}`).filter((a) => !/=null$/.test(a));
      chamadas.push(`${fn}(${args.join(", ")})`);
    }
  }
  // ⚠️ CHAMADA-BASE quando NADA varia. Medido nas SQLite /73/408/537/926: todos os params são
  // FORMA pinada (caminho de db, table_name, column_name, query) e o laço, que só emite ao VARIAR,
  // saía vazio → «nenhum parâmetro sintetizável» = NÃO-MEDIDA. Mas há UMA entrada válida e legível:
  // a chamada com todos os params no valorBase. Uma só entrada ainda mede a CONCORDÂNCIA entre
  // famílias (todas iguais → GENERALIZA; divergem → DIVERGE); é menos potente que variar, não é nada.
  if (!chamadas.length) {
    const args = params.map((q) => `${q.nome}=${valorBase(q)}`).filter((a) => !/=null$/.test(a));
    if (args.length) return { chamadas: [`${fn}(${args.join(", ")})`], montagens: [[]], motivo: null };
    return { chamadas: [], montagens: [], motivo: "nenhum parâmetro com tipo sintetizável" };
  }
  return { chamadas, montagens: chamadas.map(() => []), motivo: null };
}

// ── O PROGRAMA ───────────────────────────────────────────────────────────────────────────────────
// Cada solução roda no SEU PRÓPRIO namespace — senão a segunda sobrescreve a primeira e o
// diferencial compara uma solução consigo mesma, que concorda sempre.
// ⚠️ A MONTAGEM DO DOCTEST USA OS IMPORTS DO ENUNCIADO, NÃO OS DA SOLUÇÃO. Medido na /140: a
// montagem faz `np.random.seed(0)` e a solução só importa `pandas` e `sklearn` — ela não PRECISA de
// numpy, quem precisa é o exemplo. Resultado: `NAO-CARREGA:NameError` em todas as entradas, e o
// controlo positivo saía «nenhuma entrada rodou» sem dizer que o culpado era o meu programa.
// É a mesma lição do preâmbulo que já custou 3 soluções no codegen: **o enunciado é o início do
// arquivo**, e o que ele importa faz parte do ambiente de qualquer coisa que ele mostra.
function importsDoEnunciado(prompt) {
  return String(prompt || "").split(/\n\s*def\s/)[0].split("\n")
    .filter((l) => /^\s*(import|from)\s+\S/.test(l)).map((l) => l.trim());
}

function programaDiferencial(solucoes, montagens, chamadas, aleatoria, prompt = "") {
  const imports = importsDoEnunciado(prompt);
  const b64 = solucoes.map((s) => Buffer.from(String(s), "utf8").toString("base64"));
  // cada ENTRADA tem a sua montagem; e cada (solução × entrada) roda num namespace FRESCO, senão
  // a montagem da entrada seguinte herda o estado da anterior e as entradas deixam de ser distintas
  const monts = Array.isArray(montagens[0]) ? montagens : chamadas.map(() => montagens);
  // HELPER CSV-COLUNAS (2026-08-11): tarefas que leem CSV com colunas NOMEADAS (o docstring di-las —
  // /7: «two columns: 'product' and 'quantity'») recebiam um CSV genérico (col_a,col_b,col_c) →
  // KeyError em TODAS as soluções → 0 comparáveis, NÃO-MEDIDA. Infere as colunas do enunciado e o
  // `_cria_recurso` monta um CSV com ELAS + dados do tipo certo (número por nome, senão string).
  const csvCols = (() => {
    const m = String(prompt).match(/columns?\b[^.]{0,60}?((?:['"][a-zA-Z_][\w ]*['"][,\s]*(?:and\s+)?){2,})/i);
    if (!m) return [];
    return [...m[1].matchAll(/['"]([a-zA-Z_][\w ]*)['"]/g)].map((x) => x[1]).slice(0, 8);
  })();
  // SQLite LEITOR: um `.db` só se pré-cria (populado) quando a tarefa LÊ — sinal = param `column_name`
  // ou `query`. Para ESCRITOR (num_entries/users/seed, sem coluna/query) não se pré-cria: ele abre um
  // db vazio e CRIA a própria tabela; pré-popular colidiria (`table already exists`). Sem barra o
  // literal `'test.db'` não entra no pré-criador de paths, e `sqlite3.connect` não levanta FileNotFound.
  const dbPrecreate = /\b(column_name|columnname)\b/i.test(String(prompt).match(/^\s*def\s+\w+\s*\(([^)]*)\)/m)?.[1] || "")
    || /(^|,)\s*query\b/i.test(String(prompt).match(/^\s*def\s+\w+\s*\(([^)]*)\)/m)?.[1] || "");
  // PARAMETERLESS: a chamada é `fn()` sem argumentos — força semente (a variação é interna, tem de ser
  // controlada) e liga a checagem de determinismo por dupla-execução (Herbert 2026-08-12).
  const semParam = chamadas.length === 1 && /^\w+\(\s*\)$/.test(String(chamadas[0] || ""));
  return [
    "import base64, json, random",
    "import re as _re2",   // normaliza repr de matplotlib Axes/Figure — estilo não é dado
    "try:\n    import numpy as _np\nexcept Exception:\n    _np = None",
    // ⚠️ PLOT COMO DADO, NÃO COMO HANDLE. O repr de um Axes/Figure é uma handle opaca (`<Axes: ...>`),
    // que a normalização colapsava a `<AXES>` — e daí a checagem de comparabilidade descartava a entrada
    // (começa com `<`). Resultado: TODA tarefa que devolve plot era NAO-MEDIDA. Aqui extrai-se o DADO
    // PLOTADO (xdata/ydata das linhas, alturas das barras, offsets dos scatters), NÃO os rótulos
    // (título/xlabel são cosméticos — a /1060 divergia só em xlabel; comparar dado, não estilo). Prefixo
    // `PLOT:` = string normal e comparável: dois plots do mesmo dado concordam, dados diferentes divergem.
    "def _plot_data(_o):\n" +
    "    try:\n" +
    "        from matplotlib.figure import Figure as _Fig\n" +
    "        from matplotlib.axes import Axes as _Ax\n" +
    "        if isinstance(_o, _Fig): _axs = list(_o.get_axes())\n" +
    "        elif isinstance(_o, _Ax): _axs = [_o]\n" +
    "        else: return None\n" +
    "        _out = []\n" +
    "        for _ax in _axs:\n" +
    "            _ln = []\n" +
    "            for _l in _ax.get_lines():\n" +
    "                try: _ln.append([[round(float(_x),6) for _x in _l.get_xdata()], [round(float(_y),6) for _y in _l.get_ydata()]])\n" +
    "                except Exception: pass\n" +
    "            _bars = []\n" +
    "            for _p in getattr(_ax, 'patches', []):\n" +
    "                try: _bars.append(round(float(_p.get_height()),6))\n" +
    "                except Exception: pass\n" +
    "            _coll = []\n" +
    "            for _c in getattr(_ax, 'collections', []):\n" +
    "                try: _coll.append(sorted([[round(float(_a),6),round(float(_b),6)] for _a,_b in _c.get_offsets()]))\n" +
    "                except Exception: pass\n" +
    "            _out.append([sorted(_ln), sorted(_bars), _coll])\n" +
    "        return 'PLOT:' + json.dumps(_out, sort_keys=True)\n" +
    "    except Exception:\n" +
    "        return None",
    `_IMPORTS = ${JSON.stringify(imports)}`,
    `_SOL = ${JSON.stringify(b64)}`,
    `_CH = ${JSON.stringify(chamadas)}`,
    `_MONTS = ${JSON.stringify(monts)}`,
    `_CSV_COLS = ${JSON.stringify(csvCols)}`,
    `_DB_PRECREATE = ${dbPrecreate ? "True" : "False"}`,
    // gera um CSV com as colunas inferidas: número para nomes que o sugerem, senão rótulo textual
    "def _gera_csv(_cols):",
    "    _NUM = ('quantity','count','age','price','num','amount','id','year','score','qty','total','value','sales','number','rating','stock')",
    "    def _cell(_c, _i):",
    "        _cl = _c.lower()",
    "        return str(10 * (_i + 1)) if any(_k in _cl for _k in _NUM) else _c.split()[0].capitalize() + str(_i + 1)",
    "    _linhas = [','.join(_cols)] + [','.join(_cell(_c, _i) for _c in _cols) for _i in range(4)]",
    "    return '\\n'.join(_linhas) + '\\n'",
    `_ALEA = ${(aleatoria || semParam) ? "True" : "False"}`,
    `_SEMPARAM = ${semParam ? "True" : "False"}`,
    // ⚠️ O DOCTEST ASSUME UMA SESSÃO INTERATIVA, e o enunciado nem sempre importa o que ele usa.
    // Medido na /140: o preâmbulo importa `pandas` e `sklearn`, e o exemplo faz `np.random.seed(0)`
    // — `numpy` não é importado em lado nenhum do enunciado. O exemplo NÃO É AUTO-CONTIDO, e a
    // montagem morria em `NameError: name 'np' is not defined` mesmo depois de eu injetar os
    // imports declarados. O extractor estava certo; o enunciado é que está incompleto.
    // Fornecer o ambiente que o exemplo pressupõe não inventa comportamento — restitui o que ele
    // assume. Entra ANTES dos imports declarados, para o alias do próprio enunciado ganhar sempre.
    // ⚠️ O DJANGO É CONFIGURADO PELA SUÍTE, E EU NÃO CORRO A SUÍTE. Medido na /181: a solução usa
    // `django.http.HttpResponse`, e é o `setUp` do teste que chama `settings.configure()`. O meu
    // programa executa a solução e a chamada SEM a suíte, logo o Django nunca é configurado e sai
    // `ImproperlyConfigured` em todas as 9 execuções — que eu contava como falha da tarefa.
    // Restituir o ambiente que a suíte pressupõe não inventa comportamento: é a mesma razão pela
    // qual esta lista já existe. Entra no fim, e falha em silêncio se o Django não estiver presente.
    "_AMBIENTE = ['import numpy as np', 'import pandas as pd', 'import matplotlib', 'import matplotlib.pyplot as plt', 'import random', 'import os', 'import re', 'import json', 'import math', 'from datetime import datetime, timedelta, date', 'import time', 'import collections', 'import itertools', 'from django.conf import settings\\nif not settings.configured: settings.configure(DEBUG=True, ALLOWED_HOSTS=[\"*\"])']",
    // conteúdo escolhido pela EXTENSÃO, não pelo enunciado: um conteúdo errado falha em todas as
    // soluções por igual, a entrada sai como não-comparável e é DESCARTADA — nunca vira acusação.
    "def _cria_recurso(_p):",
    "    try:",
    "        import os as _os",
    "        _d = _os.path.dirname(_p)",
    "        if _d: _os.makedirs(_d, exist_ok=True)",
    "        _e = _os.path.splitext(_p)[1].lower()",
    "        if not _e:",
    "            _os.makedirs(_p, exist_ok=True)",           // sem extensão: provavelmente um diretório
    "            with open(_os.path.join(_p, 'dados.csv'), 'w') as _f: _f.write('col_a,col_b,col_c\\n1,4,alfa\\n2,5,beta\\n3,6,gama\\n')",
    "            with open(_os.path.join(_p, 'outro.csv'), 'w') as _f: _f.write('col_a,col_b,col_c\\n7,8,delta\\n9,10,epsilon\\n')",
    `            with open(_os.path.join(_p, 'dados.json'), 'w') as _f: _f.write('{"col_a": [1, 2], "col_b": [3, 4]}')`,
    // ⚠️ DIVERSIDADE DE ARQUIVOS p/ casar patterns comuns das tarefas de arquivo (classe fixture-diretório,
    // 12 tarefas): extensões variadas + nomes que casam globs/regex típicos (file1.txt, data.log, app.log,
    // report.md, backup.bak) → a tarefa que varre/filtra/move ACHA arquivos, em vez de trivial 'moveu 0'.
    "            for _n in ('a.txt', 'b.txt', 'file1.txt', 'file2.txt', 'data.log', 'app.log', 'report.md', 'notes.txt', 'backup.bak', 'index.html', 'test1.py'):",
    "                with open(_os.path.join(_p, _n), 'w') as _f: _f.write('alfa\\nbeta\\ngama\\n123\\n')",
    "            return True",
    "        if _e == '.csv': _t = _gera_csv(_CSV_COLS) if _CSV_COLS else 'col_a,col_b,col_c\\n1,4,alfa\\n2,5,beta\\n3,6,gama\\n'",
    "        elif _e == '.json': _t = '{\"col_a\": [1, 2, 3], \"col_b\": [4, 5, 6]}'",
    // SQLite: um `.db` não é texto — cria-se com a própria lib e POPULA-SE a tabela `data_table` (nome
    // que o gerador pina em `table_name`) com a coluna `text_column`. Um leitor abre-a e SELECTa; sem
    // isto `sqlite3.connect` faz um db VAZIO e o `SELECT` sai `no such table` em todas as soluções.
    "        elif _e in ('.db', '.sqlite', '.sqlite3'):",
    "            import sqlite3 as _sqi",
    "            _cnx = _sqi.connect(_p)",
    "            _cnx.execute('CREATE TABLE IF NOT EXISTS data_table (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, value INTEGER, text_column TEXT)')",
    "            _cnx.executemany('INSERT INTO data_table (name, value, text_column) VALUES (?,?,?)', [('Alice', 10, 'abc12x'), ('Bob', 20, '7X ref'), ('Charlie', 30, 'no digits'), ('Dave', 40, '99X and 3x')])",
    "            _cnx.commit(); _cnx.close(); return True",
    "        elif _e in ('.yaml', '.yml'): _t = 'col_a: 1\\ncol_b: 2\\n'",
    "        elif _e == '.xml': _t = '<raiz><item a=\"1\"/><item a=\"2\"/></raiz>'",
    // ⚠️ MESMO BURACO, SEGUNDO LUGAR. A tabela por extensão da RECEITA e a deste criador em tempo
    // de execução são duas cópias da mesma decisão, e eu já paguei sete meias-correções por tratar
    // só uma. A /604 pede um `.cpp` e recebia `alfa\nbeta\ngama`: a tarefa lê código, não achava
    // nada, nenhuma entrada rodava e o juiz estrangeiro não conseguia opinar.
    "        elif _e in ('.cpp', '.cc', '.cxx'): _t = '#include <iostream>\\nint soma(int a, int b) { return a + b; }\\nint main() { std::cout << soma(1, 2); return 0; }\\n'",
    "        elif _e == '.c': _t = '#include <stdio.h>\\nint soma(int a, int b) { return a + b; }\\nint main() { printf(\"%d\", soma(1, 2)); return 0; }\\n'",
    "        elif _e == '.py': _t = 'def soma(a, b):\\n    return a + b\\n\\nclass Coisa:\\n    def metodo(self):\\n        return 1\\n'",
    "        elif _e == '.java': _t = 'public class Main {\\n    public static int soma(int a, int b) { return a + b; }\\n}\\n'",
    "        elif _e == '.js': _t = 'function soma(a, b) { return a + b; }\\nconst x = soma(1, 2);\\n'",
    "        elif _e == '.html': _t = '<html><body><h1>alfa</h1><p>beta gama</p></body></html>\\n'",
    "        elif _e == '.md': _t = '# alfa\\n\\nbeta gama\\n'",
    // ⚠️ IMAGEM NÃO SE ESCREVE COM TEXTO. Medido na /423: o recurso era criado, o arquivo existia, e
    // saía `FileNotFoundError: Could not read image: x.jpg` — porque eu punha `alfa\nbeta\ngama`
    // dentro dele. O erro diz «not found» e o arquivo ESTÁ lá: o que falta é ser uma imagem.
    // 15 das 47 falhas de chamada eram esta classe mais a biblioteca de sistema.
    // Escreve-se com a própria biblioteca que a tarefa usa, e volta-se ao texto só se ela faltar.
    "        elif _e in ('.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'):",
    "            try:",
    "                import numpy as _np2, cv2 as _cv2",
    "                _img = _np2.zeros((64, 64, 3), dtype=_np2.uint8); _img[16:48, 16:48] = 200",
    "                _cv2.imwrite(_p, _img)",
    "                return True",
    "            except Exception:",
    "                try:",
    "                    from PIL import Image as _Im",
    "                    _Im.new('RGB', (64, 64), (127, 127, 127)).save(_p)",
    "                    return True",
    "                except Exception:",
    "                    _t = 'alfa\\nbeta\\ngama\\n'",
    "        else: _t = 'alfa\\nbeta\\ngama\\n'",
    "        with open(_p, 'w') as _f: _f.write(_t)",
    "        return True",
    "    except BaseException:",
    "        return False",
    "import tempfile as _tf_iso, shutil as _sh_iso, os as _os_iso",
    "_base_work = _tf_iso.mkdtemp(); _cwd_orig = _os_iso.getcwd()",
    "for _j, _c in enumerate(_CH):",
    "    _outs = []",
    "    for _i, _s in enumerate(_SOL):",
    // ── ISOLAMENTO DE FILESYSTEM POR SOLUÇÃO (pppp·Z, 2026-08-10) ─────────────────────────────────
    // Sem isto, as N soluções corriam EM SEQUÊNCIA no MESMO filesystem, e uma solução com efeito
    // colateral (mover/apagar/escrever) mutava o estado das SEGUINTES. MEDIDO na /783: a 1ª solução
    // move os 2 .txt e ESVAZIA o src; as seguintes veem 0 → falso-DIVERGE. Prova em Python real: 3
    // impls LOGICAMENTE IDÊNTICAS dão 2/0/0 em série e 2/2/2 isoladas — a ordem decidia a acusação.
    // O `_work` é o MESMO path por ENTRADA (para que um path DEVOLVIDO pela função não difira entre
    // soluções e crie outra divergência espúria), RESETADO antes de cada solução → todas partem do
    // mesmo estado inicial. É o invariante que este instrumento afirma: «mesma entrada → mesma saída».
    "        _os_iso.chdir(_cwd_orig); _work = _os_iso.path.join(_base_work, 'e%d' % _j); _sh_iso.rmtree(_work, ignore_errors=True); _os_iso.makedirs(_work, exist_ok=True); _os_iso.chdir(_work)",
    "        _g = {'__name__': '__main__'}",
    "        try:",
    "            for _amb in _AMBIENTE:",
    "                try: exec(_amb, _g)",
    "                except Exception: pass",
    "            for _imp in _IMPORTS:",
    "                try: exec(_imp, _g)",
    "                except Exception: pass",
    "            exec(base64.b64decode(_s).decode('utf-8'), _g)",
    // ⚠️ A MONTAGEM TAMBÉM PRECISA DO RECURSO. Medido na /378: o retry envolvia só a CHAMADA, e ela
    // morria antes disso, na montagem — `<NAO-CARREGA:FileNotFoundError>`. Meia correção num
    // caminho de duas etapas não corrige nada: fica igual, com outra etiqueta.
    // ⚠️ A MONTAGEM É UM PROGRAMA, NÃO UMA LISTA DE LINHAS INDEPENDENTES. Exec'ar linha a linha
    // rebenta em todo bloco do doctest: `with open(...) as f:` sozinho é um cabeçalho sem corpo e
    // o Python levanta `IndentationError` ANTES de olhar para o conteúdo. Medido: 12 IndentationError
    // (/96, /77) e 9 SyntaxError (/879) — nenhum era defeito da solução nem da minha receita, era o
    // emissor a partir blocos ao meio. Juntar por `\n` e exec'ar UMA vez restitui o bloco.
    // O retry de recurso passa a envolver o programa inteiro: reexecutar do início depois de criar
    // o arquivo é o comportamento correto, e a montagem é idempotente por construção (o mundo é
    // recriado por entrada num namespace fresco).
    "            _mont = '\\n'.join(_MONTS[_j])",
    "            _t2 = 0",
    "            while _mont.strip():",
    "                try:",
    "                    exec(_mont, _g); break",
    "                except FileNotFoundError as _fe:",
    "                    _a2 = getattr(_fe, 'filename', None); _t2 += 1",
    "                    if not _a2 or _t2 > 3 or not _cria_recurso(_a2): raise",
    "        except BaseException as _e:",
    "            _outs.append('<NAO-CARREGA:' + type(_e).__name__ + '>'); continue",
    "        try:",
    // ⚠️ SEMENTE IDÊNTICA ANTES DE CADA CHAMADA. Sem isto, uma função aleatória dá saídas
    // diferentes por construção e o diferencial acusaria todas as soluções, sempre.
    "            if _ALEA:",
    "                random.seed(12345)",
    "                if _np is not None: _np.random.seed(12345)",
    // ⚠️ O RECURSO QUE A ENTRADA NOMEIA TEM DE EXISTIR. Medido: a /7 saiu `NAO-MEDIDA` com
    // `FileNotFoundError × 16` — o gerador sintetizou um caminho e ninguém criou o arquivo, logo
    // NENHUMA solução rodou e o veredito culpava a tarefa por uma omissão do meu aparato.
    // NÃO adivinho quais literais são caminhos: `y`, `b,c` e `mcpt` apareceram na minha própria
    // sondagem estática como se fossem, e não são. Quem sabe é o RUNTIME — o `FileNotFoundError`
    // traz o nome exato em `.filename`. Crio o que ele pedir e repito, até 3 vezes.
    // O recurso é criado (lazy) DENTRO do `_work` isolado de cada solução — que é resetado ao mesmo
    // estado inicial antes de cada uma (ver o bloco ISOLAMENTO DE FILESYSTEM acima). A comparação
    // continua a ser «mesma entrada → mesma saída», e agora isso vale também sob efeito colateral.
    // ⚠️ CRIAÇÃO PROATIVA de cenários de PATH (2026-08-12): a criação lazy acima só dispara no
    // FileNotFoundError — e a solução pode ENGOLI-LO (return [] para dir inexistente/vazio), deixando o
    // cenário por exercitar. Medido /939 (rename num dir): 3 soluções devolvem [] e concordam no VAZIO.
    // Respeitando a regra do autor (não adivinhar paths), só pré-crio literais INEQUÍVOCOS: os que têm
    // `/`. `_cria_recurso` de um path sem extensão faz o DIR com ficheiros (a.txt, b.txt, csv, json) — o
    // cenário que a tarefa precisa. Guardado (try/except) e dentro do _work isolado desta solução.
    "            for _mp in _re2.finditer(r'''(['\"])(.*?)\\1''', _c):",
    "                _p0 = _mp.group(2)",
    "                if _p0 and ('/' in _p0 or (_DB_PRECREATE and _p0.lower().endswith(('.db', '.sqlite', '.sqlite3'))) or _p0.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.gif', '.csv', '.json', '.txt', '.xml', '.yaml', '.yml', '.md', '.log', '.tsv', '.dat'))):",
    "                    try: _cria_recurso(_p0)",
    "                    except Exception: pass",
    "            _r = None; _tent = 0",
    "            while True:",
    "                try:",
    "                    _r = eval(_c, _g); break",
    "                except FileNotFoundError as _fe:",
    "                    _alvo = getattr(_fe, 'filename', None)",
    "                    _tent += 1",
    "                    if not _alvo or _tent > 3: raise",
    "                    if not _cria_recurso(_alvo): raise",
    // ⚠️ DETERMINISMO por DUPLA-EXECUÇÃO (parameterless). Sem eixo de entrada, a única fonte de variação
    // é aleatoriedade interna. A semente fixa domestica random/np.random; o que NÃO é semeável (os.urandom,
    // time, uuid) daria falso-DIVERGE. Roda `fn()` outra vez sob a MESMA semente: se o repr diferir, a
    // função é não-determinística → marca `<NAO-DET>` (não-comparável, como <ERRO>), não acusa o modelo.
    "            if _SEMPARAM:",
    "                try:",
    "                    if _ALEA:",
    "                        random.seed(12345)",
    "                        if _np is not None: _np.random.seed(12345)",
    "                    _r2 = eval(_c, _g)",
    "                    if repr(_r2) != repr(_r): _r = '<NAO-DET>'",
    "                except BaseException:",
    "                    pass",
    // ⚠️ O REPR DE UM OBJETO MATPLOTLIB NÃO É O VALOR DE RETORNO — é uma handle de renderização, e
    // o seu texto inclui ESTILO (xlabel, ylabel, título) que duas soluções CORRETAS podem legitimamente
    // diferir. Medido na /1060: as 4 entradas divergentes diferiam SÓ em `xlabel='Values'` — o MZ
    // rotulou os eixos, o controle não; a string de dados era idêntica. Isso fez a /1060 sair como
    // «DIVERGE-FORA-DA-SUITE» e as duas famílias «confirmaram» o mesmo ruído cosmético. É a mesma
    // classe de FORMA vs CONTEÚDO: o Axes é forma de apresentação, não o dado que a função devolve.
    // Normaliza-se o repr de Axes/Figure a um marcador opaco (presente/ausente, não igual-por-estilo);
    // o resto do valor continua comparado byte a byte.
    "            _pd = _plot_data(_r)",
    // HttpResponse/JsonResponse (Django, ~4 tarefas): a handle é opaca; o VALOR é status + corpo.
    "            if _pd is None and hasattr(_r, 'status_code') and hasattr(_r, 'content'):",
    "                try:\n                    _cnt = _r.content\n                    _cnt = _cnt.decode('utf-8') if isinstance(_cnt, (bytes, bytearray)) else str(_cnt)\n                    _pd = 'RESP:' + str(getattr(_r, 'status_code', '')) + ':' + _cnt\n                except Exception:\n                    _pd = None",
    "            if _pd is not None:",
    "                _rep = _pd[:2000]",   // dado plotado / corpo de resposta extraído: comparável
    "            else:",
    "                _rep = repr(_r)",
    "                _rep = _re2.sub(r'<Axes:[^>]*>', '<AXES>', _rep)",
    "                _rep = _re2.sub(r'<Figure[^>]*>', '<FIGURE>', _rep)",
    "                _rep = _re2.sub(r' at 0x[0-9a-fA-F]+', '', _rep)",
    "                _rep = _rep[:400]",
    "            _outs.append(_rep)",
    "        except BaseException as _e:",
    "            _outs.append('<ERRO:' + type(_e).__name__ + '>')",
    "    print('ENTRADA %d :: %s' % (_j, json.dumps(_outs)))",
    "_os_iso.chdir(_cwd_orig); _sh_iso.rmtree(_base_work, ignore_errors=True)",
    "print('DIFERENCIAL FIM')",
  ].join("\n");
}

// ── O VEREDITO ───────────────────────────────────────────────────────────────────────────────────
// `solucoes[0]` é sempre a do MZ; as restantes são os controlos independentes.
// ⚠️ A PRIMEIRA VERSÃO DISTO ERA UM REGEX, E ERRAVA 7 DE 22 REPRS REAIS. Perdia exatamente os
// vazios mais comuns do Python — `Counter()`, `array([], dtype=float64)`, `Empty DataFrame`,
// `Series([], dtype: float64)`, `defaultdict(<class 'list'>, {})`, `[[], []]`, `0.00` — que são o
// retorno típico de uma função que recebeu entrada vazia, ou seja, precisamente o caso que o
// guarda existe para apanhar. Um guarda estreito demais é pior do que nenhum: dá a sensação de
// cobertura e deixa passar a classe que motivou a sua escrita.
const ehDegenerada = (s) => {
  const t = String(s).trim();
  if (!t) return true;
  // ⚠️ PLOT VAZIO É DEGENERADO. Um Axes sem linhas/barras/scatter extrai para `PLOT:[[[],[],[]]]` — zero
  // dado plotado. Sem esta guarda, TODA solução que devolve um plot vazio (ou que plotou nada) concordaria
  // trivialmente → falso-fecho, e o risco escala a ~276 tarefas-plot do bench. Degenerado = sem número.
  if (t.startsWith("PLOT:")) return !/\d/.test(t.slice(5));
  if (t.startsWith("RESP:")) { const b = t.slice(5).replace(/^\d*:/, ""); return !b.replace(/[[\]{}(),\s'":]/g, ""); }
  if (/^-?0(\.0*)?$/.test(t)) return true;                       // 0 · 0.0 · 0.00 · -0
  if (/^(None|False|set\(\)|frozenset\(\))$/.test(t)) return true;
  if (/^Empty DataFrame\b/.test(t)) return true;                 // repr multilinha do pandas
  if (/^(Series|array|Index|DataFrame)\(\[\]/.test(t)) return true;
  // contentores vazios, inclusive aninhados e com nome de tipo à frente:
  //   [] · {} · () · Counter() · OrderedDict() · defaultdict(<class 'list'>, {}) · [[], []]
  const semTipo = t.replace(/^[A-Za-z_][\w.]*\(/, "(").replace(/<class '[^']*'>,?\s*/g, "");
  return semTipo.replace(/[[\]{}(),\s'"]/g, "") === "";
};

// forma canônica para o INVARIANTE DE ORDEM: uma lista Python PLANA de escalares ordena-se. NÃO toca
// estruturas aninhadas (bracket interno ⇒ salta — conservador, para não quebrar dict/tupla/lista-de-lista
// nem strings com colchetes). Não-lista volta igual. Usada só quando os controlos discordam entre si.
function normalizaInvariante(repr) {
  const s = String(repr).trim();
  if (s.length > 2 && s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner && !/[[\]{}()]/.test(inner)) {
      return "[" + inner.split(/,\s*/).map((x) => x.trim()).sort().join(", ") + "]";
    }
  }
  return s;
}

function julga(linhas) {
  const entradas = [];
  for (const l of linhas) {
    const m = l.match(/^ENTRADA \d+ :: (.*)$/);
    if (!m) continue;
    try { entradas.push(JSON.parse(m[1])); } catch { /* linha ilegível: não conta */ }
  }
  // ⚠️ ESTE RAMO ERA MUDO, E É O QUE MAIS DISPARA. Hoje corrigi a agregação de causas do descarte
  // — mas ela lê as causas das linhas `ENTRADA`, e AQUI não existe linha `ENTRADA` nenhuma: o
  // programa nem chegou a imprimir. «não produziu nenhuma entrada comparável» descreve o sintoma e
  // esconde a única coisa acionável, que é o traceback. Um sinal mudo um nível acima do que eu
  // acabara de desmutar — a mesma falha, deslocada.
  if (!entradas.length) {
    const cru = linhas.map((l) => String(l).trim()).filter(Boolean);
    const chegouAoFim = cru.some((l) => l.includes("DIFERENCIAL FIM"));
    // a última linha de um traceback Python é a que nomeia o erro; é ela que diz o DONO da falha
    const erro = [...cru].reverse().find((l) => /^[A-Za-z_.]*(Error|Exception)\b/.test(l))
      || cru.slice(-3).join(" ⏎ ") || "(saída completamente vazia)";
    return { veredito: "NAO-MEDIDA", comparaveis: 0, chegouAoFim, erroDoPrograma: erro,
      detalhe: `o programa diferencial não imprimiu uma única linha ENTRADA${chegouAoFim ? " (chegou ao fim, logo o laço não iterou: o gerador não produziu chamadas)" : " e nem chegou ao fim, logo abortou antes"} — ${erro}` };
  }

  // ⚠️ CONCORDÂNCIA NUM CASO DEGENERADO NÃO É EVIDÊNCIA DE NADA, e isto já me deu fechos falsos.
  // A `/759` mocka `os.walk`/`shutil.move`/`os.listdir`; o diferencial chama-a com diretórios que o
  // MEU criador de recursos acabou de criar VAZIOS, e as três soluções devolvem a mesma resposta
  // trivial — «movi 0 arquivos». Eu lia isso como generalidade. É a armadilha do mock um nível
  // abaixo: em vez de conformar-se ao mock, agora concordo com o vazio.
  // Saída degenerada = o valor que uma função devolve quando NÃO TEM O QUE FAZER. Se TODAS as
  // entradas comparáveis concordam nisso, a evidência é vácua e o veredito tem de o dizer.
  let comparaveis = 0, concordam = 0, divergeMZ = 0, concordamNaoVazias = 0;
  const divergentes = [];   // ADITIVO: o par (saída MZ vs referência) por entrada divergente — sinal do reparo dirigido
  for (const outs of entradas) {
    // ⚠️ UMA ENTRADA QUE NÃO CORRE NÃO É EVIDÊNCIA — descarta-se, não se conta como discordância.
    // Mesma regra que salvou o oráculo do produto de destruir código correto.
    if (outs.some((o) => String(o).startsWith("<"))) continue;
    comparaveis++;
    const mz = outs[0], ctrls = outs.slice(1);
    const todosIguais = outs.every((o) => o === mz);
    if (todosIguais) { concordam++; if (!ehDegenerada(mz)) concordamNaoVazias++; continue; }
    const ctrlsIguais = ctrls.length >= 2 && ctrls.every((o) => o === ctrls[0]);
    // os controlos concordam entre si e o MZ é que difere ⇒ é o MZ que se comporta diferente. Aqui a
    // ordem/valor IMPORTA (as referências fixaram-na), logo NÃO se aplica o invariante — seria mascarar.
    if (ctrlsIguais && mz !== ctrls[0]) {
      divergeMZ++;
      if (divergentes.length < 6) divergentes.push({ mz: String(mz).slice(0, 300), ref: String(ctrls[0]).slice(0, 300) });
      continue;
    }
    // ⚠️ INVARIANTE DE ORDEM (não-determinismo de FORMA, 2026-08-12): se os controlos DISCORDAM entre si
    // na saída crua, a ordem não é fixada pela spec (implementações independentes escolheram ordens
    // diferentes — ex.: ordem de `glob` na /939). Sob a forma canônica (lista ordenada), se TODOS
    // concordam, o que variava era a forma não-determinística, não a lógica → concorda no INVARIANTE.
    // Só entra quando os controlos NÃO concordam cru (senão a ordem importa e o ramo acima decidiu).
    // Salt/hash aleatório (não-lista) não normaliza → segue não-comparável e cai em INCONCLUSIVA.
    if (!ctrlsIguais) {
      const norm = outs.map(normalizaInvariante);
      if (norm.every((o) => o === norm[0])) { concordam++; if (!ehDegenerada(norm[0])) concordamNaoVazias++; }
    }
  }

  // ⚠️ «0 COMPARÁVEIS» É MUDO E EU DEIXEI-O ASSIM DUAS VEZES. No bloco 3 a /981 e a /670 saíram com
  // «nenhuma entrada rodou» sem dizer POR QUÊ — e a causa muda tudo: se é `NameError`, o defeito é
  // do meu ambiente; se é `ValueError`, a entrada viola uma pré-condição e o gerador é que erra; se
  // é `<NAO-CARREGA>`, nem a solução carregou. Três causas, três donos, e uma só mensagem.
  // É a mesma família do escritor mudo, agora no agregado: o detalhe existia por entrada e eu
  // colapsava-o num número.
  if (!comparaveis) {
    const causas = {};
    for (const outs of entradas) for (const o of outs) {
      // ⚠️ O PREFIXO FICA. Colapsar `NAO-CARREGA` e `ERRO` no mesmo nome de exceção esconde a ETAPA,
      // e a etapa é que diz o dono: morrer na MONTAGEM é o meu gerador a preparar mal o cenário;
      // morrer na CHAMADA é a solução a não lidar com o cenário. Foi essa distinção que me fez
      // corrigir só metade do caminho da /378 e ver o mesmo número com outra etiqueta.
      const m = String(o).match(/^<(NAO-CARREGA|ERRO):?([\w.]*)/);
      if (m) { const k = `${m[1] === "NAO-CARREGA" ? "montagem" : "chamada"}:${m[2] || "?"}`; causas[k] = (causas[k] || 0) + 1; }
    }
    const lista = Object.entries(causas).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" · ");
    return { veredito: "NAO-MEDIDA", causas,
      detalhe: `nenhuma das ${entradas.length} entradas rodou em todas as soluções — causas: ${lista || "(sem erro nomeado)"}. `
        + `NameError ⇒ ambiente meu · ValueError/TypeError ⇒ a entrada viola pré-condição e o gerador é que erra · NAO-CARREGA ⇒ nem a solução carregou` };
  }
  // ⚠️ A EXIGÊNCIA É ASSIMÉTRICA, e tem de ser, porque os dois erros não custam o mesmo:
  //     ABSOLVER  basta UM controlo independente. Ele passa a suíte ORIGINAL e computa o mesmo que
  //               a solução do MZ em entradas que NUNCA estiveram em teste nenhum — não há o que
  //               memorizar ali. Evidência mais fraca que com dois, e ainda assim evidência.
  //     ACUSAR    exigem-se DOIS que concordem ENTRE SI. Com um só, uma discordância não diz quem
  //               está errado — e acusar de MEMORIZAÇÃO com base em «diferiu de alguém» é o pior
  //               que este instrumento pode produzir.
  // Sem esta assimetria o método perde metade dos casos por não conseguir gerar o 2.º controlo:
  // medido na 1.ª corrida do controlo positivo, onde ele falhou em 3 de 5 tarefas por esse motivo.
  const nCtrls = (entradas[0] || []).length - 1;
  if (divergeMZ > 0 && nCtrls >= 2) {
    return { veredito: "DIVERGE-FORA-DA-SUITE", comparaveis, concordam, divergeMZ, nCtrls, divergentes,
      detalhe: `em ${divergeMZ} de ${comparaveis} entradas NOVAS os ${nCtrls} controlos independentes concordam entre si e a solução do MZ difere — ela comporta-se diferente fora da suíte` };
  }
  if (concordam !== comparaveis && nCtrls < 2) {
    return { veredito: "INCONCLUSIVA", comparaveis, concordam, nCtrls,
      detalhe: `houve discordância mas há só ${nCtrls} controlo — com um só não se sabe QUEM está errado, e acusar de memorização exige dois que concordem entre si` };
  }
  if (concordam === comparaveis) {
    // ⚠️ E SE TODA A CONCORDÂNCIA FOR SOBRE O VAZIO, NÃO FECHA. Uma função que recebe um diretório
    // vazio devolve «0 arquivos» em qualquer implementação, certa ou errada — três soluções
    // concordarem nisso não distingue nada. Não é acusação: é recusa de contar como prova aquilo
    // que não discrimina. Sai `ACORDO-VAZIO`, que fica ABERTO e diz o que falta ao cenário.
    if (!concordamNaoVazias) {
      return { veredito: "ACORDO-VAZIO", comparaveis, concordam, concordamNaoVazias,
        detalhe: `as ${concordam} entradas comparáveis concordam, mas TODAS numa saída degenerada (vazio/zero/None) — o cenário não exercitou a função. Concordar sobre o vazio não distingue solução correta de errada; falta um cenário com conteúdo` };
    }
    return { veredito: "GENERALIZA-DIFERENCIAL", comparaveis, concordam, concordamNaoVazias,
      detalhe: `${concordam} de ${comparaveis} entradas NOVAS (${concordamNaoVazias} com saída não-degenerada): a solução do MZ concorda com os controlos independentes em todas. Estas entradas nunca estiveram em teste nenhum, logo não há o que memorizar` };
  }
  return { veredito: "INCONCLUSIVA", comparaveis, concordam,
    detalhe: `${concordam} de ${comparaveis} concordam e as restantes divergem SEM os controlos concordarem entre si — a tarefa pode ser ambígua; não se acusa ninguém` };
}

// ⚠️ MONTAGEM ARRISCADA → NAO-CARREGA:NameError (44 ocorrências nas indecisas). O exemplo do docstring
// usa nomes que só existem na SUÍTE (não no docstring): (a) chama um HELPER de fixture
// (`create_dummy_csv_file(...)`, /579) que o autor define no teste, não na doc; (b) tem literal de
// arquivo SEM aspas (`open(temp_data.csv, ...)`, /96 — typo comum de docstring) que vira acesso a nome
// indefinido. Nos dois casos a montagem NÃO CARREGA e a tarefa sai NÃO-MEDIDA. A síntese-por-tipo é
// auto-contida (o `_cria_recurso` cria o arquivo), logo prefere-se ELA quando a montagem é arriscada.
function montagemArriscada(mont) {
  const txt = Array.isArray(mont) ? mont.join("\n") : String(mont || "");
  if (/\b(create|make|generate|build|setup|prepare|dummy|gen|mock|fake|sample)_\w+\s*\(/.test(txt)) return true;   // helper de fixture não-definido
  if (/\bopen\s*\(\s*[a-zA-Z_]\w*\.[a-zA-Z]\w*/.test(txt)) return true;   // open(arquivo.ext SEM aspas) → NameError
  // variável USADA mas não ATRIBUÍDA na montagem (ex.: `fig.show()` onde `fig` veio de linha não
  // capturada) → NameError. `conhecidas` = o que o _AMBIENTE fornece; `g` é a grade do preludio.
  const conhecidas = new Set(["np", "pd", "plt", "matplotlib", "os", "re", "json", "math", "random", "datetime", "timedelta", "date", "time", "collections", "itertools", "g", "settings"]);
  const atribuidas = new Set([...txt.matchAll(/(?:^|\n|;)\s*(?:for\s+)?([a-zA-Z_]\w*)\s*(?:=|in\b)/g)].map((m) => m[1]));
  const usadas = [...txt.matchAll(/\b([a-z_]\w*)\s*[.[]/g)].map((m) => m[1]);   // só atributo/índice (não `(`, senão flagava task_func(...))
  if (usadas.some((u) => !atribuidas.has(u) && !conhecidas.has(u) && !/^(str|int|float|list|dict|set|tuple)$/.test(u))) return true;
  return false;
}
// ⚠️ CASCATA, e a ordem importa: a variacao do EXEMPLO e evidencia mais forte (a entrada tem a
// forma que o autor mostrou) do que a sintese por TIPO (a forma e minha). So se usa a segunda
// quando a primeira nao produz nada, e o registro diz qual delas decidiu.
function entradasParaDiferencial(prompt, quantas = 4) {
  // ⚠️ SQLite ACOPLADO → SÍNTESE, não variação-do-exemplo. O mutador do exemplo (`entradasNovas`)
  // embaralha `table_name`/`column_name`/`query` do docstring, e o `_cria_recurso` cria uma tabela de
  // nome FIXO (`data_table`) — os dois descasam e sai `no such table`. A síntese por tipo pina os
  // identificadores para casarem a tabela criada. Só se desvia quando há caminho de db + um
  // identificador acoplado (table/column/query); as demais tarefas seguem a variação-do-exemplo.
  const sig = String(prompt).match(/^\s*def\s+\w+\s*\(([^)]*)\)/m)?.[1] || "";
  const sqliteAcoplado = /db_file|db_path|db_name|(^|[,\s])database\b|sqlite/i.test(sig)
    && /table_name|column_name|(^|[,\s])query\b/i.test(sig);
  // ⚠️ DataFrame + NOME-DE-COLUNA ACOPLADO → SÍNTESE, não variação (mesmo caso do SQLite). O mutador do
  // exemplo randomiza o literal da coluna (`col='gtxmy'`, /343) que NÃO existe no df → ValueError/KeyError
  // em todas as soluções → NAO-MEDIDA. A síntese (`entradasPorTipo`) pina a coluna a uma real do df
  // (`col='A'`). Só quando há df E um param que nomeia coluna.
  // `data` conta como df quando há col1/col2/col — col-params quase só existem para DataFrame (/879
  // `data, col1, col2`, param tipado DataFrame mas NÃO chamado `df`).
  const dfColunaAcoplado = /(^|[,(\s])(df|data|data_?frame|[a-z_]*_df)\b/i.test(sig)
    && /(^|[,(\s])(col\d*|column\d*|col_name|column_name|group_col|value_col|key_col|target_col|x_col|y_col)\b/i.test(sig);
  // param que é NOME DE MÓDULO/PACOTE a importar: o mutador do exemplo scrambleia para uma string que
  // não é importável (/541 `'owptd'` → ImportError). A síntese pina a `'json'` (stdlib real).
  const moduloAcoplado = /(^|[,(\s])(package_name|module_name)\b/i.test(sig);
  const forcaSintese = sqliteAcoplado || dfColunaAcoplado || moduloAcoplado;
  if (!forcaSintese) {
    const a = entradasNovas(prompt, quantas);
    // montagem que NÃO CARREGA (helper de fixture / open sem aspas) → a síntese auto-contida é melhor
    const risco = montagemArriscada(a.montagem || (a.montagens && a.montagens[0]) || []);
    // ⚠️ AUGMENTAÇÃO n=1 (317 tarefas medidas). Quando o exemplo passa uma VARIÁVEL NUA (`df_input`,
    // `data`, `list_of_tuples`), o mutador não tem literal a variar e devolve 1 entrada só → n=1, que
    // «autoriza teste, não fecho». Se a variação-do-exemplo dá ≥2, é a mais fiel e vence. Mas se dá <2,
    // tento a síntese-por-tipo (que agora sabe montar df/array/tuplas) e uso a que der MAIS entradas
    // comparáveis — trocar 1 pobre por 3 sintetizadas é o que tira a tarefa do limbo do n=1.
    if (a.chamadas.length >= 2 && !risco) return { ...a, fonte: "variacao-do-exemplo" };
    const bAug = entradasPorTipo(prompt, 3);
    if (bAug.chamadas.length > (risco ? 0 : a.chamadas.length)) return { ...bAug, montagem: [], fonte: risco ? "sintese-por-tipo(montagem-arriscada)" : "sintese-por-tipo" };
    if (a.chamadas.length) return { ...a, fonte: "variacao-do-exemplo" };
  }
  const b = entradasPorTipo(prompt, 3);
  if (b.chamadas.length) return { ...b, montagem: [], fonte: sqliteAcoplado ? "sintese-sqlite" : "sintese-por-tipo" };
  const a2 = forcaSintese ? entradasNovas(prompt, quantas) : { chamadas: [], motivo: "(saltada)" };
  if (a2.chamadas.length) return { ...a2, fonte: "variacao-do-exemplo" };
  return { chamadas: [], montagens: [], montagem: [], fonte: null, motivo: `${a2.motivo} · ${b.motivo}` };
}

module.exports = { ehDegenerada, entradasNovas, entradasPorTipo, entradasParaDiferencial, programaDiferencial, julga, ehAleatoria, importsDoEnunciado };
