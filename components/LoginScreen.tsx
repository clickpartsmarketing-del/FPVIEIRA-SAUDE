import React, { useState } from 'react';
import { User, Lock, ArrowRight, Loader2, HardHat, Eye, EyeOff } from 'lucide-react';
import { supabase, configOk } from '../services/supabaseClient';
import { ACESSOS, Acesso } from '../config';

// =============================================================
// LOGIN EM 2 TOQUES (pedido Renan 07/07): a "recusa" do campo
// era digitar e-mail comprido + senha às cegas no celular.
// Agora: 1) toca no SEU NOME (e-mail preenche sozinho),
// 2) digita a senha (com olhinho p/ conferir) → Entrar.
// O último usuário fica lembrado — próximo login = só a senha.
// A sessão continua persistente: logado fica logado.
// =============================================================

const ULTIMO_KEY = 'fpv_ultimo_login';

const lembrado = (): Acesso | null => {
  try {
    const raw = localStorage.getItem(ULTIMO_KEY);
    if (!raw) return null;
    const salvo = JSON.parse(raw);
    // só aceita se ainda existir na lista (evita e-mail antigo/errado)
    return ACESSOS.find(a => a.email === salvo?.email) || null;
  } catch { return null; }
};

const LoginScreen: React.FC = () => {
  const [quem, setQuem] = useState<Acesso | null>(lembrado());
  const [manual, setManual] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    // trim + minúsculas: teclado de celular adora colocar Maiúscula
    // inicial e espaço no fim — era a "recusa" mais comum
    const mail = (quem?.email || email).trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: mail, password: senha.trim() });
    if (error) {
      setErro(error.message === 'Invalid login credentials'
        ? 'Senha incorreta. Toque no 👁 para conferir o que digitou.'
        : 'Erro de conexão: ' + error.message);
      setCarregando(false);
      return;
    }
    // sucesso: lembra quem entrou — próxima vez é só a senha
    try { if (quem) localStorage.setItem(ULTIMO_KEY, JSON.stringify({ email: quem.email })); } catch { /* sem storage, sem lembrança */ }
  };

  const escolher = (a: Acesso) => { setQuem(a); setManual(false); setErro(''); setSenha(''); };

  const campo = ACESSOS.filter(a => a.grupo === 'campo');
  const gestao = ACESSOS.filter(a => a.grupo === 'gestao');

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-fpv-500 text-fpv-50 flex items-center justify-center font-bold">FPV</div>
          <div>
            <h1 className="font-bold text-lg text-stone-900 leading-tight">FPV Campo Saúde</h1>
            <p className="text-xs text-stone-500">F.P. Vieira Engenharia · FP.096</p>
          </div>
        </div>

        {!configOk && (
          <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">
            ⚠️ Este deploy está SEM as variáveis <b>VITE_SUPABASE_URL</b> / <b>VITE_SUPABASE_ANON_KEY</b>.
            Configure na Vercel (Settings → Environment Variables) e faça <b>Redeploy</b>.
          </div>
        )}

        {/* ===== PASSO 1: quem é você (sem digitar e-mail) ===== */}
        {!quem && !manual && (
          <div className="space-y-2">
            <p className="font-bold text-stone-700 text-center pb-1">Toque no seu nome para entrar 👇</p>
            {campo.map(a => (
              <button key={a.email} onClick={() => escolher(a)}
                className="w-full min-h-[56px] bg-stone-50 hover:bg-fpv-50 border-2 border-stone-200 hover:border-fpv-300 rounded-2xl px-4 flex items-center gap-3 text-left">
                <span className="text-2xl">{a.emoji}</span>
                <span className="flex-1">
                  <span className="block font-bold text-stone-900">{a.rotulo}</span>
                  <span className="block text-[11px] text-stone-400 font-medium">{a.dica}</span>
                </span>
                <ArrowRight size={16} className="text-stone-300" />
              </button>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {gestao.map(a => (
                <button key={a.email} onClick={() => escolher(a)}
                  className="min-h-[48px] bg-white hover:bg-stone-50 border border-stone-200 rounded-xl px-3 flex items-center gap-2 text-left">
                  <span>{a.emoji}</span>
                  <span className="text-sm font-bold text-stone-700 truncate">{a.rotulo}</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setManual(true); setErro(''); }}
              className="w-full text-[11px] text-stone-400 underline pt-2">
              Entrar com outro e-mail
            </button>
          </div>
        )}

        {/* ===== PASSO 2: só a senha ===== */}
        {quem && !manual && (
          <form onSubmit={entrar} className="space-y-4">
            <div className="bg-fpv-50 border border-fpv-100 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">{quem.emoji}</span>
              <div className="flex-1 leading-tight">
                <div className="font-bold text-fpv-900">{quem.rotulo}</div>
                <div className="text-[11px] text-fpv-700">{quem.email}</div>
              </div>
              <button type="button" onClick={() => { setQuem(null); setSenha(''); setErro(''); }}
                className="text-[11px] font-bold text-fpv-700 underline shrink-0">trocar</button>
            </div>
            {/* e-mail invisível: deixa o navegador achar a senha salva certa */}
            <input type="email" name="username" autoComplete="username" value={quem.email} readOnly className="hidden" tabIndex={-1} />
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
              <input
                type={verSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)} required autoFocus
                placeholder="digite a senha"
                autoComplete="current-password" name="password" autoCapitalize="none"
                className="w-full pl-10 pr-12 py-4 bg-stone-50 border-2 border-stone-200 rounded-xl outline-none focus:border-fpv-500 text-base font-medium"
              />
              <button type="button" onClick={() => setVerSenha(v => !v)} tabIndex={-1}
                title={verSenha ? 'Esconder a senha' : 'Ver a senha'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-fpv-600">
                {verSenha ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            {erro && <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</div>}

            <button
              type="submit" disabled={carregando}
              className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 text-base"
            >
              {carregando ? <Loader2 size={18} className="animate-spin" /> : <><HardHat size={18} /> Entrar <ArrowRight size={16} /></>}
            </button>
            <p className="text-[11px] text-stone-400 text-center">Depois de entrar, você continua conectado — não precisa logar toda vez.</p>
          </form>
        )}

        {/* ===== fallback: e-mail digitado (usuário fora da lista) ===== */}
        {manual && (
          <form onSubmit={entrar} className="space-y-4">
            <div className="relative">
              <User className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                placeholder="seu e-mail de acesso"
                autoComplete="username" name="username" inputMode="email" autoCapitalize="none"
                className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-fpv-500 focus:ring-2 focus:ring-fpv-100 text-sm font-medium"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type={verSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)} required
                placeholder="senha"
                autoComplete="current-password" name="password" autoCapitalize="none"
                className="w-full pl-10 pr-12 py-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-fpv-500 focus:ring-2 focus:ring-fpv-100 text-sm font-medium"
              />
              <button type="button" onClick={() => setVerSenha(v => !v)} tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-fpv-600">
                {verSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {erro && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</div>}

            <button
              type="submit" disabled={carregando}
              className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {carregando ? <Loader2 size={18} className="animate-spin" /> : <><HardHat size={18} /> Entrar <ArrowRight size={16} /></>}
            </button>
            <button type="button" onClick={() => { setManual(false); setErro(''); }}
              className="w-full text-[11px] text-stone-400 underline">
              ← Voltar para a lista de nomes
            </button>
          </form>
        )}

        <p className="text-[11px] text-stone-400 mt-6 text-center">
          Acesso criado pela engenharia. Problemas? Fale com o Renan/Leony.
        </p>
        <a href="/treinamento/" className="block text-center text-xs font-bold text-fpv-700 mt-2 underline">
          📚 Treinamento — aprenda a usar o app
        </a>
      </div>
    </div>
  );
};

export default LoginScreen;
