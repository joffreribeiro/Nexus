import { describe, it, expect } from 'vitest';
import FluxoNavCalculos from '../fluxo-nav-calculos.js';

describe('FluxoNavCalculos.contarPrecificacoesSemProposta', () => {
  it('conta só precificações ativas sem propostaId', () => {
    const lista = [
      { status: 'ativa', propostaId: null },
      { status: 'ativa', propostaId: undefined },
      { status: 'ativa', propostaId: 'p1' },
      { status: 'arquivada', propostaId: null },
    ];
    expect(FluxoNavCalculos.contarPrecificacoesSemProposta(lista)).toBe(2);
  });

  it('retorna 0 para lista vazia ou entrada inválida', () => {
    expect(FluxoNavCalculos.contarPrecificacoesSemProposta([])).toBe(0);
    expect(FluxoNavCalculos.contarPrecificacoesSemProposta(null)).toBe(0);
    expect(FluxoNavCalculos.contarPrecificacoesSemProposta(undefined)).toBe(0);
  });

  it('ignora entradas nulas dentro da lista', () => {
    expect(FluxoNavCalculos.contarPrecificacoesSemProposta([null, { status: 'ativa', propostaId: null }])).toBe(1);
  });
});

describe('FluxoNavCalculos.contarPropostasAceitasSemVenda', () => {
  it('conta só propostas aceitas sem vendaId', () => {
    const lista = [
      { status: 'aceita', vendaId: null },
      { status: 'aceita', vendaId: 123 },
      { status: 'rascunho', vendaId: null },
      { status: 'aceita', vendaId: undefined },
    ];
    expect(FluxoNavCalculos.contarPropostasAceitasSemVenda(lista)).toBe(2);
  });

  it('retorna 0 para lista vazia ou entrada inválida', () => {
    expect(FluxoNavCalculos.contarPropostasAceitasSemVenda([])).toBe(0);
    expect(FluxoNavCalculos.contarPropostasAceitasSemVenda(null)).toBe(0);
  });
});
