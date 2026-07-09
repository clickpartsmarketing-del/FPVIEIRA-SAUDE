import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// Projeto multi-página: cada HTML é uma entrada do build.
// Vercel detecta o preset Vite automaticamente (build: vite build, saída: dist/).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        painel: fileURLToPath(new URL('./painel.html', import.meta.url)),
        medicao: fileURLToPath(new URL('./medicao.html', import.meta.url)),
      },
    },
  },
})
