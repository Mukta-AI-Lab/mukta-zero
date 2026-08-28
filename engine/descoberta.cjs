// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
// descoberta.cjs — R2 do plano aprovado (W1.1b): RECUPERAÇÃO DE MÉTODO antes da geração.
//
// POR QUE EXISTE. O gap do resíduo hard é DESCOBERTA, não execução — medido duas vezes:
// feed-method (2026-07-23): método verificado no prompt move 0/8 → 5/8; degrau AGI-2 (2026-07-31):
// 4 cérebros × tarefas reais → 0 aprovações quando ninguém fornece o método. O modelo executa a
// rota que recebe e não acha a rota na fronteira. Este módulo fornece a rota, quando o corpus a tem.
//
// FRONTEIRA DE PROPRIEDADE (handoff x/y): o MÓDULO é do R&D; a CHAMADA em `_runAssignment` é do
// MZ-Eng — uma linha revisável. Nada aqui importa agent-runtime.
//
// ⚠️ O RETRIEVER v1 É LEXICAL, E ISSO É DECLARADO. A validação de 2026-07-23 (@1=67%, @3=89%,
// held-out de classe) usou retriever de EMBEDDING — aqueles números NÃO se transferem para este.
// O gate do W1.1 mede este do zero, em A/B pareado. Publicar os 89% como se fossem deste módulo
// seria a 5ª classe (afirmar além do dado).
//
// HIGIENE (a mesma do corpus): MÉTODO É CLASSE, NÃO INSTÂNCIA. O corpus versionado só contém
// "como esta classe se resolve"; nunca a resposta de uma instância. E o retrieval devolver NADA
// é resultado honesto — repertório frio é um TRIGGER (registrado), não um erro.
'use strict';
const fs = require('fs'), path = require('path');

const ARQ = path.join(__dirname, 'method-corpus.json');
const LIMIAR = Number(process.env.DESCOBERTA_LIMIAR || 0.18);

let _corpus = null;
function corpus() {
  if (!_corpus) _corpus = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  return _corpus;
}

// tokenização crua e SEM stemming — pt/en misturados no corpus e nos enunciados.
// ⚠️ 'sobre' entrou aqui por DISPARO REAL: no portão v2, "poema sobre o mar" casou com "busca
// binária sobre o valor" e furou o frio — preposição pontuando como sinal é ruído com cara de método.
const STOP = new Set(('de da do das dos e o a os as um uma em no na nos nas por para com sem que se ao à '
  + 'sobre entre como mais menos cada todo toda todos todas qual quando onde seja sua seu isso essa esse '
  + 'the a an of in on for with and or to is are be this that').split(' '));
function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

// score lexical: cobertura dos SINAIS (peso 3 — são a assinatura da classe) + sobreposição com o
// texto do método e exemplos (peso 1). Normalizado para [0,1] pelo tamanho do lado menor.
function score(taskToks, cls) {
  const alvoSinais = new Set(tokens((cls.sinais || []).join(' ')));
  const alvoResto = new Set(tokens(cls.metodo + ' ' + (cls.exemplos_de_classe || []).join(' ')));
  let s = 0, sinaisHit = 0;
  for (const t of taskToks) {
    if (alvoSinais.has(t)) { s += 3; sinaisHit++; }
    else if (alvoResto.has(t)) s += 1;
  }
  const norm = Math.min(taskToks.size, alvoSinais.size * 3 + alvoResto.size) || 1;
  return { score: Math.min(1, s / norm), sinaisHit };
}

// `recupera(texto, k)` → { metodos: [{classe, metodo, score, sinais_hit}], top_score, frio }
// `frio: true` = nada acima do limiar — o chamador registra o trigger repertorio_frio e NÃO injeta.
function recupera(texto, k = 3) {
  const taskToks = new Set(tokens(texto));
  const ranked = corpus().classes
    .map((c) => { const r = score(taskToks, c); return { classe: c.classe, metodo: c.metodo, score: +r.score.toFixed(3), sinais_hit: r.sinaisHit }; })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((m) => m.score >= LIMIAR);
  return { metodos: ranked, top_score: ranked[0] ? ranked[0].score : 0, frio: ranked.length === 0 };
}

// bloco para o prompt. Regras de redação: candidatos, não ordens — o oráculo é quem decide; e o
// bloco só existe se houver método (percepção/descoberta vazia NÃO é prompt).
function bloco(rec) {
  if (!rec || rec.frio || !rec.metodos.length) return '';
  const linhas = rec.metodos.map((m, i) => `${i + 1}. [${m.classe}] ${m.metodo}`);
  return '=== MÉTODOS CANDIDATOS (recuperados de classes de problema já resolvidas) ===\n'
    + 'Avalie se algum se aplica. Se nenhum se aplicar, ignore esta seção e resolva do zero.\n'
    + linhas.join('\n') + '\n=== FIM DOS MÉTODOS CANDIDATOS ===';
}

