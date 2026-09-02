import { describe, it, expect } from 'vitest';
import EstoqueCalculos from '../estoque-calculos.js';

describe('EstoqueCalculos.calcularStatusCusto', () => {
  it('retorna "sem_custo" quando custoTotal é null, undefined ou 0', () => {
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: null })).toBe('sem_custo');
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: undefined })).toBe('sem_custo');
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: 0 })).toBe('sem_custo');
    expect(EstoqueCalculos.calcularStatusCusto({})).toBe('sem_custo');
    expect(EstoqueCalculos.calcularStatusCusto(null)).toBe('sem_custo');
  });

  it('retorna "sem_custo" para valores negativos ou não numéricos', () => {
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: -50 })).toBe('sem_custo');
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: 'abc' })).toBe('sem_custo');
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: NaN })).toBe('sem_custo');
  });

  it('retorna "ok" quando há custo cadastrado maior que zero', () => {
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: 150.5 })).toBe('ok');
    expect(EstoqueCalculos.calcularStatusCusto({ custoTotal: 0.01 })).toBe('ok');
  });
});

describe('EstoqueCalculos.parseCurrencyBRLToNumber', () => {
  it('converte formato pt-BR com milhar e centavos', () => {
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('1.234,56')).toBe(1234.56);
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('10.420,75')).toBe(10420.75);
  });

  it('aceita prefixo "R$" e espaços', () => {
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('R$ 1.234,56')).toBe(1234.56);
    expect(EstoqueCalculos.parseCurrencyBRLToNumber(' R$1.234,56 ')).toBe(1234.56);
  });

  it('aceita valor sem separador de milhar', () => {
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('360,00')).toBe(360);
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('5,5')).toBe(5.5);
  });

  it('retorna 0 para vazio, null, undefined ou lixo não numérico', () => {
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('')).toBe(0);
    expect(EstoqueCalculos.parseCurrencyBRLToNumber(null)).toBe(0);
    expect(EstoqueCalculos.parseCurrencyBRLToNumber(undefined)).toBe(0);
    expect(EstoqueCalculos.parseCurrencyBRLToNumber('abc')).toBe(0);
  });

  it('número inteiro já numérico passa direto (sem "." para confundir)', () => {
    expect(EstoqueCalculos.parseCurrencyBRLToNumber(1234)).toBe(1234);
  });

  // Comportamento preservado do original (app2.js): a função assume que toda
  // entrada é texto no formato pt-BR, onde "." é separador de milhar. Um
  // Number com casas decimais vira string com "." decimal (via String()) e
  // é interpretado como milhar — ex.: 1234.56 -> "1234.56" -> remove "." ->
  // 123456. Não é um bug introduzido pela extração; é a razão pela qual todo
  // chamador desta função no app já passa `input.value` (string do DOM).
  it('número não-inteiro é malinterpretado (ponto tratado como milhar) — comportamento pré-existente', () => {
    expect(EstoqueCalculos.parseCurrencyBRLToNumber(1234.56)).toBe(123456);
  });
});

describe('EstoqueCalculos.obterTotalVendasProduto', () => {
  const produto = { id: 1, nome: 'CARABINA IA2 5,56' };

  it('retorna 0 sem produto', () => {
    expect(EstoqueCalculos.obterTotalVendasProduto(null, [])).toBe(0);
  });

  it('soma vendas em formato legado (venda direta, sem items[])', () => {
    const registroVendas = [
      { produtoId: 1, quantidade: 3 },
      { produtoId: 1, quantidade: 2 },
      { produtoId: 99, quantidade: 100 } // outro produto, não deve contar
    ];
    expect(EstoqueCalculos.obterTotalVendasProduto(produto, registroVendas)).toBe(5);
  });

  it('soma vendas com items[] (venda com múltiplos produtos)', () => {
    const registroVendas = [
      { items: [{ produtoId: 1, quantidade: 4 }, { produtoId: 99, quantidade: 10 }] },
      { items: [{ produtoId: 1, quantidade: 1 }] }
    ];
    expect(EstoqueCalculos.obterTotalVendasProduto(produto, registroVendas)).toBe(5);
  });

  it('casa por nome quando produtoId não bate (produtoNome ou produto)', () => {
    const registroVendas = [
      { produtoId: 999, produtoNome: 'CARABINA IA2 5,56', quantidade: 2 },
      { items: [{ produto: 'CARABINA IA2 5,56', quantidade: 3 }] }
    ];
    expect(EstoqueCalculos.obterTotalVendasProduto(produto, registroVendas)).toBe(5);
  });

  it('cai para o agregado legado produto.vendas quando não há registros detalhados', () => {
    const p = { id: 1, nome: 'X', vendas: { KOLTE: 3, ISA: 2, IMBEL: 1 } };
    expect(EstoqueCalculos.obterTotalVendasProduto(p, [])).toBe(6);
    expect(EstoqueCalculos.obterTotalVendasProduto(p, undefined)).toBe(6);
  });

  it('registro detalhado presente mas de outro produto ainda cai no fallback', () => {
    const p = { id: 1, nome: 'X', vendas: { KOLTE: 3 } };
    const registroVendas = [{ produtoId: 999, quantidade: 100 }];
    expect(EstoqueCalculos.obterTotalVendasProduto(p, registroVendas)).toBe(3);
  });
});

