import { describe, it, expect } from 'vitest';
import PropostasCalculos from '../propostas-calculos.js';

describe('PropostasCalculos.diasParaVencer', () => {
  it('retorna dias positivos quando a validade ainda não chegou', () => {
    expect(PropostasCalculos.diasParaVencer('2026-09-10', '2026-09-01')).toBe(9);
  });

  it('retorna 0 quando vence hoje', () => {
    expect(PropostasCalculos.diasParaVencer('2026-09-01', '2026-09-01')).toBe(0);
  });

  it('retorna dias negativos quando já venceu', () => {
    expect(PropostasCalculos.diasParaVencer('2026-08-20', '2026-09-01')).toBe(-12);
  });

  it('ignora a hora do dia, comparando só a data', () => {
    expect(PropostasCalculos.diasParaVencer('2026-09-05T23:59:00', '2026-09-05T00:01:00')).toBe(0);
  });

  it('retorna null para validade ausente', () => {
    expect(PropostasCalculos.diasParaVencer(null, '2026-09-01')).toBeNull();
    expect(PropostasCalculos.diasParaVencer(undefined, '2026-09-01')).toBeNull();
    expect(PropostasCalculos.diasParaVencer('', '2026-09-01')).toBeNull();
  });

  it('retorna null para validade inválida', () => {
    expect(PropostasCalculos.diasParaVencer('data-invalida', '2026-09-01')).toBeNull();
  });

  it('usa a data atual quando `hoje` não é informado', () => {
    const amanha = new Date(Date.now() + 86400000);
    expect(PropostasCalculos.diasParaVencer(amanha.toISOString())).toBe(1);
  });
});

describe('PropostasCalculos.classeSemaforoValidade', () => {
  it('retorna "vencida" para dias negativos', () => {
    expect(PropostasCalculos.classeSemaforoValidade(-1)).toBe('vencida');
    expect(PropostasCalculos.classeSemaforoValidade(-30)).toBe('vencida');
  });

  it('retorna "alerta" quando vence hoje (0 dias)', () => {
    expect(PropostasCalculos.classeSemaforoValidade(0)).toBe('alerta');
  });

  it('retorna "alerta" entre 1 e 7 dias', () => {
    expect(PropostasCalculos.classeSemaforoValidade(1)).toBe('alerta');
    expect(PropostasCalculos.classeSemaforoValidade(7)).toBe('alerta');
  });

  it('retorna "ok" acima de 7 dias', () => {
    expect(PropostasCalculos.classeSemaforoValidade(8)).toBe('ok');
    expect(PropostasCalculos.classeSemaforoValidade(30)).toBe('ok');
  });

  it('retorna null para entrada nula/indefinida/não numérica', () => {
    expect(PropostasCalculos.classeSemaforoValidade(null)).toBeNull();
    expect(PropostasCalculos.classeSemaforoValidade(undefined)).toBeNull();
    expect(PropostasCalculos.classeSemaforoValidade(NaN)).toBeNull();
  });
});