// ── v2 (handoff ee/ff): o DESTINO CANÔNICO é a tabela do corpus de método — método que o caminho
// canônico produz mora onde o caminho canônico lê. O repo virou seed+fixture offline.
// ⚠️ v3 (MEM-0, 2026-08-03): esse destino é agora `mz_method_corpus` NA .107. O nome `code_agent_
// method_corpus` era do cloud e ficou órfão quando o harness migrou — o princípio "produz onde lê"
// sobreviveu à mudança de superfície; a implementação não tinha sobrevivido.
//
// AS DUAS NOTAS DE CONTRATO da (ff), respeitadas por construção:
//   (a) `metodo` tem TRÊS formas ({passos}|{texto}|{declarado,rounds}) e `declarado: null` é
//       INFORMAÇÃO (capability sem declaração — codegen hoje), não falha. `metodoTexto` lê as três
//       e devolve '' quando não há texto legível — a linha ainda é recuperável por tag+problema.
//   (b) `embedding_pendente=true` em TUDO e não há gerador wireado: recuperar por vetor acharia
//       ZERO e o relatório leria "o retrieve não acha nada" como fracasso do método. A v2 recupera
//       por TAG+TEXTO (lexical) e DECLARA isso no retorno (`retriever: 'lexical'`) — quando o vetor
//       existir, o campo muda e o A/B se refaz.

// ⚠️ VERIFICADO É CONTEÚDO, NÃO PRESENÇA. Achado ao olhar o corpus REAL antes de rodar (2026-07-31):
// as 9 linhas seed têm `oracle_verdict = {verificado: false, nota: "o COMO não foi preservado"}` —
// o CAMPO existe, e dentro dele a verdade é FALSE. A 1ª versão derivava `!!oracle_verdict` e reportava
// as 9 como VERIFICADAS — carimbaria "· verificado" no prompt sobre método NÃO verificado, e o SLA do
// flywheel ("só entra com o cite do oráculo que a validou") seria vencido por presença de campo.
// É a mesma classe de `declarado:null` e `nPass:null`: ler a existência do campo como o veredito dele.
// Regra: verificado ⇔ o oráculo APROVOU (nPass===nTotal>0) OU um `verificado:true` explícito.
function verificadoDe(ov) {
  if (!ov || typeof ov !== 'object') return false;
  if (ov.verificado === true) return true;
  if (typeof ov.nPass === 'number' && typeof ov.nTotal === 'number') return ov.nTotal > 0 && ov.nPass === ov.nTotal;
  return false;                                  // campo presente sem aprovação legível ⇒ NÃO verificado
}

function metodoTexto(m) {
  if (!m || typeof m !== 'object') return '';
  if (Array.isArray(m.passos)) return m.passos.join(' ');
  if (typeof m.texto === 'string') return m.texto;
  if (m.declarado && typeof m.declarado === 'object') {
    return [m.declarado.approach, m.declarado.why].filter(Boolean).join(' ');
  }
  return '';                                     // declarado:null e afins — informação, não falha
}

// CHAVE DO RETRIEVE parametrizável — pré-requisito do 4º braço (handoff ll): a hipótese de que
// query e chave vivem em vocabulários diferentes (enunciado × técnica) é testável SÓ se der para
// keyar em `problema` sozinho (enunciado × enunciado) contra `metodo` sozinho. `campos` é o eixo
// da ablação. Default 'todos' preserva o comportamento atual — nenhum chamador existente muda.
function textoDaChave(linha, campos) {
  const partes = {
    tag: linha.tag, problema: linha.problema, metodo: metodoTexto(linha.metodo),
  };
  const sel = campos === 'todos' ? ['tag', 'problema', 'metodo'] : (Array.isArray(campos) ? campos : [campos]);
  return sel.map((c) => partes[c]).filter(Boolean).join(' ');
}

function scoreLinha(taskToks, linha, campos = 'todos') {
  const alvo = new Set(tokens(textoDaChave(linha, campos)));
  let s = 0;
  for (const t of taskToks) if (alvo.has(t)) s++;
  const norm = Math.min(taskToks.size, alvo.size) || 1;
  return Math.min(1, s / norm);
}