describe('EstoqueCalculos.obterDistribuicaoTotalExcluindoImbel', () => {
  const produto = { id: 1, nome: 'PISTOLA .40 GC MD7' };

  it('retorna 0 sem produto', () => {
    expect(EstoqueCalculos.obterDistribuicaoTotalExcluindoImbel(null, [])).toBe(0);
  });

  it('soma distribuição excluindo o representante IMBEL', () => {
    const registroDistribuicao = [
      { produtoId: 1, representante: 'KOLTE', quantidade: 5 },
      { produtoId: 1, representante: 'imbel', quantidade: 999 }, // case-insensitive, deve ser excluído
      { produtoId: 1, representante: 'ISA', quantidade: 3 }
    ];
    expect(EstoqueCalculos.obterDistribuicaoTotalExcluindoImbel(produto, registroDistribuicao)).toBe(8);
  });

  it('cai para produto.distribuicao (legado) excluindo IMBEL quando não há registros', () => {
    const p = { id: 1, nome: 'X', distribuicao: { KOLTE: 4, IMBEL: 500, LC: 1 } };
    expect(EstoqueCalculos.obterDistribuicaoTotalExcluindoImbel(p, [])).toBe(5);
  });
});

describe('EstoqueCalculos.calcularSaldoConsolidado', () => {
  it('retorna 0 sem produto', () => {
    expect(EstoqueCalculos.calcularSaldoConsolidado(null, [])).toBe(0);
  });

  it('estoque consolidado menos total vendido', () => {
    const produto = { id: 1, nome: 'X', estoqueConsolidado: 100 };
    const registroVendas = [{ produtoId: 1, quantidade: 30 }];
    expect(EstoqueCalculos.calcularSaldoConsolidado(produto, registroVendas)).toBe(70);
  });

  it('pode ficar negativo (venda acima do estoque cadastrado)', () => {
    const produto = { id: 1, nome: 'X', estoqueConsolidado: 10 };
    const registroVendas = [{ produtoId: 1, quantidade: 15 }];
    expect(EstoqueCalculos.calcularSaldoConsolidado(produto, registroVendas)).toBe(-5);
  });
});

