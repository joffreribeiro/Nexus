/**
 * fluxo-nav-calculos.js - Cálculos puros dos badges de pendência da esteira
 * de etapas (Operação), usados por fluxo-nav.js.
 * Sem DOM, sem estado global — testável isoladamente com Vitest. Recebe os
 * arrays (precificações, propostas) como argumento em vez de ler globais de
 * app2.js, para poder ser testado sem depender de window/document.
 */
(function () {

/**
 * Quantas precificações ativas ainda não viraram proposta — badge da etapa
 * "Proposta" da esteira.
 * @param {Array} precificacoesCliente
 * @returns {number}
 */
function contarPrecificacoesSemProposta(precificacoesCliente) {
    if (!Array.isArray(precificacoesCliente)) return 0;
    return precificacoesCliente.filter(p => p && p.status === 'ativa' && !p.propostaId).length;
}

/**
 * Quantas propostas aceitas ainda não têm venda registrada — badge da etapa
 * "Venda" da esteira.
 * @param {Array} propostas
 * @returns {number}
 */
function contarPropostasAceitasSemVenda(propostas) {
    if (!Array.isArray(propostas)) return 0;
    return propostas.filter(p => p && p.status === 'aceita' && !p.vendaId).length;
}

const FluxoNavCalculos = {
    contarPrecificacoesSemProposta,
    contarPropostasAceitasSemVenda
};

if (typeof window !== 'undefined') {
    window.FluxoNavCalculos = FluxoNavCalculos;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FluxoNavCalculos;
}

})();