// `recuperaDb(deps, texto, {cap, k, campos})` — deps = {fetchLinhas} injetado (produção: REST com
// SRK; teste: fixture). Mesma doutrina do exec injetado: uma lógica, N transportes.
// `campos`: 'todos' (default) | 'problema' | 'metodo' | ['problema','tag'] — o eixo do 4º braço.
// 🔴🔴 ANTI-VAZAMENTO — pré-requisito de segurança para `MZ_DESCOBERTA=inject` (2026-08-08).
// MEDIDO antes de ligar a injeção: em 7 de 8 tarefas do BigCodeBench testadas, a PRÓPRIA solução
// verificada da tarefa estava no corpus (2 a 4 linhas cada). O `filtraInjetaveis` filtra por
// `verificado` e `generaliza` — e NADA nele impede devolver a linha da tarefa que está a ser
// resolvida agora. Ligar a injeção sem esta trava entrega ao modelo a resposta dele próprio: o
// placar sobe e não mede nada. É a armadilha do feed-method de Julho, à escala de produção.
// A exclusão é por ENUNCIADO e não por id, porque a mesma tarefa entra no corpus com ids diferentes
// a cada corrida (`fonte` distingue braços; `prompt_hash` não sobe no select do retriever).
function ehAPropriaTarefa(problema, texto) {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const p = n(problema), t = n(texto);
  if (!p || !t) return false;
  if (p.slice(0, 220) === t.slice(0, 220)) return true;
  return p.includes(t.slice(0, 120)) || t.includes(p.slice(0, 120));
}

