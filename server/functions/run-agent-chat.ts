// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// Mukta Zero — cérebro-real (endpoint independente na instância IaaS).
// Contrato custom do mukta-edge: export default (req, { sql, getSecret }).
// Fase 2b/2c: cresce o lean com CAPACIDADES reais reusando o schema slice (2a):
//   - SSOT: resolve modelo por agent_profiles.model_id -> llm_models (is_active).
//   - MEMÓRIA DE SESSÃO real (determinística, sem embeddings): recall via
//     get_session_memory_traceback + persist via append_session_memory_event.
//   - Multi-provider OPEN: chave lida via get_vault_secret (deepinfra/nebius/bitdeer/nvidia).
// Independente da Mukta principal. NÃO é copia do run-agent-chat de prod (contrato diferente);
// é o prod como REFERÊNCIA do que ligar, escrito no idioma (req,{sql,getSecret}).

// SELO DE DATA/HORA para nome de ficheiro gerado — YYYY-MM-DD-HHmm, em UTC.
//
// UTC de propósito e não hora local: o edge corre no servidor e o usuário está noutro fuso, então
// "hora local" aqui seria a do servidor a fingir ser a dele. Um selo em UTC é ambíguo para ninguém;
// um selo local sem indicação de fuso engana quem o lê a partir de outro lugar.
//
// ⚠️ Duplicado nos ficheiros que geram documento (aqui, mz-research, mz-office), ao contrário da
// regra de PREÇO que eu levei para o banco. A diferença é deliberada: isto é transformação PURA de
// string, sem estado, e uma ida ao banco no caminho de geração de documento acrescentaria um modo
// de falha a troco de nada. Divergência aqui produz nome inconsistente; lá produzia dinheiro errado.
const selo = (): string => new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// JULGAMENTO DE ABSORÇÃO DE MEMÓRIA — v1, MEDE e NÃO DECIDE
//
// Regra: §37 do mesmo runbook — `sim ∧ valor~5% ∧ período-NÃO-disjunto`, eleita por busca exaustiva
// SÓ no treino e validada em hold-out; P=2 é o único degrau com sinal (p=0,010) e sobreviveu ao
// aumento de n, à correção do σ, ao aumento de permutações e à limpeza da régua (§38).
//
// ⚠️ PROXY DECLARADO: o termo semântico da regra medida usa embeddings. No caminho de persistência
//    isso custaria uma chamada de rede POR TURNO. A v1 troca por Jaccard de conteúdo e **regista
//    que é proxy** (`proxy_semantico`), para que o custo dessa troca seja medível depois em vez de
//    invisível. Trocar sem registar seria o defeito que este projeto chama de «número certo de
//    outra coisa».
//
// ⚠️ NÃO decide: a saída vai para `metadata` e a absorção continua incondicional. O objetivo desta
//    versão é produzir o denominador — quanto SERIA rejeitado — antes de existir rejeição.
// ── PREMISSAS DE CORRELAÇÃO POR CAMPO DE DOMÍNIO ────────────────────────────────────────────────
// Diretiva do Herbert (§39): «premissas de correlação definidas para cada campo de domínio».
//
// É ALFABETO FIXO — autorado à mão, hardcode honesto, é a LINGUAGEM e não o resultado. O princípio
// é o do plano do cubo: alfabeto fixo, transições aprendidas. Autorar isto NÃO precisa de rótulo
// nenhum; o que precisa de rótulo é VALIDAR que cada premissa discrimina, e essa validação está
// declarada em aberto (43 positivos ÷ 20 domínios ≈ 2 — sem denominador por domínio).
//
// 🎯 E as premissas SÃO o tipificador: o domínio cujo vocabulário dispara mais é o domínio do turno.
//    Máquina enumera, sem chamada de rede no caminho de persistência. O micro-LM entra depois,
//    como tipificador alternativo, e só se MEDIR melhor que este — não por suposição.
type PremissaDominio = {
  dominio: string;
  marcadores: RegExp;      // o que identifica o campo
  unidades: Array<[string, RegExp]>;   // grandezas que fazem sentido NELE
  tolerancia: number;      // quanto dois valores podem diferir e ainda serem o MESMO fato
  periodo_obrigatorio: boolean;  // fato do campo faz sentido sem período declarado?
};
const _ABS_DOMINIOS: PremissaDominio[] = [
  { dominio: "agro",
    marcadores: /\b(caf[ée]|safra|arábica|robusta|conab|soja|milho|gr[ãa]os?|cooperativa|colheita)\b/i,
    unidades: [["saca", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?sacas?/i], ["ton", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?toneladas?/i], ["pct", /^\s*(%|por cento)/i]],
    tolerancia: 0.05, periodo_obrigatorio: true },
  { dominio: "pecuaria",
    marcadores: /\b(carne|bovina|suína|frango|abate|frigor[íi]fico|rebanho|pecu[áa]ria|abiec)\b/i,
    unidades: [["ton", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?toneladas?/i], ["usd", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?d[óo]lares/i], ["pct", /^\s*(%|por cento)/i]],
    tolerancia: 0.05, periodo_obrigatorio: true },
  { dominio: "renda_fixa",
    marcadores: /\b(cdi|ipca\+|debênture|cra\d|taxa indicativa|anbima|vencimento|selic|deb[êe]ntures?)\b/i,
    // 🔴 tolerância APERTADA de propósito: em renda fixa 0,5 p.p. é outro papel, não arredondamento.
    // 🔴 E a NOTAÇÃO é do campo: `7,9444 IPCA+%` · `110,19 %CDI` · `1,93 DI+%`. O padrão genérico de
    //    percentual (`%` logo após o número) NÃO casa nenhum dos três — o teste por domínio mostrou
    //    o campo a extrair ZERO grandezas. É exatamente o que premissas por domínio existem para
    //    resolver: cada campo mede na sua própria notação.
    unidades: [["pct", /^\s*(IPCA\s*\+|DI\s*\+|CDI)?\s*(%|por cento)/i], ["pct", /^\s*%\s*(CDI|DI)/i],
               ["brl", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?reais/i]],
    tolerancia: 0.005, periodo_obrigatorio: true },
  { dominio: "mobilidade",
    marcadores: /\b(el[ée]tric|eletrificad|emplacament|ve[íi]culos?|h[íi]brid|montadora|fenabrave|abve)\b/i,
    unidades: [["pct", /^\s*(%|por cento)/i], ["unid", /^\s*(de\s+)?(mil\s+)?(unidades|ve[íi]culos|carros)/i]],
    tolerancia: 0.02, periodo_obrigatorio: true },
  { dominio: "mercado_financeiro",
    marcadores: /\b(ebitda|a[çc][õo]es|ipo|pre[çc]o-alvo|balan[çc]o|receita l[íi]quida|trimestre|\d[TQ]\d\d)\b/i,
    unidades: [["brl", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?reais/i], ["usd", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?d[óo]lares/i], ["pct", /^\s*(%|por cento)/i]],
    tolerancia: 0.02, periodo_obrigatorio: true },
  // §44: sem este domínio, 1.125 de 1.125 afirmações macro caíam em `generico` — a classe mais
  // mensurável de afirmação económica brasileira não estava coberta. `selic` fica FORA de propósito:
  // já é marcador de renda_fixa, e empate ⇒ genérico; não se mexe no que o §41 mediu.
  { dominio: "macroeconomia",
    marcadores: /\b(ipca|inpc|igp-m|igp-di|ipca-15|ipc-fipe|ipa-di|ipa-m|pib|c[âa]mbio|infla[çc][ãa]o|copom|boletim focus|d[íi]vida bruta|resultado prim[áa]rio|resultado nominal|conta corrente|balan[çc]a comercial|taxa de desocupa[çc][ãa]o|produ[çc][ãa]o industrial)\b/i,
    unidades: [["pct", /^\s*(%|por cento)/i],
               ["brl", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?reais/i],
               ["usd", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?d[óo]lares/i]],
    tolerancia: 0.02, periodo_obrigatorio: true },
];
// fallback: o alfabeto GLOBAL que o §21/§37 mediram. Turno que não tipifica cai aqui, e o metadata
// regista `dominio: "generico"` — para que a fração de genérico seja MEDÍVEL e não invisível.
const _ABS_GENERICO: PremissaDominio = {
  dominio: "generico",
  marcadores: /$^/,
  unidades: [["pct", /^\s*(%|por cento)/i], ["ton", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?toneladas?/i],
             ["saca", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?sacas?/i], ["litro", /^\s*(de\s+)?litros?/i],
             ["brl", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?reais/i], ["usd", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?d[óo]lares/i]],
  tolerancia: 0.05, periodo_obrigatorio: false,
};
// TIPIFICAÇÃO: conta marcadores; empate ou zero ⇒ genérico. Determinístico e sem rede.
function _absTipifica(t: string): { premissa: PremissaDominio; forca: number; placar: Record<string, number> } {
  const placar: Record<string, number> = {};
  let melhor = _ABS_GENERICO, forca = 0;
  for (const d of _ABS_DOMINIOS) {
    const n = (String(t || "").match(new RegExp(d.marcadores.source, "gi")) || []).length;
    if (n) placar[d.dominio] = n;
    if (n > forca) { forca = n; melhor = d; }
  }
  // empate entre dois domínios com a mesma força ⇒ não tipifica (não se escolhe por ordem da lista)
  if (forca > 0 && Object.values(placar).filter((v) => v === forca).length > 1) { melhor = _ABS_GENERICO; forca = 0; }
  return { premissa: melhor, forca, placar };
}

const _ABS_NUM = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)/g;
const _ABS_UNI: Array<[string, RegExp]> = [
  ["pct", /^\s*(%|por cento)/i], ["ton", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?toneladas?/i],
  ["saca", /^\s*(de\s+)?(mil\s+|milh[oõ]es?\s+de\s+)?sacas?/i], ["litro", /^\s*(de\s+)?litros?/i],
  ["brl", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?reais/i], ["usd", /^\s*(mil|milh[oõ]es?|bilh[oõ]es?)?\s*(de\s+)?d[óo]lares/i],
];
const _ABS_MULT: Array<[RegExp, number]> = [[/^\s*mil\b/i, 1e3], [/^\s*milh[oõ]es?\b/i, 1e6], [/^\s*bilh[oõ]es?\b/i, 1e9]];
// substantivos de TEMPO nunca são grandeza: «12 meses» é um intervalo, não uma medição (§49)
const _ABS_TEMPO = new Set(["mes","mese","meses","mês","ano","anos","dia","dias","semana","semanas",
  "hora","horas","trimestre","trimestres","vez","vezes","ponto","pontos","minuto","minutos","segundo","segundos"]);

// A assinatura é lida COM AS UNIDADES DO DOMÍNIO: «sacas» é grandeza em agro e ruído em renda fixa.
// §52 · GRANDEZA AFIRMADA ≠ QUALQUER NÚMERO DA FRASE. «A multa é de 20% sobre o saldo (metade dos
// 40% devidos na demissão sem justa causa)» carrega 20 E 40, e casava com os dois regimes, que são
// OPOSTOS. Medido: era o maior defeito da rejeição em produção. Princípio: número introduzido por
// CONECTIVO DE CONTRASTE está lá para comparar, não para afirmar. O conectivo governa quando aparece
// ENTRE o número anterior e este. Nunca esvazia a assinatura — só se descarta havendo já uma grandeza.
const _ABS_CONTRASTE = /\b(em vez d|ao inv[ée]s d|metade d|dobro d|contra\b|ante\b|anterior|antes era|era d|corrigindo|em compara[çc][ãa]o|comparad[oa]|versus|vs\b)/i;
function _absSig(t: string, prem: PremissaDominio = _ABS_GENERICO): { vals: Array<[number, string]>; per: Set<string> } {
  const vals: Array<[number, string]> = [];
  const tl = String(t || "");
  let m: RegExpExecArray | null;
  let fimAnterior = 0;                    // §52: onde acabou o número anterior (haja ou não valor)
  const rx = new RegExp(_ABS_NUM.source, "g");
  while ((m = rx.exec(tl)) !== null) {
    const contrastivo = vals.length > 0 && _ABS_CONTRASTE.test(tl.slice(fimAnterior, m.index));
    fimAnterior = m.index + m[0].length;
    if (contrastivo) continue;
    let raw = m[1];
    if (/^\d{1,3}(\.\d{3})+/.test(raw)) raw = raw.replace(/\./g, "");
    let v = parseFloat(raw.replace(",", "."));
    if (!isFinite(v)) continue;
    const cauda = tl.slice(m.index + m[0].length, m.index + m[0].length + 40);
    for (const [rex, mul] of _ABS_MULT) if (rex.test(cauda)) { v *= mul; break; }
    let u = "x";
    for (const [nome, pat] of prem.unidades) if (pat.test(cauda)) { u = nome; break; }
    if (u === "x" && /^\s*%/.test(cauda)) u = "pct";
    // 🔴 §48: A UNIDADE TAMBÉM VEM ANTES DO NÚMERO. Todos os padrões olhavam só a CAUDA, e em
    //    português a moeda antecede: `R$ 2,4 bilhões`, `US$ 98 milhões`. Medido: 22 dos 33
    //    positivos recusados no conjunto rotulado não tinham grandeza LEGÍVEL num dos lados — 67%
    //    das falhas de sensibilidade eram de LEITURA, não de casamento. Irmão do defeito de
    //    notação do §41 (`IPCA+%`, `%CDI`), e perdido na porta do protótipo em Python, que já
    //    olhava a cabeça, para esta versão, que deixou de olhar.
    if (u === "x") {
      const cabeca = tl.slice(Math.max(0, m.index - 14), m.index);
      if (/(R\$|BRL)\s*$/i.test(cabeca)) u = "brl";
      else if (/(US\$|USD|U\$S)\s*$/i.test(cabeca)) u = "usd";
      else if (/(€|EUR)\s*$/i.test(cabeca)) u = "eur";
    }
    // §49 · CONTAGEM DE COISAS: «130 startups», «4.600 eletropostos». A unidade é o próprio
    // substantivo. Esta família saiu do INVENTÁRIO dos números órfãos, não de uma lista minha —
    // p.p., bps, hectares, MW e múltiplos, que eu tinha suposto, deram ZERO ocorrências no dado.
    // 🔴 Forma ESTRITA de propósito: «130 startups» ≠ «130 empresas». A forma nua (toda contagem
    //    é a mesma unidade) media +0,022 de sensibilidade, mas casaria «130 funcionários» com
    //    «130 lojas» da mesma empresa no mesmo ano — falha que os meus negativos não exercitam,
    //    porque quase nenhum é contagem. Sem denominador para a arriscar, fica a estrita.
    // 🔴 §56: o «27» de «safra 2026/27» estava a virar grandeza, com a palavra seguinte por unidade
    //    (`[27,"#para"]`, `[27,"#pode"]`). Número que segue uma barra é metade de um período, não uma
    //    contagem — e o período já é lido por `rxSafra` logo abaixo. Apanhado ao ler as recusas de
    //    positivos, não por inspeção: a regra de contagem do §49 nasceu sem esta guarda.
    const posBarra = /\/\s*$/.test(tl.slice(Math.max(0, m.index - 3), m.index));
    if (u === "x" && !posBarra && !/^(19|20)\d{2}$/.test(m[1])) {
      const sub = /^\s*(?:mil|milh[oõ]es?|bilh[oõ]es?)?\s*(?:de\s+)?([a-záéíóúâêôãõçà]{4,}?)(?:s|es)?\b/i.exec(cauda);
      const nome = sub ? sub[1].toLowerCase() : "";
      if (nome && !_ABS_TEMPO.has(nome)) u = "#" + nome;
    }
    // 🔴 VALOR SEM UNIDADE NÃO É MEDIÇÃO. Sem esta linha o ANO entra como grandeza e casa consigo
    //    mesmo: dois papéis de renda fixa com vencimento em 2029 e taxas DIFERENTES batiam o termo
    //    de valor pelo ano. Apanhado pelo teste POR DOMÍNIO — a tolerância apertada da renda fixa
    //    (0,5%) tornou o defeito visível, e no alfabeto global ele estava escondido.
    if (u === "x") continue;
    vals.push([v, u]);
  }
  const per = new Set<string>();
  for (const a of tl.match(/\b(19|20)\d{2}\b/g) || []) per.add(a);
  if (/\bao ano\b|\banual\b|\bpor ano\b/i.test(tl)) per.add("AA");
  // §46-C2: `safra 25/26`, `ciclo 2026/27`, `2026/27` denotam anos e não eram lidos. É LEITURA, não
  // limiar. Medido: zero efeito no conjunto de 157 — fica como apólice, e está registado como zero.
  const rxSafra = /\b(?:safra|ciclo)?\s*(\d{4}|\d{2})\s*\/\s*(\d{2})\b/g;
  let ms: RegExpExecArray | null;
  while ((ms = rxSafra.exec(tl)) !== null) {
    per.add(String(ms[1].length === 4 ? Number(ms[1]) : 2000 + Number(ms[1])));
    per.add(String(2000 + Number(ms[2])));
  }
  return { vals, per };
}
// §46-C4 · FAIXA É INTERVALO. «entre 75% e 100%» casava com «entre 50% e 74%» pelos extremos 75 e 74.
// Dois intervalos casam se INTERSECTAREM. Ponto × ponto fica inalterado, para o efeito ser atribuível.
function _absFaixas(t: string): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  // §52: a faixa lê-se COM prefixo de moeda. Sem isto, «De R$ 180.000,01 a R$ 360.000,00» não era
  // faixa nenhuma — virava dois PONTOS soltos, e bandas ADJACENTES casavam pelo 360.000 que
  // partilham. Era o 2º defeito da rejeição em produção.
  const rx = /(?:entre|de)\s+(?:R\$|US\$|USD|€)?\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(?:%|por cento)?\s*(?:e|a|at[ée])\s+(?:R\$|US\$|USD|€)?\s*(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(%|por cento)?/gi;
  const num = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));
  let m: RegExpExecArray | null;
  while ((m = rx.exec(String(t || ""))) !== null) {
    const lo = num(m[1]), hi = num(m[2]);
    if (isFinite(lo) && isFinite(hi) && hi > lo) out.push([lo, hi, m[3] ? "pct" : "x"]);
  }
  return out;
}
// §44/§46-C3 · TERMO DE ENTIDADE. O §43 mediu que o portão não tinha discriminador de entidade
// nenhum: recusava quando os números calhavam diferentes e aceitava quando calhavam próximos.
// A entidade não é o fraseado — é O QUE está a ser medido. Três fontes, todas de máquina, e SEM
// PARÂMETRO LIVRE (a condição é interseção não-vazia, logo não há limiar para sobre-ajustar):
//   (a) acrónimos · (b) próprios que NÃO abrem frase · (c) marcador de domínio + o seu QUALIFICADOR
// O (c) leva o qualificador porque «carne de frango» e «carne suína» casavam pelo marcador `carne`:
// o marcador identifica o CAMPO, não a entidade — usar léxico de campo como léxico de entidade foi
// exatamente a falha diagnóstica que abriu a missão, reproduzida por instrumento meu (§45.4).
const _ABS_STOP = new Set(["em","no","na","os","as","um","uma","de","do","da","ao","para","com","por",
  "este","esta","esse","essa","segundo","apos","apesar","entre","sobre","ate","desde","onde",
  "quando","embora","porem","contudo","alem","cerca","conforme","durante"]);
const _ABS_LIG = new Set(["de","da","do","no","na","em","dos","das","e","a","o","com","por","para"]);
// §55 · PALAVRA DE FUNÇÃO QUE ABRE A CLAIM NÃO É ENTIDADE. O guarda de início-de-frase tinha um
// buraco: em `/(^|[.!?]\s+)?(...)/` o alternante `^` casa a STRING VAZIA, logo na posição 0 o
// `mp[1] === ""` e o `continue` não disparava — a primeira palavra entrava como entidade. Medido:
// «Vou registrar que o IGP-M…» casou com «Vou atualizar… o IPCA…» pela entidade «vou», e o portão
// deu uma claim sobre IGP-M como já conhecida por uma sobre IPCA. Lido nos pares afetados, TODOS
// casavam SÓ pela palavra inicial — dois acertavam por acidente («Como…» × «Como…») e um errava.
// Acertar por gramática não é propriedade a preservar. Nomes próprios na posição 0 (Brasil, Conab)
// continuam a entrar: só se descartam as palavras de FUNÇÃO, e os acrónimos entram por outra regra.
const _ABS_FUNCAO = new Set(["vou","como","responda","repita","confirme","acabei","nesse","neste",
  "nessa","esse","essa","isso","aqui","agora","depois","ainda","apenas","tambem","também","entao",
  "então","assim","cada","qual","quais","quanto","quantos","caso","veja","note","vale","seja",
  "pode","deve","para","sobre","quando"]);
function _absEntidades(t: string): Set<string> {
  const s = String(t || "");
  const out = new Set<string>();
  for (const m of s.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}(?:[-][A-Z0-9]+)*\b/g) || []) out.add(m.toLowerCase());
  const rxP = /(^|[.!?]\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõçà]{2,})/g;
  let mp: RegExpExecArray | null;
  while ((mp = rxP.exec(s)) !== null) {
    const w = mp[2].toLowerCase();
    const abre = mp.index === 0 || (mp[1] !== undefined && mp[1] !== "");
    if (abre && _ABS_FUNCAO.has(w)) continue;           // §55: abre a claim E é palavra de função
    if (mp[1] !== undefined && mp[1] !== "") continue;   // abre frase interna ⇒ maiúscula é gramática
    if (!_ABS_STOP.has(w)) out.add(w);
  }
  const pal = s.toLowerCase().match(/[\wáéíóúâêôãõçà-]+/g) || [];
  for (const d of _ABS_DOMINIOS) {
    const rx = new RegExp(d.marcadores.source, "gi");
    let mm: RegExpExecArray | null;
    while ((mm = rx.exec(s)) !== null) {
      const alvo = mm[0].toLowerCase();
      const i = pal.indexOf(alvo.split(/\s+/)[0]);
      if (i < 0) { out.add(alvo); continue; }
      let q: string | null = null;
      for (let k = i + 1; k < Math.min(pal.length, i + 4); k++) {
        if (_ABS_LIG.has(pal[k]) || /^\d/.test(pal[k])) continue;
        if (pal[k].length >= 4 && pal[k] !== alvo) { q = pal[k]; break; }
      }
      if (!q) for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
        if (_ABS_LIG.has(pal[k]) || /^\d/.test(pal[k])) continue;
        if (pal[k].length >= 4 && pal[k] !== alvo) { q = pal[k]; break; }
      }
      out.add(q ? alvo + " " + q : alvo);
    }
  }
  return out;
}
function _absConteudo(t: string): Set<string> {
  return new Set((String(t || "").toLowerCase().match(/\w{4,}/g) || []));
}
function _absJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
// §48 · A UNIDADE DE JULGAMENTO É A AFIRMAÇÃO, NÃO A PROSA.
// O §47 mediu o defeito em produção: `julgaAbsorcao` recebia a resposta do modelo (~500 chars,
// carregada de contexto da sessão) e não a afirmação (~40 chars). Prosa longa quase sempre
// intersecta em entidade, e por isso um turno sobre IGP-M foi lido como redundante com um sobre
// IPCA — o termo fez o que devia com a entrada que recebeu; a ENTRADA é que estava errada.
// Todas as medições da missão (157 pares rotulados, 1.050 negativos) usaram afirmações isoladas.
// Isto recupera essa unidade: parte o turno em frases e fica só com as que carregam GRANDEZA.
// Máquina, sem rede, como as premissas — a extração de claims do §20 é do pipeline de pesquisa e
// custa uma chamada de modelo, que não cabe no caminho de persistência.
const _ABS_MAX_CLAIMS = 12;   // teto declarado: turno longo não vira varredura quadrática
function _absClaims(t: string, prem: PremissaDominio = _ABS_GENERICO): string[] {
  const s = String(t || "").replace(/[ \t]+/g, " ");
  const frases = s.split(/(?<=[.!?])\s+|\n+|(?:^|\s)[-•*]\s+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const f of frases) {
    if (f.length < 15) continue;
    if (!_absSig(f, prem).vals.length) continue;   // sem grandeza ⇒ não é afirmação mensurável
    out.push(f);
    if (out.length >= _ABS_MAX_CLAIMS) break;
  }
  return out;
}

