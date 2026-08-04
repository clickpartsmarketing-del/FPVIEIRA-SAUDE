// Copiar para a RAIZ do projeto (C:\Users\nicol\FPV-Campo\vitest.setup.ts).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// desmonta a árvore entre testes: sem isso, um teste enxerga o DOM do outro
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// env do Vite que o supabaseClient.ts espera. Valores FALSOS: nenhum
// teste desta suíte pode encostar no banco de produção.
// (é a mesma razão pela qual o CI builda com env falsa)
Object.assign(import.meta.env, {
  VITE_SUPABASE_URL: 'https://teste.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'chave-de-teste',
});

// jsdom não implementa nada disso e os componentes usam
if (!window.matchMedia) {
  // @ts-expect-error jsdom
  window.matchMedia = () => ({
    matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
}
window.confirm = vi.fn(() => true);
window.alert = vi.fn();
