import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Multi-página: o app React (index) + as duas ferramentas standalone da
// fase 1, que continuam publicadas nas mesmas URLs (/painel.html é o
// painel do engenheiro que cola o export do WhatsApp; /medicao.html é o
// pacote de junho do Edmar). Elas não dependem de Supabase.
export default defineConfig({
  plugins: [react()],
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
