// tests/buscaNorm.test.ts
// ---------------------------------------------------------------
// POR QUE ESTE TESTE EXISTE
// buscaNorm() é a régua única de busca (v70). Ela colapsa letra dobrada
// para "fanny" achar "Fany" — e é aí que mora a armadilha: se a regra de
// colapso escapar para DÍGITO, a busca pela O.S. 1188 passa a casar com
// 188, e o operador de campo anexa material na O.S. errada. O teste do
// dígito é o mais importante deste arquivo.
// ---------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { buscaNorm } from '../types';

describe('buscaNorm — régua única de busca', () => {
  it('ignora maiúsculas', () => {
    expect(buscaNorm('GILSON')).toBe(buscaNorm('gilson'));
  });

  it('ignora acento: jose acha JOSÉ, marcal acha MARÇAL', () => {
    expect(buscaNorm('JOSÉ')).toBe('jose');
    expect(buscaNorm('MARÇAL')).toBe('marcal');
    expect(buscaNorm('Conceição')).toBe(buscaNorm('conceicao'));
    expect(buscaNorm('ÂNGELA')).toBe(buscaNorm('angela'));
  });

  it('colapsa letra dobrada: fanny acha Fany', () => {
    expect(buscaNorm('Fanny')).toBe(buscaNorm('Fany'));
    expect(buscaNorm('Rennan')).toBe(buscaNorm('Renan'));
  });

  it('🔴 NÃO colapsa dígito — 1188 não pode virar 188', () => {
    expect(buscaNorm('1188')).toBe('1188');
    expect(buscaNorm('1188')).not.toBe(buscaNorm('188'));
    expect(buscaNorm('1000')).toBe('1000');
    expect(buscaNorm('2200')).toBe('2200');
  });

  it('preserva a ref de equipe distinguível: L11 != L1', () => {
    expect(buscaNorm('L11')).not.toBe(buscaNorm('L1'));
  });

  it('entrada vazia/nula não explode (vem de campo opcional do banco)', () => {
    expect(buscaNorm('')).toBe('');
    expect(buscaNorm(undefined as any)).toBe('');
    expect(buscaNorm(null as any)).toBe('');
  });

  it('é idempotente — normalizar duas vezes dá o mesmo', () => {
    // as telas normalizam o termo digitado E o campo do banco; se não
    // fosse idempotente, os dois lados poderiam divergir
    for (const s of ['MARÇAL', 'Fanny', 'E.M. JOÃO XXIII', 'L11']) {
      expect(buscaNorm(buscaNorm(s))).toBe(buscaNorm(s));
    }
  });

  it('caso real de escola com acento e letra dobrada', () => {
    expect(buscaNorm('E.M. ANNA MARIA')).toBe(buscaNorm('E.M. ANA MARIA'));
  });
});