describe('EstoqueCalculos.obterMetricasImbelProduto', () => {
  const produto = { id: 1, nome: 'FUZIL X', estoqueConsolidado: 100 };

  it('retorna zeros sem produto', () => {
    expect(EstoqueCalculos.obterMetricasImbelProduto(null)).toEqual({
      estoqueTotal: 0, imbelDisp: 0, imbelVenda: 0, imbelSaldo: 0
    });
  });

  it('sem nenhum registro: tudo disponível na IMBEL, nada vendido', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto);
    expect(m.estoqueTotal).toBe(100);
    expect(m.imbelDisp).toBe(100);
    expect(m.imbelVenda).toBe(0);
    expect(m.imbelSaldo).toBe(100);
    expect(m.consolidadoDisp).toBe(100);
    expect(m.consolidadoVenda).toBe(0);
    expect(m.consolidadoSaldo).toBe(100);
  });

  it('distribuição reduz o disponível na IMBEL mas não o consolidado', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto, {
      registroDistribuicao: [{ produtoId: 1, representante: 'KOLTE', quantidade: 20 }]
    });
    expect(m.imbelDisp).toBe(80);   // 100 - 20
    expect(m.consolidadoDisp).toBe(100); // distribuição não afeta o consolidado
  });

  it('devolução para IMBEL soma de volta ao disponível na IMBEL', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto, {
      registroDistribuicao: [{ produtoId: 1, representante: 'KOLTE', quantidade: 20 }],
      registroDevolucoes: [{ produtoId: 1, destino: 'IMBEL', quantidade: 5 }]
    });
    expect(m.imbelDisp).toBe(85); // 100 - 20 + 5
  });

  it('devolução para outro destino (não IMBEL) não afeta o disponível na IMBEL', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto, {
      registroDevolucoes: [{ produtoId: 1, destino: 'KOLTE', quantidade: 5 }]
    });
    expect(m.imbelDisp).toBe(100);
  });

  it('só vendas atribuídas à IMBEL reduzem o saldo IMBEL; outras reduzem só o consolidado', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto, {
      registroVendas: [
        { produtoId: 1, representante: 'IMBEL', quantidade: 10 },
        { produtoId: 1, representante: 'KOLTE', quantidade: 7 }
      ]
    });
    expect(m.imbelVenda).toBe(10);
    expect(m.imbelSaldo).toBe(90);           // 100 - 10
    expect(m.consolidadoVenda).toBe(17);     // 10 + 7, todas as vendas contam no consolidado
    expect(m.consolidadoSaldo).toBe(83);     // 100 - 17
  });

  it('venda cancelada não conta em nenhum saldo', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto, {
      registroVendas: [{ produtoId: 1, representante: 'IMBEL', quantidade: 10, cancelado: true }]
    });
    expect(m.imbelVenda).toBe(0);
    expect(m.consolidadoVenda).toBe(0);
  });

  it('venda com items[] soma por item, casando por produtoId', () => {
    const m = EstoqueCalculos.obterMetricasImbelProduto(produto, {
      registroVendas: [{ representante: 'IMBEL', items: [{ produtoId: 1, quantidade: 6 }, { produtoId: 99, quantidade: 4 }] }]
    });
    expect(m.imbelVenda).toBe(6);
    expect(m.consolidadoVenda).toBe(6);
  });
});

describe('EstoqueCalculos.calcularImbelDisponivel', () => {
  it('retorna 0 sem produto', () => {
    expect(EstoqueCalculos.calcularImbelDisponivel(null)).toBe(0);
  });

  it('coincide com imbelSaldo de obterMetricasImbelProduto', () => {
    const produto = { id: 1, nome: 'X', estoqueConsolidado: 50 };
    const registros = { registroVendas: [{ produtoId: 1, representante: 'IMBEL', quantidade: 20 }] };
    expect(EstoqueCalculos.calcularImbelDisponivel(produto, registros)).toBe(30);
    expect(EstoqueCalculos.calcularImbelDisponivel(produto, registros))
      .toBe(EstoqueCalculos.obterMetricasImbelProduto(produto, registros).imbelSaldo);
  });
});