async function recuperaDb(deps, texto, { cap = null, k = 3, campos = 'todos' } = {}) {
  const todas = await deps.fetchLinhas(cap);
  const linhas = (todas || []).filter((l) => !ehAPropriaTarefa(l.problema, texto));
  const excluidas = (todas || []).length - linhas.length;
  if (excluidas) console.error(`[ANTI-VAZAMENTO] ${excluidas} linha(s) do corpus são a PRÓPRIA tarefa — excluídas do retrieve`);
  const taskToks = new Set(tokens(texto));
  const ranked = (linhas || [])
    .map((l) => ({ id: l.id, tag: l.tag || null, fonte: l.fonte,
      resumo: (metodoTexto(l.metodo) || l.problema || '').slice(0, 400),
      verificado: verificadoDe(l.oracle_verdict),
      // ⚠️ O CAMPO TEM DE SUBIR, senão o filtro de injeção decide por `undefined`. Um filtro que lê
      // um campo que ninguém preenche não é conservador: é um portão que rejeita tudo em silêncio,
      // e o sintoma («o retrieve não injeta nada») é indistinguível de «não há o que injetar».
      // `generaliza` vem do carimbo da campanha de generalidade; ausente = DESCONHECIDO, não falso.
      generaliza: (l.oracle_verdict && typeof l.oracle_verdict === "object" && "generaliza" in l.oracle_verdict)
        ? l.oracle_verdict.generaliza === true : undefined,
      score: +scoreLinha(taskToks, l, campos).toFixed(3) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((m) => m.score >= LIMIAR);
  return { metodos: ranked, top_score: ranked[0] ? ranked[0].score : 0,
    frio: ranked.length === 0, retriever: 'lexical', chave: campos, vetor: 'indisponivel_embedding_pendente' };
}

// fetch de produção (REST). Traz as N mais recentes da cap; SEM filtro de verificado — o acervo
// declara 0 verificadas hoje, e filtrar por isso agora devolveria vazio SEMPRE, que se leria como
// "retrieve não funciona". `verificado` viaja no resultado para o CHAMADOR decidir/registrar.
// a `apikey` é a chave PÚBLICA da instância (anon), lida do mesmo alvo que todo o resto do MZ usa.
// Fica em módulo e não em argumento para nenhum chamador existente ter de mudar — a assinatura
// `fetchLinhasRest(SUPA, srk)` continua idêntica.
let _lidoFalhas = 0;
const ANON = (() => {
  try {
    const os = require('os'), path = require('path');
    return JSON.parse(require('fs').readFileSync(path.join(os.homedir(), '.mukta', 'target.json'), 'utf8')).anon_key || null;
  } catch { return null; }
})();

function fetchLinhasRest(SUPA, srk) {
  return async (cap) => {
    const filtro = cap ? `cap=eq.${encodeURIComponent(cap)}&` : '';
    // ⚠️ TABELA MUDOU NA MEM-0 (2026-08-03): `code_agent_method_corpus` → `mz_method_corpus`.
    // NÃO é renomeação cosmética. O escritor migrou para a .107 a 02/08 e passou a gravar em
    // `mz_method_corpus`; este leitor ficou a apontar ao nome do cloud, que na .107 NÃO EXISTE —
    // 404/42P01, que o `.catch(() => [])` abaixo converte em lista vazia. Efeito medido: `frio:true`
    // em 100% das consultas, indistinguível de "o corpus está vazio". O braço `inject` do A/B do
    // MEM-3 injetaria zero para sempre, e o kill R-MZ2 desligaria a escrita por um Δsolved=0 que
    // media o encanamento. Este era o mais caro dos quatro achados, e é uma linha.
    // 🔴🔴 SEGUNDO defeito na MESMA linha, e mais caro que o primeiro (2026-08-07, medido):
    // `apikey: srk` passava o MESMO token como chave de API e como Bearer. Isso funciona quando
    // `srk` é a service_role key — e o caminho de produção NÃO passa essa: o `getSRK()` devolve um
    // JWT de login (205 ch). Medido, com os dois pares de cabeçalhos na mesma URL e no mesmo minuto:
    //     apikey=srk  → HTTP 401 {"message":"Invalid authentication credentials"}
    //     apikey=anon → HTTP 200 [{"id":164},{"id":222},{"id":91}]
    // Efeito: 401 em TODAS as consultas, e o `.catch(() => [])` convertia-o em lista vazia. Medido
    // em `mz_runtime_events`: `k:0 · top_score:0 · verificados:0` em 57 de 57 consultas — e ninguém
    // podia distinguir isso de «o corpus está vazio». Chamado com a credencial certa, o MESMO
    // retriever devolve k=3 com top_score 0,511 sobre 200 linhas.
    // ⇒ a frase «nunca foi estabelecido que retrieval de método funciona» era falsa: ele nunca
    //   chegou a ser autorizado a LER. É o mesmo modo de falha que o comentário acima documenta
    //   (404 engolido pelo catch) — o nome da tabela foi corrigido e o catch mudo ficou.
    const r = await fetch(`${SUPA}/rest/v1/mz_method_corpus?${filtro}select=id,tag,fonte,problema,metodo,oracle_verdict&order=created_at.desc&limit=200`,
      { headers: { apikey: ANON, Authorization: `Bearer ${srk}` } });
    // NENHUM LEITOR NASCE MUDO. O catch continua a não quebrar o laço (best-effort no fluxo), mas
    // grita — porque «não achei» e «não me deixaram ler» são a mesma lista vazia para quem lê depois.
    if (!r.ok) {
      if (_lidoFalhas++ < 5) console.error(`[CORPUS NÃO LIDO] HTTP ${r.status}: ${String(await r.text().catch(() => '')).slice(0, 160)}`);
      return [];
    }
    const j = await r.json().catch((e) => { console.error(`[CORPUS ILEGÍVEL] ${String(e && e.message).slice(0, 90)}`); return []; });
    return Array.isArray(j) ? j : [];
  };
}

function blocoDb(rec) {
  if (!rec || rec.frio || !rec.metodos.length) return '';
  // 🔴 O RÓTULO TEM DE DIZER O QUE O CORPO É (2026-08-08). O `resumo` é
  // `metodoTexto(metodo) || problema` — e como `declarado` é null em 204 de 215 linhas, o que sai
  // daqui é o ENUNCIADO DE OUTRA TAREFA sob um cabeçalho que promete «MÉTODOS CANDIDATOS».
  // Um bloco que promete método e entrega enunciado faz o modelo procurar técnica onde só há
  // problema alheio — é a classe do rótulo que mede uma coisa e é lido como outra, dentro do
  // próprio mecanismo de memória. Agora cada linha declara qual das duas coisas é.
  const linhas = rec.metodos.map((m, i) => {
    const temMetodo = !!metodoTexto(m.metodo || {}).trim() || (m.tipo === 'metodo');
    const rotulo = temMetodo ? 'MÉTODO' : 'ENUNCIADO de tarefa parecida (sem método declarado)';
    return `${i + 1}. [${m.tag || 'sem-tag'}${m.verificado ? ' · verificado por execução' : ''} · ${rotulo}] ${m.resumo}`;
  });
  return '=== MEMÓRIA DE TAREFAS ANTERIORES (retrieval lexical — embedding pendente) ===\n'
    + 'Cada linha declara se é um MÉTODO ou apenas o ENUNCIADO de uma tarefa parecida.\n'
    + 'NENHUMA delas é a tarefa que você tem de resolver. Avalie; se nada se aplicar, ignore e resolva do zero.\n'
    + linhas.join('\n') + '\n=== FIM DA MEMÓRIA ===';
}

module.exports = { recupera, bloco, tokens, LIMIAR, ARQ, recuperaDb, blocoDb, metodoTexto, verificadoDe, fetchLinhasRest };
