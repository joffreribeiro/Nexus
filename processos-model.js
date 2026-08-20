/**
 * processos-model.js - Forma dos dados do módulo de Processos (SEI) do Controle-Estoque
 * Funções puras: factories, normalização/migração e validação.
 * Sem DOM, sem estado global — testável isoladamente com Vitest.
 *
 * Espelha ponto-model.js: schema plano por processo, `normalizarProcesso()` aceita
 * tanto o formato já normalizado quanto o formato bruto do processos_seed.json
 * (numero/assunto/tipoProcesso/marcadores/acompanhamentoEspecial/observacao/
 * sugestaoMarcador/origem — quase 1:1, só falta gerar id e atualizadoEm).
 */

// Marcadores já cadastrados no Controle de Processos do SEI (unidade DVMNA-FI),
// usados como sugestão inicial no seletor de classificação — lista estática de
// domínio, não é buscada em tempo de execução (ver processos_seed.json:5-19).
var MARCADORES_SEI_PADRAO = [
    'Acompanhamento', 'Força Armada', 'Geral', 'Mercado Interno', 'P&D', 'Pessoal',
    'Plano de Produção', 'Projetos - FI', 'Representantes', 'S&OP', 'TED',
    'TED em tratativas', 'TED encerrados'
];

var ORIGENS_VALIDAS = ['marcado', 'sem_marcador', 'nao_triado'];

// Formato do número de processo do SEI: NNNNN.NNNNNN/AAAA-DD
var RE_NUMERO_SEI = /^\d{5}\.\d{6}\/\d{4}-\d{2}$/;

function novoId(prefixo) {
    return prefixo + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

function ehObjeto(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizarListaTexto(v) {
    return (Array.isArray(v) ? v : [])
        .filter(function (x) { return typeof x === 'string' && x.trim(); })
        .map(function (x) { return x.trim(); });
}

function normalizarTextoOpcional(v) {
    return (typeof v === 'string' && v.trim()) ? v.trim() : null;
}

// ──────────────────────────────────────────────
//  NORMALIZAÇÃO
// ──────────────────────────────────────────────

/**
 * Normaliza um processo. Aceita tanto um objeto já no formato do schema
 * (com id/atualizadoEm) quanto o formato bruto do processos_seed.json —
 * pura e idempotente.
 */
function normalizarProcesso(rBruto) {
    var r = ehObjeto(rBruto) ? rBruto : {};
    return {
        id: (typeof r.id === 'string' && r.id) ? r.id : novoId('proc'),
        numero: (typeof r.numero === 'string' && r.numero.trim()) ? r.numero.trim() : '',
        assunto: normalizarTextoOpcional(r.assunto),
        tipoProcesso: normalizarTextoOpcional(r.tipoProcesso),
        marcadores: normalizarListaTexto(r.marcadores),
        acompanhamentoEspecial: normalizarListaTexto(r.acompanhamentoEspecial),
        observacao: normalizarTextoOpcional(r.observacao),
        sugestaoMarcador: normalizarTextoOpcional(r.sugestaoMarcador),
        origem: ORIGENS_VALIDAS.indexOf(r.origem) !== -1 ? r.origem : 'nao_triado',
        negocioId: (typeof r.negocioId === 'string' && r.negocioId) ? r.negocioId : null,
        atualizadoEm: (typeof r.atualizadoEm === 'string' && r.atualizadoEm) ? r.atualizadoEm : new Date().toISOString()
    };
}

/**
 * Normaliza uma lista de processos (migração/import): mapeia cada item e
 * deduplica por `numero` — mesma regra de "último ganha" usada por
 * normalizarPonto() para registros por data. Itens sem número válido são
 * descartados.
 */
function normalizarProcessos(listaBruta) {
    var lista = (Array.isArray(listaBruta) ? listaBruta : []).map(normalizarProcesso).filter(function (p) { return p.numero; });
    var porNumero = {};
    lista.forEach(function (p) { porNumero[p.numero] = p; });
    return Object.keys(porNumero).sort().map(function (n) { return porNumero[n]; });
}

/**
 * Regra única de classificação por origem, a partir dos marcadores e grupos de
 * Acompanhamento Especial de um processo — usada tanto pelo store (aplicarMarcador/
 * removerMarcador) quanto pela UI (salvar do modal), pra não haver duas fontes de
 * verdade divergentes pra mesma regra.
 */
function origemParaClassificacao(marcadores, acompanhamentoEspecial) {
    if (Array.isArray(marcadores) && marcadores.length) return 'marcado';
    if (Array.isArray(acompanhamentoEspecial) && acompanhamentoEspecial.length) return 'sem_marcador';
    return 'nao_triado';
}

/** Normaliza o estado inteiro estoque.processos: garante o array `itens`. */
function normalizarEstadoProcessos(bruto) {
    var e = ehObjeto(bruto) ? bruto : {};
    return {
        versao: 1,
        itens: normalizarProcessos(e.itens)
    };
}

// ──────────────────────────────────────────────
//  FACTORY
// ──────────────────────────────────────────────

/** Cria um processo novo (sempre gera id/atualizadoEm novos, mesmo se `dados` já tiver). */
function novoProcesso(dados) {
    return normalizarProcesso(Object.assign({}, dados, { id: undefined, atualizadoEm: undefined }));
}

// ──────────────────────────────────────────────
//  VALIDAÇÃO
// ──────────────────────────────────────────────

/**
 * `opts.ignorarFormatoNumero` pula a checagem de formato (mas não a de
 * obrigatoriedade) — usado por ProcessosStore.atualizarProcesso() quando o
 * patch não altera `numero` (campo imutável na UI), pra um processo
 * importado com número fora do padrão estrito não travar edições de campos
 * que nada têm a ver com ele.
 */
function validarProcesso(processo, opts) {
    var o = opts || {};
    var erros = [];
    if (!ehObjeto(processo)) { erros.push('Processo deve ser um objeto válido'); return erros; }
    if (!processo.numero || typeof processo.numero !== 'string' || !processo.numero.trim()) {
        erros.push('Número do processo é obrigatório');
    } else if (!o.ignorarFormatoNumero && !RE_NUMERO_SEI.test(processo.numero.trim())) {
        erros.push('Número do processo deve seguir o formato NNNNN.NNNNNN/AAAA-DD');
    }
    if (processo.origem != null && ORIGENS_VALIDAS.indexOf(processo.origem) === -1) {
        erros.push('Origem inválida');
    }
    return erros;
}

var ProcessosModel = {
    MARCADORES_SEI_PADRAO: MARCADORES_SEI_PADRAO,
    ORIGENS_VALIDAS: ORIGENS_VALIDAS,

    novoId: novoId,

    normalizarProcesso: normalizarProcesso,
    normalizarProcessos: normalizarProcessos,
    normalizarEstadoProcessos: normalizarEstadoProcessos,

    origemParaClassificacao: origemParaClassificacao,

    novoProcesso: novoProcesso,

    validarProcesso: validarProcesso
};

if (typeof window !== 'undefined') {
    window.ProcessosModel = ProcessosModel;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProcessosModel;
}
