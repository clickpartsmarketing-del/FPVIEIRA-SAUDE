// tests/osService.listar.test.ts
// ---------------------------------------------------------------
// POR QUE ESTE TESTE EXISTE
// Este é o teste que protege a LIÇÃO #7 e o caso real da "O.S. 913
// sumida". Três comportamentos foram pagos com bug em produção:
//   1) o PostgREST corta em 1000 linhas -> tem que paginar
//   2) 400+ linhas do importão têm o MESMO criado_em; sem desempate por
//      id o banco devolve ordem instável -> linha repetida numa página e
//      ENGOLIDA noutra. Daí o dedupe por id.
//   3) erro no meio da paginação NÃO pode devolver lista parcial em
//      silêncio: KPI da Gestão sobre lista incompleta = decisão errada
//      sem ninguém saber. Por isso listar() devolve { dados, erro }.
// Se alguém "simplificar" listar() no futuro, um destes quebra.
// ---------------------------------------------------------------
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// vi.hoisted: vi.mock é içado acima dos imports, então o mock não pode
// referenciar um const normal (TDZ). Isto resolve.
const { range } = vi.hoisted(() => ({ range: vi.fn() }));

vi.mock('../services/supabaseClient', () => {
  const b: any = {};
  b.select = () => b;
  b.order = () => b;
  b.range = (de: number, ate: number) => range(de, ate);
  return { supabase: { from: () => b }, configOk: true };
});

import { osService } from '../services/osService';

/** n linhas com id decrescente a partir de idTopo */
const pagina = (n: number, idTopo: number) =>
  Array.from({ length: n }, (_, i) => ({ id: idTopo - i, numero: idTopo - i }));

beforeEach(() => range.mockReset());

describe('osService.listar — paginação, dedupe e erro', () => {
  it('para na primeira página incompleta (não pagina à toa)', async () => {
    range.mockResolvedValueOnce({ data: pagina(37, 37), error: null });

    const { dados, erro } = await osService.listar();

    expect(erro).toBeNull();
    expect(dados).toHaveLength(37);
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith(0, 999);
  });

  it('pagina enquanto a página vier CHEIA (1000 linhas)', async () => {
    range
      .mockResolvedValueOnce({ data: pagina(1000, 3000), error: null })
      .mockResolvedValueOnce({ data: pagina(1000, 2000), error: null })
      .mockResolvedValueOnce({ data: pagina(120, 1000), error: null });

    const { dados, erro } = await osService.listar();

    expect(erro).toBeNull();
    expect(dados).toHaveLength(2120);
    expect(range).toHaveBeenCalledTimes(3);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(range).toHaveBeenNthCalledWith(3, 2000, 2999);
  });

  it('🔴 CASO O.S. 913: linha repetida entre páginas entra UMA vez só', async () => {
    // ordem instável do banco: os ids 2001 e 2000 voltam na 2ª página
    range
      .mockResolvedValueOnce({ data: pagina(1000, 3000), error: null })   // 3000..2001
      .mockResolvedValueOnce({ data: pagina(5, 2001), error: null });     // 2001..1997

    const { dados } = await osService.listar();

    const ids = dados.map((d: any) => d.id);
    expect(new Set(ids).size).toBe(ids.length);   // zero duplicata
    expect(dados).toHaveLength(1004);             // 1000 + 4 novas
    expect(ids).toContain(1997);                  // e a nova NÃO se perdeu
  });

  it('🔴 erro NO MEIO da paginação devolve { dados parciais, erro } — nunca lista curta em silêncio', async () => {
    range
      .mockResolvedValueOnce({ data: pagina(1000, 3000), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'conexão perdida' } });

    const { dados, erro } = await osService.listar();

    expect(erro).toBe('conexão perdida');   // o App exibe o aviso de lista incompleta
    expect(dados).toHaveLength(1000);       // o que deu para ler continua utilizável
  });

  it('erro logo na primeira página: lista vazia COM erro (não vazia "normal")', async () => {
    range.mockResolvedValueOnce({ data: null, error: { message: 'JWT expired' } });

    const { dados, erro } = await osService.listar();

    expect(dados).toHaveLength(0);
    expect(erro).toBe('JWT expired');       // != null é o que diferencia de "não há O.S."
  });

  it('banco vazio: lista vazia SEM erro', async () => {
    range.mockResolvedValueOnce({ data: [], error: null });

    const { dados, erro } = await osService.listar();

    expect(dados).toHaveLength(0);
    expect(erro).toBeNull();
  });
});
