import { createClient } from '@supabase/supabase-js';

// Chaves via variável de ambiente — NUNCA hardcoded no código.
// Local: arquivo .env.local | Vercel: Settings > Environment Variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const configOk = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (!configOk) {
  console.error('⚠️ Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (.env.local ou Vercel > Environment Variables).');
}

// fallback impede tela branca se as env vars faltarem — o login exibirá erro amigável
export const supabase = createClient(
  SUPABASE_URL || 'https://config-pendente.supabase.co',
  SUPABASE_KEY || 'anon-key-pendente'
);