describe('EstoqueCalculos.resolverAliquotaICMS', () => {
  it('prioriza a tabela predefinida por NCM quando o estado está nela', () => {
    const aliquota = EstoqueCalculos.resolverAliquotaICMS({
      estado: 'SP', tipoPessoa: 'PJ', ncm: '9301.90.00', categoria: 'Armas',
      icmsPjPorNcm: { '9301.90.00': { SP: 18, RJ: 20 } },
      tabelaICMS: [{ ncm: 'Todos', estado: 'Todos', tipoPessoa: 'Todos', categoriaProduto: 'Todos', aliquota: 99 }],
      icmsBaseFallback: 5
    });
    expect(aliquota).toBe(18);
  });

  it('usa a tabela PF quando tipoPessoa é PF', () => {
    const aliquota = EstoqueCalculos.resolverAliquotaICMS({
      estado: 'SP', tipoPessoa: 'PF', ncm: '9301.90.00',
      icmsPjPorNcm: { '9301.90.00': { SP: 18 } },
      icmsPfPorNcm: { '9301.90.00': { SP: 12 } }
    });
    expect(aliquota).toBe(12);
  });

  it('sem match na tabela NCM, escolhe a regra do usuário mais específica (maior score)', () => {
    const tabelaICMS = [
      { ncm: 'Todos', estado: 'Todos', tipoPessoa: 'Todos', categoriaProduto: 'Todos', aliquota: 10 },
      { ncm: 'Todos', estado: 'SP', tipoPessoa: 'Todos', categoriaProduto: 'Todos', aliquota: 15 },
      { ncm: 'Todos', estado: 'SP', tipoPessoa: 'PJ', categoriaProduto: 'Armas', aliquota: 20 }
    ];
    const aliquota = EstoqueCalculos.resolverAliquotaICMS({
      estado: 'SP', tipoPessoa: 'PJ', ncm: null, categoria: 'Armas', tabelaICMS
    });
    expect(aliquota).toBe(20); // regra mais específica (estado+tipo+categoria) vence
  });

  it('regra com critério específico que não bate é descartada, mesmo com outros critérios batendo', () => {
    const tabelaICMS = [
      { ncm: 'Todos', estado: 'RJ', tipoPessoa: 'Todos', categoriaProduto: 'Todos', aliquota: 99 }, // estado não bate
      { ncm: 'Todos', estado: 'Todos', tipoPessoa: 'Todos', categoriaProduto: 'Todos', aliquota: 7 }
    ];
    const aliquota = EstoqueCalculos.resolverAliquotaICMS({
      estado: 'SP', tipoPessoa: 'PJ', ncm: null, categoria: 'Armas', tabelaICMS
    });
    expect(aliquota).toBe(7);
  });

  it('sem nenhum match, cai no fallback icmsBase do produto', () => {
    const aliquota = EstoqueCalculos.resolverAliquotaICMS({
      estado: 'SP', tipoPessoa: 'PJ', ncm: null, categoria: 'Armas',
      tabelaICMS: [{ ncm: 'Todos', estado: 'RJ', tipoPessoa: 'Todos', categoriaProduto: 'Todos', aliquota: 99 }],
      icmsBaseFallback: 4.5
    });
    expect(aliquota).toBe(4.5);
  });

  it('sem nenhuma regra e sem fallback informado, retorna 0', () => {
    expect(EstoqueCalculos.resolverAliquotaICMS({ estado: 'SP', tipoPessoa: 'PJ', ncm: null, categoria: 'Armas' })).toBe(0);
  });
});

describe('EstoqueCalculos.calcularPrecoFinal', () => {
  it('retorna null quando ci é 0 ou ausente (sem custo, preço não calculável)', () => {
    expect(EstoqueCalculos.calcularPrecoFinal({ ci: 0 })).toBeNull();
    expect(EstoqueCalculos.calcularPrecoFinal({})).toBeNull();
  });

  it('calcula a sequência valorBase -> impostos -> IPI -> precoFinal (caso de referência)', () => {
    // ci=1000, taxa=10%, roi=20% -> valorBase = 1000*(1+0.10+0.20) = 1300
    // icms 18% + pis 1.65% + cofins 7.6% sobre 1300
    const r = EstoqueCalculos.calcularPrecoFinal({
      ci: 1000, taxaPct: 10, roiPct: 20, comissaoPct: 5,
      pisPct: 1.65, cofinsPct: 7.6, ipiPct: 3.25, icmsPct: 18
    });
    expect(r.valorBase).toBeCloseTo(1300, 6);
    expect(r.icmsR).toBeCloseTo(1300 * 0.18, 6);
    expect(r.pisR).toBeCloseTo(1300 * 0.0165, 6);
    expect(r.cofinsR).toBeCloseTo(1300 * 0.076, 6);
    const valorImpostosEsperado = 1300 + r.icmsR + r.pisR + r.cofinsR;
    expect(r.valorImpostos).toBeCloseTo(valorImpostosEsperado, 6);
    expect(r.ipiR).toBeCloseTo(valorImpostosEsperado * 0.0325, 6);
    expect(r.valorTotal).toBeCloseTo(valorImpostosEsperado + r.ipiR, 6);
    expect(r.precoFinal).toBeCloseTo(valorImpostosEsperado + r.ipiR, 6);
    expect(r.isManual).toBe(false);
  });

  it('comissão é calculada mas não soma ao preço final', () => {
    const semComissao = EstoqueCalculos.calcularPrecoFinal({ ci: 100, taxaPct: 0, roiPct: 0, comissaoPct: 0, icmsPct: 0 });
    const comComissaoAlta = EstoqueCalculos.calcularPrecoFinal({ ci: 100, taxaPct: 0, roiPct: 0, comissaoPct: 50, icmsPct: 0 });
    expect(comComissaoAlta.precoFinal).toBeCloseTo(semComissao.precoFinal, 6);
    expect(comComissaoAlta.comissaoR).toBeGreaterThan(0);
  });

  it('override manual substitui o precoFinal calculado e marca isManual', () => {
    const r = EstoqueCalculos.calcularPrecoFinal({
      ci: 100, taxaPct: 10, roiPct: 10, icmsPct: 0, precoFinalManual: 250
    });
    expect(r.precoFinal).toBe(250);
    expect(r.isManual).toBe(true);
    // margem recalculada em cima do valorTotal automático, não do manual
    expect(r.margem).toBeCloseTo((250 - r.valorTotal) / r.valorTotal * 100, 6);
  });

  it('sem impostos e sem taxa/roi, precoFinal = ci', () => {
    const r = EstoqueCalculos.calcularPrecoFinal({ ci: 500 });
    expect(r.valorBase).toBe(500);
    expect(r.precoFinal).toBe(500);
    expect(r.margem).toBe(0);
  });

  it('margem é 0 quando valorTotal é 0 (evita divisão por zero)', () => {
    // ci !== 0 é obrigatório para não retornar null, mas o restante pode compor valorTotal 0
    // só é fisicamente possível com ci negativo cancelando os fatores; validamos a guarda diretamente:
    const r = EstoqueCalculos.calcularPrecoFinal({ ci: 100, taxaPct: -100, roiPct: 0, icmsPct: 0 });
    expect(r.valorTotal).toBeCloseTo(0, 6);
    expect(r.margem).toBe(0);
  });
});

