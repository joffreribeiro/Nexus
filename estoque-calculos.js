/**
 * estoque-calculos.js - Cálculos puros do módulo Operação/Estoque do Controle-Estoque
 * Sem DOM, sem estado global — testável isoladamente com Vitest.
 *
 * O módulo Operação ainda não tem uma separação lógica/renderização como o
 * CRM (crm-calculos.js) ou o Ponto (ponto-calculos.js); a maior parte do
 * código vive em app2.js, que acessa `document`/`window` no escopo de
 * carregamento e por isso não pode ser importado com segurança pelo Vitest
 * (ambiente `node`, sem jsdom — ver vitest.config.js). Este arquivo existe
 * para abrigar funções puras do módulo Operação, seguindo o mesmo padrão dos
 * demais módulos, à medida que forem extraídas de app2.js.
 *
 * IIFE obrigatória: várias funções aqui têm o MESMO NOME que os wrappers
 * definidos em app2.js (ex.: `obterMetricasImbelProduto`, `calcularSaldoConsolidado`).
 * Como este arquivo carrega DEPOIS de app2.js no index.html, uma declaração
 * `function` solta no escopo global venceria por ordem de carregamento e
 * sobrescreveria silenciosamente o wrapper de app2.js — que tem assinatura
 * diferente (menos parâmetros, lê os globais implicitamente). O sintoma seria
 * todo saldo/venda voltando 0, sem erro nenhum no console. A IIFE garante que
 * só `window.EstoqueCalculos` fica exposto.
 */
