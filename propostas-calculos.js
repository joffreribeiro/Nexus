/**
 * propostas-calculos.js - Cálculos puros da tela de Propostas (workspace Operação)
 * Sem DOM, sem estado global — testável isoladamente com Vitest.
 *
 * Segue o mesmo padrão de estoque-calculos.js/crm-calculos.js: IIFE para não
 * colidir com nomes já usados em app2.js, exposto como window.PropostasCalculos
 * e via module.exports para o Vitest.
 */
(function () {

/**
 * Dias entre `hoje` e a data de validade (ignorando hora do dia).
 * Positivo = ainda falta vencer, 0 = vence hoje, negativo = já venceu.
 * @param {string|Date|null|undefined} validade
 * @param {string|Date} [hoje] - padrão: data/hora atual
 * @returns {number|null} null quando `validade` é ausente ou inválida
 */
function diasParaVencer(validade, hoje) {
    if (!validade) return null;
    const dataValidade = new Date(validade);
    if (isNaN(dataValidade.getTime())) return null;

    const base = hoje ? new Date(hoje) : new Date();
    if (isNaN(base.getTime())) return null;

    const diaValidade = Date.UTC(dataValidade.getFullYear(), dataValidade.getMonth(), dataValidade.getDate());
    const diaHoje = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
    return Math.round((diaValidade - diaHoje) / 86400000);
}

/**
 * Classe do semáforo de validade a partir do resultado de diasParaVencer().
 * @param {number|null} dias
 * @returns {'vencida'|'alerta'|'ok'|null}
 */
function classeSemaforoValidade(dias) {
    if (dias === null || dias === undefined || !Number.isFinite(dias)) return null;
    if (dias < 0) return 'vencida';
    if (dias <= 7) return 'alerta';
    return 'ok';
}

const PropostasCalculos = {
    diasParaVencer,
    classeSemaforoValidade
};

if (typeof window !== 'undefined') {
    window.PropostasCalculos = PropostasCalculos;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PropostasCalculos;
}

})();