describe('EstoqueCalculos.calcularItemPrecificacaoCliente', () => {
  it('retorna null quando ci é 0 ou ausente (sem CI, preço não calculável)', () => {
    expect(EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 0 })).toBeNull();
    expect(EstoqueCalculos.calcularItemPrecificacaoCliente({})).toBeNull();
  });

  it('calcula a sequência valorBase -> impostos -> IPI -> comissão -> precoFinal (caso de referência)', () => {
    // ci=1000, taxa=20%, roi=30% -> valorBase = 1000*(1+0.20+0.30) = 1500
    const r = EstoqueCalculos.calcularItemPrecificacaoCliente({
      ci: 1000, taxaPct: 20, roiPct: 30, comissaoPct: 5,
      pisPct: 1.65, cofinsPct: 7.6, ipiPct: 0, icmsPct: 18,
      quantidade: 2
    });
    expect(r.valorBase).toBeCloseTo(1500, 6);
    expect(r.icmsR).toBeCloseTo(1500 * 0.18, 6);
    expect(r.pisR).toBeCloseTo(1500 * 0.0165, 6);
    expect(r.cofinsR).toBeCloseTo(1500 * 0.076, 6);
    const valorImpostosEsperado = 1500 + r.icmsR + r.pisR + r.cofinsR;
    expect(r.valorImpostos).toBeCloseTo(valorImpostosEsperado, 6);
    expect(r.ipiR).toBeCloseTo(0, 6); // ipiPct 0
    expect(r.comissaoR).toBeCloseTo(valorImpostosEsperado * 0.05, 6);
    const precoFinalEsperado = valorImpostosEsperado + r.ipiR + r.comissaoR;
    expect(r.precoFinal).toBeCloseTo(precoFinalEsperado, 6);
  });

  it('diferente de calcularPrecoFinal: a comissão ENTRA no preço final', () => {
    const semComissao = EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 100, taxaPct: 0, roiPct: 0, comissaoPct: 0, icmsPct: 0 });
    const comComissaoAlta = EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 100, taxaPct: 0, roiPct: 0, comissaoPct: 50, icmsPct: 0 });
    expect(comComissaoAlta.precoFinal).toBeGreaterThan(semComissao.precoFinal);
    expect(comComissaoAlta.comissaoR).toBeGreaterThan(0);
  });

  it('subtotalProduto = precoFinal (=valorFinal, sem IPI aqui) × quantidade, sem frete', () => {
    const r = EstoqueCalculos.calcularItemPrecificacaoCliente({
      ci: 100, taxaPct: 0, roiPct: 0, comissaoPct: 0, icmsPct: 0, quantidade: 3
    });
    expect(r.valorFinal).toBeCloseTo(100, 6);
    expect(r.subtotalProduto).toBeCloseTo(300, 6);
  });

  it('quantidade ausente, zero ou negativa cai para 1', () => {
    const base = { ci: 100, taxaPct: 0, roiPct: 0, comissaoPct: 0, icmsPct: 0 };
    expect(EstoqueCalculos.calcularItemPrecificacaoCliente(base).quantidade).toBe(1);
    expect(EstoqueCalculos.calcularItemPrecificacaoCliente({ ...base, quantidade: 0 }).quantidade).toBe(1);
    expect(EstoqueCalculos.calcularItemPrecificacaoCliente({ ...base, quantidade: -5 }).quantidade).toBe(1);
  });

  it('margem = (precoFinal - ci) / precoFinal — lucro sobre o preço, não sobre o custo', () => {
    const r = EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 1000, taxaPct: 20, roiPct: 30, comissaoPct: 5, pisPct: 1.65, cofinsPct: 7.6, icmsPct: 18 });
    expect(r.margem).toBeCloseTo((r.precoFinal - 1000) / r.precoFinal * 100, 6);
  });

  it('abaixoDaMinima só acusa quando margemMinima é informada e a margem real fica abaixo dela', () => {
    const semMinima = EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 1000, taxaPct: 20, roiPct: 30, comissaoPct: 5, pisPct: 1.65, cofinsPct: 7.6, icmsPct: 18, margemMinima: null });
    expect(semMinima.abaixoDaMinima).toBe(false);

    const acimaDaMinima = EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 1000, taxaPct: 20, roiPct: 30, comissaoPct: 5, pisPct: 1.65, cofinsPct: 7.6, icmsPct: 18, margemMinima: 10 });
    expect(acimaDaMinima.abaixoDaMinima).toBe(false);

    const abaixoDaMinima = EstoqueCalculos.calcularItemPrecificacaoCliente({ ci: 1000, taxaPct: 20, roiPct: 30, comissaoPct: 5, pisPct: 1.65, cofinsPct: 7.6, icmsPct: 18, margemMinima: 90 });
    expect(abaixoDaMinima.abaixoDaMinima).toBe(true);
  });
});