(function () {

/**
 * Situação do custo cadastrado de um produto, para o Relatório de
 * Rentabilidade: 'sem_custo' quando o custo total é nulo, indefinido ou zero
 * (a margem calculada nesse caso não é confiável — vira ~100% por ausência de
 * dado, não por resultado real); 'ok' quando há custo cadastrado maior que zero.
 */
function calcularStatusCusto(produto) {
    const custo = produto && produto.custoTotal;
    const num = Number(custo);
    return (Number.isFinite(num) && num > 0) ? 'ok' : 'sem_custo';
}

/**
 * Converte um valor monetário em formato pt-BR ("1.234,56", "R$ 10,00", ou já
 * numérico) para Number. Extraído de app2.js: usado em todo lugar que lê um
 * campo de valor digitado pelo usuário (CI de produto, item de venda, item de
 * movimentação IMBEL) — um erro aqui distorce preço em cascata.
 * @param {string|number} value
 * @returns {number} 0 quando vazio ou não numérico após limpeza
 */
function parseCurrencyBRLToNumber(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const normalized = text
        .replace(/\s/g, '')
        .replace(/[R$r$]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Total vendido de um produto. Prioriza os registros detalhados de venda
 * (`registroVendas`, com ou sem `items[]`) por serem a fonte de verdade;
 * cai para o agregado legado `produto.vendas` só quando não há nenhum
 * registro detalhado para o produto.
 * @param {object} produto
 * @param {Array} registroVendas
 * @returns {number}
 */
function obterTotalVendasProduto(produto, registroVendas) {
    if (!produto) return 0;
    const registros = Array.isArray(registroVendas) ? registroVendas : [];
    const registrosDesteProduto = registros.filter(v => {
        if (Array.isArray(v.items) && v.items.length) {
            return v.items.some(it =>
                Number(it.produtoId) === Number(produto.id) ||
                it.produto === produto.nome ||
                it.produtoNome === produto.nome
            );
        }
        return Number(v.produtoId) === Number(produto.id) || v.produtoNome === produto.nome;
    });
    if (registrosDesteProduto.length > 0) {
        return registrosDesteProduto.reduce((sum, v) => {
            if (Array.isArray(v.items) && v.items.length) {
                return sum + v.items.reduce((s, it) => {
                    if (Number(it.produtoId) === Number(produto.id) || (it.produto === produto.nome) || (it.produtoNome === produto.nome)) return s + (Number(it.quantidade) || 0);
                    return s;
                }, 0);
            }
            if (Number(v.produtoId) === Number(produto.id) || v.produtoNome === produto.nome) return sum + (Number(v.quantidade) || 0);
            return sum;
        }, 0);
    }
    // Fallback para agregado em produto.vendas quando não há registros para este produto
    if (!produto.vendas) return 0;
    return Object.keys(produto.vendas).reduce((s, k) => s + (Number(produto.vendas[k]) || 0), 0);
}

/**
 * Total distribuído de um produto, excluindo a distribuição atribuída à
 * IMBEL (que é derivada, não uma distribuição real a um representante).
 * Mesmo padrão de fonte de verdade + fallback de obterTotalVendasProduto.
 * @param {object} produto
 * @param {Array} registroDistribuicao
 * @returns {number}
 */
function obterDistribuicaoTotalExcluindoImbel(produto, registroDistribuicao) {
    if (!produto) return 0;
    const registros = Array.isArray(registroDistribuicao) ? registroDistribuicao : [];
    const registrosDesteProduto = registros.filter(d =>
        Number(d.produtoId) === Number(produto.id) ||
        (d.produtoNome && d.produtoNome === produto.nome)
    );
    if (registrosDesteProduto.length > 0) {
        return registrosDesteProduto.reduce((s, d) => {
            const rep = (d.representante || '').toString().toUpperCase();
            if (rep === 'IMBEL') return s;
            return s + (Number(d.quantidade) || 0);
        }, 0);
    }
    // Fallback para o objeto produto.distribuicao (legado) quando não há registros para este produto
    if (!produto.distribuicao) return 0;
    return Object.keys(produto.distribuicao).reduce((s, k) => {
        if ((k || '').toUpperCase() === 'IMBEL') return s;
        return s + (Number(produto.distribuicao[k]) || 0);
    }, 0);
}

/**
 * Saldo consolidado = estoque consolidado − total vendido.
 * @param {object} produto
 * @param {Array} registroVendas
 * @returns {number}
 */
function calcularSaldoConsolidado(produto, registroVendas) {
    if (!produto) return 0;
    const estoqueConc = Number(produto.estoqueConsolidado || 0);
    const vendas = obterTotalVendasProduto(produto, registroVendas);
    return estoqueConc - vendas;
}

/**
 * Métricas de saldo IMBEL x consolidado para um produto — a função central
 * de onde derivam os saldos exibidos em Estoque/Distribuição/IMBEL. Reúne
 * três fontes de registro (distribuição, devolução, venda) para responder
 * "quanto ainda está disponível na IMBEL" e "quanto está disponível no
 * consolidado", já líquido de vendas.
 * @param {object} produto
 * @param {object} [registros]
 * @param {Array} [registros.registroDistribuicao]
 * @param {Array} [registros.registroDevolucoes]
 * @param {Array} [registros.registroVendas]
 */
function obterMetricasImbelProduto(produto, registros) {
    if (!produto) {
        return { estoqueTotal: 0, imbelDisp: 0, imbelVenda: 0, imbelSaldo: 0 };
    }
    const registroDistribuicao = (registros && registros.registroDistribuicao) || [];
    const registroDevolucoes = (registros && registros.registroDevolucoes) || [];
    const registroVendas = (registros && registros.registroVendas) || [];

    const produtoId = produto.id;
    const estoqueTotal = Number(
        (produto.estoqueConsolidado ?? produto.estoqueTotal ?? produto.estoque ?? produto.qtdTotal ?? produto.estoqueInicial) || 0
    );

    const distPorRep = {};
    registroDistribuicao.forEach(d => {
        if (Number(d.produtoId) === Number(produtoId) || (d.produtoNome && d.produtoNome === produto.nome)) {
            const r = (d.representante || '').toString().toUpperCase();
            distPorRep[r] = (distPorRep[r] || 0) + (Number(d.quantidade) || 0);
        }
    });
    const totalDistribuido = Object.values(distPorRep).reduce((s, v) => s + v, 0);

    let totalDevolvidoParaImbel = 0;
    registroDevolucoes.forEach(d => {
        if (Number(d.produtoId) === Number(produtoId) || (d.produtoNome && d.produtoNome === produto.nome)) {
            const destino = (d.destino || '').toString().toUpperCase();
            if (destino === 'IMBEL') totalDevolvidoParaImbel += (Number(d.quantidade) || 0);
        }
    });

    const vendasPorRep = {};
    registroVendas.forEach(v => {
        if (v.cancelado) return;
        const rep = (v.representante || '').toString().toUpperCase();
        if (Array.isArray(v.items) && v.items.length) {
            v.items.forEach(it => {
                if (Number(it.produtoId) === Number(produtoId) || (it.produto === produto.nome) || (it.produtoNome === produto.nome)) {
                    vendasPorRep[rep] = (vendasPorRep[rep] || 0) + (Number(it.quantidade) || 0);
                }
            });
        } else if (Number(v.produtoId) === Number(produtoId) || (v.produtoNome === produto.nome)) {
            vendasPorRep[rep] = (vendasPorRep[rep] || 0) + (Number(v.quantidade) || 0);
        }
    });

    const totalVendasProduto = Object.values(vendasPorRep).reduce((s, v) => s + v, 0);
    const consolidadoDisp = estoqueTotal;
    const consolidadoVenda = totalVendasProduto;
    const consolidadoSaldo = consolidadoDisp - consolidadoVenda;

    const imbelDisp = estoqueTotal - totalDistribuido + totalDevolvidoParaImbel;
    const imbelVenda = Number(vendasPorRep['IMBEL'] || 0);
    const imbelSaldo = imbelDisp - imbelVenda;

    return {
        estoqueTotal,
        imbelDisp,
        imbelVenda,
        imbelSaldo,
        consolidadoDisp,
        consolidadoVenda,
        consolidadoSaldo
    };
}

/**
 * Saldo disponível na IMBEL — atalho para `obterMetricasImbelProduto(...).imbelSaldo`.
 * @param {object} produto
 * @param {object} [registros] mesmo formato de obterMetricasImbelProduto
 * @returns {number}
 */
function calcularImbelDisponivel(produto, registros) {
    if (!produto) return 0;
    const met = obterMetricasImbelProduto(produto, registros);
    return Number(met.imbelSaldo || 0);
}

/**
 * Alíquota de ICMS aplicável, por ordem de prioridade:
 *   1) tabela predefinida por NCM (PJ ou PF conforme tipoPessoa);
 *   2) melhor match nas regras cadastradas pelo usuário (tabelaICMS), com
 *      pontuação por especificidade (NCM > estado > tipo de pessoa > categoria;
 *      qualquer critério específico que não bata elimina a regra);
 *   3) fallback: icmsBase cadastrado no produto.
 *
 * Núcleo puro de `buscarAliquotaICMS` (app2.js) — recebe já resolvidos o NCM
 * e a categoria do produto (que dependem de `estoque.produtos`/`detectarNCM`
 * no chamador) para não precisar desses globais aqui.
 *
 * @param {object} ctx
 * @param {string} ctx.estado
 * @param {string} ctx.tipoPessoa - 'PJ' ou 'PF'
 * @param {string|null} ctx.ncm
 * @param {string} ctx.categoria
 * @param {object} ctx.icmsPjPorNcm - tabela predefinida (NCM -> estado -> alíquota), caso PJ
 * @param {object} ctx.icmsPfPorNcm - idem, caso PF
 * @param {Array} ctx.tabelaICMS - regras cadastradas: {ncm, estado, tipoPessoa, categoriaProduto, aliquota}
 * @param {number} [ctx.icmsBaseFallback=0]
 * @returns {number}
 */
function resolverAliquotaICMS(ctx) {
    const { estado, tipoPessoa, ncm, categoria } = ctx;
    const icmsPjPorNcm = ctx.icmsPjPorNcm || {};
    const icmsPfPorNcm = ctx.icmsPfPorNcm || {};
    const tabelaICMS = ctx.tabelaICMS || [];
    const icmsBaseFallback = ctx.icmsBaseFallback || 0;

    // 1) tabela predefinida por NCM (PJ/PF)
    if (ncm) {
        const tabela = (tipoPessoa === 'PF') ? icmsPfPorNcm : icmsPjPorNcm;
        if (tabela[ncm] && tabela[ncm][estado] !== undefined) {
            return tabela[ncm][estado];
        }
    }

    // 2) regras usuário (tabelaICMS) com scoring incluindo NCM
    const score = (rule) => {
        let s = 0;
        if (rule.ncm && ncm && rule.ncm === ncm) s += 8;
        else if (rule.ncm && rule.ncm !== 'Todos') return -1;
        if (rule.estado === estado) s += 4;
        else if (rule.estado !== 'Todos') return -1;
        if (rule.tipoPessoa === tipoPessoa) s += 2;
        else if (rule.tipoPessoa !== 'Todos') return -1;
        if (rule.categoriaProduto === categoria) s += 1;
        else if (rule.categoriaProduto !== 'Todos') return -1;
        return s;
    };

    const match = tabelaICMS
        .map(r => ({ rule: r, score: score(r) }))
        .filter(x => x.score >= 0)
        .sort((a, b) => b.score - a.score)[0];

    if (match) return match.rule.aliquota;

    // 3) fallback: icmsBase na tabelaAliquotas do produto
    return icmsBaseFallback;
}

/**
 * Matemática pura de precificação — núcleo de `calcularPreco` (app2.js).
 * Todas as taxas de entrada são percentuais (ex.: 12 = 12%), já resolvidas
 * pelo chamador (que decide entre override explícito, valor salvo por
 * produto/NCM, ou padrão global lido do DOM — nenhuma dessas fontes é
 * responsabilidade desta função).
 *
 * Sequência (preservada de calcularPreco):
 *   1. valorBase = CI × (1 + Taxa% + ROI%)
 *   2. impostos proporcionais (ICMS, PIS, COFINS) sobre valorBase
 *   3. IPI sobre valorImpostos (valorBase + os três impostos acima)
 *   4. comissão sobre valorImpostos (calculada, mas não somada ao preço)
 *   5. precoFinal = valorImpostos + IPI, a menos que haja override manual
 *
 * @param {object} p
 * @param {number} p.ci - custo interno
 * @param {number} p.taxaPct
 * @param {number} p.roiPct
 * @param {number} p.comissaoPct
 * @param {number} p.pisPct
 * @param {number} p.cofinsPct
 * @param {number} p.ipiPct
 * @param {number} p.icmsPct
 * @param {number|null} [p.precoFinalManual] - quando presente, substitui o precoFinal calculado
 * @returns {object|null} null quando ci <= 0 (sem custo cadastrado, preço não calculável)
 */
function calcularPrecoFinal(p) {
    const ci = Number(p && p.ci) || 0;
    if (ci === 0) return null;

    const taxaPct = Number(p.taxaPct) || 0;
    const roiPct = Number(p.roiPct) || 0;
    const comissaoPct = Number(p.comissaoPct) || 0;
    const pisPct = Number(p.pisPct) || 0;
    const cofinsPct = Number(p.cofinsPct) || 0;
    const ipiPct = Number(p.ipiPct) || 0;
    const icmsPct = Number(p.icmsPct) || 0;

    // Step 1: valorBase = CI + (CI × Taxa%) + (CI × ROI%)  →  CI × (1 + Taxa% + ROI%)
    const valorBase = ci * (1 + (taxaPct / 100) + (roiPct / 100));

    // Step 2: impostos sobre valorBase
    const icmsR = valorBase * icmsPct / 100;
    const pisR = valorBase * pisPct / 100;
    const cofinsR = valorBase * cofinsPct / 100;
    const valorImpostos = valorBase + icmsR + pisR + cofinsR;

    // Step 3: IPI sobre valorImpostos
    const ipiR = valorImpostos * ipiPct / 100;
    const valorTotal = valorImpostos + ipiR;

    // Step 4: comissão sobre valorImpostos (sem IPI) — calculada mas não incluída no preço
    const comissaoR = valorImpostos * comissaoPct / 100;
    const temManual = p.precoFinalManual !== null && p.precoFinalManual !== undefined && p.precoFinalManual !== '';
    // parseFloat (não Number): mesmo parser usado por quem grava precoFinalManual
    // (salvarPrecoFinalManual, em app2.js) — mantém tolerância a valores não
    // perfeitamente limpos.
    const precoFinal = temManual ? parseFloat(p.precoFinalManual) : valorImpostos + ipiR;

    return {
        ci, taxa: taxaPct, roi: roiPct,
        valorBase,
        icms: icmsPct, icmsR,
        pis: pisPct, pisR,
        cofins: cofinsPct, cofinsR,
        valorImpostos,
        ipi: ipiPct, ipiR,
        valorTotal,
        comissao: comissaoPct, comissaoR,
        precoFinal,
        margem: (valorTotal > 0 ? ((precoFinal - valorTotal) / valorTotal * 100) : 0),
        isManual: temManual
    };
}

/**
 * Catálogo de tipos de movimentação IMBEL — cor, ícone, rótulo e se o tipo
 * aumenta ou diminui o estoque (`categoria`). Usado por getImbelTipo/
 * imbelTipoAumentaEstoque/calcularSaldosImbel e por toda a UI da tela de
 * Movimentação IMBEL (badges, filtros). Extraído de app2.js (IMBEL_TIPOS) —
 * dado estático, sem acoplamento a DOM/estado.
 */
const IMBEL_TIPOS = {
    RECEBIMENTO_FABRICA: {
        label: 'Recebimento Fábrica', categoria: 'entrada', icon: '📦', cor: '#16a34a', bg: '#f0fdf4', contaReceita: false,
        descricao: 'Produto recebido da Fábrica de Itajubá'
    },
    RETORNO_MARKETING: {
        label: 'Retorno Promo', categoria: 'entrada', icon: '↩', cor: '#0284c7', bg: '#e0f2fe', contaReceita: false,
        descricao: 'Produto retornado de ação promocional'
    },
    AJUSTE_ENTRADA: {
        label: 'Ajuste de Inventário (+)', categoria: 'entrada', icon: '🔧', cor: '#64748b', bg: '#f8fafc', contaReceita: false,
        descricao: 'Correção de estoque — entrada'
    },
    VENDA: {
        label: 'Venda', categoria: 'saida', icon: '💰', cor: '#d97706', bg: '#fffbeb', contaReceita: true,
        descricao: 'Venda ao cliente final'
    },
    SAIDA_MARKETING: {
        label: 'Saída Promo', categoria: 'saida', icon: '↗', cor: '#7c3aed', bg: '#f3e8ff', contaReceita: false,
        descricao: 'Produto cedido para ação promocional ou evento'
    },
    DEVOLUCAO_FABRICA: {
        label: 'Devolução à Fábrica', categoria: 'saida', icon: '🔙', cor: '#dc2626', bg: '#fef2f2', contaReceita: false,
        descricao: 'Produto devolvido à Fábrica de Itajubá'
    },
    AJUSTE_SAIDA: {
        label: 'Ajuste de Inventário (-)', categoria: 'saida', icon: '🔧', cor: '#64748b', bg: '#f8fafc', contaReceita: false,
        descricao: 'Correção de estoque — saída'
    }
};

/**
 * Resolve o tipo de movimentação IMBEL pelo código (tenta o valor exato,
 * depois uma normalização — maiúsculas com "_" no lugar de espaço — antes de
 * cair num tipo genérico "saída"). Extraído de app2.js (getImbelTipo).
 */
function getImbelTipo(tipoKey) {
    return IMBEL_TIPOS[tipoKey]
        || IMBEL_TIPOS[(tipoKey || '').toString().toUpperCase().replace(/\s+/g, '_')]
        || { label: tipoKey, categoria: 'saida', icon: '•', cor: '#64748b', bg: '#f8fafc', contaReceita: false };
}

/**
 * true quando o tipo de movimentação aumenta o estoque (categoria "entrada").
 * Extraído de app2.js (imbelTipoAumentaEstoque).
 */
function imbelTipoAumentaEstoque(tipoKey) {
    try { return getImbelTipo(tipoKey).categoria === 'entrada'; } catch (e) { return false; }
}

/**
 * Saldo de cada produto IMBEL (inicial + entradas − saídas), a partir do
 * histórico de movimentações — a base de onde vem todo saldo exibido na tela
 * de Movimentação IMBEL. Núcleo puro de `calcularSaldosImbel` (app2.js): já
 * recebia `data` como parâmetro, sem ler estado global — só precisou mudar de
 * arquivo.
 * @param {object} data
 * @param {Array} data.produtos - cada um com {id, quantidadeInicial}
 * @param {Array} data.movimentacoes - cada uma com {id, tipo, produtoId?, quantidade?, items?}
 * @param {object} [opts]
 * @param {*} [opts.ignorarId] - ignora uma movimentação específica (usado ao editar: recalcula sem o registro antigo)
 * @returns {object} mapa produtoId -> {inicial, entradas, saidas, saidaByTipo, saldo}
 */
function calcularSaldosImbel(data, { ignorarId = null } = {}) {
    const saldos = {};
    (data.produtos || []).forEach(p => {
        const inicial = Number(p.quantidadeInicial) || 0;
        saldos[p.id] = { inicial, entradas: 0, saidas: 0, saidaByTipo: {} };
    });
    (data.movimentacoes || []).forEach(m => {
        if (ignorarId && m.id === ignorarId) return;
        const aumenta = imbelTipoAumentaEstoque(m.tipo);
        const subItens = (m.items && m.items.length)
            ? m.items.map(it => ({ produtoId: it.produtoId, quantidade: Number(it.quantidade) || 0 }))
            : (m.produtoId ? [{ produtoId: m.produtoId, quantidade: Number(m.quantidade) || 0 }] : []);
        subItens.forEach(({ produtoId, quantidade }) => {
            if (!saldos[produtoId]) return;
            if (aumenta) {
                saldos[produtoId].entradas += quantidade;
            } else {
                saldos[produtoId].saidas += quantidade;
                saldos[produtoId].saidaByTipo[m.tipo] = (saldos[produtoId].saidaByTipo[m.tipo] || 0) + quantidade;
            }
        });
    });
    Object.values(saldos).forEach(s => { s.saldo = s.inicial + s.entradas - s.saidas; });
    return saldos;
}

/**
 * Alíquota efetiva de um campo (icms/pis/cofins/ipi) considerando benefícios
 * fiscais por produto, na ordem: isenção total > RETID (zera só impostos
 * federais, não ICMS) > override explícito por produto > valor padrão.
 * Núcleo puro de `resolverAliquota` (app2.js) — os três mapas de estado
 * (beneficioFiscalAtivo/beneficiosPorProduto/retidPorProduto) são globais em
 * app2.js; aqui entram como parâmetros explícitos.
 * @param {object} ctx
 * @param {string} ctx.nomeProduto
 * @param {string} ctx.campo - 'icms' | 'pis' | 'cofins' | 'ipi'
 * @param {number} ctx.valorPadrao
 * @param {boolean} ctx.beneficioFiscalAtivo
 * @param {object} ctx.beneficiosPorProduto - nomeProduto -> {isentoTotal?, [campo]?: override}
 * @param {object} ctx.retidPorProduto - nomeProduto -> true quando RETID ativo
 * @returns {number}
 */
function resolverAliquotaComBeneficio(ctx) {
    const { nomeProduto, campo, valorPadrao, beneficioFiscalAtivo, beneficiosPorProduto, retidPorProduto } = ctx;
    try {
        if (beneficioFiscalAtivo && beneficiosPorProduto && beneficiosPorProduto[nomeProduto] && beneficiosPorProduto[nomeProduto].isentoTotal) return 0;
        if (retidPorProduto && retidPorProduto[nomeProduto] && campo !== 'icms') return 0;
        if (beneficioFiscalAtivo && beneficiosPorProduto && beneficiosPorProduto[nomeProduto]) {
            const override = beneficiosPorProduto[nomeProduto][campo];
            if (override !== null && override !== undefined && override !== '') return Number(override);
        }
    } catch (e) { /* qualquer erro cai no valorPadrao, mesmo comportamento do original */ }
    return Number(valorPadrao || 0);
}

const EstoqueCalculos = {
    calcularStatusCusto,
    parseCurrencyBRLToNumber,
    obterTotalVendasProduto,
    obterDistribuicaoTotalExcluindoImbel,
    calcularSaldoConsolidado,
    obterMetricasImbelProduto,
    calcularImbelDisponivel,
    resolverAliquotaICMS,
    calcularPrecoFinal,
    IMBEL_TIPOS,
    getImbelTipo,
    imbelTipoAumentaEstoque,
    calcularSaldosImbel,
    resolverAliquotaComBeneficio
};

if (typeof window !== 'undefined') {
    window.EstoqueCalculos = EstoqueCalculos;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EstoqueCalculos;
}

})();
