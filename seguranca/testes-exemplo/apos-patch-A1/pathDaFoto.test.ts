// tests/pathDaFoto.test.ts
// ⚠️ COPIAR PARA tests/ SÓ DEPOIS de aplicar o patch A.1 (criar
//    services/fotoService.ts). Antes disso o import não resolve e o CI
//    fica vermelho por um arquivo que ainda não existe.
// ---------------------------------------------------------------
// POR QUE ESTE TESTE EXISTE
// pathDaFoto() é a ponte entre o banco (que tem URL pública ANTIGA,
// caminho NOVO e link EXTERNO misturados na mesma coluna) e o bucket
// privado. Se ela errar, a evidência fotográfica da medição some da
// folha de assinatura — e evidência que some é glosa.
// Ela também tem que continuar espelhando public.fpv_path_da_foto() do
// 09-fotos-privadas.sql: se as duas divergirem, o backfill do banco e a
// tela passam a discordar sobre onde a foto está.
// ---------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { pathDaFoto } from '../services/fotoService';

const BASE = 'https://abcdefgh.supabase.co';

describe('pathDaFoto — URL gravada no banco -> caminho no bucket', () => {
  it('URL PÚBLICA antiga (o que está gravado hoje em foto_urls)', () => {
    expect(pathDaFoto(`${BASE}/storage/v1/object/public/fotos-os/os/1720000000_ab12cd.jpg`))
      .toBe('os/1720000000_ab12cd.jpg');
  });

  it('URL ASSINADA (se alguma tiver sido gravada por engano) — descarta o token', () => {
    expect(pathDaFoto(`${BASE}/storage/v1/object/sign/fotos-os/os/1720000000_ab12cd.jpg?token=eyJhbGciOi.Jz`))
      .toBe('os/1720000000_ab12cd.jpg');
  });

  it('query string na URL pública não entra no caminho', () => {
    expect(pathDaFoto(`${BASE}/storage/v1/object/public/fotos-os/os/foto.jpg?t=123`))
      .toBe('os/foto.jpg');
  });

  it('caminho CRU (o que o upload passa a gravar) volta igual', () => {
    expect(pathDaFoto('os/1720000000_ab12cd.jpg')).toBe('os/1720000000_ab12cd.jpg');
  });

  it('🔴 link EXTERNO (Drive/WhatsApp/n8n) devolve null — NÃO é nosso para assinar', () => {
    // se isto virar caminho, o app tenta assinar um objeto que não existe
    // e a foto de evidência some da tela
    expect(pathDaFoto('https://drive.google.com/file/d/1a2b3c/view')).toBeNull();
    expect(pathDaFoto('https://i.imgur.com/abc.jpg')).toBeNull();
  });

  it('vazio/nulo/espaço não explode (coluna text[] aceita lixo do import)', () => {
    expect(pathDaFoto('')).toBeNull();
    expect(pathDaFoto('   ')).toBeNull();
    expect(pathDaFoto(undefined as any)).toBeNull();
    expect(pathDaFoto(null as any)).toBeNull();
  });

  it('é idempotente: aplicar de novo no resultado dá o mesmo', () => {
    // a coluna vai conviver com os dois formatos durante a migração; a
    // tela pode passar o mesmo valor duas vezes pela função
    const u = `${BASE}/storage/v1/object/public/fotos-os/os/foto.jpg`;
    expect(pathDaFoto(pathDaFoto(u)!)).toBe(pathDaFoto(u));
  });

  it('bucket de outro projeto não é confundido com o nosso', () => {
    // '/public/outro-bucket/' não casa com '/public/fotos-os/' -> externa
    expect(pathDaFoto(`${BASE}/storage/v1/object/public/outro-bucket/x.jpg`)).toBeNull();
  });
});