// Os três termos: ENTIDADE ∧ VALOR ∧ PERÍODO.
// 🔴 O `jaccard>=0,40` que aqui estava era um PROXY que nunca foi medido antes de embarcar, e que
//    o §44.4 apanhou: a regra validada no §31 tinha termo de entidade, e o deploy trocou-a por ele.
//    Medido depois: sensibilidade 0,111 no conjunto rotulado. O jaccard continua a ser CALCULADO
//    para telemetria — deixou foi de decidir. Proxy anotado como proxy é dívida, não simplificação.
function _absMesmoFato(ta: string, tb: string, A: ReturnType<typeof _absSig>, B: ReturnType<typeof _absSig>, prem: PremissaDominio = _ABS_GENERICO) {
  // ENTIDADE — interseção não-vazia. Sem entidade legível de um dos lados, NÃO se afirma que é a mesma.
  const EA = _absEntidades(ta), EB = _absEntidades(tb);
  const t1 = EA.size > 0 && EB.size > 0 && [...EA].some((x) => EB.has(x));
  // VALOR — faixa é intervalo (§46-C4); ponto × ponto inalterado, na tolerância do domínio.
  let t2 = false;
  const fa = _absFaixas(ta), fb = _absFaixas(tb);
  if (fa.length && fb.length) {
    // §52: sobreposição em MEDIDA, estrita. Duas faixas que apenas se TOCAM na fronteira
    // («…a 360.000,00» e «de 360.000,01…») são faixas diferentes por construção.
    for (const [a1, a2, ua] of fa) for (const [b1, b2, ub] of fb)
      if (ua === ub && Math.max(a1, b1) < Math.min(a2, b2)) { t2 = true; break; }
  } else if (fa.length || fb.length) {
    const fx = fa.length ? fa : fb, pt = fa.length ? B : A;
    for (const [l, h, uf] of fx) for (const [v, uv] of pt.vals)
      if ((uf === "x" || uf === uv) && v >= l && v <= h) { t2 = true; break; }
  } else {
    for (const [x, ux] of A.vals) for (const [y, uy] of B.vals) {
      if (ux !== uy || x === 0 || y === 0) continue;
      if (Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y)) <= prem.tolerancia) { t2 = true; break; }
    }
  }
  // PERÍODO — §46-C1: `periodo_obrigatorio` estava DECLARADO na premissa desde o §41 e este termo
  // ignorava-o: com um dos lados sem período legível, passava POR VACUIDADE. Passar por não saber é
  // a forma mais silenciosa de falhar. §46-C5: o campo só morde quando ALGUÉM tem período — lido dos
  // positivos que a C1 perdia, o domínio também carrega claims ESTRUTURAIS (uma tarifa, uma quota)
  // que legitimamente não têm período, e aí o termo ABSTÉM-SE em vez de recusar.
  let t3: boolean;
  if (prem.periodo_obrigatorio && (A.per.size || B.per.size) && (!A.per.size || !B.per.size)) t3 = false;
  else t3 = !(A.per.size && B.per.size && ![...A.per].some((p) => B.per.has(p)));
  return { casa: t1 && t2 && t3, t1, t2, t3 };
}

function julgaAbsorcao(prompt: string, text: string, anteriores: string[]): Record<string, unknown> {
  const base = {
    v: 1,
    regra: "entidade-intersecta ∧ valor~tolerancia-do-dominio ∧ periodo-NAO-disjunto",
    medido: "regime pesquisa (157 pares rotulados): sens 0.267 · espec 1.000 (0/112 falso-aceite). "
      + "Regressao em 1050 negativos do Focus: 1/1050. A regra ANTERIOR (jaccard>=0.40) dava "
      + "sens 0.111 · espec 0.982. Zero em 112 nao e 'nao erra': e 'nao erra NESTES 112'.",
    limite: "sensibilidade 0.267 — a camada NAO reconhece corroboracao na maioria dos casos",
    // §48: a unidade passou a ser a AFIRMACAO (o turno e partido em frases com grandeza), que e a
    // unidade em que os numeros acima foram medidos. O bloqueio do §47 caiu — mas 3 turnos de teste
    // nao sao uma medicao de trafego real, e por isso a rejeicao continua desligada ate a telemetria
    // `claims`/`claims_redundantes` dar o denominador em producao. Primeiro o denominador, depois a
    // decisao — a mesma ordem do §40.
    unidade_de_julgamento: "afirmacao extraida do turno (pergunta + resposta), nao a prosa",
    // §54: a decisao de TURNO fica como telemetria historica; a unidade ACIONAVEL e `claims_detalhe`,
    // que ANOTA cada afirmacao como ja-conhecida sem apagar nada. Precisao medida em turnos reais:
    // 0,702 por claim contra 0,615 por turno — mas o que decide e o custo, nao o numero: anotacao
    // errada custa um rotulo, rejeicao errada custa memoria e e irreversivel.
    rejeicao: "DESLIGADA e a NAO ADOTAR: a unidade acionavel e a ANOTACAO por claim (§54)",
    precisao_por_claim: "0.702 (94 pares rotulados de 183 marcados — cobertura 51%, e a amostra e "
      + "enviesada para turnos totalmente casados; ver §54.2)",
    runbook: "documentação interna§44/§45/§46",
    nota: "PASSA-TUDO: mede e NAO altera a absorcao",
  };
  // 1) TIPIFICA o campo de domínio — as premissas SÃO o tipificador (máquina enumera, sem rede)
  const tip = _absTipifica(prompt + " " + text);
  const prem = tip.premissa;
  const alvo = _absSig(text, prem);
  const cAlvo = _absConteudo(text);
  const comparados = (anteriores || []).length;
  // premissas do domínio VIAJAM no metadata: sem isto, a fração de 'generico' e o efeito de cada
  // premissa ficam invisíveis, e a validação por domínio (declarada em aberto) nunca teria insumo.
  const premissas = { dominio: prem.dominio, forca: tip.forca, placar: tip.placar,
                      tolerancia: prem.tolerancia, unidades: prem.unidades.map((u) => u[0]) };

  // §48 · a comparação passa a ser AFIRMAÇÃO × AFIRMAÇÃO. O turno entra inteiro (pergunta + resposta,
  // porque o fato tanto pode ser afirmado por um lado como pelo outro) e é partido em claims.
  const claimsAlvo = _absClaims(prompt + " " + text, prem);
  const claimsAnt: string[] = [];
  for (const a of anteriores) for (const c of _absClaims(a, prem)) claimsAnt.push(c);

  // NÃO-DECIDIDO por AUSÊNCIA DE GRANDEZA: sem número, a regra medida não tem sobre o que operar.
  // É o 3º balde do §26 — e declarar «não medi» é diferente de decidir.
  if (!claimsAlvo.length) {
    return { ...base, decisao: "NAO_DECIDIDO", motivo: "turno sem afirmacao mensuravel", comparados, premissas, claims: 0 };
  }
  if (!claimsAnt.length) {
    return { ...base, decisao: "NAO_DECIDIDO", motivo: "sem afirmacoes anteriores para comparar",
             comparados, premissas, claims: claimsAlvo.length, claims_anteriores: 0 };
  }
  // memoiza a assinatura: o teto de 12 claims por lado dá até 144 pares, e reler o mesmo texto
  // dezenas de vezes seria desperdício no caminho de persistência.
  const cache = new Map<string, ReturnType<typeof _absSig>>();
  const sig = (s: string) => { let v = cache.get(s); if (!v) { v = _absSig(s, prem); cache.set(s, v); } return v; };

  // 🎯 REGRA DE DECISÃO, declarada: o turno é redundante só se TODAS as suas afirmações já forem
  //    conhecidas. Trazer UMA afirmação nova basta para absorver. É a direção segura — falso-recusa
  //    custa memória perdida e falso-aceite custa memória corrompida (§31).
  let redundantes = 0;
  const exemplo: string[] = [];
  // §54 · A UNIDADE ACIONÁVEL É A CLAIM, NÃO O TURNO. Medido: precisão por claim 0,702 contra 0,615
  // por turno. Mas o argumento que decide não é esse — é o CUSTO: anotar uma claim como já-conhecida
  // não apaga nada, enquanto rejeitar o turno apagaria 81 afirmações nas sessões medidas. Anotação
  // errada custa um rótulo errado; rejeição errada custa memória, e é irreversível.
  const detalhe: Array<Record<string, unknown>> = [];
  for (const c of claimsAlvo) {
    let casou: string | null = null;
    for (const d of claimsAnt) {
      if (_absMesmoFato(c, d, sig(c), sig(d), prem).casa) { casou = d; if (exemplo.length < 2) exemplo.push(c.slice(0, 90)); break; }
    }
    if (casou) redundantes++;
    if (detalhe.length < _ABS_MAX_CLAIMS) {
      detalhe.push({ claim: c.slice(0, 160), redundante: !!casou, casou_com: casou ? casou.slice(0, 160) : null });
    }
  }
  const dec = redundantes === claimsAlvo.length ? "REJEITARIA_REDUNDANTE" : "ABSORVERIA";
  const jacProsa = anteriores.reduce((m, a) => Math.max(m, _absJaccard(cAlvo, _absConteudo(a))), 0);
  return {
    ...base, decisao: dec, comparados, premissas,
    motivo: dec === "REJEITARIA_REDUNDANTE"
      ? `todas as ${claimsAlvo.length} afirmacoes ja constam de turnos anteriores`
      : `${claimsAlvo.length - redundantes} de ${claimsAlvo.length} afirmacoes sao novas`,
    claims: claimsAlvo.length, claims_anteriores: claimsAnt.length, claims_redundantes: redundantes,
    claims_exemplo_redundante: exemplo,
    claims_detalhe: detalhe,   // §54: a anotação POR AFIRMAÇÃO — é esta a unidade acionável
    jaccard_prosa: Number(jacProsa.toFixed(3)),   // só telemetria — não decide (§44.4)
    grandezas: alvo.vals.length, periodos: [...alvo.per],
  };
}

function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}
async function verifyJwt(token: string, secret: string): Promise<any> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("jwt malformado");
  const [h, p, sig] = parts;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("assinatura inválida");
  const claims = b64urlToJson(p);
  if (claims.exp && Date.now() / 1000 > claims.exp) throw new Error("token expirado");
  // `service_role` legitimamente NÃO tem `sub` — é uma credencial de máquina, não
  // de pessoa. Exigir `sub` dela rejeitaria o webhook/ticker antes de qualquer
  // guarda. A identidade de quem esses jobs representam vem do `on_behalf_of`,
  // conferido no handler; aqui só se admite a ausência para esse papel.
  if (!claims.sub && claims.role !== "service_role") throw new Error("sem sub");
  return claims;
}

// ---- TOOLS (Fase 2e) — built-ins seguros executados no handler --------------
// Tier 2: PRIMITIVOS determinísticos vetados injetados no run_code (grafo-ferramenta: o código CHAMA, não re-deriva).
const MZ_CODE_PRIMITIVES = "import unicodedata as _ud\ndef only_digits(s):\n    return ''.join(ch for ch in str(s or '') if ch.isdigit())\ndef strip_accents(s):\n    return ''.join(ch for ch in _ud.normalize('NFD', str(s or '')) if _ud.category(ch) != 'Mn')\ndef validate_cpf(cpf):\n    c = only_digits(cpf)\n    if len(c) != 11 or c == c[0] * 11: return False\n    for i in (9, 10):\n        s = sum(int(c[k]) * ((i + 1) - k) for k in range(i))\n        if (s * 10) % 11 % 10 != int(c[i]): return False\n    return True\ndef validate_cnpj(cnpj):\n    c = only_digits(cnpj)\n    if len(c) != 14 or c == c[0] * 14: return False\n    w1 = [5,4,3,2,9,8,7,6,5,4,3,2]\n    w2 = [6] + w1\n    for w, i in ((w1, 12), (w2, 13)):\n        s = sum(int(c[k]) * w[k] for k in range(i))\n        m = s % 11\n        if (0 if m < 2 else 11 - m) != int(c[i]): return False\n    return True\ndef parse_br_number(s):\n    t = ''.join(ch for ch in str(s or '') if ch.isdigit() or ch in ',.-')\n    if not t: return None\n    t = t.replace('.', '').replace(',', '.')\n    try: return float(t)\n    except ValueError: return None\ndef fmt_brl(x):\n    try: v = float(x)\n    except (ValueError, TypeError): return None\n    return 'R$ ' + '{:,.2f}'.format(v).replace(',', '_').replace('.', ',').replace('_', '.')";

// ── CAMADA 1 · CICLO DE VERIFICAÇÃO-REFUTAÇÃO (2026-08-06) ──────────────────────────────────────
// O MZ já tinha o G3 como oráculo e um laço de 4 rondas — logo tinha uma forma FRACA de reparo:
// o modelo vê o erro e pode retentar. Faltavam três coisas, e as três estão MEDIDAS no AGI-2:
//
//   (1) RETORNO DIRIGIDO — o traceback CRU não diz ao modelo o que ele fez de errado.
//       Medido: `TypeError: object of type 'NoneType' has no len()` devolvido em bruto fez o
//       modelo reescrever o MESMO defeito nos 4 pares, em DUAS campanhas completas. A causa
//       («tens um ramo sem saída») nunca lhe foi dita.
//   (2) RETORNO REPETIDO — reenviar texto idêntico devolve o mesmo programa. Medido: séries
//       `8,0% ×4` e `7,4% ×4` com `prompt_tok` idêntico entre tentativas.
//   (3) O LAÇO DESTRÓI VALOR — em 7 de 9 tarefas ele termina PIOR que a sua própria melhor
//       tentativa. Sem memória do que já correu, cada ronda pode ser um retrocesso invisível.
//
// ⚠️ SINGLE-FILE: esta edge é copiada como UM .ts pelo deploy-function. Nada aqui importa ficheiro
// irmão, de propósito.

// Nomeia a CAUSA a partir da assinatura do erro. Nomear a causa vale mais que reportar o sintoma.
function diagnosticaErroPy(stderr: string, code: string): string | null {
  const e = String(stderr || "");
  if (/NoneType.*has no len|'NoneType' object is not subscriptable|'NoneType' object is not iterable/i.test(e)) {
    return "⛔ A tua função DEVOLVEU None. Ela pode ter `return` nalguns caminhos (os casos vazios)"
      + " mas CAI ATÉ AO FIM sem retornar no caminho PRINCIPAL."
      + "\nA lógica pode estar certa: o defeito é um RAMO SEM SAÍDA. Garante que a última linha"
      + " retorna o resultado e que TODOS os ramos retornam.";
  }
  if (/IndexError: list index out of range/i.test(e)) {
    return "⛔ Escreveste FORA dos limites de uma lista. A causa mais comum: construíste uma"
      + " estrutura NOVA (com dimensões próprias) e indexaste-a com as coordenadas da ESTRUTURA"
      + " DE ORIGEM.\nSe a saída tem tamanho diferente da entrada, as coordenadas de saída NÃO são"
      + " as de entrada — traduz os índices.";
  }
  if (/NameError: name '([^']+)' is not defined/i.test(e)) {
    const m = e.match(/NameError: name '([^']+)' is not defined/i);
    return `⛔ Usaste \`${m?.[1]}\` sem o definir (ou definiste-o depois de o usar). Define-o antes,`
      + " ou chama a função que já te foi dada em vez de a reescrever com outro nome.";
  }
  if (/RecursionError/i.test(e)) {
    return "⛔ Recursão infinita: o caso-base nunca é atingido. Verifica a condição de paragem"
      + " e se cada chamada reduz mesmo o problema.";
  }
  if (/ZeroDivisionError/i.test(e)) {
    return "⛔ Divisão por zero — protege o denominador antes de dividir.";
  }
  if (/SyntaxError|IndentationError/i.test(e)) {
    return "⛔ O código nem chegou a correr: erro de SINTAXE/INDENTAÇÃO. Reescreve o bloco inteiro"
      + " com indentação consistente (4 espaços) em vez de corrigir uma linha.";
  }
  return null;
}

