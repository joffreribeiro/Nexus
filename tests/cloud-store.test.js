import { describe, it, expect } from 'vitest';
import CloudStore from '../cloud-store.js';

describe('CloudStore.dividirEstoqueEmModulos', () => {
  it('separa crm e ponto do restante do estoque', () => {
    const estoque = {
      produtos: [{ id: 1, nome: 'X' }],
      registroVendas: [{ id: 'v1' }],
      crm: { negocios: [{ id: 'n1' }] },
      ponto: { registros: [{ data: '2026-01-01' }] }
    };
    const { estoqueCore, crm, ponto } = CloudStore.dividirEstoqueEmModulos(estoque);
    expect(estoqueCore.produtos).toEqual([{ id: 1, nome: 'X' }]);
    expect(estoqueCore.registroVendas).toEqual([{ id: 'v1' }]);
    expect(estoqueCore.crm).toBeUndefined();
    expect(estoqueCore.ponto).toBeUndefined();
    expect(crm).toEqual({ negocios: [{ id: 'n1' }] });
    expect(ponto).toEqual({ registros: [{ data: '2026-01-01' }] });
  });

  it('crm/ponto ausentes viram null (não quebra em estoque sem esses módulos ainda)', () => {
    const { crm, ponto } = CloudStore.dividirEstoqueEmModulos({ produtos: [] });
    expect(crm).toBeNull();
    expect(ponto).toBeNull();
  });

  it('estoque nulo ou não-objeto retorna estrutura vazia segura', () => {
    expect(CloudStore.dividirEstoqueEmModulos(null)).toEqual({ estoqueCore: {}, crm: null, ponto: null });
    expect(CloudStore.dividirEstoqueEmModulos(undefined)).toEqual({ estoqueCore: {}, crm: null, ponto: null });
  });

  it('não muta o objeto estoque original', () => {
    const estoque = { produtos: [], crm: { a: 1 }, ponto: { b: 2 } };
    const copia = JSON.parse(JSON.stringify(estoque));
    CloudStore.dividirEstoqueEmModulos(estoque);
    expect(estoque).toEqual(copia);
  });
});

describe('CloudStore.remontarEstoqueAPartirDeModulos', () => {
  it('reconstrói o estoque completo a partir dos três módulos', () => {
    const modulos = {
      estoqueCore: { produtos: [{ id: 1 }], registroVendas: [] },
      crm: { negocios: [{ id: 'n1' }] },
      ponto: { registros: [{ data: '2026-01-01' }] }
    };
    const estoque = CloudStore.remontarEstoqueAPartirDeModulos(modulos);
    expect(estoque.produtos).toEqual([{ id: 1 }]);
    expect(estoque.crm).toEqual({ negocios: [{ id: 'n1' }] });
    expect(estoque.ponto).toEqual({ registros: [{ data: '2026-01-01' }] });
  });

  it('crm/ponto null (documento ainda não existe) não vira chave no estoque remontado', () => {
    const estoque = CloudStore.remontarEstoqueAPartirDeModulos({
      estoqueCore: { produtos: [] }, crm: null, ponto: null
    });
    expect('crm' in estoque).toBe(false);
    expect('ponto' in estoque).toBe(false);
  });

  it('modulos ausente ou parcial não lança — retorna o que der pra montar', () => {
    expect(CloudStore.remontarEstoqueAPartirDeModulos(undefined)).toEqual({});
    expect(CloudStore.remontarEstoqueAPartirDeModulos({})).toEqual({});
  });

  it('round-trip: dividir seguido de remontar reproduz o estoque original (ida e volta sem perda)', () => {
    const original = {
      produtos: [{ id: 1, nome: 'CARABINA' }],
      registroVendas: [{ id: 'v1', valorTotal: 500 }],
      clientes: [{ id: 'c1', nome: 'Cliente X' }],
      crm: { negocios: [{ id: 'n1', titulo: 'Negócio' }], funis: [] },
      ponto: { registros: [{ data: '2026-01-01', entrada: '08:00' }], acordos: [] }
    };
    const modulos = CloudStore.dividirEstoqueEmModulos(original);
    const reconstruido = CloudStore.remontarEstoqueAPartirDeModulos(modulos);
    expect(reconstruido).toEqual(original);
  });
});
