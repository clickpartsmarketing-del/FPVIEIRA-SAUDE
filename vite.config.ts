import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// VERSÃO VISÍVEL NO APP — vem do package.json, não da memória de ninguém
// (lição da Educação: commit v72 subiu mostrando v71 por bump manual
// esquecido). Subir versão = editar só o package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const VERSAO = 'v' + String(pkg.version).split('.')[0];

// Multi-página: o app React (index) + as duas ferramentas standalone da
// fase 1, que continuam publicadas nas mesmas URLs (/painel.html é o
// painel do engenheiro que cola o export do WhatsApp; /medicao.html é o
// pacote de junho do Edmar). Elas não dependem de Supabase.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(VERSAO),
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        painel: fileURLToPath(new URL('./painel.html', import.meta.url)),
        medicao: fileURLToPath(new URL('./medicao.html', import.meta.url)),
      },
    },
  },
});
