import React, { useState } from 'react';
import { Printer, FileSignature } from 'lucide-react';
import { OSCampo, refDaOS } from '../types';
import { hojeLocal } from '../config';

interface Props { lista: OSCampo[]; }

const hoje = () => hojeLocal();
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return hojeLocal(d); };
const br = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

const FechamentoSemanal: React.FC<Props> = ({ lista }) => {
  const [de, setDe] = useState(diasAtras(7));
  const [ate, setAte] = useState(hoje());
  const [soConcluidas, setSoConcluidas] = useState(true);

  const selecionadas = lista.filter(os => {
    const ref = os.conclusao || os.entrada || '';
    if (!ref || ref < de || ref > ate) return false;
    if (soConcluidas && os.status !== 'Concluído') return false;
    return true;
  });

  return (
    <div>
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 mb-5 print-hidden">
        <h2 className="font-bold text-stone-900 mb-1 flex items-center gap-2"><FileSignature size={18} className="text-fpv-600" /> Fechamento para assinatura do fiscal</h2>
        <p className="text-sm text-stone-500 mb-4">Selecione o período: cada O.S. vira uma folha com serviço, materiais, memória de cálculo e campos de assinatura. Imprima ou salve em PDF e leve ao fiscal.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">De</label>
            <input type="date" value={de} onChange={e => setDe(e.target.value)}
              className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Até</label>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)}
              className="border border-stone-200 rounded-lg px-3 py-2 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-stone-600 pb-2.5">
            <input type="checkbox" checked={soConcluidas} onChange={e => setSoConcluidas(e.target.checked)} className="accent-fpv-500" />
            só concluídas
          </label>
          <button onClick={() => window.print()} disabled={selecionadas.length === 0}
            className="ml-auto flex items-center gap-2 bg-fpv-500 hover:bg-fpv-600 text-white font-bold px-5 py-3 rounded-xl disabled:opacity-50">
            <Printer size={18} /> Imprimir / PDF ({selecionadas.length})
          </button>
        </div>
      </div>

      <div id="folha-print">
        {selecionadas.map(os => (
          <div key={os.id} className="folha bg-white border border-stone-200 rounded-2xl p-8 mb-5 max-w-3xl mx-auto">
            <div className="flex items-center justify-between border-b-2 border-fpv-500 pb-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-fpv-500 text-white flex items-center justify-center font-bold text-sm">FPV</div>
                <div>
                  <div className="font-bold text-stone-900 leading-tight">F.P. Vieira Engenharia</div>
                  <div className="text-xs text-stone-500">Contrato 005/2026 · FP.096 — Manutenção Predial Saúde · SEMUSA Rio das Ostras</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-bold uppercase text-stone-400">Ordem de Serviço</div>
                <div className="text-2xl font-black text-stone-900 tabular-nums">{refDaOS(os)}</div>
                {os.emergencial && <div className="text-[11px] font-bold text-red-600 uppercase">Emergencial</div>}
              </div>
            </div>

            <table className="w-full text-sm mb-4">
              <tbody>
                <tr>
                  <td className="py-1.5 text-stone-500 w-32 align-top font-medium">Unidade</td>
                  <td className="py-1.5 font-bold text-stone-900">{os.unidade}</td>
                  <td className="py-1.5 text-stone-500 w-24 align-top font-medium">Fiscal</td>
                  <td className="py-1.5 font-bold text-stone-900">{os.fiscal}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-stone-500 font-medium">Entrada</td>
                  <td className="py-1.5 text-stone-900">{br(os.entrada)}</td>
                  <td className="py-1.5 text-stone-500 font-medium">Conclusão</td>
                  <td className="py-1.5 text-stone-900">{br(os.conclusao)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-stone-500 font-medium">Executor</td>
                  <td className="py-1.5 text-stone-900">{os.executor || '—'}</td>
                  <td className="py-1.5 text-stone-500 font-medium">Status</td>
                  <td className="py-1.5 text-stone-900">{os.status}{os.medicao ? ' · ' + os.medicao : ''}</td>
                </tr>
              </tbody>
            </table>

            {os.solicitado && (
              <div className="mb-4">
                <div className="text-[11px] font-bold uppercase text-stone-400 mb-1">Solicitação do fiscal</div>
                <div className="text-sm text-stone-900 border border-stone-200 rounded-lg p-3 min-h-[40px]">{os.solicitado}</div>
              </div>
            )}

            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase text-stone-400 mb-1">Serviço executado</div>
              <div className="text-sm text-stone-900 border border-stone-200 rounded-lg p-3 min-h-[52px]">{os.servico || ' '}</div>
            </div>

            <div className="mb-4">
              <div className="text-[11px] font-bold uppercase text-stone-400 mb-1">Materiais utilizados</div>
              <div className="text-sm text-stone-900 border border-stone-200 rounded-lg p-3 min-h-[44px]">{os.materiais || ' '}</div>
            </div>

            <div className="mb-5">
              <div className="text-[11px] font-bold uppercase text-fpv-600 mb-1">Memória de cálculo (medidas de campo)</div>
              <div className="text-sm text-stone-900 border-2 border-fpv-100 bg-fpv-50/40 rounded-lg p-3 min-h-[64px] font-medium">{os.memoria_calculo || ' '}</div>
            </div>

            {os.foto_urls?.length > 0 && (
              <div className="mb-5">
                <div className="text-[11px] font-bold uppercase text-stone-400 mb-2">Evidências fotográficas</div>
                <div className="grid grid-cols-3 gap-2">
                  {os.foto_urls.slice(0, 7).map((u, i) => (
                    <img key={i} src={u} alt={`foto ${i + 1}`} className="w-full h-28 object-cover rounded-lg border border-stone-200" />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-8 pt-8 mt-2">
              <div className="text-center">
                <div className="border-t-2 border-stone-400 pt-2 text-xs text-stone-600 font-medium">Encarregado — {os.executor || '____________'}</div>
                <div className="text-[10px] text-stone-400 mt-1">Data: ____/____/______</div>
              </div>
              <div className="text-center">
                <div className="border-t-2 border-stone-400 pt-2 text-xs text-stone-600 font-medium">Fiscal — {os.fiscal}</div>
                <div className="text-[10px] text-stone-400 mt-1">Data: ____/____/______</div>
              </div>
            </div>
          </div>
        ))}
        {selecionadas.length === 0 && (
          <p className="text-sm text-stone-400 text-center py-10 print-hidden">Nenhuma O.S. no período selecionado.</p>
        )}
      </div>
    </div>
  );
};

export default FechamentoSemanal;
