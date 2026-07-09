import React, { useEffect, useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, Percent, HardHat, Plus, X } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

// =====================================================================
// 💰 FINANCEIRO DO CONTRATO — visão exclusiva Lucas/Rafael (decisão
// Renan 08/07: "fecha a régua"). A restrição REAL é no banco: a tabela
// contrato_financeiro tem RLS por e-mail (FINANCEIRO.sql) — outros
// logins recebem lista vazia e a seção nem aparece.
// Sem dependência de gráficos: barras em CSS puro (build na Vercel
// continua leve). Dado NUNCA vai pro código — repo é público.
// =====================================================================

interface MesFin {
  id?: number;
  contrato: string;
  mes: string;
  ordem: number;
  custo_total: number;
  medicao_bruta: number;
  mo_direta: number;
  mo_indireta: number;
  material: number;
}

// ordem do ano-contrato (começou em dezembro/2025)
const ORDEM_MESES = ['DEZEMBRO', 'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO'];

const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtCompacto = (v: number) => {
  const n = v || 0; const s = n < 0 ? '-' : ''; const a = Math.abs(n);
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${s}R$ ${Math.round(a / 1e3).toLocaleString('pt-BR')} mil`;
  return `${s}R$ ${Math.round(a)}`;
};
const num = (s: string) => parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;

const VAZIO = { mes: '', custo_total: '', medicao_bruta: '', mo_direta: '', mo_indireta: '', material: '' };

const Financeiro: React.FC = () => {
  const [linhas, setLinhas] = useState<MesFin[]>([]);
  const [faltaSQL, setFaltaSQL] = useState(false);
  const [carregou, setCarregou] = useState(false);
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ ...VAZIO });
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    const { data, error } = await supabase.from('contrato_financeiro')
      .select('*').order('contrato').order('ordem');
    if (error) { setFaltaSQL(/contrato_financeiro/.test(error.message)); setCarregou(true); return; }
    setLinhas((data as MesFin[]) || []);
    setCarregou(true);
  };
  useEffect(() => { carregar(); }, []);

  const salvarMes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    if (!form.mes) { setMsg('Escolha o mês.'); return; }
    setSalvando(true); setMsg('');
    const payload: MesFin = {
      contrato: 'FP.096', mes: form.mes, ordem: ORDEM_MESES.indexOf(form.mes),
      custo_total: num(form.custo_total), medicao_bruta: num(form.medicao_bruta),
      mo_direta: num(form.mo_direta), mo_indireta: num(form.mo_indireta), material: num(form.material),
    };
    const { error } = await supabase.from('contrato_financeiro')
      .upsert([payload], { onConflict: 'contrato,mes' });
    setSalvando(false);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`✅ ${form.mes} lançado.`); setForm({ ...VAZIO }); setFormAberto(false); carregar();
  };

  // RLS devolve vazio p/ quem não é Lucas/Rafael → seção some sozinha
  if (!carregou) return null;
  if (faltaSQL) return (
    <div className="mt-4 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
      💰 Financeiro: rode o <b>FINANCEIRO.sql</b> no Supabase para ativar esta seção.
    </div>
  );
  if (linhas.length === 0 && !formAberto) return null;

  const contratos = Array.from(new Set(linhas.map(l => l.contrato)));

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="font-bold text-stone-900 flex-1">💰 Financeiro do contrato</h3>
        <span className="text-[10px] font-bold text-stone-400 uppercase">visão restrita · Lucas/Rafael</span>
        <button onClick={() => { setFormAberto(v => !v); setMsg(''); }}
          className="flex items-center gap-1 text-[11px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-2.5 py-1">
          {formAberto ? <X size={12} /> : <Plus size={12} />} {formAberto ? 'fechar' : 'lançar mês'}
        </button>
      </div>

      {formAberto && (
        <form onSubmit={salvarMes} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-2">
          <select value={form.mes} onChange={e => setForm(f => ({ ...f, mes: e.target.value }))}
            className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-stone-50 col-span-2 md:col-span-1">
            <option value="">Mês…</option>
            {ORDEM_MESES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {([['custo_total', 'Custo total'], ['medicao_bruta', 'Medição bruta'], ['mo_direta', 'M.O. direta'], ['mo_indireta', 'M.O. indireta'], ['material', 'Material']] as const).map(([k, rot]) => (
            <input key={k} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
              placeholder={rot} inputMode="decimal"
              className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-stone-50" />
          ))}
          <button type="submit" disabled={salvando}
            className="col-span-2 md:col-span-3 bg-fpv-600 disabled:bg-stone-300 text-white font-bold rounded-xl py-2.5 text-sm">
            {salvando ? 'Salvando…' : 'Salvar mês (atualiza se já existir)'}
          </button>
          {msg && <p className="col-span-2 md:col-span-3 text-xs font-bold text-stone-600">{msg}</p>}
        </form>
      )}

      {contratos.map(ct => {
        const ms = linhas.filter(l => l.contrato === ct);
        const fechados = ms.filter(m => m.medicao_bruta > 0);
        const custo = ms.reduce((a, m) => a + Number(m.custo_total), 0);
        const custoFech = fechados.reduce((a, m) => a + Number(m.custo_total), 0);
        const medicao = fechados.reduce((a, m) => a + Number(m.medicao_bruta), 0);
        const resultado = medicao - custoFech;
        const margem = medicao > 0 ? resultado / medicao : 0;
        const maxBarra = Math.max(...ms.map(m => Math.max(Number(m.custo_total), Number(m.medicao_bruta))), 1);
        return (
          <div key={ct} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <b className="text-sm text-stone-900">{ct}</b>
              <span className="text-[11px] text-stone-400 font-bold">{ms.length} meses lançados · {fechados.length} com medição</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-xl border border-stone-200 p-2 text-center">
                <HardHat size={14} className="mx-auto text-amber-500" />
                <div className="text-sm font-bold tabular-nums">{fmtCompacto(custo)}</div>
                <div className="text-[9px] font-bold uppercase text-stone-400">custo</div>
              </div>
              <div className="rounded-xl border border-stone-200 p-2 text-center">
                <Wallet size={14} className="mx-auto text-fpv-600" />
                <div className="text-sm font-bold tabular-nums">{fmtCompacto(medicao)}</div>
                <div className="text-[9px] font-bold uppercase text-stone-400">medição</div>
              </div>
              <div className="rounded-xl border border-stone-200 p-2 text-center">
                {resultado >= 0 ? <TrendingUp size={14} className="mx-auto text-fpv-600" /> : <TrendingDown size={14} className="mx-auto text-red-500" />}
                <div className={`text-sm font-bold tabular-nums ${resultado >= 0 ? 'text-fpv-700' : 'text-red-600'}`}>{fmtCompacto(resultado)}</div>
                <div className="text-[9px] font-bold uppercase text-stone-400">resultado</div>
              </div>
              <div className="rounded-xl border border-stone-200 p-2 text-center">
                <Percent size={14} className="mx-auto text-stone-500" />
                <div className={`text-sm font-bold tabular-nums ${margem >= 0 ? 'text-stone-800' : 'text-red-600'}`}>{(margem * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</div>
                <div className="text-[9px] font-bold uppercase text-stone-400">margem</div>
              </div>
            </div>

            <div className="space-y-2">
              {ms.map(m => {
                const res = m.medicao_bruta > 0 ? m.medicao_bruta - m.custo_total : null;
                const moiPct = m.custo_total > 0 ? m.mo_indireta / m.custo_total : 0;
                return (
                  <div key={m.mes} className="border border-stone-100 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <b className="w-20 shrink-0 text-stone-700">{m.mes.slice(0, 3)}<span className="text-stone-300">{m.mes.slice(3, 9).toLowerCase()}</span></b>
                      <div className="flex-1 space-y-1">
                        <div className="h-2 rounded-full bg-amber-400" style={{ width: `${Math.max(2, 100 * m.custo_total / maxBarra)}%` }} title={`Custo ${fmt(m.custo_total)}`} />
                        <div className="h-2 rounded-full bg-fpv-500" style={{ width: `${Math.max(2, 100 * m.medicao_bruta / maxBarra)}%` }} title={`Medição ${fmt(m.medicao_bruta)}`} />
                      </div>
                      <span className={`w-24 shrink-0 text-right font-bold tabular-nums ${res == null ? 'text-stone-400' : res >= 0 ? 'text-fpv-700' : 'text-red-600'}`}>
                        {res == null ? 'em aberto' : fmtCompacto(res)}
                      </span>
                    </div>
                    <div className="text-[10px] text-stone-400 font-bold mt-1 ml-20 pl-2">
                      direta {fmtCompacto(m.mo_direta)} · <span className={moiPct > 0.4 ? 'text-red-600' : ''}>indireta {fmtCompacto(m.mo_indireta)}{moiPct > 0.4 ? ' ⚠' : ''}</span> · material {fmtCompacto(m.material)}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-stone-400">barra âmbar = custo · barra verde = medição · ⚠ = mão de obra indireta acima de 40% do custo do mês (lição de março)</p>
          </div>
        );
      })}
    </div>
  );
};

export default Financeiro;
