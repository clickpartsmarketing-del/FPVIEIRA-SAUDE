// tests/refDaOS.test.ts
// ---------------------------------------------------------------
// POR QUE ESTE TESTE EXISTE
// refDaOS() é a chave que amarra O.S. <-> material. saida_material.os_ref
// guarda EXATAMENTE o texto que refDaOS devolve. Se a precedência
// inverter (fict_ref ganhar do numero, por exemplo), toda saída passa a
// ser gravada com a ref errada e o custo some da medição — foi assim que
// nasceram as 168 saídas órfãs da auditoria de 24/07. É uma função de 3
// linhas que segura dinheiro.
// ---------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { refDaOS } from '../types';

const os = (p: Partial<Parameters<typeof refDaOS>[0]>) =>
  ({ numero: null, fict_ref: null, numero_fict: null, ...p }) as any;

describe('refDaOS — precedência da referência da O.S.', () => {
  it('nº OFICIAL ganha de todo o resto', () => {
    expect(refDaOS(os({ numero: 1330, fict_ref: 'L20', numero_fict: 42 }))).toBe('1330');
  });

  it('sem nº oficial, usa a ref da equipe (L/M/G/C)', () => {
    expect(refDaOS(os({ fict_ref: 'L20', numero_fict: 42 }))).toBe('L20');
    expect(refDaOS(os({ fict_ref: 'M07' }))).toBe('M07');
  });

  it('sem nº e sem ref de equipe, usa o F-nn legado', () => {
    expect(refDaOS(os({ numero_fict: 42 }))).toBe('F-42');
  });

  it('sem nada: S/Nº (e NUNCA string vazia — vazio vira os_ref nulo no banco)', () => {
    expect(refDaOS(os({}))).toBe('S/Nº');
  });

  it('numero 0 não pode ser tratado como ausente', () => {
    // armadilha clássica: `o.numero ? ... : ...` faria 0 cair no fallback.
    // O código usa `!= null` — este teste é a trava disso.
    expect(refDaOS(os({ numero: 0, fict_ref: 'L01' }))).toBe('0');
  });

  it('devolve sempre string (o os_ref do banco é text)', () => {
    expect(typeof refDaOS(os({ numero: 1330 }))).toBe('string');
    expect(typeof refDaOS(os({ numero_fict: 5 }))).toBe('string');
  });

  it('REGRESSÃO REAL: a ref muda quando a fictícia ganha o nº oficial', () => {
    // ListaOS.vincularNumero depende disto para saber que precisa
    // re-chavear o material de 'L20' para '1330'
    const antes = refDaOS(os({ fict_ref: 'L20' }));
    const depois = refDaOS(os({ fict_ref: 'L20', numero: 1330 }));
    expect(antes).toBe('L20');
    expect(depois).toBe('1330');
    expect(antes).not.toBe(depois);
  });
});
