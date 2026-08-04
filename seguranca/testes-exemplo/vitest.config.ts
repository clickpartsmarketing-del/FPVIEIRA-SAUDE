/// <reference types="vitest" />
// Copiar para a RAIZ do projeto (C:\Users\nicol\FPV-Campo\vitest.config.ts).
// Fica separado do vite.config.ts de propósito: config de teste que muda
// não pode arriscar mexer no build de produção.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',          // precisa para @testing-library/react
    globals: true,                 // describe/it/expect sem import
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // roda em segundos: nada aqui toca rede ou banco de verdade
    testTimeout: 5000,
    coverage: {
      provider: 'v8',
      // sem meta de porcentagem: meta de cobertura em app legado vira
      // teste de fachada. A meta é COBRIR O QUE JÁ QUEBROU.
      include: ['types.ts', 'config.ts', 'services/**'],
      reporter: ['text', 'html'],
    },
  },
});