// Regressão do bug do frete proporcional: o rateio lia CI/Taxa/ROI/Comissão só
// do catálogo, nunca da linha individual — um item com CI só na linha
// contribuía 0 pro rateio, e com todos os itens nessa situação o frete
// rateado saía ~100× maior. As duas funções abaixo são a prioridade de
// resolução (linha > catálogo > padrão) extraída do rateio corrigido em
// app2.js — testam exatamente a causa do bug, sem precisar de DOM/jsdom.
describe('EstoqueCalculos.resolverCIComPrioridade', () => {
  it('usa o CI da linha quando ele é um número válido maior que zero', () => {
    expect(EstoqueCalculos.resolverCIComPrioridade(1500, 999)).toBe(1500);
    expect(EstoqueCalculos.resolverCIComPrioridade(1500, null)).toBe(1500);
  });

  it('cai pro CI do catálogo quando a linha não tem CI válido (NaN, 0 ou negativo)', () => {
    expect(EstoqueCalculos.resolverCIComPrioridade(NaN, 800)).toBe(800);
    expect(EstoqueCalculos.resolverCIComPrioridade(0, 800)).toBe(800);
    expect(EstoqueCalculos.resolverCIComPrioridade(-10, 800)).toBe(800);
  });

  it('devolve 0 quando nem linha nem catálogo têm CI válido — é o caso que causava o bug', () => {
    expect(EstoqueCalculos.resolverCIComPrioridade(NaN, null)).toBe(0);
    expect(EstoqueCalculos.resolverCIComPrioridade(NaN, undefined)).toBe(0);
    expect(EstoqueCalculos.resolverCIComPrioridade(0, 0)).toBe(0);
  });

  it('aceita CI do catálogo como string BRL crua (parseFloat, não parser BRL)', () => {
    // O chamador em app2.js já resolve a string BRL antes de chegar aqui pro
    // caso da linha; o valor de catálogo aqui é o número já salvo, não texto
    // "1.500,00" — parseFloat('1500') funciona, parseFloat('1.500,00') não
    // (é justamente por isso que o CI da linha precisa vir pré-convertido).
    expect(EstoqueCalculos.resolverCIComPrioridade(NaN, '1500')).toBe(1500);
  });
});

