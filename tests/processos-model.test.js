import { describe, it, expect } from 'vitest';
import ProcessosModel from '../processos-model.js';

describe('ProcessosModel.normalizarProcesso', () => {
  it('aceita o formato bruto do processos_seed.json e gera id/atualizadoEm', () => {
    const p = ProcessosModel.normalizarProcesso({
      numero: '65251.004709/2025-34',
      assunto: 'Plano de Negócios 2026',
      tipoProcesso: 'Planejamento Estratégico: Elaboração do Plano Estratégico',
      marcadores: ['Acompanhamento'],
      acompanhamentoEspecial: ['Consultas Importantes'],
      observacao: null,
      origem: 'marcado'
    });
    expect(p.numero).toBe('65251.004709/2025-34');
    expect(p.assunto).toBe('Plano de Negócios 2026');
    expect(p.marcadores).toEqual(['Acompanhamento']);
    expect(p.acompanhamentoEspecial).toEqual(['Consultas Importantes']);
    expect(p.origem).toBe('marcado');
    expect(p.negocioId).toBe(null);
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBeGreaterThan(0);
    expect(typeof p.atualizadoEm).toBe('string');
    expect(isNaN(Date.parse(p.atualizadoEm))).toBe(false);
  });

  it('preenche sugestaoMarcador quando presente (formato sem_marcador/nao_triado)', () => {
    const p = ProcessosModel.normalizarProcesso({
      numero: '65251.000034/2025-54',
      assunto: 'Pagamento de Comissões - Novembro/2024',
      tipoProcesso: null,
      marcadores: [],
      acompanhamentoEspecial: ['Representantes'],
      observacao: null,
      sugestaoMarcador: 'Aplicar marcador já existente "Representantes"',
      origem: 'sem_marcador'
    });
    expect(p.sugestaoMarcador).toBe('Aplicar marcador já existente "Representantes"');
    expect(p.origem).toBe('sem_marcador');
  });

  it('valores ausentes viram null/[] com defaults sensatos', () => {
    const p = ProcessosModel.normalizarProcesso(undefined);
    expect(p.numero).toBe('');
    expect(p.assunto).toBe(null);
    expect(p.tipoProcesso).toBe(null);
    expect(p.marcadores).toEqual([]);
    expect(p.acompanhamentoEspecial).toEqual([]);
    expect(p.observacao).toBe(null);
    expect(p.sugestaoMarcador).toBe(null);
    expect(p.negocioId).toBe(null);
    // origem desconhecida/ausente cai para 'nao_triado' — nunca inventa marcado/sem_marcador
    expect(p.origem).toBe('nao_triado');
  });

  it('origem inválida cai para "nao_triado"', () => {
    const p = ProcessosModel.normalizarProcesso({ numero: '65251.000001/2026-01', origem: 'lixo' });
    expect(p.origem).toBe('nao_triado');
  });

  it('é idempotente: normalizar(normalizar(x)) preserva id e atualizadoEm', () => {
    const uma = ProcessosModel.normalizarProcesso({ numero: '65251.000001/2026-01', assunto: 'Teste', marcadores: ['Geral'] });
    const duas = ProcessosModel.normalizarProcesso(uma);
    expect(duas).toEqual(uma);
  });

  it('descarta espaços em branco nas listas de marcadores/acompanhamento', () => {
    const p = ProcessosModel.normalizarProcesso({
      numero: '65251.000001/2026-01',
      marcadores: ['  Geral  ', '', '  ', 'TED'],
      acompanhamentoEspecial: [' Acompanhar ', null, 42]
    });
    expect(p.marcadores).toEqual(['Geral', 'TED']);
    expect(p.acompanhamentoEspecial).toEqual(['Acompanhar']);
  });
});

describe('ProcessosModel.novoProcesso', () => {
  it('sempre gera id e atualizadoEm novos, mesmo se os dados de entrada já tiverem', () => {
    const base = ProcessosModel.normalizarProcesso({ numero: '65251.000001/2026-01' });
    const outro = ProcessosModel.novoProcesso(base);
    expect(outro.id).not.toBe(base.id);
    expect(outro.numero).toBe(base.numero);
  });
});

