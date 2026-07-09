// Cliente Supabase — fase de produção (banco de dados).
//
// Configuração:
//   - Local: copie .env.example para .env e preencha as duas variáveis.
//   - Vercel: Settings → Environment Variables → VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
//
// Enquanto as variáveis não existirem, `supabase` é null e as páginas
// continuam funcionando 100% standalone (dados embutidos) — nada quebra.
//
// Uso futuro numa página (script type="module"):
//   import { supabase } from './src/lib/supabase.js'
//   if (supabase) { const { data } = await supabase.from('relatos').select() }
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey) : null