describe('EstoqueCalculos.resolverPercentualComPrioridade', () => {
  it('usa o valor da linha quando é um número válido — inclusive 0', () => {
    expect(EstoqueCalculos.resolverPercentualComPrioridade(15, 999, 20)).toBe(15);
    expect(EstoqueCalculos.resolverPercentualComPrioridade(0, 999, 20)).toBe(0);
  });

  it('cai pro catálogo quando a linha é NaN e o catálogo está explicitamente definido', () => {
    expect(EstoqueCalculos.resolverPercentualComPrioridade(NaN, 12, 20)).toBe(12);
    expect(EstoqueCalculos.resolverPercentualComPrioridade(NaN, 0, 20)).toBe(0); // 0 é um valor explícito válido
  });

  it('cai pro padrão quando nem linha nem catálogo têm valor (catálogo null/undefined/vazio)', () => {
    expect(EstoqueCalculos.resolverPercentualComPrioridade(NaN, null, 20)).toBe(20);
    expect(EstoqueCalculos.resolverPercentualComPrioridade(NaN, undefined, 20)).toBe(20);
    expect(EstoqueCalculos.resolverPercentualComPrioridade(NaN, '', 20)).toBe(20);
  });
});

describe('EstoqueCalculos.getImbelTipo / imbelTipoAumentaEstoque', () => {
  it('resolve um tipo conhecido pelo código exato', () => {
    const t = EstoqueCalculos.getImbelTipo('VENDA');
    expect(t.label).toBe('Venda');
    expect(t.categoria).toBe('saida');
    expect(t.contaReceita).toBe(true);
  });

  it('normaliza espaço/minúsculas antes de cair no genérico (compat com dados legados)', () => {
    const t = EstoqueCalculos.getImbelTipo('recebimento_fabrica');
    expect(t.label).toBe('Recebimento Fábrica');
  });

  it('tipo desconhecido cai no genérico "saída", preservando o código como label', () => {
    const t = EstoqueCalculos.getImbelTipo('TIPO_INEXISTENTE');
    expect(t.categoria).toBe('saida');
    expect(t.label).toBe('TIPO_INEXISTENTE');
  });

  it('tipos de entrada aumentam estoque; tipos de saída não', () => {
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('RECEBIMENTO_FABRICA')).toBe(true);
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('RETORNO_MARKETING')).toBe(true);
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('AJUSTE_ENTRADA')).toBe(true);
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('VENDA')).toBe(false);
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('SAIDA_MARKETING')).toBe(false);
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('DEVOLUCAO_FABRICA')).toBe(false);
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('AJUSTE_SAIDA')).toBe(false);
  });

  it('tipo desconhecido não aumenta estoque (fallback seguro para "saida")', () => {
    expect(EstoqueCalculos.imbelTipoAumentaEstoque('XYZ')).toBe(false);
  });
});

describe('EstoqueCalculos.calcularSaldosImbel', () => {
  it('sem movimentações, saldo = quantidade inicial', () => {
    const data = { produtos: [{ id: 1, quantidadeInicial: 50 }], movimentacoes: [] };
    const s = EstoqueCalculos.calcularSaldosImbel(data);
    expect(s[1]).toEqual({ inicial: 50, entradas: 0, saidas: 0, saidaByTipo: {}, saldo: 50 });
  });

  it('entrada soma, saída subtrai — saldo = inicial + entradas - saidas', () => {
    const data = {
      produtos: [{ id: 1, quantidadeInicial: 100 }],
      movimentacoes: [
        { id: 'a', tipo: 'RECEBIMENTO_FABRICA', produtoId: 1, quantidade: 20 },
        { id: 'b', tipo: 'VENDA', produtoId: 1, quantidade: 30 }
      ]
    };
    const s = EstoqueCalculos.calcularSaldosImbel(data);
    expect(s[1].entradas).toBe(20);
    expect(s[1].saidas).toBe(30);
    expect(s[1].saldo).toBe(90); // 100 + 20 - 30
  });

  it('agrupa saídas por tipo em saidaByTipo', () => {
    const data = {
      produtos: [{ id: 1, quantidadeInicial: 0 }],
      movimentacoes: [
        { id: 'a', tipo: 'VENDA', produtoId: 1, quantidade: 5 },
        { id: 'b', tipo: 'VENDA', produtoId: 1, quantidade: 3 },
        { id: 'c', tipo: 'SAIDA_MARKETING', produtoId: 1, quantidade: 2 }
      ]
    };
    const s = EstoqueCalculos.calcularSaldosImbel(data);
    expect(s[1].saidaByTipo).toEqual({ VENDA: 8, SAIDA_MARKETING: 2 });
  });

  it('movimentação com items[] distribui a quantidade por produto', () => {
    const data = {
      produtos: [{ id: 1, quantidadeInicial: 0 }, { id: 2, quantidadeInicial: 0 }],
      movimentacoes: [
        { id: 'a', tipo: 'VENDA', items: [{ produtoId: 1, quantidade: 4 }, { produtoId: 2, quantidade: 6 }] }
      ]
    };
    const s = EstoqueCalculos.calcularSaldosImbel(data);
    expect(s[1].saidas).toBe(4);
    expect(s[2].saidas).toBe(6);
  });

  it('ignora movimentação de produto não cadastrado (sem entrada correspondente em saldos)', () => {
    const data = {
      produtos: [{ id: 1, quantidadeInicial: 10 }],
      movimentacoes: [{ id: 'a', tipo: 'VENDA', produtoId: 999, quantidade: 5 }]
    };
    const s = EstoqueCalculos.calcularSaldosImbel(data);
    expect(s[1].saldo).toBe(10);
    expect(s[999]).toBeUndefined();
  });

  it('ignorarId exclui uma movimentação específica do cálculo (usado ao editar)', () => {
    const data = {
      produtos: [{ id: 1, quantidadeInicial: 0 }],
      movimentacoes: [
        { id: 'a', tipo: 'VENDA', produtoId: 1, quantidade: 5 },
        { id: 'b', tipo: 'VENDA', produtoId: 1, quantidade: 3 }
      ]
    };
    const semIgnorar = EstoqueCalculos.calcularSaldosImbel(data);
    const comIgnorar = EstoqueCalculos.calcularSaldosImbel(data, { ignorarId: 'b' });
    expect(semIgnorar[1].saidas).toBe(8);
    expect(comIgnorar[1].saidas).toBe(5);
  });
});