describe('ProcessosModel.normalizarProcessos', () => {
  it('mapeia uma lista bruta e descarta itens sem número válido', () => {
    const lista = ProcessosModel.normalizarProcessos([
      { numero: '65251.000001/2026-01', assunto: 'A' },
      { assunto: 'Sem número' },
      { numero: '', assunto: 'Número vazio' }
    ]);
    expect(lista.length).toBe(1);
    expect(lista[0].assunto).toBe('A');
  });

  it('deduplica por número, mantendo o último (mesma regra do Ponto para registros por data)', () => {
    const lista = ProcessosModel.normalizarProcessos([
      { numero: '65251.000001/2026-01', assunto: 'Primeira versão' },
      { numero: '65251.000001/2026-01', assunto: 'Segunda versão' }
    ]);
    expect(lista.length).toBe(1);
    expect(lista[0].assunto).toBe('Segunda versão');
  });

  it('devolve array vazio para entrada inválida', () => {
    expect(ProcessosModel.normalizarProcessos(null)).toEqual([]);
    expect(ProcessosModel.normalizarProcessos(undefined)).toEqual([]);
    expect(ProcessosModel.normalizarProcessos('lixo')).toEqual([]);
  });
});

describe('ProcessosModel.normalizarEstadoProcessos', () => {
  it('devolve estrutura completa com itens normalizados a partir de undefined', () => {
    const estado = ProcessosModel.normalizarEstadoProcessos(undefined);
    expect(estado.versao).toBe(1);
    expect(Array.isArray(estado.itens)).toBe(true);
    expect(estado.itens.length).toBe(0);
  });

  it('normaliza itens existentes preservando dados válidos', () => {
    const estado = ProcessosModel.normalizarEstadoProcessos({
      itens: [{ numero: '65251.000001/2026-01', assunto: 'X', origem: 'marcado' }]
    });
    expect(estado.itens.length).toBe(1);
    expect(estado.itens[0].assunto).toBe('X');
  });
});

describe('ProcessosModel.validarProcesso', () => {
  it('exige número no formato NNNNN.NNNNNN/AAAA-DD', () => {
    expect(ProcessosModel.validarProcesso({ numero: '' }).length).toBeGreaterThan(0);
    expect(ProcessosModel.validarProcesso({ numero: '12345' }).length).toBeGreaterThan(0);
    expect(ProcessosModel.validarProcesso({ numero: '65251.004709/2025-34' })).toEqual([]);
  });

  it('rejeita origem fora do conjunto válido', () => {
    const erros = ProcessosModel.validarProcesso({ numero: '65251.004709/2025-34', origem: 'invalido' });
    expect(erros.length).toBeGreaterThan(0);
  });

  it('aceita as três origens válidas', () => {
    ['marcado', 'sem_marcador', 'nao_triado'].forEach((origem) => {
      expect(ProcessosModel.validarProcesso({ numero: '65251.004709/2025-34', origem })).toEqual([]);
    });
  });

  it('retorna erro para entrada que não é objeto', () => {
    expect(ProcessosModel.validarProcesso(null).length).toBeGreaterThan(0);
    expect(ProcessosModel.validarProcesso('lixo').length).toBeGreaterThan(0);
  });
});

describe('ProcessosModel.validarProcesso com opts.ignorarFormatoNumero', () => {
  it('ainda exige número não-vazio mesmo ignorando o formato', () => {
    const erros = ProcessosModel.validarProcesso({ numero: '' }, { ignorarFormatoNumero: true });
    expect(erros.length).toBeGreaterThan(0);
  });

  it('não rejeita número fora do formato quando ignorarFormatoNumero é true', () => {
    expect(ProcessosModel.validarProcesso({ numero: '12345' }, { ignorarFormatoNumero: true })).toEqual([]);
  });

  it('sem opts, continua exigindo o formato estrito (comportamento padrão preservado)', () => {
    expect(ProcessosModel.validarProcesso({ numero: '12345' }).length).toBeGreaterThan(0);
  });
});

describe('ProcessosModel.origemParaClassificacao', () => {
  it('retorna "marcado" quando há ao menos um marcador, independente de acompanhamento', () => {
    expect(ProcessosModel.origemParaClassificacao(['Geral'], [])).toBe('marcado');
    expect(ProcessosModel.origemParaClassificacao(['Geral'], ['Acompanhar'])).toBe('marcado');
  });

  it('retorna "sem_marcador" quando só há acompanhamento especial', () => {
    expect(ProcessosModel.origemParaClassificacao([], ['Acompanhar'])).toBe('sem_marcador');
  });

  it('retorna "nao_triado" quando não há marcador nem acompanhamento', () => {
    expect(ProcessosModel.origemParaClassificacao([], [])).toBe('nao_triado');
    expect(ProcessosModel.origemParaClassificacao(undefined, undefined)).toBe('nao_triado');
  });
});

describe('ProcessosModel.MARCADORES_SEI_PADRAO', () => {
  it('inclui os marcadores conhecidos da unidade DVMNA-FI', () => {
    expect(ProcessosModel.MARCADORES_SEI_PADRAO).toContain('Representantes');
    expect(ProcessosModel.MARCADORES_SEI_PADRAO).toContain('TED');
  });
});
