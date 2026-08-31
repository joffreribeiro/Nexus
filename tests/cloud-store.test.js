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

  it('crm/ponto/auditoria ausentes viram null (não quebra em estoque sem esses módulos ainda)', () => {
    const { crm, ponto, auditoria } = CloudStore.dividirEstoqueEmModulos({ produtos: [] });
    expect(crm).toBeNull();
    expect(ponto).toBeNull();
    expect(auditoria).toBeNull();
  });

  it('auditoriaVendas sai do estoqueCore e vira o envelope { registros } (array não pode ser raiz de documento)', () => {
    const { estoqueCore, auditoria } = CloudStore.dividirEstoqueEmModulos({
      produtos: [{ id: 1 }],
      auditoriaVendas: [{ id: 'a1', acao: 'EDIÇÃO' }]
    });
    expect(estoqueCore.auditoriaVendas).toBeUndefined();
    expect(auditoria).toEqual({ registros: [{ id: 'a1', acao: 'EDIÇÃO' }] });
  });

  it('estoque nulo ou não-objeto retorna estrutura vazia segura', () => {
    const vazio = { estoqueCore: {}, crm: null, ponto: null, auditoria: null };
    expect(CloudStore.dividirEstoqueEmModulos(null)).toEqual(vazio);
    expect(CloudStore.dividirEstoqueEmModulos(undefined)).toEqual(vazio);
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
      estoqueCore: { produtos: [] }, crm: null, ponto: null, auditoria: null
    });
    expect('crm' in estoque).toBe(false);
    expect('ponto' in estoque).toBe(false);
    expect('auditoriaVendas' in estoque).toBe(false);
  });

  it('auditoria volta do envelope para estoque.auditoriaVendas', () => {
    const estoque = CloudStore.remontarEstoqueAPartirDeModulos({
      estoqueCore: { produtos: [] },
      auditoria: { registros: [{ id: 'a1' }] }
    });
    expect(estoque.auditoriaVendas).toEqual([{ id: 'a1' }]);
  });

  it('auditoria dentro do estoqueCore vence a do documento próprio (versão antiga gravou depois)', () => {
    const estoque = CloudStore.remontarEstoqueAPartirDeModulos({
      estoqueCore: { produtos: [], auditoriaVendas: [{ id: 'gravado-pela-versao-antiga' }] },
      auditoria: { registros: [{ id: 'obsoleto' }] }
    });
    expect(estoque.auditoriaVendas).toEqual([{ id: 'gravado-pela-versao-antiga' }]);
  });

  it('base gravada antes da separação mantém a auditoria que veio dentro do estoqueCore', () => {
    const estoque = CloudStore.remontarEstoqueAPartirDeModulos({
      estoqueCore: { produtos: [], auditoriaVendas: [{ id: 'antigo' }] },
      auditoria: null
    });
    expect(estoque.auditoriaVendas).toEqual([{ id: 'antigo' }]);
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
      ponto: { registros: [{ data: '2026-01-01', entrada: '08:00' }], acordos: [] },
      auditoriaVendas: [{ id: 'a1', acao: 'EDIÇÃO', contrato: '123' }]
    };
    const modulos = CloudStore.dividirEstoqueEmModulos(original);
    const reconstruido = CloudStore.remontarEstoqueAPartirDeModulos(modulos);
    expect(reconstruido).toEqual(original);
  });
});

describe('CloudStore.verificarTamanhoDosModulos (teto de 1 MiB por documento)', () => {
  it('mede cada módulo separadamente, não o estoque inteiro somado', () => {
    const tamanhos = CloudStore.tamanhosDosModulos({
      observacoes: 'x'.repeat(1000),
      crm: { historico: 'y'.repeat(5000) },
      ponto: { registros: [] }
    });
    expect(tamanhos.estoque).toBeGreaterThan(1000);
    expect(tamanhos.estoque).toBeLessThan(2000);
    expect(tamanhos.crm).toBeGreaterThan(5000);
    expect(tamanhos.ponto).toBeLessThan(100);
    expect(tamanhos.auditoria).toBeLessThan(100);
  });

  it('estoque dentro do limite passa sem lançar', () => {
    expect(() => CloudStore.verificarTamanhoDosModulos({ produtos: [{ id: 1 }] })).not.toThrow();
  });

  it('auditoria grande não conta mais para o documento estoque', () => {
    const tamanhos = CloudStore.tamanhosDosModulos({
      produtos: [{ id: 1 }],
      auditoriaVendas: [{ detalhes: 'z'.repeat(400 * 1024) }]
    });
    expect(tamanhos.estoque).toBeLessThan(1024);
    expect(tamanhos.auditoria).toBeGreaterThan(400 * 1024);
  });

  it('módulo acima de 1 MiB lança apontando qual documento estourou', () => {
    expect(() => CloudStore.verificarTamanhoDosModulos({
      crm: { historico: 'x'.repeat(CloudStore.LIMITE_DOC_BYTES + 1000) }
    })).toThrow(/app_data\/crm/);
  });

  it('soma acima de 1 MiB distribuída entre módulos não lança (era o caso que quebrava o legado)', () => {
    const meio = 'x'.repeat(700 * 1024);
    expect(() => CloudStore.verificarTamanhoDosModulos({
      observacoes: meio,
      crm: { historico: meio }
    })).not.toThrow();
  });

  it('updatedAt (sentinela do SDK) não entra na conta', () => {
    const semTs = CloudStore.tamanhoAproximadoBytes({ a: 1 });
    const comTs = CloudStore.tamanhoAproximadoBytes({ a: 1, updatedAt: { sentinela: 'x'.repeat(500) } });
    expect(comTs).toBeLessThan(semTs + 30);
  });
});