describe('EstoqueCalculos.resolverAliquotaComBeneficio', () => {
  const base = { nomeProduto: 'CARABINA IA2', campo: 'icms', valorPadrao: 18 };

  it('sem benefício ativo e sem RETID, retorna o valor padrão', () => {
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({
      ...base, beneficioFiscalAtivo: false, beneficiosPorProduto: {}, retidPorProduto: {}
    })).toBe(18);
  });

  it('isentoTotal zera a alíquota, independente do campo', () => {
    const ctx = {
      ...base, beneficioFiscalAtivo: true,
      beneficiosPorProduto: { 'CARABINA IA2': { isentoTotal: true } },
      retidPorProduto: {}
    };
    expect(EstoqueCalculos.resolverAliquotaComBeneficio(ctx)).toBe(0);
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({ ...ctx, campo: 'pis' })).toBe(0);
  });

  it('RETID zera impostos federais (pis/cofins/ipi) mas não ICMS', () => {
    const ctx = {
      nomeProduto: 'CARABINA IA2', valorPadrao: 18, beneficioFiscalAtivo: false,
      beneficiosPorProduto: {}, retidPorProduto: { 'CARABINA IA2': true }
    };
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({ ...ctx, campo: 'pis' })).toBe(0);
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({ ...ctx, campo: 'cofins' })).toBe(0);
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({ ...ctx, campo: 'ipi' })).toBe(0);
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({ ...ctx, campo: 'icms' })).toBe(18); // ICMS não é zerado por RETID
  });

  it('override explícito por produto substitui o valor padrão quando benefício está ativo', () => {
    const ctx = {
      ...base, beneficioFiscalAtivo: true,
      beneficiosPorProduto: { 'CARABINA IA2': { icms: 7 } },
      retidPorProduto: {}
    };
    expect(EstoqueCalculos.resolverAliquotaComBeneficio(ctx)).toBe(7);
  });

  it('override não se aplica quando beneficioFiscalAtivo é false, mesmo com o mapa preenchido', () => {
    const ctx = {
      ...base, beneficioFiscalAtivo: false,
      beneficiosPorProduto: { 'CARABINA IA2': { icms: 7 } },
      retidPorProduto: {}
    };
    expect(EstoqueCalculos.resolverAliquotaComBeneficio(ctx)).toBe(18);
  });

  it('override 0 é respeitado (não confundido com "sem override")', () => {
    const ctx = {
      ...base, beneficioFiscalAtivo: true,
      beneficiosPorProduto: { 'CARABINA IA2': { icms: 0 } },
      retidPorProduto: {}
    };
    expect(EstoqueCalculos.resolverAliquotaComBeneficio(ctx)).toBe(0);
  });

  it('produto sem entrada em beneficiosPorProduto/retidPorProduto usa o valor padrão', () => {
    expect(EstoqueCalculos.resolverAliquotaComBeneficio({
      ...base, beneficioFiscalAtivo: true, beneficiosPorProduto: {}, retidPorProduto: {}
    })).toBe(18);
  });
});