function buildTools(): any[] {
  return [
    { type: "function", function: { name: "get_current_time", description: "Retorna a data e hora atuais em ISO 8601 (UTC). Use quando o usuário perguntar que horas são ou a data de hoje.", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "calculate", description: "Avalia uma expressão aritmética simples (soma, subtração, multiplicação, divisão, parênteses) e retorna o número. Use para contas exatas.", parameters: { type: "object", properties: { expression: { type: "string", description: "ex.: 347*89" } }, required: ["expression"] } } },
    { type: "function", function: { name: "search_knowledge", description: "Busca semântica na base de conhecimento da empresa. Use quando precisar de fatos específicos que possam estar documentados.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { name: "run_code", description: "Executa um trecho de código (python ou node) num SANDBOX ISOLADO (sem acesso à rede, efêmero) e retorna o stdout. Use para cálculos exatos, transformações de dados, parsing, e verificação-por-execução — em vez de calcular de cabeça. No python, funções VETADAS já disponíveis (chame direto, NÃO reimplemente): validate_cpf(x)/validate_cnpj(x) (dígito verificador correto), parse_br_number(s), fmt_brl(x), only_digits(s), strip_accents(s).", parameters: { type: "object", properties: { lang: { type: "string", enum: ["python", "node"] }, code: { type: "string", description: "código completo; imprima o resultado com print()/console.log()" } }, required: ["lang", "code"] } } },
    { type: "function", function: { name: "web_search", description: "Busca na WEB (Google) e retorna resultados orgânicos (título, link, snippet). Use para informação ATUAL da internet que não esteja na base de conhecimento interna (search_knowledge). Não invente URLs.", parameters: { type: "object", properties: { query: { type: "string", description: "consulta de busca" } }, required: ["query"] } } },
    { type: "function", function: { name: "scrape_url", description: "Busca e extrai o conteúdo textual de uma página web (URL) — título + texto principal. Use para ler uma página específica (ex.: um resultado do web_search).", parameters: { type: "object", properties: { url: { type: "string", description: "URL completa http(s)://" } }, required: ["url"] } } },
    { type: "function", function: { name: "generate_document", description: "Gera um ARQUIVO .docx REAL (Word) com o conteúdo estruturado e devolve um LINK de download. Use SEMPRE que o usuário pedir um documento/estudo/relatório em .docx ou Word — NUNCA devolva o texto pedindo para copiar no Word. SEMPRE inclua a conclusão e as FONTES de pesquisa usadas (URLs do web_search/scrape). Cite o link devolvido ao usuário.", parameters: { type: "object", properties: { title: { type: "string", description: "título do documento" }, sections: { type: "array", description: "seções do corpo, em ordem", items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string", description: "texto da seção (parágrafos separados por linha em branco)" } }, required: ["heading", "body"] } }, conclusion: { type: "string", description: "conclusão do trabalho (OBRIGATÓRIA)" }, sources: { type: "array", items: { type: "string" }, description: "fontes de pesquisa usadas (URLs/referências) — OBRIGATÓRIO" }, file_name: { type: "string", description: "ex.: estudo-fidc.docx" } }, required: ["title", "sections", "conclusion", "sources"] } } },
  ];
}

// HMAC-SHA256(secret, "<ISO_timestamp>.<rawBody>") em hex — contrato do google-serp-service (x-mukta-timestamp/x-mukta-signature).
// markdownToBlocks — converte o texto markdown final (ex.: síntese do Conselho) em blocks[] p/ o compose_docx do
// mz-office. Simples e robusto: #/##/### → headings; demais linhas → parágrafos (remove marcadores inline).
function markdownToBlocks(md: string): any[] {
  const blocks: any[] = [];
  for (const raw of String(md || "").split(/\n/)) {
    const line = raw.trim();
    if (!line || /^([-*_])\1{2,}$/.test(line)) continue; // pula linhas em branco e réguas ---
    const h1 = line.match(/^#\s+(.+)/), h = line.match(/^#{2,6}\s+(.+)/);
    if (h1) blocks.push({ type: "heading1", text: h1[1].replace(/[*_`#]/g, "").slice(0, 240) });
    else if (h) blocks.push({ type: "heading2", text: h[1].replace(/[*_`#]/g, "").slice(0, 240) });
    else blocks.push({ type: "paragraph", runs: [{ text: line.replace(/^[-*]\s+/, "• ").replace(/[*_`]/g, "").slice(0, 4000) }] });
  }
  return blocks.length ? blocks : [{ type: "paragraph", runs: [{ text: String(md || "").slice(0, 4000) }] }];
}

async function signSerpBody(secret: string, body: string): Promise<{ ts: string; sig: string }> {
  const ts = new Date().toISOString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`));
  const sig = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { ts, sig };
}

// CENTRAL-FIRST → LOCAL-FALLBACK. O serviço central da Mukta é o primário; o worker local .107 é fallback
// (só em outage do central — fica parado no dia a dia p/ não estrangular memória; um supervisor o sobe quando o central cai).
async function callSerp(sql: any, path: string, payload: unknown, timeoutMs: number): Promise<{ ok: boolean; data?: any; via?: string }> {
  const body = JSON.stringify(payload);
  const getV = async (n: string): Promise<string | null> => { try { const r = await sql`select public.get_vault_secret(${n}) as v`; return r[0]?.v || null; } catch { return null; } };
  const attempt = async (base: string | null, secret: string | null, to: number, via: string) => {
    if (!base || !secret) return null;
    try {
      const { ts, sig } = await signSerpBody(secret, body);
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), to);
      const r = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
        method: "POST", headers: { "content-type": "application/json", "x-mukta-timestamp": ts, "x-mukta-signature": sig },
        body, signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      if (j && j.ok) return { ok: true, data: j, via };
    } catch { /* cai p/ o fallback */ }
    return null;
  };
  // 1) CENTRAL (primário)
  const c = await attempt(await getV("SERP_CENTRAL_BASE_URL"), await getV("SERP_CENTRAL_HMAC_SECRET"), Math.min(timeoutMs, 20000), "central");
  if (c) return c;
  // 2) LOCAL (fallback em outage)
  const l = await attempt(await getV("SERP_LOCAL_BASE_URL"), await getV("SERP_LOCAL_HMAC_SECRET"), timeoutMs, "local-fallback");
  if (l) return l;
  return { ok: false };
}

// Fase 1 (Herbert 2026-07-20): protect-gate PRÉ-AÇÃO nas ações do PRÓPRIO agente MZ (por-tenant). Predicados app-layer.
function isInternalUrl(u: string): boolean {
  try {
    const h = new URL(String(u)).hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".internal") || h.endsWith(".local")) return true;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
    const m = h.match(/^172\.(\d+)\./); if (m && +m[1] >= 16 && +m[1] <= 31) return true;
    if (!h.includes(".")) return true;
    return false;
  } catch { return true; }
}
const METERED_TOOLS = ["web_search", "scrape_url"];
// 🔴 `enforcePersonaGate` FOI REMOVIDA daqui (W1, ·P, 2026-08-10). A decisão mudou-se para
// `public.persona_gate_check` na .107 — ver o `execTool`. Não fica uma cópia «por segurança»:
// duas implementações de um gate de SEGURANÇA no mesmo arquivo, uma delas sem chamador, é um
// convite a que alguém volte a chamá-la — e aí as duas decidem, divergem em silêncio, e o dia em
// que divergirem é o dia em que ninguém está a olhar.
// O comportamento que ela tinha está CONGELADO em `scripts/agent/fixture-persona-gate.cjs`, que é
// a linha de base contra a qual a versão SQL foi provada (33.600 comparações). É lá que ele deve
// viver: como REGISTO do que se decidia, não como um segundo decisor.
// ⚠️ `isInternalUrl` e `METERED_TOOLS` acima ficaram sem uso. Não os removo NESTA janela para não
//    inflar o diff de um deploy do caminho do utilizador — ficam declarados como dívida, não
//    esquecidos. (A lógica deles vive em `public.persona_url_interna` e no `budget_min` do SQL.)
async function execTool(tc: any, ctx: { sql: any; getSecret: any; companyId: string | null; agentId: string | null; userToken?: string; apikey?: string; captured?: any; personaProtect?: any[]; balance?: number; projectId?: string | null; userId?: string | null }): Promise<string> {
  const name = tc?.function?.name;
  let args: any = {};
  try { args = JSON.parse(tc?.function?.arguments || "{}"); } catch { /* */ }
  // ── W1 · O AVALIADOR PASSA A SER O SQL, e a decisão deixa de existir em duplicado ────────────
  // Havia DUAS implementações do mesmo avaliador: `enforcePersonaGate` (JS, viva aqui desde
  // 2026-07-20) e `public.persona_gate_check` na .107, provada equivalente em 33.600 comparações
  // (672 mono-regra + 32.928 multi-regra, com a ORDEM a decidir em 190 delas). O critério da
  // Coordenação era «pode duplicar CÓDIGO, nunca a DECISÃO» — e duas cópias de um gate de SEGURANÇA
  // divergem em silêncio. A equivalência exaustiva é o que autoriza a troca sem mudar comportamento.
  //
  // ⚠️ Vai pela conexão `sql` JÁ ABERTA, não pelo REST que o harness usa. Não é detalhe: esta função
  //    já consulta o banco várias vezes por turno (a própria resolução da persona, :566/:568), logo
  //    uma query a mais NÃO acrescenta dependência — acrescenta latência. Um RPC HTTP acrescentaria
  //    um ponto de falha NOVO no caminho de quem está à espera de resposta.
  // ⚠️ E o `skip` local fica: sem `protect` não há o que gatear, e não se paga ida ao banco por nada.
  const _pp = ctx.personaProtect || [];
  let _pg: { blocked: boolean; condition_key?: string; infra?: boolean } = { blocked: false };
  if (Array.isArray(_pp) && _pp.length) {
    try {
      // ⚠️ `::text::jsonb` e NÃO `::jsonb` — é o idioma já provado neste arquivo (:637). Com só
      //    `::jsonb`, o postgres.js manda a string COMO jsonb e ela vira um ESCALAR `"[...]"`, não
      //    um array: o `jsonb_array_elements` lá dentro rebenta com «cannot extract elements from a
      //    scalar», o gate cai no catch e devolve INFRA. E o fail-closed barra a ação — ou seja, o
      //    sintoma é «bloqueou», que é indistinguível de o gate ter funcionado. Foi assim que a
      //    minha 1ª prova deu verde sem o gate ter avaliado nada. O comentário de :1405 já dizia isto.
      const _r = await ctx.sql`select public.persona_gate_check(${JSON.stringify(_pp)}::text::jsonb, ${String(name)}, ${JSON.stringify(args || {})}::text::jsonb, ${JSON.stringify({ balance: ctx.balance })}::text::jsonb) as v`;
      const _v = (_r && _r[0] && _r[0].v) || {};
      _pg = { blocked: !!_v.blocked, condition_key: _v.condition_key };
    } catch (e) {
      // D-1: indisponibilidade é INFRA, nunca `blocked`. O fail-closed é do FLUXO (a ação não corre),
      // mas o NOME do desfecho não pode mentir — foi assim que 35/35 saíram «bloqueadas» no lote 1
      // por um provedor em baixo. E é BARULHENTO: gate mudo é gate que ninguém sabe que caiu.
      console.error("[run-agent-chat] persona_gate_check indisponivel:", String((e as Error)?.message || e).slice(0, 200));
      _pg = { blocked: false, infra: true };
    }
  }
  if (_pg.infra) return "⚠ Nao foi possivel verificar as regras da sua persona agora. A acao NAO foi executada - tente novamente em instantes.";
  if (_pg.blocked) return "\u26d4 Ação bloqueada pela sua persona (regra: " + _pg.condition_key + "). Ajuste as regras da persona para permitir.";
  try {
    if (name === "get_current_time") return new Date().toISOString();
    if (name === "calculate") {
      const expr = String(args.expression || "").trim();
      if (!expr || !/^[-+*/().\s0-9]+$/.test(expr)) return "erro: expressão inválida (apenas números e + - * / ( ))";
      const val = Function('"use strict"; return (' + expr + ")")();
      return typeof val === "number" && isFinite(val) ? String(val) : "erro: resultado inválido";
    }
    if (name === "search_knowledge") {
      const q = String(args.query || "").trim();
      if (!q || !ctx.companyId) return "sem resultados";
      const { sql, getSecret } = ctx;
      const cfg = async (k: string) => { try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; } };
      const emodel = await cfg("embedding_model"), ebase = await cfg("embedding_base_url"), ekeyName = await cfg("embedding_key_name");
      const edim = parseInt((await cfg("embedding_dim")) || "1536", 10);
      if (!emodel || !ebase || !ekeyName) return "busca indisponível";
      let ekey: string | undefined;
      try { const r = await sql`select public.get_vault_secret(${ekeyName}) as v`; ekey = r[0]?.v || undefined; } catch { /* */ }
      ekey = ekey || getSecret(ekeyName);
      if (!ekey) return "busca indisponível";
      const er = await fetch(`${ebase.replace(/\/+$/, "")}/embeddings`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${ekey}` }, body: JSON.stringify({ model: emodel, input: q, dimensions: edim }) });
      const ej: any = await er.json().catch(() => ({}));
      const vec = ej?.data?.[0]?.embedding;
      if (!Array.isArray(vec) || !vec.length) return "sem resultados";
      const vecStr = `[${vec.join(",")}]`;
      const rows = await sql`select content, (1 - (embedding <=> ${vecStr}::vector)) as similarity
        from knowledge_nodes where company_id = ${ctx.companyId}::uuid and embedding is not null and approval_status = 'approved' and (valid_to is null)
        order by embedding <=> ${vecStr}::vector limit 3`;
      const rel = (rows || []).filter((r: any) => Number(r.similarity) >= 0.35);
      return rel.length ? rel.map((r: any) => r.content).join("\n---\n") : "sem resultados";
    }
    if (name === "run_code") {
      const { sql, getSecret } = ctx;
      const cfg = async (k: string) => { try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; } };
      // KILL-SWITCH: só executa se a flag estiver ligada.
      if ((await cfg("code_exec_enabled")) !== "true") return "execução de código está DESABILITADA (kill-switch code_exec_enabled).";
      const lang = args.lang === "node" ? "node" : "python";
      const code = String(args.code || "");
      if (!code.trim()) return "erro: sem código";
      let execCode = code;
      if (lang === "python" && (await cfg("code_primitives_enabled")) === "true") execCode = MZ_CODE_PRIMITIVES + "\n\n" + code;
      let token: string | undefined;
      try { const r = await sql`select public.get_vault_secret('CODEEXEC_TOKEN') as v`; token = r[0]?.v || undefined; } catch { /* */ }
      token = token || getSecret("CODEEXEC_TOKEN");
      if (!token) return "code-exec indisponível (sem token)";
      try {
        const r = await fetch("http://172.17.0.1:8787/exec", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ lang, code: execCode, timeout: 10 }),
        });
        const jr: any = await r.json().catch(() => ({}));
        if (jr.error) return `erro do executor: ${jr.error}${jr.detail ? " — " + jr.detail : ""}`;
        const out = String(jr.stdout || "").trim();
        const err = String(jr.stderr || "").trim();

        // ── CICLO DE VERIFICAÇÃO-REFUTAÇÃO ──────────────────────────────────────────────────────
        const st: any = ((ctx as any)._runCode = (ctx as any)._runCode || { vistos: new Map(), n: 0, melhor: null });
        st.n++;
        // (2) RETORNO REPETIDO — o mesmo código submetido outra vez não pode receber a mesma resposta,
        // senão o laço gasta rondas a confirmar o que já sabia. Medido no AGI-2: prompt idêntico
        // devolve programa idêntico, e a série de erro fica cravada.
        const chave = execCode.replace(/\s+/g, " ").trim();
        const jaVisto = st.vistos.get(chave);
        st.vistos.set(chave, (jaVisto || 0) + 1);

        // (3) MEMÓRIA DA MELHOR TENTATIVA — «correu sem erro» é melhor que «rebentou», e sem
        // memória cada ronda pode ser um retrocesso invisível. Medido: o laço termina pior que a
        // sua própria melhor tentativa em 7 de 9 tarefas.
        const correu = !err && !jr.timed_out;
        if (correu && !st.melhor) st.melhor = { ronda: st.n, saida: out.slice(0, 400) };

        let extra = "";
        if (jaVisto) {
          extra += `\n\n⚠️ ESTE CÓDIGO JÁ FOI EXECUTADO nesta conversa (${jaVisto + 1}ª vez) e deu o`
            + " mesmo resultado. Re-executá-lo não traz informação nova."
            + "\nMuda a ABORDAGEM, não os detalhes: se a saída está errada, a hipótese é que está"
            + " errada — não o ajuste fino.";
        }
        // (1) RETORNO DIRIGIDO — nomear a CAUSA em vez de devolver o sintoma
        const diag = err ? diagnosticaErroPy(err, execCode) : null;
        if (diag) extra += "\n\n" + diag;
        if (st.melhor && (err || jr.timed_out) && st.melhor.ronda < st.n) {
          extra += `\n\n📌 Na ronda ${st.melhor.ronda} desta conversa uma versão CORREU sem erro e`
            + ` devolveu: ${st.melhor.saida}\nSe a versão actual for pior, volta a essa e corrige a partir dela.`;
        }

        return (out || "(sem stdout)")
          + (jr.timed_out ? "  [TIMEOUT — o código excedeu o limite; reduza a complexidade algorítmica (evite força-bruta em N grande) e re-execute]" : "")
          + (err ? `\n[stderr] ${err.slice(0, 1500)}` + (diag ? "" : "\n(corrija o erro acima e re-execute run_code)") : "")
          + extra;
      } catch (e) { return "code-exec inalcançável: " + String((e as Error).message || e).slice(0, 120); }
    }
    if (name === "web_search") {
      const { sql } = ctx;
      const cfg = async (k: string) => { try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; } };
      if ((await cfg("web_search_enabled")) !== "true") return "busca na web DESABILITADA (kill-switch web_search_enabled).";
      const q = String(args.query || "").trim();
      if (!q) return "erro: query vazia";
      const res = await callSerp(sql, "/v1/google/search", { query: q, gl: "br", hl: "pt-br", atomic: true }, 22000);
      if (!res.ok) return "busca na web indisponível no momento (central e fallback falharam).";
      const organic = (res.data?.organic || []).slice(0, 6);
      if (!organic.length) return `sem resultados para "${q}".`;
      // CAPTURA as fontes REAIS (título + URL) p/ a seção "Fontes" do docx — o usuário pede as URLs usadas (≥10).
      if (ctx.captured) {
        ctx.captured.sources = ctx.captured.sources || [];
        for (const o of organic) { const link = String(o.link || "").trim(); if (/^https?:\/\//i.test(link) && !ctx.captured.sources.some((s: any) => s.url === link)) ctx.captured.sources.push({ title: String(o.title || "").slice(0, 160), url: link }); }
      }
      const lines = organic.map((o: any, i: number) => `${i + 1}. ${String(o.title || "").slice(0, 140)}\n   ${o.link || ""}\n   ${String(o.snippet || "").slice(0, 240)}`);
      return `Resultados web (via ${res.via}):\n` + lines.join("\n");
    }
    if (name === "scrape_url") {
      const { sql } = ctx;
      const cfg = async (k: string) => { try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; } };
      if ((await cfg("web_search_enabled")) !== "true") return "scrape na web DESABILITADO (kill-switch web_search_enabled).";
      const url = String(args.url || "").trim();
      if (!/^https?:\/\//i.test(url)) return "erro: url inválida (use http(s)://)";
      const res = await callSerp(sql, "/v1/scrape", { url, return_raw_html: true, raw_html_limit: 60000 }, 45000);
      if (!res.ok) return "scrape indisponível no momento (central e fallback falharam).";
      const d = res.data || {};
      const title = String(d.title || "").slice(0, 200);
      const html = String(d.raw_html || "");
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2500);
      return `Página (via ${res.via}) — ${d.final_url || url}\nTítulo: ${title}\n${text || "(sem conteúdo textual extraível)"}`;
    }
    if (name === "generate_document") {
      // Gera um .docx REAL via mz-office (compose_docx) e devolve o link. Força as seções Conclusão + Fontes.
      const title = String(args.title || "Documento").slice(0, 200);
      const sections = Array.isArray(args.sections) ? args.sections : [];
      const conclusion = String(args.conclusion || "").trim();
      const sources = (Array.isArray(args.sources) ? args.sources : []).filter((s: any) => s && String(s).trim());
      if (!sections.length) return "erro: documento sem seções (forneça sections[]).";
      const blocks: any[] = [{ type: "heading1", text: title }];
      for (const sec of sections) {
        blocks.push({ type: "heading2", text: String(sec?.heading || "").slice(0, 200) });
        for (const para of String(sec?.body || "").split(/\n\n+/)) if (para.trim()) blocks.push({ type: "paragraph", runs: [{ text: para.trim().slice(0, 4000) }] });
      }
      if (conclusion) { blocks.push({ type: "heading2", text: "Conclusão" }); for (const para of conclusion.split(/\n\n+/)) if (para.trim()) blocks.push({ type: "paragraph", runs: [{ text: para.trim().slice(0, 4000) }] }); }
      if (sources.length) { blocks.push({ type: "heading2", text: "Fontes" }); sources.forEach((s: string, i: number) => blocks.push({ type: "paragraph", runs: [{ text: `${i + 1}. ${String(s).slice(0, 400)}` }] })); }
      const fname = String(args.file_name || "documento").replace(/[^\w.\-]+/g, "_").replace(/\.docx$/i, "").slice(0, 100) || "documento"; // mz-office acrescenta .docx
      try {
        const r = await fetch("http://kong:8000/functions/v1/mz-office", {
          method: "POST",
          headers: { apikey: ctx.apikey || "", authorization: `Bearer ${ctx.userToken || ""}`, "content-type": "application/json" },
          body: JSON.stringify({ action: "compose_docx", composer_type: "compose_docx", file_name: fname, blocks }),
        });
        const jr: any = await r.json().catch(() => ({}));
        if (!r.ok || jr.error) return `erro ao gerar o .docx: ${jr.error || ("http " + r.status)}`;
        const url = jr.signed_url || jr.gcs_url;
        if (!url) return "documento gerado, mas sem link de download disponível.";
        // CAPTURA o link REAL (com ?token=) p/ o pós-processamento anexá-lo direto — a LLM dropa o token ao citar URLs.
        if (ctx.captured) { ctx.captured.docUrl = url; ctx.captured.docName = jr.file_name || fname; ctx.captured.storagePath = jr.storage_path; }
        return `✅ Documento .docx "${jr.file_name || fname}" gerado com sucesso (${jr.bytes_len || "?"} bytes). NÃO reescreva nem cite o link de download — ele será anexado AUTOMATICAMENTE à sua resposta. Apenas confirme ao usuário que o documento está pronto para baixar.`;
      } catch (e) { return "gerador de documento inalcançável: " + String((e as Error).message || e).slice(0, 120); }
    }
    if (name === "list_project_files") {
      if (!ctx.projectId || !ctx.userId) return "esta conversa não está vinculada a um projeto.";
      const rows = await ctx.sql`select file_name, kind from public.mz_project_files where project_id = ${ctx.projectId}::uuid and user_id = ${ctx.userId}::uuid order by created_at desc limit 60`;
      if (!rows.length) return "o projeto vinculado ainda não tem documentos.";
      return "Documentos do projeto:\n" + rows.map((f: any, i: number) => `${i + 1}. ${f.file_name}${f.kind ? " (" + f.kind + ")" : ""}`).join("\n");
    }
    if (name === "edit_project_document") {
      if (!ctx.projectId || !ctx.userId) return "esta conversa não está vinculada a um projeto.";
      const fn = String(args.file_name || "").trim();
      const changes = Array.isArray(args.changes) ? args.changes.filter((cc: any) => cc && cc.original_text && cc.replacement_text) : [];
      if (!fn) return "erro: informe file_name (use list_project_files).";
      if (!changes.length) return "erro: informe changes [{original_text, replacement_text}].";
      const fr = await ctx.sql`select storage_path, file_name from public.mz_project_files where project_id = ${ctx.projectId}::uuid and user_id = ${ctx.userId}::uuid and lower(file_name) = ${fn.toLowerCase()} and storage_path is not null order by created_at desc limit 1`;
      const target = fr[0];
      if (!target || !target.storage_path) return `não encontrei um documento chamado "${fn}" com arquivo editável no projeto. Use list_project_files.`;
      try {
        const r = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey: ctx.apikey || "", authorization: `Bearer ${ctx.userToken || ""}`, "content-type": "application/json" }, body: JSON.stringify({ action: "apply_track_changes", source_path: target.storage_path, changes, author: "Mukta Zero", file_name: String(target.file_name || "revisado").replace(/\.docx$/i, ""), project_id: ctx.projectId }) });
        const jr: any = await r.json().catch(() => ({}));
        if (!r.ok || jr.error) return `não consegui editar: ${jr.error || jr.message || ("http " + r.status)}${Array.isArray(jr.unmatched) && jr.unmatched.length ? " — trechos NÃO encontrados no documento (verifique o texto EXATO): " + jr.unmatched.slice(0, 3).map((u: any) => JSON.stringify(String(u).slice(0, 50))).join(", ") : ""}`;
        if (ctx.captured && jr.file_id) { ctx.captured.docFileId = jr.file_id; ctx.captured.docName = jr.file_name || target.file_name; ctx.captured.storagePath = jr.storage_path; }
        return `✅ Documento "${target.file_name}" editado com ${jr.applied ?? changes.length} revisão(ões) como track changes; a nova versão foi salva no projeto. NÃO cite nem reescreva o link — ele será anexado automaticamente. Apenas confirme ao usuário.`;
      } catch (e) { return "editor de documento inalcançável: " + String((e as Error).message || e).slice(0, 120); }
    }
    if (name === "append_to_project_document") {
      if (!ctx.projectId || !ctx.userId) return "esta conversa não está vinculada a um projeto.";
      const fn = String(args.file_name || "").trim();
      const content = String(args.content || "").trim();
      const heading = String(args.heading || "").trim();
      if (!fn) return "erro: informe file_name.";
      if (!content) return "erro: informe content.";
      const fr = await ctx.sql`select storage_path, file_name from public.mz_project_files where project_id = ${ctx.projectId}::uuid and user_id = ${ctx.userId}::uuid and lower(file_name) = ${fn.toLowerCase()} and storage_path is not null order by created_at desc limit 1`;
      const target = fr[0];
      if (!target || !target.storage_path) return `não encontrei um documento chamado "${fn}" com arquivo editável no projeto. Use list_project_files.`;
      const blocks: any[] = [];
      if (heading) blocks.push({ type: "heading2", text: heading.slice(0, 200) });
      for (const para of content.split(/\n\n+/)) if (para.trim()) blocks.push({ type: "paragraph", runs: [{ text: para.trim().slice(0, 4000) }] });
      if (!blocks.length) return "erro: sem conteúdo para acrescentar.";
      try {
        const r = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey: ctx.apikey || "", authorization: `Bearer ${ctx.userToken || ""}`, "content-type": "application/json" }, body: JSON.stringify({ action: "append_docx", source_path: target.storage_path, blocks, file_name: String(target.file_name || "documento").replace(/\.docx$/i, ""), project_id: ctx.projectId }) });
        const jr: any = await r.json().catch(() => ({}));
        if (!r.ok || jr.error) return `não consegui acrescentar: ${jr.error || ("http " + r.status)}`;
        if (ctx.captured && jr.file_id) { ctx.captured.docFileId = jr.file_id; ctx.captured.docName = jr.file_name || target.file_name; ctx.captured.storagePath = jr.storage_path; }
        return `✅ Seção acrescentada ao documento "${target.file_name}" (conteúdo original preservado); a nova versão foi salva no projeto. NÃO cite o link — será anexado automaticamente. Apenas confirme ao usuário.`;
      } catch (e) { return "editor de documento inalcançável: " + String((e as Error).message || e).slice(0, 120); }
    }
    if (name === "search_project_files") {
      if (!ctx.projectId || !ctx.userId) return "esta conversa não está vinculada a um projeto — não há documentos de projeto para buscar.";
      const q = String(args.query || "").trim();
      if (!q) return "erro: query vazia";
      const { sql } = ctx;
      let files: any[] = [];
      try { files = await sql`select id, file_name, storage_path, content_text from public.mz_project_files where project_id = ${ctx.projectId}::uuid and user_id = ${ctx.userId}::uuid order by created_at desc limit 40`; } catch { return "não consegui ler os arquivos do projeto."; }
      if (!files.length) return "o projeto vinculado ainda não tem documentos.";
      const terms = q.toLowerCase().split(/\s+/).map((t: string) => t.replace(/[^0-9a-zà-ú]/gi, "")).filter((t: string) => t.length >= 3);
      if (!terms.length) terms.push(q.toLowerCase());
      const found: { file: string; score: number; snippet: string }[] = [];
      let parsed = 0;
      for (const f of files) {
        let text: string = typeof f.content_text === "string" ? f.content_text : "";
        if (!text && f.storage_path && parsed < 8) {
          parsed++;
          try {
            const pr = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey: ctx.apikey || "", authorization: `Bearer ${ctx.userToken || ""}`, "content-type": "application/json" }, body: JSON.stringify({ action: "parse_document", source_path: f.storage_path }) });
            const pj: any = await pr.json().catch(() => ({}));
            text = Array.isArray(pj.paragraphs) ? pj.paragraphs.map((pp: any) => String(pp.text || "")).join("\n").trim() : "";
            if (text) { try { await sql`update public.mz_project_files set content_text = ${text} where id = ${f.id}::uuid`; } catch { /* cache best-effort */ } }
          } catch { /* parse best-effort */ }
        }
        if (!text) continue;
        const low = text.toLowerCase();
        let score = 0;
        for (const t of terms) { let i = 0, cnt = 0; while ((i = low.indexOf(t, i)) !== -1 && cnt < 200) { score++; cnt++; i += t.length; } }
        if (score <= 0) continue;
        let pos = -1;
        for (const t of terms) { pos = low.indexOf(t); if (pos !== -1) break; }
        const start = Math.max(0, pos - 200);
        const snippet = text.slice(start, start + 700).replace(/\s+/g, " ").trim();
        found.push({ file: String(f.file_name || "documento"), score, snippet });
      }
      found.sort((a, b) => b.score - a.score);
      const top = found.slice(0, 4);
      if (!top.length) return `nenhum trecho relevante para "${q}" nos documentos do projeto (busquei em ${files.length} arquivo(s)).`;
      return top.map((r) => `📄 ${r.file}:\n${r.snippet}`).join("\n\n---\n\n").slice(0, 4000);
    }
    return `erro: ferramenta desconhecida ${name}`;
  } catch (e) { return "erro: " + String((e as Error).message || e).slice(0, 160); }
}

// fetch a um provedor LLM COM TIMEOUT (cobre a conexão E a leitura do corpo). Um provedor lento aborta e o caller
// cai no próximo da ladder — impede pendurar até o teto de 300s do upstream (kong) → era a causa de http 504.
async function llmFetch(baseUrl: string, key: string, payload: any, timeoutMs = 100000): Promise<{ ok: boolean; status: number; text: string } | null> {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(payload) });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text };
  } catch { return null; } finally { clearTimeout(tm); }
}

export default async function (req: Request, ctx: { sql: any; getSecret: (n: string) => string | undefined }) {
  const { sql, getSecret } = ctx;
  const origin = req.headers.get("origin") || "*";
  const cors: Record<string, string> = {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "apikey, content-type, authorization",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
  const j = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  // 1) AUTH
  const secret = getSecret("JWT_SECRET") || getSecret("GOTRUE_JWT_SECRET");
  if (!secret) return j({ error: "server_misconfig", detail: "JWT_SECRET ausente" }, 500);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  let claims: any;
  try { claims = await verifyJwt(token, secret); }
  catch (e) { return j({ error: "unauthorized", detail: String((e as Error).message || e) }, 401); }
  // 2) BODY — { messages, agent_id?, company_id?, session_id?, system_prompt_override? }
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }

  // 2b) IDENTIDADE EFETIVA — `on_behalf_of` (FB14)
  //
  // Quem dispara um webhook é um CI ou um cron de terceiro: não tem sessão, por
  // definição do caso de uso. O ticker dos laços idem — corre com service_role e
  // precisa executar COMO O DONO do laço, para cobrar a carteira certa e
  // respeitar as regras dele.
  //
  // 🔒 A guarda é a única linha que importa aqui, e ela só é confiável porque a
  // ASSINATURA do JWT é verificada acima (HMAC contra JWT_SECRET). Sem essa
  // verificação, `role: "service_role"` seria forjável por qualquer um e isto
  // viraria impersonação universal.
  //
  // REJEITA ALTO, não ignora em silêncio: um chamador comum que mande
  // `on_behalf_of` recebe 403. Ignorar silenciosamente o faria crer que age como
  // outro enquanto age como si mesmo — e esconderia uma tentativa de escalada
  // que merece aparecer.
  const ehServiceRole = claims.role === "service_role";
  const alvo = typeof body.on_behalf_of === "string" ? body.on_behalf_of.trim() : "";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (alvo && !ehServiceRole) {
    return j({ error: "forbidden", detail: "on_behalf_of exige credencial service_role" }, 403);
  }
  if (alvo && !UUID_RE.test(alvo)) {
    return j({ error: "bad_request", detail: "on_behalf_of deve ser um uuid" }, 400);
  }
  if (ehServiceRole && !alvo) {
    // Sem alvo, o run não teria dono: nem carteira a cobrar, nem regras a
    // respeitar. Correr "como service_role" seria um run órfão e privilegiado.
    return j({ error: "bad_request", detail: "service_role exige on_behalf_of (o run precisa de um dono)" }, 400);
  }

  const userId = (ehServiceRole ? alvo : claims.sub) as string;
  // Auditoria: um run disparado EM NOME DE alguém tem de dizer isso. Sem esta
  // marca, revendo carteira ou telemetria depois, "o usuário fez" e "um webhook
  // fez em nome dele" ficam indistinguíveis — e são coisas diferentes.
  const acionadoPorMaquina = ehServiceRole;
  const prompt = Array.isArray(body.messages)
    ? body.messages.filter((m: any) => m?.role === "user").map((m: any) => m?.content).join("\n")
    : (body.prompt || "");
  if (!prompt && body.action !== "persona_compile") return j({ error: "empty_prompt" }, 400);
  const projectId: string | null = (typeof body.project_id === "string" && body.project_id) ? body.project_id : null;
  const baseSystem = (body.system_prompt_override
    || "Você é o Mukta Zero, agente de IA de engenharia e produtividade da Mukta.")
    + (projectId ? " Esta conversa está VINCULADA A UM PROJETO com documentos (base de conhecimento); use a ferramenta search_project_files para consultar os documentos do projeto quando a pergunta puder ser respondida por eles — não peça ao usuário o que já está nos documentos." : "");
  const sessionId: string | null = body.session_id || body.conversation_id || null;
  // Temperatura parametrizável (aprovado Herbert): default 0.2 preservado; body.temperature=0 → review determinística.
  const reqTemp: number = typeof body.temperature === "number" ? body.temperature : 0.2;
  const clientName: string | null = body.client_name || null; // 'mz-cli' etc. (gating de plano)
  const jobId: string | null = typeof body.job_id === "string" ? body.job_id : null;
  // emitPhase — grava a FASE do pensamento em mz_jobs p/ o front streamar (SÓ o rótulo, NUNCA verbatim — regra P0).
  // Best-effort: falha nunca derruba a resposta. Fases são cosméticas; o result é a fonte da verdade.
  const emitPhase = async (phase: string, label: string) => {
    if (!jobId) return;
    try {
      await sql`update public.mz_jobs set phase = ${phase}, phases = coalesce(phases, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('phase', ${phase}::text, 'label', ${label}::text, 'at', now())), updated_at = now() where id = ${jobId}`;
    } catch { /* fases best-effort */ }
  };

  // registerChatDoc — registra um doc gerado no chat no projeto "Documentos Chat" do user (cria o projeto se faltar).
  // Assim TODO documento gerado no chat aparece em Projetos → Documentos Chat. Best-effort.
  const registerChatDoc = async (fileName: string, storagePath: string | null | undefined): Promise<string | null> => {
    if (!userId || !storagePath) return null;
    try {
      const pr = await sql`select id from public.mz_projects where user_id = ${userId}::uuid and name = 'Documentos Chat' limit 1`;
      let projId = pr[0]?.id;
      if (!projId) { const np = await sql`insert into public.mz_projects (user_id, name, description) values (${userId}::uuid, 'Documentos Chat', 'Documentos gerados nas conversas do chat') returning id`; projId = np[0]?.id; }
      if (projId) { const fr = await sql`insert into public.mz_project_files (user_id, project_id, file_name, storage_path, kind) values (${userId}::uuid, ${projId}::uuid, ${String(fileName || `${selo()}-documento.docx`)}, ${storagePath}, 'docx') returning id`; return fr[0]?.id ?? null; }
    } catch { /* best-effort */ }
    return null;
  };

  // 3) TENANT — resolve company/agent por query DIRETA (o sql do mukta-edge não tem auth.uid()).
  let companyId: string | null = body.company_id || null;
  let agentId: string | null = body.agent_id || null;
  try {
    if (!companyId) {
      const r = await sql`select company_id from user_company_memberships where user_id = ${userId} limit 1`;
      companyId = r[0]?.company_id || null;
    }
    if (!agentId && companyId) {
      const r = await sql`select id from agent_profiles where company_id = ${companyId} and is_active = true limit 1`;
      agentId = r[0]?.id || null;
    }
  } catch { /* segue sem tenant se falhar; memória fica desativada */ }

  // 3b) WORKING PERSONA (Fase 0 LINHA — kill-switch internal_config.persona_engine_enabled, default OFF; best-effort).
  // Norteador de execução: compila pursue[] (soft) no system prompt. protect[] NÃO entra como texto — enforcement
  // Migration persona_charters validada BEGIN…ROLLBACK na .107 (8/8 checks). Falha aqui NUNCA derruba o turno.
  let personaProtect: any[] = [];
  let personaTrace: any = null;
  let personaBlock = "";
  try {
    const ks = await sql`select public.get_internal_config('persona_engine_enabled') as v`;
    if (String(ks[0]?.v) === "true") {
      // slug selecionável: body.persona_slug (escolha imediata) > mz_user_persona (persona ativa do user) > mz_default
      let personaSlug = (typeof body.persona_slug === "string" && body.persona_slug.trim()) || null;
      if (!personaSlug) { try { const up = await sql`select persona_slug from public.mz_user_persona where user_id = ${userId}::uuid`; personaSlug = up[0]?.persona_slug || null; } catch { /* sem escolha */ } }
      personaSlug = personaSlug || "mz_default";
      const pr = await sql`select persona_slug, scope, stage, pursue, protect from public.resolve_active_persona(${personaSlug}, ${companyId}::uuid, null::uuid, ${userId}::uuid)`;
      try { const es = await sql`select public.get_internal_config('persona_enforce_enabled') as v`; if (String(es[0]?.v) === "true" && Array.isArray(pr[0]?.protect)) personaProtect = pr[0].protect; } catch { /* enforce best-effort */ }
      const pursue = pr[0]?.pursue;
      personaTrace = { slug: pr[0]?.persona_slug || personaSlug, scope: pr[0]?.scope || null, source: (typeof body.persona_slug === "string" && body.persona_slug.trim()) ? "body" : "active", pursue_injected: Array.isArray(pursue) && pursue.length > 0, pursue_count: Array.isArray(pursue) ? pursue.length : 0, protect_count: Array.isArray(pr[0]?.protect) ? pr[0].protect.length : 0 };
      if (Array.isArray(pursue) && pursue.length) {
        const goals = pursue.map((g: any) => `- ${g.direction === "minimize" ? "MINIMIZE" : "MAXIMIZE"} ${g.metric || g.objective_key} (peso ${g.weight ?? 1})`).join("\n");
        personaBlock = `\n\nPERSONA (norteador de execução — objetivos a PERSEGUIR):\n${goals}\n(Restrições duras são impostas por gate externo, não por você.)`;
      }
    }
  } catch { /* persona best-effort */ }

  // 4) LADDER — SSOT multi-provider: modelo do agente primeiro, depois todos ativos por priority.
  let agentModelId: string | null = null;
  let ladder: any[] = [];
  try {
    if (agentId) {
      const r = await sql`select model_id from agent_profiles where id = ${agentId} and is_active = true limit 1`;
      agentModelId = r[0]?.model_id || null;
    }
    ladder = await sql`select id, provider, model_slug, base_url, provider_config from llm_models
      where is_active = true
      order by case when id = ${agentModelId} then 0 else 1 end, priority asc, created_at asc`;
  } catch (e) { return j({ error: "model_lookup_failed", detail: String((e as Error).message || e) }, 500); }
  if (!ladder.length) return j({ error: "no_active_model" }, 500);

  // Tier 1 Nível 2: compila descrição fluida do user em pursue[] estruturado → charter scope=user → ativa. Reusa ladder+llmFetch.
  if (body.action === "persona_compile") {
    const desc = String(body.description || "").trim();
    if (!desc) return j({ error: "empty_description" }, 400);
    const m = ladder[0];
    let mkey: string | undefined;
    try { const r = await sql`select public.get_vault_secret(${String(m.provider).toUpperCase() + "_API_KEY"}) as v`; mkey = r[0]?.v || undefined; } catch { /* */ }
    mkey = mkey || getSecret(String(m.provider).toUpperCase() + "_API_KEY");
    if (!mkey) return j({ error: "no_model_key" }, 500);
    const csys = "Você COMPILA a descrição fluida de uma persona de agente em OBJETIVOS-A-PERSEGUIR estruturados. NÃO invente objetivos fora da descrição. Máximo 4; o principal com weight 1. Responda SOMENTE JSON: {\"pursue\":[{\"objective_key\":\"snake_case\",\"metric\":\"objetivo em texto\",\"weight\":0.1,\"direction\":\"maximize|minimize\"}]}";
    const cr = await llmFetch(m.base_url, mkey, { model: m.model_slug, messages: [{ role: "system", content: csys }, { role: "user", content: "Descrição:\n" + desc + "\n\nCompile. SOMENTE JSON." }], temperature: 0, max_tokens: 1500, response_format: { type: "json_object" }, ...(m.provider_config ? { provider: m.provider_config } : {}) }, 60000);
    let pursue: any[] = [];
    try { const jr: any = JSON.parse(cr?.text || "{}"); pursue = JSON.parse(jr.choices?.[0]?.message?.content || "{}").pursue || []; } catch { /* */ }
    const valid = (pursue || []).filter((o: any) => o && typeof o.objective_key === "string" && /^[a-z][a-z0-9_]*$/.test(o.objective_key) && typeof o.metric === "string" && o.metric.trim().length > 3 && (o.direction === "maximize" || o.direction === "minimize")).slice(0, 4).map((o: any) => ({ objective_key: o.objective_key, metric: o.metric.trim(), weight: typeof o.weight === "number" ? Math.max(0.1, Math.min(1, o.weight)) : 1, direction: o.direction }));
    if (!valid.length) return j({ error: "compile_failed", detail: "nenhum objetivo bem-formado" }, 422);
    const cslug = (String(body.slug || "custom_persona").replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40)) || "custom_persona";
    try {
      await sql`update public.persona_charters set is_active=false where scope='user' and persona_slug=${cslug} and user_id=${userId}::uuid`;
      await sql`insert into public.persona_charters (persona_slug, scope, user_id, stage, pursue, protect, raw_prompt) values (${cslug},'user',${userId}::uuid,'linha',${JSON.stringify(valid)}::text::jsonb,'[]'::jsonb,${desc})`;
      await sql`insert into public.mz_user_persona (user_id, persona_slug) values (${userId}::uuid, ${cslug}) on conflict (user_id) do update set persona_slug=${cslug}, updated_at=now()`;
    } catch (e) { return j({ error: "persist_failed", detail: String((e as Error).message || e).slice(0, 120) }, 500); }
    return j({ ok: true, persona_slug: cslug, pursue: valid });
  }

  // 5) MEMÓRIA DE SESSÃO — recall determinístico (turnos anteriores do MESMO session_id, do DB).
  let memoryBlock = "";
  // Turnos anteriores REAPROVEITADOS no julgamento de absorção (passo 7). Sai daqui e não de uma
  // consulta nova: o recall já os trouxe, e uma 2ª query no caminho de persistência pagaria
  // latência para ler o que já está em memória.
  let turnosAnteriores: string[] = [];
  // 🔴 FOLHA DA CADEIA — o `id` do turno mais recente, para o próximo evento apontar para ele.
  // MEDIDO 2026-08-16: os 260 eventos da instância tinham `parent_event_id` NULL, **todos**. O
  // `get_session_memory_traceback` é `WITH RECURSIVE` sobre `parent_event_id`, logo a recursão
  // terminava no próprio nó e devolvia **1 linha**, nunca 12. A memória de sessão recuperava UM
  // turno desde sempre, e o sintoma era invisível: o bloco de memória vinha preenchido, só que com
  // um turno em vez de doze.
  let folhaMemoria: string | null = null;
  if (sessionId && companyId && agentId) {
    try {
      const past = await sql`select id, user_input, assistant_output, depth
        from get_session_memory_traceback(${sessionId}, ${companyId}::uuid, ${agentId}::uuid, null, 12)`;
      if (past && past.length) {
        // a FOLHA é a de menor `depth` (o traceback vem do leaf para a raiz)
        folhaMemoria = String([...past].sort((a: any, b: any) => (a.depth ?? 0) - (b.depth ?? 0))[0]?.id ?? "") || null;
      }
      if (past && past.length) {
        // traceback vem do leaf p/ a raiz (depth cresc.) -> inverter p/ ordem cronológica
        const chrono = [...past].sort((a: any, b: any) => (b.depth ?? 0) - (a.depth ?? 0));
        // §48: entra o turno INTEIRO (pergunta + resposta). Antes só vinha `assistant_output`, e um
        // fato afirmado PELO UTILIZADOR ficava invisível ao julgamento do turno seguinte.
        turnosAnteriores = chrono
          .map((r: any) => `${String(r.user_input ?? "")} ${String(r.assistant_output ?? "")}`.trim())
          .filter((s) => s.length > 20);
        const lines = chrono
          .map((r: any) => `Usuário: ${r.user_input}\nMukta Zero: ${r.assistant_output}`)
          .join("\n---\n");
        memoryBlock = `\n\n[Memória desta sessão — turnos anteriores, use se relevante]\n${lines}\n[fim da memória]`;
      }
    } catch { /* memória é best-effort: nunca derruba a resposta */ }
  }
  // 5b) RAG SEMÂNTICO — embed da pergunta (config SSOT em internal_config) + consult_knowledge_base.
  let ragBlock = "";
  const cfg = async (k: string): Promise<string | null> => {
    try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; }
  };
  try {
    if (companyId && (await cfg("rag_enabled")) === "true") {
      const emodel = await cfg("embedding_model");
      const ebase = await cfg("embedding_base_url");
      const ekeyName = await cfg("embedding_key_name");
      const edim = parseInt((await cfg("embedding_dim")) || "1536", 10);
      if (emodel && ebase && ekeyName) {
        let ekey: string | undefined;
        try { const r = await sql`select public.get_vault_secret(${ekeyName}) as v`; ekey = r[0]?.v || undefined; } catch { /* */ }
        ekey = ekey || getSecret(ekeyName);
        if (ekey) {
          const er = await fetch(`${ebase.replace(/\/+$/, "")}/embeddings`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${ekey}` },
            body: JSON.stringify({ model: emodel, input: prompt, dimensions: edim }),
          });
          const ej: any = await er.json().catch(() => ({}));
          const vec = ej?.data?.[0]?.embedding;
          if (Array.isArray(vec) && vec.length) {
            const vecStr = `[${vec.join(",")}]`;
            // SEMÂNTICO (cosine). Escopo por company_id explícito (handler sem JWT no sql).
            const chunks = await sql`select content, (1 - (embedding <=> ${vecStr}::vector)) as similarity
              from knowledge_nodes
              where company_id = ${companyId}::uuid
                and embedding is not null
                and approval_status = 'approved'
                and (valid_to is null)
              order by embedding <=> ${vecStr}::vector
              limit 8`;
            const picked: string[] = (chunks || []).filter((c: any) => Number(c.similarity) >= 0.35).map((c: any) => String(c.content));
            // HÍBRIDO (kill-switch rag_hybrid_enabled, default OFF): + LEXICAL/FTS. O cosine tem baixa similaridade
            // questão↔fato (~0.35) p/ fatos densos e enterra os de TERMO EXATO (art./número/sigla) abaixo do threshold
            // (achado E2E 2026-07-22: cosine-only não move a resposta). O FTS recupera exatamente esses.
            if ((await cfg("rag_hybrid_enabled")) === "true") {
              const stop = new Set(["qual", "quais", "quanto", "quantos", "como", "para", "por", "que", "com", "dos", "das", "uma", "meu", "seu", "sua", "the", "and", "fins", "sobre", "entre", "ate", "valor", "numero", "quando"]);
              const terms = String(prompt).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w: string) => ((w.length >= 4) || (/^\d+$/.test(w) && w.length >= 2)) && !stop.has(w));
              const tsq = [...new Set(terms)].slice(0, 10).join(" | ");
              if (tsq) {
                try {
                  const ftsRows = await sql`select content, ts_rank(fts, to_tsquery('portuguese', ${tsq})) as rank
                    from knowledge_nodes
                    where company_id = ${companyId}::uuid and fts is not null and approval_status = 'approved' and (valid_to is null)
                      and fts @@ to_tsquery('portuguese', ${tsq})
                    order by rank desc limit 6`;
                  const seen = new Set(picked);
                  for (const r of (ftsRows || [])) { const c = String((r as any).content); if (!seen.has(c)) { picked.push(c); seen.add(c); } }
                } catch { /* fts best-effort — nunca derruba a resposta */ }
              }
            }
            const finalChunks = picked.slice(0, 6);
            if (finalChunks.length) {
              ragBlock = `\n\n[Base de conhecimento — trechos relevantes recuperados, use se pertinente]\n`
                + finalChunks.map((c: string) => `• ${c}`).join("\n") + `\n[fim da base]`;
            }
          }
        }
      }
    }
  } catch { /* RAG é best-effort: nunca derruba a resposta */ }

  // T1.3b — NUDGE de code-exec: para qualquer problema NUMÉRICO/COMPUTACIONAL (contagem, aritmética exata, combinatória,
  // simulação, verificação de fórmula), NÃO calcule "de cabeça" — escreva e EXECUTE um programa com a ferramenta run_code.
  // Lever provado (T1.3): computação via code-exec leva AIME 71→100%; raciocinar o mesmo cálculo (self-repair) não move.
  const toolNudge = "\n\nFERRAMENTAS: você tem a ferramenta run_code (executa código em sandbox). Para QUALQUER pergunta numérica/computacional — contagem, aritmética exata, combinatória, teoria dos números, simulação, ou conferir uma fórmula — ESCREVA E EXECUTE um programa com run_code em vez de calcular de cabeça (LLMs erram cálculo mental). Use a saída executada como a resposta. Para perguntas não-computacionais, responda normalmente.";
  // ── CAMADA 2 · PASSO DA FAMÍLIA (2026-08-06) ──────────────────────────────────────────────────
  // MEDIDO no AGI-2: pede-se ao modelo que PRODUZA o artefacto em todos os passos, e ele é bom a
  // NOMEAR e mau a produzir.
  //     «escreva out_dims»    0 de 4, com 5 modelos e 3 trocas de role
  //     «escreva transform»   exatos = 0 em 13/13, duas campanhas completas
  //     «que natureza tem?»   13/13 nomearam um MECANISMO em 1,2–2,0 s · 0/13 inventaram zeros
  //                           numa grade sem zeros (ou seja: LÊEM o que recebem)
  // O passo em que ele demonstrou competência NÃO EXISTIA — ninguém lhe perguntava.
  //
  // ⚠️ E isto é um NUDGE, não um portão. A minha própria regra medida diz que «uma decisão
  // entregue como TEXTO pode ser ignorada em silêncio». Portanto: entra barato, e o efeito
  // MEDE-SE antes de o promover a passo obrigatório. Se não mudar comportamento, sai.
  const familiaNudge = "\n\nANTES DE ESCREVER CÓDIGO para um problema com critério objetivo (testes, saída esperada, exemplos de entrada→saída): diga PRIMEIRO, em UMA frase, qual é a NATUREZA do problema — que estrutura ele explora (padrão periódico? simetria? contagem? ordenação? partição?). Só depois escreva o programa. Se a primeira tentativa falhar o critério, NÃO ajuste detalhes do mesmo programa: reveja a NATUREZA — um erro espalhado por todos os casos é hipótese errada, não hipótese quase certa.";
  // 5b3) PLAYBOOK do agente (kill-switch playbook_learning, default OFF) — regras de DECISÃO aprendidas (Rota A,
  // oracle-gated) armazenadas como knowledge_nodes (metadata.playbook_kind='rule'). Diferente do RAG: NÃO é
  // recuperado por similaridade — TODAS as regras APPROVED do agente entram sempre (alavanca forte; F0-shadow arma
  // isto OFF + regras em 'draft' → não-injetadas; F1 = flip ON + review_knowledge_node aprova). Ver
  let playbookBlock = "";
  try {
    if (companyId && agentId && (await cfg("playbook_learning")) === "true") {
      const rules = await sql`select content from knowledge_nodes
        where company_id = ${companyId}::uuid and approval_status = 'approved' and (valid_to is null)
          and metadata->>'playbook_kind' = 'rule'
          and (agent_id = ${agentId}::uuid or metadata->>'agent_id' = 'company-general')
        order by trust_score desc nulls last limit 20`;
      if (rules && rules.length) {
        playbookBlock = `\n\n[Playbook do agente — regras de decisão aprendidas e verificadas por oráculo, siga-as]\n`
          + rules.map((r: any) => `- ${String(r.content)}`).join("\n") + `\n[fim do playbook]`;
      }
    }
  } catch { /* playbook best-effort — nunca derruba a resposta */ }

  // ⚠️ o `familiaNudge` entra atrás do `toolNudge` de propósito: o de ferramentas diz QUANDO usar
  // o run_code; o da família diz o que fazer ANTES de escrever o código que lá vai.
  const system = baseSystem + personaBlock + toolNudge + familiaNudge + memoryBlock + ragBlock + playbookBlock;

  // 5b2) GATING DE PLANO (kill-switch internal_config.mz_gating_enabled, default off): CLI e self-learning
  //      são recursos de conta PAGA. Bloqueia ANTES do dispatch se plan != 'paid'. Best-effort: não bloqueia se falhar.
  try {
    if ((await cfg("mz_gating_enabled")) === "true" && (clientName === "mz-cli" || body.self_learning === true)) {
      const w = await sql`select plan from mz_user_wallets where user_id = ${userId}::uuid limit 1`;
      if ((w[0]?.plan || "free") !== "paid") {
        return j({ error: "paid_plan_required", detail: "O CLI e o self-learning são recursos de conta paga. Faça upgrade para usar." }, 403);
      }
    }
  } catch { /* gating best-effort: falha não bloqueia o fluxo normal */ }

  // 5c) ROTEAMENTO BUDGET (kill-switch internal_config.budget_routing_enabled, default off): tarefa SIMPLES
  // (heurística DETERMINÍSTICA, sem chamada LLM extra) → modelo budget (gemma via role mz_chat_budget, ~5,5×
  // mais barato) na FRENTE da ladder. Conservador: só budget se CURTA + padrão simples + sem keyword de
  // reasoning; incerto → brain (não degrada). MZ paga token bruto → isso corta COGS direto nas tarefas simples.
  let routedTier: "brain" | "budget" = "brain";
  const classifyTier = (p: string): "brain" | "budget" => {
    const t = p.toLowerCase(), len = p.length;
    // stems SEM \b final (o \b final quebra o stemming: "traduz\b" não casa "traduza"). Leading \b = início de palavra.
    const complexKw = /\b(analis|an[aá]lise|avali|prov[ae]|demonstr|calcul|deriv|integr|equa[cç]|teorema|algoritmo|c[oó]digo|code|function|implement|refator|debug|arquitet|estrat[eé]gi|jur[ií]dic|financ|risco|compliance|parecer|deck|apresenta|redij|disserta|ensaio|compar|trade-?off|por que|porqu[eê]|passo a passo|step by step|otimiz|planej|indu[cç])/i;
    // Chat interativo prioriza VELOCIDADE: só o EXPLICITAMENTE complexo (ou muito longo) vai ao reasoning-model forte
    // (DeepSeek-Pro, lento ~48s); saudação/Q&A simples-média vão ao gemma rápido (~5s) via budget_routing. Antes o
    // default 'brain' fazia até "diga olá" levar 48s. Reversível: kill-switch budget_routing_enabled + este classificador.
    if (complexKw.test(t)) return "brain";
    if (len > 500) return "brain";
    return "budget";
  };
  routedTier = classifyTier(prompt); // AVALIAÇÃO DE COMPLEXIDADE SEMPRE (Herbert): determinística, barata (sem LLM);
                                     // reusada p/ o roteamento budget E como pré-gate do Conselho (só convoca se 'brain').
  try {
    if ((await cfg("budget_routing_enabled")) === "true" && routedTier === "budget") {
      const br = await sql`select llm_model_id from llm_role_defaults where role = 'mz_chat_budget' limit 1`;
      const budgetId = br[0]?.llm_model_id;
      const idx = budgetId ? ladder.findIndex((m: any) => m.id === budgetId) : -1;
      if (idx > 0) { const [bm] = ladder.splice(idx, 1); ladder.unshift(bm); } // gemma-budget vira o 1º; failover segue
    }
  } catch { /* routing best-effort: cai no comportamento padrão (brain) */ }

  // 6) DISPATCH com FAILOVER + LOOP DE TOOLS (Fase 2e).
  const tools = buildTools();
  if (projectId) tools.push({ type: "function", function: { name: "search_project_files", description: "Busca nos DOCUMENTOS do PROJETO vinculado a esta conversa (a base de conhecimento do projeto). Retorna os trechos mais relevantes com o nome do arquivo de origem. Use sempre que a pergunta puder ser respondida pelos documentos do projeto, em vez de pedir ao usuário. Não invente — se não achar, diga que não encontrou.", parameters: { type: "object", properties: { query: { type: "string", description: "o que buscar nos documentos do projeto" } }, required: ["query"] } } });
  if (projectId) {
    tools.push({ type: "function", function: { name: "list_project_files", description: "Lista os documentos do PROJETO vinculado (o nome de cada arquivo). Use ANTES de editar, para saber quais documentos existem e o nome exato.", parameters: { type: "object", properties: {} } } });
    tools.push({ type: "function", function: { name: "edit_project_document", description: "Edita um documento .docx EXISTENTE do projeto vinculado, aplicando alterações como REVISÕES (track changes) visíveis. Use para corrigir/ajustar/alterar trechos do documento. Cada mudança casa um texto original EXATO e o substitui. A versão editada é salva de volta no projeto.", parameters: { type: "object", properties: { file_name: { type: "string", description: "nome exato do documento (use list_project_files)" }, changes: { type: "array", description: "as alterações a aplicar", items: { type: "object", properties: { original_text: { type: "string", description: "trecho EXATO que existe hoje no documento" }, replacement_text: { type: "string", description: "texto que substitui o original" }, comment: { type: "string", description: "comentário opcional da revisão" } }, required: ["original_text", "replacement_text"] } } }, required: ["file_name", "changes"] } } });
    tools.push({ type: "function", function: { name: "append_to_project_document", description: "Acrescenta uma NOVA seção ao FIM de um documento .docx EXISTENTE do projeto vinculado (preserva todo o conteúdo original). Use para ADICIONAR conteúdo a um documento. A versão atualizada é salva de volta no projeto.", parameters: { type: "object", properties: { file_name: { type: "string", description: "nome exato do documento" }, heading: { type: "string", description: "título da nova seção (opcional)" }, content: { type: "string", description: "texto da nova seção (parágrafos separados por linha em branco)" } }, required: ["file_name", "content"] } } });
  }
  const convo: any[] = [{ role: "system", content: system }, { role: "user", content: prompt }];
  const attempts: any[] = [];
  // dispatch SEM tools (p/ o reasoning_gate) — só devolve content revisado.
  // ── LEDGER DE CHAMADAS DE MODELO (observabilidade por run) ──
  //
  // Um run do MZ usa VÁRIOS modelos — classificador, presidente do conselho, 2-3
  // especialistas em famílias distintas, sintetizador, e a resposta final. Até
  // aqui a telemetria guardava só o modelo do ÚLTIMO passo (`trace.model`) e um
  // total de tokens do run: a tela de Observabilidade mostrava "um modelo" para
  // um trabalho que consumiu seis, e o usuário não tinha como saber onde o custo
  // foi parar.
  //
  // O ledger anota UMA LINHA POR CHAMADA nos dois únicos pontos de despacho
  // (dispatchPlain/dispatchOn), que é por onde tudo passa — logo não há caminho
  // de modelo que escape sem ser contado.
  //
  // 🔒 SÓ METADADOS. Nunca a mensagem enviada nem o texto devolvido. O prompt do
  // usuário e a saída do agente ficam no histórico local dele; esta trilha é
  // custo e roteamento, e vai para uma tabela que outras pessoas leem.
  const modelCalls: Array<{ model: string; provider: string; purpose: string; tokens_in: number; tokens_out: number; latency_ms: number; ok: boolean }> = [];
  const logCall = (m: any, purpose: string, usage: any, ms: number, ok: boolean) => {
    try {
      modelCalls.push({
        model: String(m?.model_slug || "?"),
        provider: String(m?.provider || "?"),
        purpose,
        tokens_in: Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0,
        tokens_out: Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0,
        latency_ms: ms,
        ok,
      });
      if (modelCalls.length > 40) modelCalls.splice(0, modelCalls.length - 40); // teto: um run patológico não vira jsonb gigante
    } catch { /* ledger nunca derruba o despacho */ }
  };

  const toolsUsed: string[] = [];
  let text = "";
  let usedModel: any = null;
  const t0 = Date.now();
  let tokIn = 0, tokOut = 0, tokTotal = 0;
  // DEADLINE GUARD (fix do http 504): o upstream kong→run-agent-chat corta em ~300s. Reservamos orçamento p/
  // garantir que a resposta final + o docx sejam gerados ANTES disso. wantsDoc é hoisted aqui (era só na doc-gen)
  // p/ pular o reasoning_gate — que REESCREVE o texto inteiro (2ª chamada grande, "DOBRA a latência") — em
  // pedidos de documento longo, onde ele custa ~90s e agrega pouco. Causa-raiz do 504 no estudo→docx enriquecido.
  const elapsedMs = () => Date.now() - t0;
  const wantsDoc = /\bdocx\b|\bem\s+word\b|documento\s+(word|em\s+word)|\bestudo\b|\brelat[óo]rio\b|\bparecer\b|\bdossi[êe]\b|\blaudo\b|\bwhitepaper\b|\bwhite\s+paper\b/i.test(prompt);
  const needsWebSources = wantsDoc && /\bfontes?\b|\burls?\b|\blinks?\b|pesquis|\bdados\b|taxas?|mercado|atual|recente|transa[çc]|\b20\d\d\b/i.test(prompt);
  // Intenção de REVISAR/COMPLEMENTAR um documento anterior (verbo de edição, não de criação). Ex.: "revise este contrato",
  // "ajuste os prazos", "complemente o documento". Abre o bloco de doc-anterior mesmo sem palavra de wantsDoc — a existência
  // de um docx anterior + o classificador LLM (revisar|complementar|novo) são os gates reais. (W1, Herbert 2026-07-17)
  const wantsReviseDoc = /\brevis(?:e|ar|ão|a)?\b|\bajust(?:e|es|ar)\b|\bcorrij|\bcorrig|\balter(?:e|es|ar|a[çc])|\bedit(?:e|ar)\b|controle de altera|track\s*change|\bredline\b|\bcomplement(?:e|ar|a[çc])|\brefa[çc]a\b|\bmude\b|\bmudar\b/i.test(prompt);

  // Intenções acionáveis por chat/portal (W2b/W3): auditar integridade / compilar artefato navegável.
  const wantsAudit = /\baudit(?:e|ar|oria)?\b|integridade|verifi\w*\s+(as\s+)?(cita|fonte|fato)|checar\s+(as\s+)?fonte|fact.?check|cita\w*\s+fabricad/i.test(prompt);
  const wantsCompile = /\bcompil\w+\b|\bpainel\b|\bdashboard\b|panorama\s+(naveg[áa]vel|interativo|html)|artefato\s+(html|web|naveg[áa]vel)|p[áa]gina\s+naveg[áa]vel/i.test(prompt);
  // dispatch numa ladder; aceita content OU tool_calls como resposta válida.
  const dispatchLadder = async (msgs: any[]): Promise<{ msg: any; model: any; usage: any } | null> => {
    for (const m of ladder) {
      if (elapsedMs() > 250000) break; // nunca inicia provider novo perto do teto de 300s do upstream → evita 504
      const keyName = `${String(m.provider).toUpperCase()}_API_KEY`;
      let key: string | undefined;
      try { const r = await sql`select public.get_vault_secret(${keyName}) as v`; key = r[0]?.v || undefined; } catch { /* */ }
      key = key || getSecret(keyName);
      if (!key) { attempts.push({ model: m.model_slug, error: "no_key" }); continue; }
      // Este é o caminho da RESPOSTA (com tools) — o mais usado de todos. Ficou
      // de fora da primeira versão do ledger, que instrumentou só os dois
      // `dispatch*`: o resultado foi um run real com `model_calls: []` e
      // `tokens_in: 2548` no mesmo trace, ou seja, a trilha contradizendo a si
      // mesma. Medir "quase todos os caminhos" não mede nada.
      const tCall = Date.now();
      const rr = await llmFetch(m.base_url, key, { model: m.model_slug, messages: msgs, tools, tool_choice: "auto", temperature: reqTemp, max_tokens: 8192, ...(m.provider_config ? { provider: m.provider_config } : {}) });
      if (!rr) { attempts.push({ model: m.model_slug, error: "timeout_or_neterr" }); logCall(m, "resposta", null, Date.now() - tCall, false); continue; }
      if (!rr.ok) { attempts.push({ model: m.model_slug, status: rr.status, detail: rr.text.slice(0, 140) }); logCall(m, "resposta", null, Date.now() - tCall, false); continue; }
      let parsed: any = null;
      try { parsed = JSON.parse(rr.text); } catch { /* */ }
      const msg: any = parsed?.choices?.[0]?.message;
      if (msg && ((msg.content && String(msg.content).trim()) || (msg.tool_calls && msg.tool_calls.length))) {
        logCall(m, msg.tool_calls && msg.tool_calls.length ? "resposta (tool call)" : "resposta", parsed?.usage || null, Date.now() - tCall, true);
        return { msg, model: m, usage: parsed?.usage || null };
      }
      attempts.push({ model: m.model_slug, error: "empty" });
      logCall(m, "resposta", parsed?.usage || null, Date.now() - tCall, false);
    }
    return null;
  };


  const dispatchPlain = async (msgs: any[], opts?: { maxTries?: number; timeoutMs?: number; maxTokens?: number; purpose?: string }): Promise<{ text: string; usage: any } | null> => {
    let tries = 0;
    for (const m of ladder) {
      if (elapsedMs() > 250000) break; // nunca inicia provider novo perto do teto de 300s → evita pendurar até o 504
      if (opts?.maxTries && tries >= opts.maxTries) break; // limita nº de provedores (chamadas caras, ex.: compositor de estudo)
      const keyName = `${String(m.provider).toUpperCase()}_API_KEY`;
      let key: string | undefined;
      try { const r = await sql`select public.get_vault_secret(${keyName}) as v`; key = r[0]?.v || undefined; } catch { /* */ }
      key = key || getSecret(keyName);
      if (!key) continue;
      tries++;
      const tCall = Date.now();
      const rr = await llmFetch(m.base_url, key, { model: m.model_slug, messages: msgs, temperature: reqTemp, max_tokens: opts?.maxTokens || 8192, ...(m.provider_config ? { provider: m.provider_config } : {}) }, opts?.timeoutMs);
      // Falha de provedor TAMBÉM entra no ledger: um run que caiu por 3 modelos
      // antes de acertar custa tempo real, e omitir isso faria a trilha mentir
      // sobre a latência — o failover ficaria invisível justamente onde dói.
      if (!rr || !rr.ok) { logCall(m, opts?.purpose || "resposta", null, Date.now() - tCall, false); continue; }
      try {
        const parsed = JSON.parse(rr.text);
        const c = parsed?.choices?.[0]?.message?.content;
        if (c && String(c).trim()) { logCall(m, opts?.purpose || "resposta", parsed?.usage || null, Date.now() - tCall, true); return { text: String(c), usage: parsed?.usage || null }; }
      } catch { /* tenta o próximo da ladder */ }
    }
    return null;
  };

  // dispatchOn — dispatcha num MODELO ESPECÍFICO (não itera a ladder). Base do Conselho MULTI-MODELO:
  // especialistas rodam em modelos de FAMÍLIAS distintas → diversidade de pontos-cegos devolve o teto-oráculo.
  // Reasoning-models (Kimi/GLM) raciocinam antes; message.content sai limpo com max_tokens 8192 (verificado).
  const dispatchOn = async (m: any, msgs: any[], timeoutMs?: number, maxTokens?: number, purpose?: string): Promise<{ text: string; usage: any } | null> => {
    const keyName = `${String(m.provider).toUpperCase()}_API_KEY`;
    let key: string | undefined;
    try { const r = await sql`select public.get_vault_secret(${keyName}) as v`; key = r[0]?.v || undefined; } catch { /* */ }
    key = key || getSecret(keyName);
    if (!key) return null;
    try {
      const tCall = Date.now();
      const rr = await llmFetch(m.base_url, key, { model: m.model_slug, messages: msgs, temperature: reqTemp, max_tokens: maxTokens || 8192, ...(m.provider_config ? { provider: m.provider_config } : {}) }, timeoutMs);
      if (!rr || !rr.ok) { logCall(m, purpose || "especialista", null, Date.now() - tCall, false); return null; }
      const parsed = JSON.parse(rr.text);
      const c = parsed?.choices?.[0]?.message?.content;
      if (c && String(c).trim()) { logCall(m, purpose || "especialista", parsed?.usage || null, Date.now() - tCall, true); return { text: String(c), usage: parsed?.usage || null }; }
    } catch { /* modelo específico falhou → caller cai no dispatchPlain (ladder) */ }
    return null;
  };

  // A3 — GATE DE COMPLEXIDADE: tarefa complexa/multi-domínio → CONSELHO (presidente decompõe por ÁREA → especialistas focados → síntese).
  // Kill-switch internal_config.council_enabled (default off). O reasoning_gate (F4) cobre o caso médio.
  await emitPhase("analyzing", "Analisando a complexidade…");
  let councilUsed = false;
  let councilModelsTrace: string[] = [];
  try {
    const cfgCo = async (k: string) => { try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; } };
    // PRÉ-GATE determinístico (Herbert): só avalia p/ Conselho se classifyTier já disse 'brain' (complexo-ish).
    // Tarefa 'budget' (simples) NUNCA convoca o Conselho — economiza o classificador-LLM e as chamadas do conselho.
    // Estudo/relatório que precisa de FONTES/PESQUISA web (needsWebSources, hoisted acima) NÃO vai p/ o Conselho:
    // o Conselho sintetiza do conhecimento dos modelos, SEM web → sem fontes nem dados atuais (foi a queixa
    // "não foi enriquecido / sem as fontes"). Esses pedidos seguem o FLUXO DEDICADO de estudo (pesquisa + compositor).
    if ((await cfgCo("council_enabled")) === "true" && !needsWebSources && !wantsAudit && !wantsCompile && prompt.trim().length > 80 && routedTier === "brain") {
      const cls = await dispatchPlain([
        { role: "system", content: "Classifique a COMPLEXIDADE da tarefa: 'complexo' se exige análise MULTI-DOMÍNIO (jurídico+financeiro+risco), auditoria profunda ou decisão de alto risco; senão 'simples'. SOMENTE JSON {\"nivel\":\"complexo|simples\"}." },
        { role: "user", content: prompt.slice(0, 2500) },
      ], { purpose: "classificação" });
      if (cls && /complexo/i.test(cls.text)) {
        await emitPhase("council", "Convocando o Conselho de especialistas…");
        const chair = await dispatchPlain([{ role: "system", content: "Você preside um conselho. Identifique 2-3 ÁREAS de expertise distintas necessárias p/ tratar a tarefa. SOMENTE JSON {\"areas\":[\"<área>\"]}." }, { role: "user", content: prompt }], { purpose: "conselho:presidente" });
        let areas: string[] = ["análise geral"];
        try { const a = JSON.parse(String(chair?.text || "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")); if (Array.isArray(a.areas) && a.areas.length) areas = a.areas.slice(0, 3); } catch { /* */ }
        // Pool DIVERSO p/ os especialistas: 1 modelo por FAMÍLIA (prefixo do slug, ex.: deepseek-ai/google/
        // moonshotai/Qwen/meta-llama/zai-org), o de maior prioridade em cada. Derivado da ladder SSOT —
        // sem hardcode de slug (§4.B). Round-robin dos especialistas sobre o pool → diversidade de modelo.
        await emitPhase("council_specialists", "Consultando especialistas: " + areas.join(", ") + "…");
        const famPool: any[] = []; const seenFam = new Set<string>();
        for (const m of ladder) { const f = String(m.model_slug).split("/")[0].toLowerCase(); if (!seenFam.has(f)) { seenFam.add(f); famPool.push(m); } }
        const pareceres = await Promise.all(areas.map(async (area, i) => {
          const spec = famPool.length ? famPool[i % famPool.length] : ladder[0];
          const specMsgs = [{ role: "system", content: `Você é ESPECIALISTA SÊNIOR em ${area}. Analise a tarefa SÓ pela sua lente, com profundidade e princípios firmes do domínio (não divague p/ outras áreas).` }, { role: "user", content: prompt }];
          const dr = await dispatchOn(spec, specMsgs, undefined, undefined, `conselho:${area}`); // modelo específico da família
          const r = dr || await dispatchPlain(specMsgs, { purpose: `conselho:${area} (fallback)` }); // fallback: ladder (não quebra o conselho)
          councilModelsTrace.push(`${area}→${dr ? spec.model_slug : "ladder-fallback"}`);
          return `### ${area}\n${r?.text || ""}`;
        }));
        await emitPhase("council_synth", "Sintetizando os pareceres do Conselho…");
        const synth = await dispatchPlain([{ role: "system", content: system + "\n\nVocê é o SINTETIZADOR do conselho. Integre os pareceres dos especialistas numa resposta final ao usuário, resolvendo divergências e priorizando o bem-fundamentado. Responda direto ao usuário." }, { role: "user", content: `TAREFA:\n${prompt}\n\nPARECERES:\n${pareceres.join("\n\n")}` }], { purpose: "conselho:síntese" });
        if (synth && synth.text && synth.text.trim().length > 40) { text = synth.text.trim(); usedModel = ladder[0]; councilUsed = true; }
      }
    }
  } catch { /* council best-effort: cai no fluxo normal */ }

  const captured: any = {}; // link REAL de artefatos gerados por tool (docx) — anexado direto, sem a LLM citar (dropa o token)

  // ── COMPLEMENTO INTENCIONAL de um documento anterior da sessão (Herbert 2026-07-17) ──
  // Se o usuário pede p/ ENRIQUECER/COMPLEMENTAR o documento gerado ANTES nesta conversa, NÃO reescrevemos: inserimos
  // as seções NOVAS ao FIM do .docx original (append_docx cirúrgico no XML, preserva o arquivo). Gatilho é INTENCIONAL
  // e caso-a-caso via classificador LLM (há muitas formas de pedir), não regex. Só entra se houver um docx anterior na sessão.
  if ((wantsDoc || wantsReviseDoc) && !councilUsed && !text) {
    try {
      // recupera o docx anterior: 1º pela mensagem da SESSÃO (preciso), 2º fallback pelo doc de chat mais recente do user.
      let priorPath: string | null = null;
      if (sessionId) { try { const pr = await sql`select content from public.mz_messages where conversation_id=${sessionId}::uuid and role='assistant' and content like '%mz-uploads/%' order by created_at desc limit 1`; const m = String(pr[0]?.content || "").match(/mz-uploads\/([^?"\)\s]+\.docx)/i); if (m) priorPath = m[1]; } catch { /* */ } }
      if (!priorPath) { try { const pf = await sql`select storage_path from public.mz_project_files where user_id=${userId}::uuid and kind='docx' and storage_path is not null order by created_at desc limit 1`; if (pf[0]?.storage_path) priorPath = String(pf[0].storage_path); } catch { /* */ } }
      if (priorPath) {
        const cls = await dispatchPlain([
          { role: "system", content: "Há um DOCUMENTO .docx que JÁ foi gerado antes para o usuário. Classifique a INTENÇÃO da mensagem dele quanto a esse documento: 'revisar' = editar/corrigir/ajustar o texto EXISTENTE com controle de alterações (redline: mudar cláusulas, prazos, valores, redação); 'complementar' = ADICIONAR conteúdo/seções novas ao fim sem mexer no existente; 'novo' = documento do zero (outro assunto). Interprete a INTENÇÃO real; na dúvida, 'novo'. SOMENTE JSON {\"acao\":\"revisar|complementar|novo\"}." },
          { role: "user", content: prompt },
        ], { maxTries: 1, timeoutMs: 25000 });
        const acao = cls ? (/revisar/i.test(cls.text) ? "revisar" : /complementar/i.test(cls.text) ? "complementar" : "novo") : "novo";
        if (acao === "revisar") {
          // ── REVISÃO com TRACK CHANGES (W1): parse_document → brain gera redline → apply_track_changes nativo ──
          await emitPhase("generating", "Revisando o documento com controle de alterações…");
          try {
            const apikey = req.headers.get("apikey") || "";
            const pr2 = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "parse_document", source_path: priorPath }) });
            const parsed: any = await pr2.json().catch(() => ({}));
            const docText = (parsed?.paragraphs || []).map((p: any) => String(p.text || "")).filter(Boolean).join("\n").slice(0, 14000);
            if (docText.length > 40) {
              let brainId3: string | null = null;
              try { const br = await sql`select llm_model_id from public.llm_role_defaults where role='mz_chat_brain' limit 1`; brainId3 = br[0]?.llm_model_id || null; } catch { /* */ }
              const brainR = (brainId3 && ladder.find((m: any) => m.id === brainId3)) || ladder[0];
              const rev = await dispatchOn(brainR, [
                { role: "system", content: "Você é um revisor de documentos/contratos. Proponha alterações PONTUAIS e materiais atendendo ao pedido, em JSON. REGRAS CRÍTICAS p/ original_text: (1) DEVE ser um TRECHO LITERAL E EXATO copiado do DOCUMENTO (palavra por palavra, mesma pontuação/acentuação); (2) NÃO atravesse quebra de linha — copie de UMA única linha contínua, senão não se aplica. APENAS JSON: {\"changes\":[{\"original_text\":\"<trecho LITERAL de 1 linha>\",\"replacement_text\":\"<nova redação>\",\"comment\":\"<justificativa>\",\"clause_ref\":\"<ex: Cláusula 3>\"}]}. De 2 a 8 alterações." },
                { role: "user", content: `[PEDIDO]\n${prompt.slice(0, 800)}\n\n[DOCUMENTO]\n${docText}` },
              ], 140000);
              let changes: any[] = [];
              try { const rj = JSON.parse(String(rev?.text || "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")); if (Array.isArray(rj.changes)) changes = rj.changes.filter((c: any) => c && c.original_text && c.replacement_text); } catch { /* */ }
              if (changes.length) {
                const tr = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "apply_track_changes", source_path: priorPath, changes, author: "Mukta Zero — Revisão", file_name: "documento_revisado" }) });
                const trj: any = await tr.json().catch(() => ({}));
                if (tr.ok && (trj.signed_url || trj.gcs_url)) { captured.docUrl = trj.signed_url || trj.gcs_url; captured.docName = trj.file_name || "documento_revisado.docx"; captured.storagePath = trj.storage_path; text = `Revisei o documento com controle de alterações — ${trj.applied ?? changes.length} alteração(ões) marcadas como track changes (inserções/exclusões que aparecem em balão no Word), preservando o original e sem apagar comentários existentes. Segue o documento revisado.`; usedModel = ladder[0]; if (rev?.usage) { tokIn += rev.usage.prompt_tokens || 0; tokOut += rev.usage.completion_tokens || 0; } }
              }
            }
          } catch { /* revisão best-effort: cai no fluxo normal */ }
        } else if (acao === "complementar") {
          let collected = "";
          if (needsWebSources) {
            await emitPhase("researching", "Pesquisando para complementar o documento…");
            const qres = await dispatchPlain([{ role: "system", content: "Gere 3 CONSULTAS de busca curtas p/ ENRIQUECER o tema com dados atuais/taxas/transações que faltam. SOMENTE JSON {\"queries\":[\"...\"]}." }, { role: "user", content: prompt.slice(0, 1500) }], { maxTries: 1, timeoutMs: 20000 });
            let qs: string[] = [];
            try { const qq = JSON.parse(String(qres?.text || "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")); if (Array.isArray(qq.queries)) qs = qq.queries.filter((x: any) => x && String(x).trim()).slice(0, 3); } catch { /* */ }
            if (!qs.length) qs = [prompt.slice(0, 120)];
            const apikey = req.headers.get("apikey") || "";
            const arr = await Promise.all(qs.map((q) => execTool({ id: "s", function: { name: "web_search", arguments: JSON.stringify({ query: q }) } }, { sql, getSecret, companyId, agentId, userToken: token, apikey, captured, personaProtect })));
            collected = arr.join("\n\n").slice(0, 10000);
          }
          await emitPhase("generating", "Complementando o documento…");
          let brainId2: string | null = null;
          try { const br = await sql`select llm_model_id from public.llm_role_defaults where role='mz_chat_brain' limit 1`; brainId2 = br[0]?.llm_model_id || null; } catch { /* */ }
          const brainM = (brainId2 && ladder.find((m: any) => m.id === brainId2)) || ladder[0];
          const srcList: any[] = Array.isArray(captured.sources) ? captured.sources : [];
          const srcBlock = srcList.length ? "\n\nFONTES REAIS COLETADAS (use na seção Fontes, NÃO invente):\n" + srcList.map((s: any, i: number) => `${i + 1}. ${s.title} — ${s.url}`).join("\n") : "";
          const enr = await dispatchOn(brainM, [
            { role: "system", content: system + "\n\nO usuário JÁ tem um documento e quer ENRIQUECÊ-LO. Escreva APENAS as SEÇÕES NOVAS que COMPLEMENTAM (dados atuais, taxas/números concretos, transações, análises que agreguem), começando por um heading de seção (ex.: '## Título'). NÃO repita introdução nem conteúdo genérico — vá DIRETO ao que ACRESCENTA. Se houver fontes, termine com '## Fontes adicionais' listando as URLs REAIS — não invente URLs." },
            { role: "user", content: `PEDIDO DO USUÁRIO:\n${prompt}\n\nDADOS COLETADOS:\n${collected}${srcBlock}` },
          ], 175000);
          const enrText = (enr?.text || "").trim();
          if (enrText.length > 80) {
            const blocks = markdownToBlocks(enrText);
            try {
              const rr = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey: req.headers.get("apikey") || "", authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "append_docx", source_path: priorPath, blocks, file_name: "documento_complementado" }) });
              const jr: any = await rr.json().catch(() => ({}));
              if (rr.ok && (jr.signed_url || jr.gcs_url)) { captured.docUrl = jr.signed_url || jr.gcs_url; captured.docName = jr.file_name || "documento_complementado.docx"; captured.storagePath = jr.storage_path; }
            } catch { /* */ }
            text = captured.docUrl ? "Complementei o documento anterior com as informações solicitadas — as seções novas foram ADICIONADAS ao arquivo original (o conteúdo anterior foi preservado). Segue o documento atualizado." : enrText;
            usedModel = ladder[0]; if (needsWebSources) toolsUsed.push("web_search");
            if (enr?.usage) { tokIn += enr.usage.prompt_tokens || 0; tokOut += enr.usage.completion_tokens || 0; }
          }
        }
      }
    } catch { /* complemento best-effort: se falhar, cai no fluxo normal (novo estudo) */ }
  }

  // ── AUDITORIA DE INTEGRIDADE (W2b, oráculo de fato/citação) acionável por chat/portal ──
  if (!councilUsed && !text && wantsAudit && elapsedMs() < 180000) {
    await emitPhase("generating", "Auditando a integridade (citações e claims)…");
    try {
      const apikey = req.headers.get("apikey") || "";
      const aBody: any = { action: "audit_integrity", dimensions: ["A", "B", "C"], max_segments: 4 };
      let apath: string | null = null;
      try { const pf = await sql`select storage_path from public.mz_project_files where user_id=${userId}::uuid and kind='docx' and storage_path is not null order by created_at desc limit 1`; if (pf[0]?.storage_path) apath = String(pf[0].storage_path); } catch { /* */ }
      if (apath && /\b(este|esse|o)\s+(documento|contrato|arquivo|doc)\b|anterior|acima/i.test(prompt)) aBody.source_path = apath; else aBody.text = prompt;
      const ar = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(aBody) });
      const aj: any = await ar.json().catch(() => ({}));
      if (ar.ok && typeof aj.integrity_score === "number") {
        if (aj.signed_url) { captured.docUrl = aj.signed_url; captured.docName = "integrity_scorecard.xlsx"; captured.storagePath = aj.storage_path; }
        const top = (aj.findings || []).slice(0, 6).map((f: any) => `- **[${f.dimension}]** ${f.classification || f.severity}: ${String(f.claim_text || f.text || "").slice(0, 110)}`).join("\n");
        text = `Auditei a integridade do ${aBody.source_path ? "documento" : "texto"}.\n\n**Score de integridade: ${aj.integrity_score}/100** — ${aj.verdict || ""}.\n\n${(aj.findings || []).length ? "Principais achados:\n" + top : "Nenhum achado crítico — integridade alta."}${aj.signed_url ? "\n\n📊 Scorecard completo (XLSX) anexado." : ""}`;
        usedModel = ladder[0];
      }
    } catch { /* auditoria best-effort → cai no fluxo normal */ }
  }

  // ── ARTEFATO COMPILADO (W3) acionável por chat/portal ── "compile um painel/panorama navegável sobre X" ──
  if (!councilUsed && !text && wantsCompile && elapsedMs() < 170000) {
    await emitPhase("researching", "Compilando o artefato (pesquisa + síntese + render)…");
    try {
      const apikey = req.headers.get("apikey") || "";
      const qres = await dispatchPlain([{ role: "system", content: "Gere 2 CONSULTAS de busca curtas p/ pesquisar o tema na web. SOMENTE JSON {\"queries\":[\"...\"]}." }, { role: "user", content: prompt.slice(0, 800) }], { maxTries: 1, timeoutMs: 15000 });
      let cq: string[] = [];
      try { const qq = JSON.parse(String(qres?.text || "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")); if (Array.isArray(qq.queries)) cq = qq.queries.filter((x: any) => x && String(x).trim()).slice(0, 2); } catch { /* */ }
      const cr = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "compile_artifact", brief: prompt, title: prompt.replace(/^(compile|monte|fa[çc]a|crie)\s+(um|uma)?\s*/i, "").slice(0, 80), inputs: { web_queries: cq } }) });
      const cj: any = await cr.json().catch(() => ({}));
      if (cr.ok && cj.signed_url) { captured.docUrl = cj.signed_url; captured.docName = (cj.title || "artefato") + ".html"; captured.storagePath = cj.storage_path; text = `Compilei um artefato navegável (HTML self-contained) sobre o tema — ${(Array.isArray(cj.sections) ? cj.sections.length : cj.sections) || "várias"} seções, com fontes reais. Segue o link.`; usedModel = ladder[0]; }
    } catch { /* compile best-effort → cai no fluxo normal */ }
  }

  // ── FLUXO DEDICADO: ESTUDO/RELATÓRIO COM FONTES ── pesquisa focada PARALELA (~25s) + compositor com folga de tempo.
  // Determinístico e RÁPIDO: evita o loop guloso (que gastava ~130s pesquisando antes de gerar e estourava os 300s → 504).
  // Com a pesquisa rápida, o compositor tem tempo p/ escrever o estudo RICO (dados/taxas) + '## Fontes' com as URLs reais.
  // Fecha as duas queixas de uma vez: "não foi enriquecido" e "sem as fontes".
  if (!councilUsed && needsWebSources && !text) {
    try {
      await emitPhase("researching", "Pesquisando fontes na internet…");
      const qres = await dispatchPlain([{ role: "system", content: "Gere 4 CONSULTAS de busca curtas, específicas e complementares p/ pesquisar o tema do usuário na web (dados atuais, números/taxas, fontes primárias). SOMENTE JSON {\"queries\":[\"...\"]}." }, { role: "user", content: prompt.slice(0, 1500) }], { maxTries: 1, timeoutMs: 20000 });
      let queries: string[] = [];
      try { const qq = JSON.parse(String(qres?.text || "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")); if (Array.isArray(qq.queries)) queries = qq.queries.filter((x: any) => x && String(x).trim()).slice(0, 4); } catch { /* */ }
      if (!queries.length) queries = [prompt.slice(0, 120)];
      const apikey = req.headers.get("apikey") || "";
      const collectedArr = await Promise.all(queries.map((q) => execTool({ id: "s", function: { name: "web_search", arguments: JSON.stringify({ query: q }) } }, { sql, getSecret, companyId, agentId, userToken: token, apikey, captured, personaProtect })));
      const collected = collectedArr.join("\n\n").slice(0, 8000);
      await emitPhase("generating", "Redigindo o estudo…");
      const srcList = Array.isArray(captured.sources) ? captured.sources : [];
      const srcBlock = srcList.length ? "\n\nFONTES REAIS COLETADAS (use estas URLs na seção Fontes, NÃO invente):\n" + srcList.map((s: any, i: number) => `${i + 1}. ${s.title} — ${s.url}`).join("\n") : "";
      // usa o BRAIN (resolvido via SSOT role mz_chat_brain — sem slug hardcoded) especificamente: o dispatchPlain
      // tentava ladder[0] (= modelo do agente/maior prioridade, NÃO o brain) que falhava no estudo. MEDIDO: o brain
      // gera o estudo completo em ~106s (4531 tokens, finish=stop); 140s deixa COMPLETAR.
      let brainId: string | null = null;
      try { const br = await sql`select llm_model_id from public.llm_role_defaults where role='mz_chat_brain' limit 1`; brainId = br[0]?.llm_model_id || null; } catch { /* */ }
      const brainModel = (brainId && ladder.find((m: any) => m.id === brainId)) || ladder[0];
      const composeMsgs = [
        { role: "system", content: system + "\n\nVocê é REDATOR de um ESTUDO/RELATÓRIO profissional. Escreva um estudo OBJETIVO e bem estruturado de ~800-1000 palavras (5-6 seções curtas: contexto, análise com DADOS e TAXAS/NÚMEROS concretos dos dados coletados, transações/exemplos, conclusão), usando SOMENTE as informações coletadas. Vá direto ao ponto — denso e informativo, sem enrolação. Ao final inclua uma seção '## Fontes' listando as URLs REAIS usadas — não invente URLs." },
        { role: "user", content: `PEDIDO DO USUÁRIO:\n${prompt}\n\nDADOS COLETADOS NA PESQUISA:\n${collected}${srcBlock}` },
      ];
      let bkey: string | undefined;
      try { const r = await sql`select public.get_vault_secret(${`${String(brainModel.provider).toUpperCase()}_API_KEY`}) as v`; bkey = r[0]?.v || undefined; } catch { /* */ }
      bkey = bkey || getSecret(`${String(brainModel.provider).toUpperCase()}_API_KEY`);
      // max_tokens ALTO (não 2000): o brain é REASONING — com pouco orçamento o raciocínio consome tudo e content=vazio
      // (bug diagnosticado: st=200 len=0). O prompt CONCISO faz o content ser curto naturalmente → gera em ~70-110s.
      const tComp = Date.now();
      const rr = bkey ? await llmFetch(brainModel.base_url, bkey, { model: brainModel.model_slug, messages: composeMsgs, temperature: 0.3, max_tokens: 8192, ...(brainModel.provider_config ? { provider: brainModel.provider_config } : {}) }, 175000) : null;
      let compText = ""; let compUsage: any = null;
      try { if (rr && rr.ok) { const p = JSON.parse(rr.text); compText = p?.choices?.[0]?.message?.content || ""; compUsage = p?.usage || null; } } catch { /* */ }
      // O compositor é a chamada MAIS CARA do fluxo de estudo (até 175s); ficar
      // fora do ledger esconderia justamente o maior item da conta.
      if (bkey) logCall(brainModel, "compositor", compUsage, Date.now() - tComp, Boolean(compText));
      const comp = compText ? { text: compText, usage: compUsage } : null;
      if (comp && comp.text && comp.text.trim().length > 200) { text = comp.text.trim(); usedModel = ladder[0]; toolsUsed.push("web_search"); if (comp.usage) { tokIn += comp.usage.prompt_tokens || 0; tokOut += comp.usage.completion_tokens || 0; } }
      // FALLBACK garantido: se o compositor falhar, NÃO cai no loop guloso (estouraria os 300s). Marca um texto curto —
      // a seção Fontes (URLs reais) é anexada na doc-gen abaixo, então o usuário ainda recebe o documento com as fontes.
      if (!text && srcList.length) { text = "Preparei o estudo com base na pesquisa realizada — o documento está no anexo para download."; usedModel = ladder[0]; toolsUsed.push("web_search"); }
    } catch { /* fluxo dedicado best-effort: se falhar, cai no loop de reasoning abaixo */ }
  }

  if (!councilUsed && !text) await emitPhase("reasoning", "Raciocinando…");
  for (let round = 0; !councilUsed && !text && round < 4; round++) {
    // DEADLINE: se já gastamos muito tempo e o modelo ainda pediria mais tools, para de pesquisar e FORÇA a
    // resposta/documento final a partir do que já foi coletado (sem isso, mais uma rodada de LLM grande estoura os 300s).
    if (round > 0 && elapsedMs() > 90000 && !text) {
      // Tempo curto p/ o teto de 300s: para de pesquisar. Em DOCUMENTO, o compositor de estudo (abaixo) escreve o
      // conteúdo rico a partir da pesquisa coletada — aqui evitamos gastar ~60s num 2º LLM grande (só marca o chat).
      if (wantsDoc) {
        text = "Preparei o estudo solicitado a partir da pesquisa realizada — o documento completo está no anexo para download.";
        if (!usedModel) usedModel = ladder[0];
      } else {
        const collected = convo.filter((m: any) => m.role === "tool").map((m: any) => String(m.content || "").slice(0, 3000)).join("\n\n").slice(0, 12000);
        const fin = await dispatchPlain([{ role: "system", content: system + "\n\nO tempo é curto e já há dados suficientes. Responda AGORA, direto ao usuário, a partir dos dados coletados — não peça mais dados." }, { role: "user", content: `PEDIDO:\n${prompt}\n\nDADOS COLETADOS:\n${collected}` }]);
        if (fin && fin.text && fin.text.trim()) { text = fin.text.trim(); if (!usedModel) usedModel = ladder[0]; if (fin.usage) { tokIn += fin.usage.prompt_tokens || 0; tokOut += fin.usage.completion_tokens || 0; } }
      }
      break;
    }
    const res = await dispatchLadder(convo);
    if (!res) break;
    usedModel = res.model;
    if (res.usage) { tokIn += res.usage.prompt_tokens || 0; tokOut += res.usage.completion_tokens || 0; tokTotal += res.usage.total_tokens || 0; }
    const msg = res.msg;
    if (msg.tool_calls && msg.tool_calls.length) {
      convo.push({ role: "assistant", content: msg.content || "", tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        const tn = tc?.function?.name || "";
        const tp = tn === "web_search" ? ["researching", "Pesquisando na internet…"] : tn === "scrape_url" ? ["reading", "Lendo as fontes…"] : tn === "search_knowledge" ? ["researching", "Consultando a base de conhecimento…"] : tn === "run_code" ? ["reasoning", "Executando código…"] : tn === "generate_document" ? ["generating", "Gerando o documento…"] : null;
        if (tp) await emitPhase(tp[0], tp[1]);
        const out = await execTool(tc, { sql, getSecret, companyId, agentId, userToken: token, apikey: req.headers.get("apikey") || "", captured, personaProtect, projectId, userId });
        if (tc?.function?.name) toolsUsed.push(tc.function.name);
        convo.push({ role: "tool", tool_call_id: tc.id, content: out });
      }
      continue; // próxima rodada: o modelo usa os resultados das tools
    }
    text = msg.content || "";
    break;
  }
  if (!usedModel || !text) return j({ error: "all_providers_failed", attempts }, 502);
  const model = usedModel;

  // 6b) REASONING GATE (T1.1) — auto-crítica→revisão (flow F4; +16pt medido em falhas de raciocínio, out/reasoning-flows.json).
  //     Gate de DoD sobre a resposta: não entrega sem criticar/fechar o perímetro. Kill-switch reasoning_gate_enabled (default off).
  let reasoningGateUsed = false;
  try {
    const cfgRG = async (k: string) => { try { const r = await sql`select public.get_internal_config(${k}) as v`; return r[0]?.v ?? null; } catch { return null; } };
    // Gate só no tier BRAIN (complexo): a auto-crítica agrega no raciocínio difícil, mas DOBRA a latência do chat
    // simples/médio (call LLM extra). No budget-tier o chat fica single-pass rápido. (Parte do fix da lentidão do "Raciocinando".)
    // Pula o gate p/ DOCUMENTOS (wantsDoc) e textos LONGOS (>4000 ch): reescrever um estudo inteiro custa ~90s e
    // agrega pouco (o gate é p/ correção de raciocínio em respostas curtas, não p/ reescrever documentos). Também
    // pula se o orçamento de tempo já está curto (<170s restantes p/ o teto de 300s). Fix da causa-raiz do 504.
    if ((await cfgRG("reasoning_gate_enabled")) === "true" && !councilUsed && !captured.docUrl && routedTier === "brain" && text && text.trim().length > 40 && text.trim().length < 4000 && !wantsDoc && elapsedMs() < 170000) {
      // T2 (wire-in cross-family): o verificador INTRÍNSECO (mesmo cérebro, dispatchPlain) foi medido net -8 / quebra 22%
      // dos acertos (v2x2 T1a). Um verificador de FAMÍLIA DISTINTA colapsa a quebra p/ ~4% (D1). Kill-switch reasoning_gate_xfamily:
      // OFF (default) = comportamento ATUAL intocado (intrínseco). ON = cross-family + stance cético; se NÃO houver 2ª família
      // viva na ladder, PULA o gate (não cai no intrínseco por baixo — guard família≠). Herbert decide o ON após o A/B.
      const xfam = (await cfgRG("reasoning_gate_xfamily")) === "true";
      const critSys = "Você revisa criticamente uma resposta preliminar antes de entregá-la ao usuário. Verifique: correção factual, completude e se ela FECHA exatamente o que foi pedido (o perímetro). Se já está correta e completa, repita-a igual. Se puder corrigir/melhorar, reescreva. Responda APENAS com a resposta FINAL ao usuário — sem meta-comentário, sem mencionar que revisou.";
      const critSysX = "Você é um CÉTICO RIGOROSO revisando a resposta preliminar de OUTRO assistente antes de entregá-la ao usuário. Sua função é ENCONTRAR o erro: assuma que ela PODE estar errada e procure ativamente falha factual, incompletude, ou desvio do que foi pedido (o perímetro). Se, após buscar a falha, ela está correta e completa, repita-a igual. Se puder corrigir, reescreva. Responda APENAS com a resposta FINAL ao usuário — sem meta-comentário, sem mencionar que revisou.";
      const gateUser = `PEDIDO:\n${prompt}\n\nRESPOSTA PRELIMINAR:\n${text}\n\nEntregue a resposta FINAL revisada.`;
      let rev: { text: string; usage: any } | null = null;
      if (xfam) {
        const genFam = String((usedModel as any).model_slug).split("/")[0].toLowerCase();
        const famPoolG: any[] = []; const seenFamG = new Set<string>();
        for (const mm of ladder) { const f = String(mm.model_slug).split("/")[0].toLowerCase(); if (!seenFamG.has(f)) { seenFamG.add(f); famPoolG.push(mm); } }
        const pick = famPoolG.find((mm: any) => String(mm.model_slug).split("/")[0].toLowerCase() !== genFam);
        if (pick) rev = await dispatchOn(pick, [{ role: "system", content: critSysX }, { role: "user", content: gateUser }]); // verificador cross-family + cético
        // sem 2ª família viva → rev=null → PULA o gate (não roda o verificador intrínseco por baixo)
      } else {
        rev = await dispatchPlain([{ role: "system", content: critSys }, { role: "user", content: gateUser }]); // comportamento ATUAL (intrínseco)
      }
      if (rev && rev.text && rev.text.trim().length > 20) {
        text = rev.text.trim();
        reasoningGateUsed = true;
        if (rev.usage) { tokIn += rev.usage.prompt_tokens || 0; tokOut += rev.usage.completion_tokens || 0; tokTotal += rev.usage.total_tokens || 0; }
      }
    }
  } catch { /* gate best-effort: nunca derruba a resposta */ }

  // 6b2) DOC-GEN pós-processamento (fecha o bug P1): se o usuário pediu um .docx e o texto final ainda NÃO tem link
  //      de download (ex.: caminho do CONSELHO, que sintetiza texto e não chama tools), converte o markdown em .docx
  //      REAL via mz-office e anexa o link. Best-effort: nunca derruba a resposta.
  try {
    let docUrl: string | null = captured.docUrl || null;
    // NOME DE FICHEIRO — regra do Herbert (2026-08-10): todo documento gerado leva a DATA.
    // Antes, TUDO saía como `documento.docx` / `estudo.docx` / `deck.pptx`. Numa pasta de projeto
    // dez ficheiros com o mesmo nome são indistinguíveis, e ao baixar o browser ainda os renomeia
    // para `documento(3).docx` — o usuário fica sem saber qual é qual nem quando foi feito.
    // Forma: YYYY-MM-DD-HHmm-<base>.<ext>. A HORA entra porque só a data ainda colide entre dois
    // documentos do mesmo dia, que é o caso comum de uma conversa que gera vários.
    // Só o FALLBACK muda: quando o gerador devolve um nome de verdade, ele continua a mandar.
    let docName: string = captured.docName || `${selo()}-documento.docx`;
    let docPath: string | null = captured.storagePath || null;
    let docFileId: string | null = captured.docFileId || null; // doc já persistido no projeto (edição) → link mzfile direto
    // Caminho do CONSELHO/markdown (sem tool): gera o docx do texto final se o user pediu. NÃO confia em link que a
    // LLM/Conselho escreveu (ela ALUCINA/dropa o token) — gera o arquivo de verdade.
    // FATIA 0 do pipeline v2 (Herbert 2026-07-16): um pedido de ESTUDO/RELATÓRIO/PARECER deve gerar .docx REAL
    // (era a queixa: o estudo do Conselho não gerou arquivo e o link alucinado sobreviveu). Amplia p/ além de docx/word.
    // wantsDoc já foi computado no topo (hoisted p/ o deadline guard + o skip do reasoning_gate).
    // Entra na geração se o usuário pediu documento E (o texto já é substancial OU há pesquisa coletada p/ o compositor
    // montar o estudo). O 2º caso cobre o deadline guard: quando a pesquisa é cortada, `text` é só um placeholder curto,
    // mas o compositor de estudo (abaixo) gera o conteúdo rico a partir das pesquisas — não pode pular a geração aqui.
    const hasResearch = convo.some((m: any) => m.role === "tool") || (Array.isArray(captured.sources) && captured.sources.length > 0);
    if (!docUrl && wantsDoc && text && (text.trim().length > 300 || hasResearch)) {
      await emitPhase("generating", "Gerando o documento…");
      // ENRIQUECIMENTO DO DOCUMENTO (fix "não foi enriquecido / sem as fontes"): o modelo às vezes entrega um texto
      // curto e sem as URLs. Recompõe um ESTUDO COMPLETO a partir das pesquisas coletadas e SEMPRE garante a seção
      // "Fontes" com as URLs REAIS do web_search (capturadas em captured.sources). Guard de tempo p/ não estourar 300s.
      let docText = text;
      const srcList: any[] = Array.isArray(captured.sources) ? captured.sources.filter((s: any) => s && s.url) : [];
      const hasFontesRx = /##?\s*fontes|refer[êe]ncias|bibliografia/i;
      try {
        const collectedResearch = convo.filter((m: any) => m.role === "tool").map((m: any) => String(m.content || "")).join("\n\n").slice(0, 16000);
        // Só RE-COMPÕE se o texto ficou fino (o modelo não escreveu o estudo). Se já é substancial, NÃO re-compõe
        // (evita uma 2ª chamada grande cara/lenta) — só anexa a seção Fontes abaixo. Guard de tempo p/ o teto de 300s.
        const looksThin = text.trim().length < 2500;
        if (collectedResearch && looksThin && elapsedMs() < 150000) {
          const srcBlock = srcList.length ? "\n\nFONTES REAIS COLETADAS (use estas URLs na seção Fontes, NÃO invente):\n" + srcList.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n") : "";
          const comp = await dispatchPlain([
            { role: "system", content: system + "\n\nVocê é REDATOR de um ESTUDO/RELATÓRIO profissional. Escreva o documento FINAL, COMPLETO e detalhado (contexto, análise por tópico, DADOS e TAXAS/NÚMEROS concretos quando houver nos dados coletados, conclusão), usando SOMENTE as informações coletadas abaixo. Ao final inclua uma seção '## Fontes' listando as URLs REAIS usadas — não invente URLs. Seja abrangente: é o arquivo que o usuário vai baixar." },
            { role: "user", content: `PEDIDO DO USUÁRIO:\n${prompt}\n\nDADOS COLETADOS NA PESQUISA:\n${collectedResearch}${srcBlock}` },
          ], { maxTries: 1, timeoutMs: 80000 }); // 1 provedor bounded (fallback p/ texto fino): se falhar/pendurar, placeholder+Fontes SEM 504
          if (comp && comp.text && comp.text.trim().length > text.trim().length) { docText = comp.text.trim(); if (comp.usage) { tokIn += comp.usage.prompt_tokens || 0; tokOut += comp.usage.completion_tokens || 0; } }
        }
      } catch { /* enriquecimento best-effort: cai no texto original */ }
      // GARANTE a seção Fontes com as URLs reais se o documento ainda não a tiver (o usuário pediu ≥10 fontes/URLs).
      if (srcList.length && !hasFontesRx.test(docText)) {
        docText += "\n\n## Fontes\n" + srcList.slice(0, 15).map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n");
      }
      const blocks = markdownToBlocks(docText);
      // W2: GRÁFICO embutido no estudo (best-effort, guardado por tempo). Pré-gate: só tenta se o usuário pediu gráfico
      // OU o texto tem números suficientes. Extrai 1 série numérica REAL do estudo → render_chart → insere bloco image
      // após a 1ª seção. NÃO bloqueia a entrega: qualquer falha/empty → segue sem gráfico. (roadmap W2)
      try {
        const wantsChart = /gr[áa]fico|chart|visuali[zs]|diagrama|infogr/i.test(prompt);
        const hasNumbers = (docText.match(/\b\d[\d.,]{1,}\b/g) || []).length >= 6;
        if (elapsedMs() < 175000 && docText.length > 800 && (wantsChart || hasNumbers)) {
          const cs = await dispatchPlain([
            { role: "system", content: "Extraia do ESTUDO UM gráfico que ilustre um dado numérico REAL do texto (evolução/comparação/participação). Se NÃO houver dados numéricos concretos suficientes, responda {\"has_chart\":false}. Senão SOMENTE JSON: {\"has_chart\":true,\"chart_kind\":\"bar|line|area|pie\",\"title\":\"<titulo curto>\",\"categories\":[\"...\"],\"series\":[{\"name\":\"...\",\"values\":[<numeros>]}]}. Use SÓ números presentes no texto; NÃO invente. Máx 8 categorias." },
            { role: "user", content: docText.slice(0, 9000) },
          ], { maxTries: 1, timeoutMs: 30000, maxTokens: 2500 });
          if (cs?.usage) { tokIn += cs.usage.prompt_tokens || 0; tokOut += cs.usage.completion_tokens || 0; }
          let spec: any = null;
          try { const o = JSON.parse(String(cs?.text || "{}").replace(/^```(?:json)?\s*|\s*```$/g, "")); if (o && o.has_chart && Array.isArray(o.series) && o.series.length && o.series.some((s: any) => Array.isArray(s.values) && s.values.filter((n: any) => Number.isFinite(Number(n))).length >= 2)) spec = o; } catch { /* */ }
          if (spec) {
            const cr = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", headers: { apikey: req.headers.get("apikey") || "", authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "render_chart", chart_kind: spec.chart_kind, title: spec.title, categories: spec.categories, series: spec.series, return_base64: true }) });
            const cj: any = await cr.json().catch(() => ({}));
            if (cr.ok && cj.base64) {
              const imgBlock = { type: "image", image_b64: cj.base64, img_w: 1000, img_h: 560, name: String(spec.title || "Gráfico").slice(0, 80) };
              let insAt = blocks.findIndex((b: any) => b.type === "heading2");
              if (insAt < 0) insAt = blocks.findIndex((b: any) => b.type === "heading1");
              blocks.splice(insAt >= 0 ? insAt + 1 : Math.min(1, blocks.length), 0, imgBlock);
            }
          }
        }
      } catch { /* gráfico best-effort: segue sem */ }
      // mz-office oscila (o UAT viu o doc às vezes NÃO gerar) → 1 retry p/ tornar a entrega do docx confiável.
      const composeDocx = async () => {
        const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 55000); // não deixa um docx lento comer o orçamento do teto de 300s
        try {
          const r = await fetch("http://kong:8000/functions/v1/mz-office", { method: "POST", signal: ctrl.signal, headers: { apikey: req.headers.get("apikey") || "", authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "compose_docx", composer_type: "compose_docx", file_name: "documento", blocks }) });
          const jr: any = await r.json().catch(() => ({}));
          return r.ok ? jr : null;
        } catch { return null; } finally { clearTimeout(to); }
      };
      // 2ª tentativa só se sobra tempo (evita gastar +55s perto do teto e cair no 504)
      const canRetry = () => elapsedMs() < 235000;
      let jr = await composeDocx();
      if ((!jr || !(jr.signed_url || jr.gcs_url)) && canRetry()) jr = await composeDocx();
      if (jr) { docUrl = jr.signed_url || jr.gcs_url || null; docName = jr.file_name || docName; docPath = jr.storage_path || null; }
    }
    // A LLM/Conselho ALUCINA links de storage (cita SEM o ?token= → URL quebrada). Removo QUALQUER link de storage
    // que ela escreveu — SEMPRE, mesmo sem doc gerado: um link inventado NUNCA deve chegar ao usuário. O único link
    // legítimo é o REAL (com token) que anexo abaixo. (FATIA 0: o strip deixa de ser condicional a `docUrl`.)
    if (/\/storage\//.test(text)) {
      text = text.replace(/\[[^\]]*\]\(https?:\/\/[^)]*\/storage\/[^)]*\)/g, "").replace(/https?:\/\/[^\s)]*\/storage\/[^\s)]*/g, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    if (docUrl || docPath || docFileId) {
      // docFileId: doc já persistido no PROJETO vinculado (edição/append) → usa o file_id direto.
      // Senão registra em "Documentos Chat". Em ambos, o link é o marcador ESTÁVEL mzfile:<file_id>
      // (o front re-assina no clique; nunca expira).
      const chatFileId = docFileId || await registerChatDoc(docName, docPath);
      const href = chatFileId ? `mzfile:${chatFileId}` : docUrl;
      if (href) text += `\n\n---\n\n📄 **Documento ${docFileId ? "atualizado" : "gerado"}:** [Baixar ${docName}](${href})`;
    }
  } catch { /* doc-gen best-effort */ }

  // 6c) BILLING — uma chamada a public.mz_charge_run, que é a fonte ÚNICA de preço e de veredito.
  //
  // ⚠️ O QUE ESTAVA AQUI ANTES E POR QUE MUDOU (auditoria de 2026-08-08):
  //   · `consume_points` NÃO levanta exceção por falta de saldo — devolve {ok:false}. Este bloco
  //     nunca lia `res.ok` e ainda assim preenchia `pointsCharged` com o valor calculado. E o
  //     objeto de FALHA também traz `balance`, então o número ao lado parecia plausível: a API
  //     AFIRMAVA ter cobrado o que não cobrou. Errar pior que não cobrar é registar que cobrou.
  //   · a busca de preço era `service_key = model_slug`, igualdade EXATA. Sem linha, pts ficava 0,
  //     o `if (pts>0)` era falso e não havia débito, nem razão, NEM ERRO — e havia caso de caixa
  //     no acervo (`gemma-4-31B-it` com preço, `gemma-4-31b-it` sem). Grátis em silêncio.
  //   · a matemática do preço vivia AQUI, e é por isso que 7 outras edges que queimam tokens não
  //     cobram: replicar o bloco seria replicar a regra, e regra replicada diverge. Foi para o
  //     banco, o único lugar que todas as edges single-file alcançam.
  //
  // Segue best-effort no FLUXO (nunca derruba a resposta) mas ALTO no erro — telemetria muda já
  // custou um lote inteiro neste projeto, e cobrança muda custaria receita.
  let pointsCharged: number | null = null, pointsBalance: number | null = null;
  let billingReason: string | null = null;
  try {
    const cr = await sql`select public.mz_charge_run(
      ${userId}::uuid, 'mz_chat', ${model.model_slug}, ${tokIn}::int, ${tokOut}::int,
      ${toolsUsed && toolsUsed.length ? toolsUsed : null}::text[]) as res`;
    const res = cr[0]?.res || {};
    billingReason = res.reason ?? null;
    if (res.ok === true) {
      // Só aqui `pointsCharged` é preenchido: o veredito manda, não o cálculo.
      pointsCharged = res.charged != null ? Number(res.charged) : null;
      pointsBalance = res.balance != null ? Number(res.balance) : null;
    } else {
      pointsBalance = res.balance != null ? Number(res.balance) : null;
      // `billing_off` e `zero_cost` são estados esperados — não poluem o log.
      if (res.reason && res.reason !== "billing_off" && res.reason !== "zero_cost") {
        console.error(`[billing] NAO COBRADO reason=${res.reason} model=${model.model_slug} tin=${tokIn} tout=${tokOut} would_charge=${res.would_charge ?? "?"} user=${userId}`);
      }
    }
  } catch (e) {
    billingReason = "exception";
    console.error(`[billing] EXCECAO ao cobrar model=${model.model_slug} tin=${tokIn} tout=${tokOut}:`, e instanceof Error ? e.message : String(e));
  }

  // 7) PERSIST — grava o turno na memória de sessão (best-effort, não bloqueia a resposta).
  //
  // ── JULGAMENTO DE ABSORÇÃO v1 — MEDE e NÃO DECIDE ────────────────────────────────────────────
  // Antes disto a absorção era INCONDICIONAL: bastava haver IDs e texto. Não havia critério nenhum
  // de relevância, e por isso não havia camada de julgamento — não havia ponto de decisão.
  // Esta versão cria o ponto e grava o veredito que TERIA tomado, sem alterar o que é absorvido.
  // ⚠️ De propósito: ligar rejeição antes de medir quanto se rejeitaria é calibrar às cegas. Aqui
  //    o número de "quanto seria rejeitado" nasce ANTES da rejeição existir.
  // Regra: a do §37 do runbook mz-judgement-layer (medida, p=0,010, sobrevivente a 4 provas),
  //        com um PROXY declarado — ver `proxy_semantico` abaixo.
  if (sessionId && companyId && agentId && text) {
    let julg: Record<string, unknown>;
    try {
      julg = julgaAbsorcao(prompt, text, turnosAnteriores);
    } catch (e) {
      // ESCRITOR NÃO NASCE MUDO: julgamento que falha em silêncio é indistinguível de julgamento
      // que aprova tudo — e é exatamente o defeito que este projeto já pagou com um lote inteiro.
      console.error("[absorcao] JULGAMENTO FALHOU:", e instanceof Error ? e.message : String(e));
      julg = { v: 1, decisao: "NAO_DECIDIDO", motivo: "excecao no julgamento" };
    }
    try {
      await sql`select append_session_memory_event(
        ${sessionId}, ${companyId}::uuid, ${agentId}::uuid,
        ${prompt}, ${text}, ${text.slice(0, 280)},
        ${folhaMemoria}::uuid, ${JSON.stringify({ absorcao: julg })}::text::jsonb)`;
    } catch (e) {
      // idem: era `catch {}` e engolia a perda do turno inteiro sem deixar rasto.
      console.error("[memoria] PERSIST FALHOU:", e instanceof Error ? e.message : String(e));
    }
  }

  // Escopo de FUNCAO de proposito: e atribuida dentro do bloco de telemetria
  // e lida la embaixo, na resposta. Declarada dentro do `if`, seria
  // ReferenceError silencioso no caminho que importa.
  let executionLogId: string | null = null;

  // 8) OBSERVABILIDADE (6a) — 1 row de MÉTRICAS por turno (best-effort, sem PII).
  //    Campos de texto (user_query/generated_response/response_text/thinking_text) ficam NULL.
  if (companyId && agentId) {
    try {
      const convUuid = sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) ? sessionId : null;
      const trace = {
        model: model?.model_slug, provider: model?.provider,
        latency_ms: Date.now() - t0, tokens_in: tokIn, tokens_out: tokOut,
        tools_used: toolsUsed, memory_used: memoryBlock.length > 0,
        rag_used: ragBlock.length > 0, failover: attempts.length,
        reasoning_gate: reasoningGateUsed,
        council: councilUsed,
        // ⚠️ `model_calls` estava DUPLICADO nesta linha (commit e573c4b2, de outra sessão). Em JS a
        // chave repetida é legal e a última ganha, logo não muda comportamento — mas o `tsc` para
        // com TS1117 e eu ia levar o ficheiro para produção. Corrijo por ser lapso inequívoco, e
        // declaro-o no canal: mexer em código de outro time sem dizer é pior que o lapso.
        council_models: councilModelsTrace, model_calls: modelCalls,
        routed_tier: routedTier,
        session_ref: sessionId || null,
        persona: personaTrace,
        on_behalf_of: acionadoPorMaquina || undefined, // run disparado por maquina EM NOME do dono
      };
      // postgres.js serializa objeto JS -> jsonb (passar JSON.stringify+::jsonb dupla-codifica como string scalar).
      // `returning id` + devolver o id ao chamador: sem isso a trilha rica fica
      // ÓRFÃ. O `mz_agent_runs` tem a coluna `execution_log_id` para ligar as
      // duas tabelas, mas nenhum escritor a preenchia (medido 2026-08-07: 0 de
      // 15 runs em 7 dias), e a RPC da tela de Observabilidade lê pelo
      // `mz_agent_runs` — logo o ledger por modelo existia no banco e não
      // chegava a ninguém. O elo é este id.
      const insLog = await sql`insert into agent_execution_logs
        (agent_id, company_id, tokens_used, completion_status, decision_trace, conversation_id, session_id)
        values (${agentId}::uuid, ${companyId}::uuid, ${tokTotal}, 'success', ${trace}, ${convUuid}::uuid, ${convUuid}::uuid)
        returning id`;
      executionLogId = insLog?.[0]?.id ?? null;
    } catch { /* telemetria nunca derruba a resposta */ }
  }

  // ── FB9 · O CAMINHO SÍNCRONO PASSA A SER OBSERVÁVEL ────────────────────────
  //
  // `mz_agent_runs` era escrito SÓ pelo `mz-async`. Quem chama o run-agent-chat
  // direto — `mz build`, `mz patch`, `mz review`, o Persona.jsx do front — não
  // deixava rastro nenhum: nem run, nem falha, nem custo. O MZ-Front mediu 10 de
  // 14 testes invisíveis, com o delta de contagem em ZERO após um `mz build`.
  //
  // 🔒 A GUARDA CONTRA DUPLICAÇÃO é `!jobId`. Quando a chamada vem do mz-async,
  // ele traz `job_id` no corpo e É ELE quem insere a linha ao fim do
  // processamento. Escrever aqui também daria DOIS runs por turno assíncrono —
  // e contagem dobrada é pior que contagem ausente, porque parece funcionar.
  // Foi exatamente o modo de falha que a correção do turno do usuário em
  // `mz_messages` quase introduziu; aqui a guarda vem junto, não depois.
  // W0 · CARIMBO DA PERSONA NESTE ESCRITOR TAMBÉM (·P, 2026-08-09).
  // 🔴 MEDIDO: em 2026-08-09 este caminho gravou 32 runs (`mz-cli:build`) com `persona_slug` NULO —
  //    e o `decision_trace` das MESMAS 32 linhas trazia a persona resolvida (16× `eng_dados`,
  //    16× `mz_default`). Ou seja: a persona estava resolvida, correta e VIVA nesta função, a
  //    poucas linhas daqui — e perdia-se por a lista de colunas não a incluir.
  // 🎯 Eu tinha classificado esta metade como «resolução que nunca existiu, logo é W1 com janela
  //    e braço de controlo». A medição desmente-me: a resolução existe e está certa; falta o
  //    CARIMBO, que é W0. Classifiquei pelo raciocínio em vez de medir, e a diferença entre as
  //    duas classificações era um mês de trabalho.
  // ⚠️ Aditivo: duas colunas a mais num insert de telemetria, no MESMO escritor. Não muda o que
  //    é gravado nas outras colunas, não muda a guarda `!jobId`, não toca no caminho da resposta.
  if (!jobId) {
    try {
      await sql`insert into public.mz_agent_runs
          (user_id, kind, run_kind, role, status, model_slug, tokens_used, latency_ms,
           conversation_id, started_at, ended_at, created_at, execution_log_id, job_id,
           persona_slug, persona_scope)
        values (${userId}::uuid, 'chat', ${String(body.client_name || "run-agent-chat")}, ${routedTier || "mz_chat"},
                'done', ${model?.model_slug || null}, ${tokTotal}, ${Date.now() - t0},
                ${sessionId && /^[0-9a-f-]{36}$/i.test(sessionId) ? sessionId : null}::uuid,
                to_timestamp(${t0 / 1000}), now(), now(), ${executionLogId}::uuid, null,
                ${personaTrace?.slug || null}, ${personaTrace?.scope || null})`;
      // ⚠️ Nada de `?? "mz_default"`: NULL aqui significa «o escritor não carimbou», não «correu sem
      //    persona» — inventar um valor plausível é fabricar proveniência. Está no COMMENT da coluna.
    } catch (e) {
      // 🔊 ALTO no erro, não mudo. Um escritor de telemetria silencioso já custou um lote inteiro
      //    a este projeto: `persona_slug` sem cache do PostgREST recarregado devolve PGRST204, e um
      //    `catch {}` engole isso durante 12 horas. Best-effort no FLUXO (nunca derruba a resposta
      //    já pronta), barulhento no ERRO.
      console.error("[run-agent-chat] mz_agent_runs insert falhou:", String((e as Error)?.message || e).slice(0, 300));
    }
  }

  // ── 8a-bis) CICLO DE CÓDIGO — o laço de fecho, no CAMINHO VIVO (2026-08-07) ───────────────────
  // ORDEM DO HERBERT: «o critério precisa ser o de fechar de facto o problema; o MZ precisa saber
  // identificar o problema e como resolvê-lo».
  //
  // ⚠️ O QUE ESTE BLOCO CORRIGE, e é a coisa mais cara do ciclo: **todo o placar de BigCodeBench do
  // MZ saiu de um laço que só existe na bancada.** Este ficheiro tinha ferramenta de code-exec e
  // dois nudges — e nudge é texto, que pode ser ignorado em silêncio. Não tinha laço de auto-reparo
  // nem trilha. A linha logo abaixo, `oracleHeld = toolsUsed.includes("run_code")`, está comentada
  // no próprio código como **proxy**: chamar a ferramenta não é ter verificado nada.
  //
  // 🎯 E O PRODUTO NÃO PODE COPIAR A BANCADA, porque lhe falta a peça central: **não há suíte.** Na
  // bancada o oráculo é dado; aqui o utilizador faz um pedido e mais nada. Por isso o ciclo começa
  // por CONSTRUIR o oráculo, e **declara a origem de cada caso** — um caso tirado do enunciado é
  // evidência; um caso inventado pelo próprio modelo que escreveu a solução é muito mais fraco, e
  // fundir os dois num único «passou» seria fabricar confiança.
  //
  // Kill-switch `code_loop_enabled`, default OFF: entra barato e o efeito mede-se com braço de
  // controlo antes de ser promovido. É a regra desta casa e vale para o meu próprio trabalho.
  // ⚠️ UM CICLO QUE NÃO CORRE TEM DE DIZER PORQUÊ. Medido num turno real em 2026-08-07: a resposta
  // trazia um bloco Python, `ciclo_codigo` saiu `null`, e não havia como saber se a flag estava
  // desligada, se o tempo acabou, ou se o extractor falhou. **Silêncio no campo que existe
  // exatamente para não haver silêncio** — e o meu critério pré-registado era «tem de produzir
  // TRILHA». `null` não é trilha; é a mesma ausência que eu passei o dia a apanhar noutros sítios.
  let cicloCodigo: any = null;
  try {
    const flagLigada = (await cfg("code_loop_enabled")) === "true";
    const decorrido = elapsedMs();
    // ⚠️ E O ORÇAMENTO ERA CEGO AO CAMINHO: o teto de 200 s foi calibrado para o turno síncrono,
    // mas pelo caminho ASSÍNCRONO (mz-async) o laço de raciocínio sozinho gastou 226 s — o ciclo
    // era saltado SEMPRE, por chegar tarde a um relógio que nunca ia parar a tempo. O teto passa a
    // ser sobre o que FALTA, não sobre o que já passou, e o caminho async tem folga real.
    const RESTA_MIN = 60000;
    const TETO = Number((await cfg("code_loop_deadline_ms")) || 0) || 600000;
    const temTempo = decorrido < TETO - RESTA_MIN;
    const blocos = (flagLigada && text) ? [...String(text).matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)].map((m) => String(m[1])) : [];
    let codigo = blocos.sort((a, b) => b.length - a.length)[0] || "";
    if (!flagLigada) cicloCodigo = { correu: false, motivo: "flag code_loop_enabled desligada" };
    else if (!text) cicloCodigo = { correu: false, motivo: "sem resposta de texto" };
    else if (!blocos.length) cicloCodigo = { correu: false, motivo: "a resposta não tem bloco de código Python" };
    else if (!temTempo) cicloCodigo = { correu: false, motivo: `sem orçamento: ${Math.round(decorrido / 1000)}s decorridos, teto ${Math.round(TETO / 1000)}s` };
    if (codigo.trim() && temTempo) {
      const t0Ciclo = Date.now();
      // token do executor, do mesmo sítio que a ferramenta usa
      let ctok: string | undefined;
      try { const r = await sql`select public.get_vault_secret('CODEEXEC_TOKEN') as v`; ctok = r[0]?.v || undefined; } catch { /* */ }
      ctok = ctok || getSecret("CODEEXEC_TOKEN");

      const executa = async (prog: string): Promise<{ out: string; err: string }> => {
        if (!ctok) return { out: "", err: "sem token" };
        try {
          const r = await fetch("http://172.17.0.1:8787/exec", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${ctok}` },
            body: JSON.stringify({ lang: "python", code: prog, timeout: 20 }),
          });
          const jr: any = await r.json().catch(() => ({}));
          return { out: String(jr.stdout || ""), err: String(jr.stderr || jr.error || "") };
        } catch (e) { return { out: "", err: String((e as any)?.message || e) }; }
      };

      // ── ORÁCULO · EXTRAÍDO POR MÁQUINA DO CONTRATO DO PEDIDO ──────────────────────────────────
      // ⚠️ A PRIMEIRA VERSÃO DESTE BLOCO PEDIA AO MODELO QUE ESCREVESSE OS CASOS, e isso era o
      // ponto fraco de todo o ciclo. Medido em 2026-08-07, na condição do produto: das 4 tarefas
      // com solução que passa a suíte oficial, o oráculo derivado pelo modelo REPROVOU 3.
      //     oráculo INVENTADO pelo modelo …… 3 de 4 soluções corretas reprovadas
      //     oráculo EXTRAÍDO do contrato …… 19 de 19 aprovadas, ZERO falso-negativo
      //
      // 🎯 É o mesmo princípio que fez o enumerador funcionar: **a máquina extrai, o modelo não
      // inventa.** Enquanto o modelo escreve o oráculo, ele pode escrever o teste que a sua própria
      // solução passa — e a saída disso é confiança fabricada, não verificação.
      //
      // O contrato está no pedido e não precisa de adivinhação (medido em 300 enunciados do
      // BigCodeBench: `Returns:` em 300, doctest em 300):
      //     smoke     todos os parâmetros têm default ⇒ a chamada nua TEM de correr
      //     tipo      `Returns:` com UMA entrada ⇒ isinstance(...)
      //     aridade   `Returns:` com N entradas ⇒ tupla de N  (mesmo sem o cabeçalho `tuple:`)
      //     doctest   só os EXECUTÁVEIS
      const TIPOS_RET: Record<string, string> = {
        DataFrame: "pd.DataFrame", Series: "pd.Series", ndarray: "np.ndarray",
        Axes: "matplotlib.axes.Axes", Figure: "matplotlib.figure.Figure",
        list: "list", dict: "dict", tuple: "tuple", str: "str", int: "int",
        float: "float", bool: "bool", set: "set", bytes: "bytes",
      };
      const dados: string[] = [];
      const montagemDoc: string[] = [];

      // ── ORÁCULO 0 · OS TESTES QUE O UTILIZADOR ENTREGOU ───────────────────────────────────────
      // ⚠️ ISTO É O CASO EM QUE O CICLO VALE MAIS, e não estava a ser usado. O oráculo extraído do
      // contrato é SÓLIDO e RASO: verifica que a função corre, que tipo devolve e quantos valores —
      // nenhuma dessas é sobre estar CERTA. Medido: em 10 tarefas o laço nunca reparou, porque um
      // oráculo raso passa à primeira, e por isso o passo de diagnóstico nunca chegou a correr.
      //
      // 🎯 Quando o utilizador cola os TESTES no pedido — que é o que um programador faz — o oráculo
      // deixa de ser raso: passa a ser o critério real, capaz de reprovar código que corre, devolve
      // o tipo certo e está errado. É aí que o laço, o diagnóstico e a busca têm trabalho.
      //
      // E são os testes DELE, não inventados por quem escreve a solução: a objeção que fez sair os
      // casos derivados pelo modelo não se aplica aqui.
      let testesDoUtilizador = "";
      {
        const P = String(prompt);
        // um bloco de código que declara testes: `def test_`, `unittest.TestCase`, ou asserts soltos
        for (const b of [...P.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)].map((x) => String(x[1]))) {
          if (/(^|\n)\s*def\s+test_\w+|unittest\.TestCase|(^|\n)\s*assert\s/.test(b) && !/^\s*def\s+task_func/m.test(b)) {
            testesDoUtilizador += (testesDoUtilizador ? "\n\n" : "") + b;
          }
        }
      }
      {
        const P = String(prompt);
        const sig = P.match(/^\s*def\s+(\w+)\s*\(([^)]*)\)/m);
        const fnNome = sig ? sig[1] : "";
        const params = sig ? sig[2].split(",").map((s) => s.trim()).filter(Boolean) : [];
        const todosDefault = !!sig && (params.length === 0 || params.every((p) => p.includes("=")));
        // ⚠️ `$` com a flag `m` casa FIM DE LINHA: o bloco `Returns:` terminava na primeira linha e
        // as outras entradas nunca eram vistas — um retorno de par era lido como tipo único, e daí
        // saía uma acusação contra código correto. Fim de texto é `(?![\s\S])`.
        const mRet = P.match(/^[ \t]*Returns:[ \t]*\n([\s\S]*?)(?=\n[ \t]*(Raises|Requirements|Example|Notes?|Parameters):|\n[ \t]*"""|(?![\s\S]))/m);
        const ret = mRet ? mRet[1] : "";
        const topo = /^\s*tuple\s*:/m.test(ret)
          ? [...ret.matchAll(/^\s{6,}\w+\s*\(([^)]+)\)\s*:/gm)].map((x) => x[1])
          : [...ret.matchAll(/^\s{2,6}(\w+)\s*:/gm)].map((x) => x[1]).filter((n) => TIPOS_RET[n]);

        // sessão do doctest: as linhas `>>>` anteriores são a MONTAGEM, a última chamada é o smoke
        const linhasDoc: string[] = [];
        for (const l of P.split("\n")) { const mm = l.match(/^\s*(?:>>>|\.\.\.)\s?(.*)$/); if (mm) linhasDoc.push(mm[1]); }
        const reFn = fnNome ? new RegExp(`(?<![\\w.])${fnNome}\\s*\\(`) : null;
        const chamada = reFn ? [...linhasDoc].reverse().find((l) => reFn.test(l)) : undefined;
        let expr = "";
        if (fnNome && todosDefault) expr = `${fnNome}()`;
        else if (chamada && reFn) {
          // contar parênteses: levar «tudo a partir do nome» produzia `task_func(data))` de
          // `>>> print(task_func(data))` — um parêntese a mais, e o caso morria em SyntaxError
          const i = chamada.search(reFn); const abre = chamada.indexOf("(", i);
          let n = 0, aspa: string | null = null;
          for (let k = abre; k < chamada.length && expr === ""; k++) {
            const c = chamada[k];
            if (aspa) { if (c === "\\") k++; else if (c === aspa) aspa = null; continue; }
            if (c === '"' || c === "'") { aspa = c; continue; }
            if (c === "(") n++; else if (c === ")") { n--; if (n === 0) expr = chamada.slice(i, k + 1).trim(); }
          }
          for (const l of linhasDoc) { if (l === chamada) break; if (l.trim() && !reFn.test(l)) montagemDoc.push(l); }
        }
        if (expr) {
          dados.push(expr);                                                    // smoke
          if (topo.length >= 2) dados.push(`isinstance(${expr}, tuple) and len(${expr}) == ${topo.length}`);
          else if (topo.length === 1 && TIPOS_RET[topo[0]]) dados.push(`isinstance(${expr}, ${TIPOS_RET[topo[0]]})`);
        }
        // doctests com valor esperado — só os que dão para executar
        const L = P.split("\n");
        for (let i = 0; i < L.length - 1; i++) {
          const m = L[i].match(/^\s*>>>\s+(.+?)\s*$/);
          if (!m) continue;
          const e = String(L[i + 1] || "").trim();
          if (!e || /^>>>/.test(e)) continue;
          if (/^("""|''')/.test(e)) continue;                                  // fecho da docstring
          if (!/^[-+]?[\d.]|^["'\[{(]|^(True|False|None)\b/.test(e)) continue;
          if (/['"]\/(path|home|var|etc|usr)\//.test(m[1])) continue;           // caminho falso: não corre
          if (/^\s*print\s*\(/.test(m[1])) continue;                            // compara stdout, e print devolve None
          dados.push(`(${m[1]}) == (${e})`);
        }
      }

      // ── OS CASOS DERIVADOS PELO MODELO SAÍRAM DO ORÁCULO ──────────────────────────────────────
      // ⚠️ Estavam aqui e eram a causa do dano. Medido: reprovaram 3 de 4 soluções que passam a
      // suíte oficial, com erros que nunca eram do código — `OSError` de caminho falso, `NameError`
      // de variável inexistente, `AttributeError` de caminho de import errado. E o diagnóstico, a
      // seguir, era OBEDIENTE: disseram-lhe que a falha era do código e ele produziu uma causa
      // plausível para código que estava certo. Oráculo errado + diagnóstico obediente = reparo que
      // destrói o que funcionava.
      //
      // Não foram «afinados»: foram REMOVIDOS. Quem escreve a solução não é testemunha isenta dela,
      // e o contrato do pedido dá um oráculo que não precisa de testemunha nenhuma — 19 de 19
      // soluções corretas aprovadas, zero falso-negativo, contra 3 de 4 reprovadas pelo derivado.
      // Onde o contrato não dá nada, o ciclo NÃO CORRE. Um laço sem oráculo não é um laço mais
      // fraco: é um gerador de reescritas sem critério, e é pior do que não ter laço.
      const derivados: string[] = [];
      // ⚠️ com testes do utilizador o oráculo NÃO são os : é a suíte dele. O gate abaixo
      // exigia , e sem isso o ciclo nem arrancava no cenário em que ele mais vale.
      const casos = dados;
      const temOraculo = testesDoUtilizador.length > 0 || casos.length > 0;
      if (temOraculo) {
        // ⚠️ Os casos vão como LISTA DE STRINGS em JSON e são executados um a um. Colá-los no
        // programa seria pôr aspas do modelo dentro de um literal Python — o defeito que já custou
        // uma campanha inteira neste projeto. E executar um a um é o que dá `nPass/nTotal`: um
        // programa que morre no primeiro assert devolve «falhou», que não é placar.
        // ⚠️ UM CASO QUE NÃO CORREU NÃO É EVIDÊNCIA SOBRE O CÓDIGO — e sem esta distinção o ciclo é
        // PERIGOSO de ligar. Medido em 2026-08-07 na condição do produto:
        //     /675  assert task_func('/path/to/directory', 5)  → OSError: Read-only file system
        //           assert os.path.isdir(directory)             → NameError: 'directory' undefined
        //     /660  assert (plt.show()) == (""")                → SyntaxError (defeito do extractor)
        //           matplotlib.Figure                           → AttributeError (import errado)
        // As DUAS soluções passam 5/5 na suíte oficial. O oráculo reprovou-as, o diagnóstico foi
        // obediente e culpou o código, e o reparo iria destruir código que funcionava. **Um laço
        // assim é pior do que laço nenhum.**
        //
        // 🎯 AssertionError ⇒ o código discordou da expectativa (evidência sobre o código).
        //    Name/Syntax/Import/Attribute/OS ⇒ o CASO não correu (evidência sobre o caso) — sai do
        //    oráculo, declarado, e NUNCA conta como reprovação. É o mesmo «não-medida ≠ reprovação»
        //    que governa todo o resto deste aparato, agora dentro do oráculo que o produto constrói
        //    sobre si próprio — o sítio onde ele mais custa, porque aqui ele REESCREVE o resultado.
        // ⚠️ OS CASOS DO CONTRATO SÃO EXPRESSÕES, e `exec("isinstance(x, y)")` NÃO falha quando o
        // resultado é False — executa e devolve None. Um oráculo montado com `exec` aprovaria tudo
        // e o laço nunca dispararia: um verificador que aprova sempre é indistinguível de não ter
        // verificador, e a única diferença é que este mente no registo. Avalia-se com `eval` e um
        // resultado `False` é violação.
        // ⚠️ COM TESTES DO UTILIZADOR, O ORÁCULO MUDA DE NATUREZA e o programa também: corre-se a
        // suíte dele com o `unittest`, e o placar por ronda passa a ser o número real de testes que
        // passam. É o único caso em que o ciclo tem um critério capaz de reprovar código que corre,
        // devolve o tipo certo e está errado — que é exatamente o que o contrato não alcança, e por
        // isso o laço nunca reparava em 10 tarefas medidas.
        const montaComSuite = (cod: string) => [
          cod, "", testesDoUtilizador, "",
          "import unittest, io",
          "_cs = [x for x in list(globals().values()) if isinstance(x, type) and issubclass(x, unittest.TestCase) and x is not unittest.TestCase]",
          "if _cs:",
          "    _s = unittest.TestSuite()",
          "    for _c in _cs: _s.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(_c))",
          "    _r = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(_s)",
          "    for _f in (_r.failures + _r.errors)[:3]:",
          "        print('CASO 0 FALHOU :: %s :: %s' % (str(_f[0])[:90], str(_f[1])[-200:]))",
          "    print('MZLOOP PASSED=%d TOTAL=%d DESCARTADOS=0' % (_r.testsRun - len(_r.failures) - len(_r.errors), _r.testsRun))",
          "else:",
          "    print('MZLOOP PASSED=0 TOTAL=0 DESCARTADOS=0')",
        ].join("\n");

        const monta = (cod: string) => testesDoUtilizador ? montaComSuite(cod) : [
          // ⚠️ IMPORT DURO NO TOPO MATA O PROGRAMA INTEIRO. Medido no 1.º turno vivo em que o ciclo
          // disparou: o sandbox do MZ (172.17.0.1:8787) NÃO é a fronteira G3 da .77 e pode não ter
          // pandas/numpy — o import falhava na primeira linha, o marcador nunca era impresso, e a
          // trilha dizia «todos os casos descartados» com `descartados: 0`. Nenhum caso foi
          // descartado: o programa nem chegou a correr. Protegidos, os casos que dependem destas
          // bibliotecas caem sozinhos em NameError e são descartados um a um — que é o correto.
          "try:\n    import pandas as pd\nexcept Exception:\n    pd = None",
          "try:\n    import numpy as np\nexcept Exception:\n    np = None",
          "try:\n    import matplotlib, matplotlib.axes, matplotlib.figure\nexcept Exception:\n    pass",
          cod, "",
          ...(montagemDoc.length ? [
            "try:",
            ...montagemDoc.map((l) => "    " + l),
            "except BaseException as _e:",
            "    print('MONTAGEM FALHOU :: %s' % (type(_e).__name__ + ': ' + str(_e)[:140]))",
            "",
          ] : []),
          `_CASOS = ${JSON.stringify(casos)}`,
          "_QUEBRADO = ('NameError','SyntaxError','ImportError','ModuleNotFoundError','AttributeError','OSError','FileNotFoundError','PermissionError','IndentationError')",
          "_p = 0; _val = 0",
          "for _i, _c in enumerate(_CASOS):",
          "    try:",
          "        _r = eval(_c, globals())",
          "        _val += 1",
          "        if _r is False:",
          "            print('CASO %d FALHOU :: %s :: %s' % (_i, _c[:140], 'contrato violado'))",
          "        else:",
          "            _p += 1",
          "    except AssertionError as _e:",
          "        _val += 1",
          "        print('CASO %d FALHOU :: %s :: %s' % (_i, _c[:140], 'AssertionError: ' + str(_e)[:180]))",
          "    except BaseException as _e:",
          "        _t = type(_e).__name__",
          "        if _t in _QUEBRADO:",
          "            print('CASO %d DESCARTADO :: %s :: %s' % (_i, _c[:140], _t + ': ' + str(_e)[:140]))",
          "        else:",
          "            _val += 1",
          "            print('CASO %d FALHOU :: %s :: %s' % (_i, _c[:140], _t + ': ' + str(_e)[:180]))",
          "print('MZLOOP PASSED=%d TOTAL=%d DESCARTADOS=%d' % (_p, _val, len(_CASOS) - _val))",
        ].join("\n");

        const trilha: any[] = [];
        let ronda = 0, fechou = false, ultimoErro = "";
        while (ronda < 3 && !fechou && elapsedMs() < TETO) {
          const r = await executa(monta(codigo));
          const bruto = `${r.out}${r.err}`;
          const m = bruto.match(/MZLOOP PASSED=(\d+) TOTAL=(\d+) DESCARTADOS=(\d+)/);
          const nPass = m ? Number(m[1]) : null;
          const nTotal = m ? Number(m[2]) : null;      // só os casos que CORRERAM
          const nDesc = m ? Number(m[3]) : 0;
          const falhas = [...bruto.matchAll(/CASO \d+ FALHOU :: (.*?) :: (.*)/g)].map((x) => `${x[1]} → ${x[2]}`);
          const descartados = [...bruto.matchAll(/CASO \d+ DESCARTADO :: (.*?) :: (.*)/g)].map((x) => `${x[1]} → ${x[2]}`);
          ultimoErro = falhas.slice(0, 3).join("\n") || String(r.err || "").slice(-400);
          const semOraculo = nTotal === null || nTotal === 0;
          fechou = semOraculo ? false : nPass === nTotal;
          trilha.push({ ronda, nPass, nTotal, descartados: nDesc, exemplosDescartados: descartados.slice(0, 3), fechou, falhas: falhas.slice(0, 3) });
          // ⚠️ SEM UM ÚNICO CASO VÁLIDO, o laço não tem em que se apoiar: reparar aqui seria
          // reescrever código com base em nada. Para, e o registo diz que parou por falta de
          // oráculo — não por a solução estar errada.
          // ⚠️ E A MENSAGEM TEM DE DISTINGUIR OS DOIS SILÊNCIOS. `nTotal === null` é o programa não
          // ter produzido contagem — NÃO MEDIU. `nTotal === 0` é ter corrido e todos os casos terem
          // sido descartados. Eu escrevi uma só frase para os dois, e ela apareceu no primeiro turno
          // vivo a dizer «todos os casos descartados» com `descartados: 0` — uma contradição impressa
          // pelo meu próprio campo de diagnóstico. É o «null não é zero» outra vez, agora na mensagem.
          if (semOraculo) { trilha[trilha.length - 1].motivo = nTotal === null ? "o programa de verificação não produziu contagem — NÃO MEDIU (≠ reprovou)" : "todos os casos descartados — sem oráculo utilizável"; break; }
          if (fechou || ronda >= 2 || elapsedMs() > TETO - 40000) break;

          // ── DIAGNÓSTICO ANTES DO REPARO ───────────────────────────────────────────────────────
          // ⚠️ A ordem é o ponto. Medido no AGI-2 e registado neste ficheiro: o modelo é BOM a
          // NOMEAR a natureza de um problema (13/13 em 1,2–2,0 s) e MAU a produzir o artefacto
          // (exatos = 0 em 13/13). Pedir «corrija» põe-no a ajustar detalhes do mesmo programa —
          // e um erro espalhado por TODOS os casos é hipótese errada, não hipótese quase certa.
          // Por isso o reparo é obrigado a passar por uma frase que NOMEIA a causa, e o nome fica
          // na trilha: sem ele não há como saber, depois, se o laço explorou ou repetiu.
          const dg = await dispatchPlain([
            { role: "system", content: "Você diagnostica a CAUSA de uma falha de código antes de a corrigir. Responda em DUAS linhas, exatamente neste formato e nada mais:\nCAUSA: <uma frase nomeando o que está errado na HIPÓTESE, não no detalhe>\nEIXO: <o que tem de variar para corrigir — a estrutura do algoritmo? a ordem de consumo de um gerador aleatório? o formato de saída? a condição de borda? a interpretação do enunciado?>" },
            { role: "user", content: `ENUNCIADO:\n${String(prompt).slice(0, 2500)}\n\nCÓDIGO:\n\`\`\`python\n${codigo.slice(0, 3000)}\n\`\`\`\n\nVERIFICAÇÕES QUE FALHARAM (${nPass ?? "?"} de ${nTotal ?? "?"} passaram):\n${ultimoErro.slice(0, 1200)}` },
          ], { maxTries: 1, timeoutMs: 40000 });
          const diag = String(dg?.text || "").trim().slice(0, 400);
          if (dg?.usage) { tokIn += dg.usage.prompt_tokens || 0; tokOut += dg.usage.completion_tokens || 0; }
          trilha[trilha.length - 1].diagnostico = diag || null;
          if (elapsedMs() > TETO - 30000) break;

          const rp = await dispatchPlain([
            { role: "system", content: "Você corrige código Python. Responda APENAS com o código corrigido dentro de um bloco ```python. Sem explicação. Se o diagnóstico aponta a HIPÓTESE como errada, reescreva a abordagem — não ajuste detalhes da mesma." },
            { role: "user", content: `ENUNCIADO:\n${String(prompt).slice(0, 2500)}\n\nCÓDIGO ATUAL:\n\`\`\`python\n${codigo.slice(0, 3000)}\n\`\`\`\n\nDIAGNÓSTICO:\n${diag}\n\nFALHAS:\n${ultimoErro.slice(0, 1200)}\n\nEntregue o código corrigido.` },
          ], { maxTries: 1, timeoutMs: 60000 });
          if (rp?.usage) { tokIn += rp.usage.prompt_tokens || 0; tokOut += rp.usage.completion_tokens || 0; }
          const novo = ([...String(rp?.text || "").matchAll(/```(?:python|py)\s*\n([\s\S]*?)```/g)].map((x) => String(x[1])).sort((a, b) => b.length - a.length)[0] || "").trim();
          if (!novo) break;
          codigo = novo;
          ronda++;
        }

        cicloCodigo = {
          rondas: trilha.length,
          fechou,
          trilha,
          oraculo: { fonte: testesDoUtilizador ? "testes-do-utilizador" : "contrato-do-pedido", dados: dados.length, derivados: derivados.length, total: casos.length, testesDoUtilizador: testesDoUtilizador.length > 0 },
          // 🎯 A FORÇA DA EVIDÊNCIA, explícita: fechar só com casos que o próprio modelo inventou
          // não é o mesmo que fechar com casos do enunciado, e quem lê o registo tem de o ver sem
          // ter de o deduzir.
          forca: !fechou ? "nao_fechou" : testesDoUtilizador ? "fechou_com_os_TESTES_DO_UTILIZADOR" : (dados.length ? "fechou_com_o_contrato_do_pedido" : "fechou_sem_casos"),
          ms: Date.now() - t0Ciclo,
        };

        // se o ciclo melhorou o código, a resposta ao utilizador leva o código que PASSOU
        if (fechou && trilha.length > 1 && codigo && !String(text).includes(codigo)) {
          text = String(text).replace(/```(?:python|py)\s*\n[\s\S]*?```/, "```python\n" + codigo + "\n```");
        }
      }
    }
  } catch (e) {
    // ⚠️ ALTO NO ERRO, best-effort no fluxo: um escritor mudo perde o lote inteiro em silêncio, e
    // esta casa já pagou isso uma vez. O ciclo nunca derruba a resposta, mas nunca falha calado.
    console.error("[CICLO-CODIGO] falhou:", String((e as any)?.message || e).slice(0, 200));
    cicloCodigo = { erro: String((e as any)?.message || e).slice(0, 200) };
  }

  // 8b) WITNESS DE FECHO (T3) — 1 row/turno em persona_closure_events, atrás de persona_closure_enabled (default OFF).
  //     verdict = FEASIBLE_WITNESSED SE um ORÁCULO externo foi consultado neste turno (run_code executado), senão UNKNOWN.
  //     Fecha (parcialmente) o laço consequência→update: registra se a saída teve lastro-de-oráculo. Best-effort.
  //     ANTI-ARTEFATO (follow-up gated): a PRECISÃO (rows WITNESSED correlacionam com turnos verificados-corretos) só é
  //     medível acumulando turnos com o switch ON; se não correlacionar OU não mover recall → desligar. NÃO virar grafo.
  try {
    const _ce = await sql`select public.get_internal_config('persona_closure_enabled') as v`;
    if (String(_ce[0]?.v) === "true" && (userId || companyId) && text) {
      // ⚠️ O PROXY SAIU. `toolsUsed.includes("run_code")` dizia que a ferramenta foi CHAMADA, não que
      // algo foi verificado — e estava comentado como proxy no próprio código. Agora, quando o ciclo
      // de código correu, a testemunha é a trilha: fechou contra casos executados, com placar por
      // ronda. Sem o ciclo, mantém-se o proxy antigo e ele continua a declarar-se como proxy.
      const oracleHeld = cicloCodigo && typeof cicloCodigo.fechou === "boolean" ? cicloCodigo.fechou : toolsUsed.includes("run_code");
      const outcome = { tools_used: toolsUsed, reasoning_gate: reasoningGateUsed, council: councilUsed, code_exec: oracleHeld, ciclo_codigo: cicloCodigo, routed_tier: routedTier, model: usedModel?.model_slug };
      await sql`insert into public.persona_closure_events (persona_slug, scope, user_id, company_id, turn_ref, verdict, axes, outcome)
        values (${personaTrace?.slug || "mz_default"}, ${personaTrace?.scope || "system"}, ${userId || null}::uuid, ${companyId || null}::uuid, ${sessionId || null}, ${oracleHeld ? "FEASIBLE_WITNESSED" : "UNKNOWN"}, '[]'::jsonb, ${outcome})`;
    }
  } catch { /* witness best-effort: nunca derruba a resposta */ }

  return j({
    response_text: text,
    model: model.model_slug,
    provider: model.provider,
    user: userId,
    // W0 · CARIMBO DA PERSONA (·P, 2026-08-05). O trace já existia — mas só no `decision_trace` de
    // `agent_execution_logs`, que (i) só é escrito quando há company_id E agent_id, e (ii) não
    // chega a quem invoca. O `mz-async` guarda ESTA resposta em `mz_jobs.result` e é ele que insere
    // em `mz_agent_runs` (mz-async.ts:125) — sem esta chave, ele não tem de onde carimbar.
    // Aditivo: nenhum consumidor existente lê por posição nem valida chaves desconhecidas.
    persona: personaTrace,
    on_behalf_of: acionadoPorMaquina || undefined,
    // elo com agent_execution_logs — o mz-async grava isto em mz_agent_runs.execution_log_id
    execution_log_id: executionLogId,
    // ⚠️ A TRILHA DO CICLO DE CÓDIGO SAI AQUI, e não só na telemetria. Medido em 2026-08-07: eu
    // tinha-a escrito APENAS no `outcome` de `persona_closure_events`, que só é inserido quando
    // `persona_closure_enabled` está ON — e na `.107` essa flag está **false**. Ou seja: o ciclo
    // corria, verificava, reparava, e **não deixava rasto legível a ninguém**. É exatamente o
    // escritor mudo que esta casa proíbe, cometido por mim no mesmo dia em que o documentei.
    //
    // O critério que eu pré-registei antes de escrever este código foi «um turno de código no
    // caminho vivo tem de produzir TRILHA — placar por ronda, não só passou/falhou». Uma trilha
    // que depende de uma segunda flag de telemetria estar ligada não cumpre isso: fica `null`
    // quando o ciclo não correu, e carrega o placar por ronda quando correu.
    ciclo_codigo: cicloCodigo,
    memory_used: memoryBlock.length > 0,
    rag_used: ragBlock.length > 0,
    tools_used: toolsUsed,
    failover: attempts.length,
    reasoning_gate: reasoningGateUsed,
    council: councilUsed,
    council_models: councilModelsTrace,
    routed_tier: routedTier,
    tokens_in: tokIn,
    tokens_out: tokOut,
    points_charged: pointsCharged,
    points_balance: pointsBalance,
    // POR QUE o veredito viaja no corpo: `points_charged: null` sozinho é ambíguo — pode ser
    // billing desligado, modelo sem preço, saldo insuficiente ou turno de custo zero, e cada um
    // pede uma ação diferente de quem lê. Sem o motivo, o front só sabe dizer "não cobrou".
    billing_reason: billingReason,
  });
}
