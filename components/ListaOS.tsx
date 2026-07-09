import React, { useState } from 'react';
import { Pencil, Trash2, Siren, Search, CheckCircle2, Hash, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { OSCampo, refDaOS } from '../types';
import { medDoMes, hojeLocal, DESIGNADOS } from '../config';
import { osService } from '../services/osService';

interface Props {
  lista: OSCampo[];
  aoEditar: (os: OSCampo) => void;
  aoMudar: () => void;
  filtroMinhas?: (os: OSCampo) => boolean; // o que é "meu": executor (encarregado) ou fiscal da zona (equipe)
  rotuloMinhas?: string;
  restrito?: boolean;   // campo vê SÓ as suas (decisão Renan 05/07) — sem "Todas"
  podeExcluir?: boolean; // AUDITORIA: excluir O.S. (dado de medição!) só gestão
  podePriorizar?: boolean; // RV000: prioridade operacional definida por Nicolas/Renan
}

// filtro de status pedido pelo Renan: pendente · executando ·
// pendente assinatura · concluídas (rótulo ≠ valor do banco)
const FILTROS_STATUS: { rotulo: string; casa: (os: OSCampo) => boolean }[] = [
  { rotulo: 'Todas', casa: () => true },
  { rotulo: 'Pendente', casa: os => os.status === 'Pendente' || os.status === 'Material' },
  { rotulo: 'Executando', casa: os => os.status === 'Executando' },
  { rotulo: 'Pend. assinatura', casa: os => os.status === 'Assinatura' },
  // 'Avaliando' saiu dos chips (Renan 08/07) — o status continua existindo
  // no formulário/banco; aqui só poluía com (0)
  { rotulo: 'Concluídas', casa: os => os.status === 'Concluído' },
];

const pillCor = (status: string) => {
  if (status === 'Concluído') return 'bg-fpv-50 text-fpv-700 border-fpv-100';
  if (status === 'Assinatura') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'Avaliando') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'Cancelada') return 'bg-stone-100 text-stone-500 border-stone-200';
  return 'bg-orange-50 text-orange-700 border-orange-200';
};

const diasDesde = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

// alerta de prazo — hoje derivado da entrada + emergencial (48h);
// quando o prazo do e-mail do fiscal entrar no banco, é só trocar aqui
const alertaPrazo = (os: OSCampo) => {
  if (['Concluído', 'Cancelada'].includes(os.status)) return null;
  const d = diasDesde(os.entrada);
  if (d == null) return null;
  const limite = os.emergencial ? 2 : 15;
  const aviso = os.emergencial ? 1 : 7;
  if (d > limite) return { txt: `⏰ ${d}d — prazo estourado`, cls: 'bg-red-50 text-red-700 border-red-200' };
  if (d > aviso) return { txt: `⏳ ${d}d em aberto`, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  return null;
};

const ListaOS: React.FC<Props> = ({ lista, aoEditar, aoMudar, filtroMinhas, rotuloMinhas = 'Minhas O.S.', restrito = false, podeExcluir = false, podePriorizar = false }) => {
  const [busca, setBusca] = useState('');
  const [soMinhas, setSoMinhas] = useState(!!filtroMinhas);
  const [filtro, setFiltro] = useState('Todas');
  const [mostrar, setMostrar] = useState(100); // com a planilha importada são ~1.800 O.S.
  const [aberta, setAberta] = useState<number | null>(null); // card expandido (descrição completa)
  // DESPACHO EM 2 ETAPAS (Renan 08/07): os chips de P/designado agora são
  // SELEÇÃO local — só o botão "✔ Enviar" grava e manda pro painel.
  const [pend, setPend] = useState<Record<number, { p: number | null; exec: string }>>({});
  const [enviandoId, setEnviandoId] = useState<number | null>(null);

  const enviarDesignacao = async (os: OSCampo) => {
    const pd = pend[os.id ?? -1];
    if (!pd || enviandoId) return;
    setEnviandoId(os.id ?? null);
    await osService.salvar({ ...os, executor: pd.exec, prioridade: pd.p });
    setEnviandoId(null);
    setPend(prev => { const n = { ...prev }; delete n[os.id ?? -1]; return n; });
    aoMudar();
  };

  // MEDIÇÃO FECHADA = intocável (spec do engenheiro): só a vigente edita.
  // Gestão ainda corrige (com aviso); campo não mexe.
  const medicaoFechada = (os: OSCampo) => !!(os.medicao || '').trim() && os.medicao !== medDoMes();
  const travada = (os: OSCampo) => medicaoFechada(os) && !podeExcluir;

  const minhas = filtroMinhas ? lista.filter(os => filtroMinhas(os) && os.status !== 'Cancelada') : [];
  const base = filtroMinhas && (soMinhas || restrito) ? minhas : lista;

  // fila de despacho do Nicolas (só gestão): abertas SEM designado —
  // depois do "✔ Enviar" a O.S. sai desta fila sozinha
  const FILTRO_A_DESIGNAR = {
    rotulo: 'A designar',
    casa: (os: OSCampo) => !os.excluida && !['Concluído', 'Cancelada'].includes(os.status)
      && !DESIGNADOS.some(d => d.executor === (os.executor || '').trim()),
  };
  const filtros = podePriorizar ? [...FILTROS_STATUS, FILTRO_A_DESIGNAR] : FILTROS_STATUS;
  const casaFiltro = filtros.find(f => f.rotulo === filtro)?.casa ?? (() => true);

  const filtradas = base.filter(os =>
    casaFiltro(os) && (
      !busca ||
      refDaOS(os).toLowerCase().includes(busca.toLowerCase()) ||
      String(os.numero ?? '').includes(busca) ||
      os.unidade.toLowerCase().includes(busca.toLowerCase()) ||
      (os.executor || '').toLowerCase().includes(busca.toLowerCase())
    )
  );

  const abertas = minhas.filter(os => !['Concluído', 'Cancelada'].includes(os.status));
  const semFoto = abertas.filter(os => !(os.foto_urls?.length > 0)).length;
  const semMem = abertas.filter(os => !(os.memoria_calculo || '').trim()).length;

  const excluir = async (os: OSCampo) => {
    if (!os.id) return;
    if (!confirm(`Marcar a O.S. ${refDaOS(os)} — ${os.unidade} como EXCLUÍDA?\n\nO número continua ocupado na contagem e a exclusão fica registrada no livro-razão (quem/quando).`)) return;
    await osService.excluir(os.id);
    aoMudar();
  };

  // SÓ CONCLUI COMPLETA — ajuste Renan 08/07: memória e executor seguem
  // OBRIGATÓRIOS (é o dinheiro), mas a FOTO virou CONFIRMÁVEL para o
  // campo: as O.S. chegam assinadas e a foto já está no grupo do
  // WhatsApp — o campo dá baixa (antes era a Brendah) e a evidência é
  // anexada depois pela mineração dos grupos.
  const ocupadoRef = React.useRef(false);
  const concluir = async (os: OSCampo) => {
    if (ocupadoRef.current) return; // anti duplo-toque
    if (!podeExcluir) {
      const falta: string[] = [];
      if (!(os.memoria_calculo || '').trim()) falta.push('memória de cálculo');
      if (!(os.executor || '').trim()) falta.push('executor');
      if (falta.length > 0) {
        alert(`⛔ Para CONCLUIR falta: ${falta.join(' + ')}.\n\nToque no lápis, complete e conclua — sem as informações a O.S. não será concluída.`);
        return;
      }
      if (!(os.foto_urls?.length > 0) &&
          !confirm(`Concluir a ${refDaOS(os)} SEM FOTO no app?\n\nOK só se a foto já está no GRUPO do WhatsApp — a gestão confere e anexa depois.`)) {
        return;
      }
    }
    ocupadoRef.current = true;
    await osService.salvar({ ...os, status: 'Concluído', conclusao: os.conclusao || hojeLocal() });
    ocupadoRef.current = false;
    aoMudar();
  };

  // a O.S. oficial chega DEPOIS pelo e-mail do fiscal (acontece direto na
  // emergencial): 1 toque vincula o nº oficial — o F-nº fica guardado,
  // então o cruzamento de material feito no F-nº não se perde
  const vincularNumero = async (os: OSCampo) => {
    const resp = prompt(`Nº OFICIAL da O.S. que chegou por e-mail\n(hoje é a ${refDaOS(os)} — ${os.unidade}):`);
    if (resp == null) return;
    const n = parseInt(resp.replace(/\D/g, ''), 10);
    if (!n) return;
    // mesma guarda anti-duplicata do formulário (refatoração sênior 06/07)
    const existe = await osService.numeroExiste(n);
    if (existe && existe.id !== os.id) {
      alert(`⛔ O nº ${n} JÁ EXISTE no banco (${existe.unidade} · ${existe.status}). Confira o e-mail — se for a mesma O.S., é ELA que deve ser trabalhada (ache na lista).`);
      return;
    }
    await osService.salvar({ ...os, numero: n });
    aoMudar();
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-bold text-stone-900 flex-1">
          {filtroMinhas && (soMinhas || restrito)
            ? <>{rotuloMinhas} <span className="text-stone-400 font-medium">({minhas.length})</span></>
            : <>O.S. no banco central <span className="text-stone-400 font-medium">({lista.length})</span></>}
        </h2>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-stone-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="nº, escola, executor…"
            className="pl-8 pr-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-stone-50 outline-none focus:border-fpv-500 w-48" />
        </div>
      </div>

      {filtroMinhas && !restrito && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button onClick={() => setSoMinhas(true)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${soMinhas ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'}`}>
            Minhas ({minhas.length})
          </button>
          <button onClick={() => setSoMinhas(false)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${!soMinhas ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'}`}>
            Todas ({lista.length})
          </button>
        </div>
      )}

      {/* filtro por status — conta de cada balde já no botão */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {filtros.map(f => {
          const n = f.rotulo === 'Todas' ? base.length : base.filter(f.casa).length;
          return (
            <button key={f.rotulo} onClick={() => setFiltro(f.rotulo)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${filtro === f.rotulo ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-500 border-stone-200'}`}>
              {f.rotulo} <span className="opacity-60">({n})</span>
            </button>
          );
        })}
      </div>

      {filtroMinhas && abertas.length > 0 && (
        <p className="text-[11px] text-stone-500 mb-3">
          {abertas.length} aberta{abertas.length !== 1 ? 's' : ''}
          {semFoto > 0 && <span className="text-amber-700 font-bold"> · {semFoto} sem foto</span>}
          {semMem > 0 && <span className="text-amber-700 font-bold"> · {semMem} sem memória</span>}
        </p>
      )}

      {filtradas.length === 0 && (
        <p className="text-sm text-stone-400 text-center py-8">
          {filtro !== 'Todas' ? `Nenhuma O.S. em "${filtro}".`
            : filtroMinhas ? 'Nenhuma O.S. sua ainda. Registre pelo Formulário 💪'
            : 'Nenhuma O.S. ainda. Registre a primeira no Formulário 💪'}
        </p>
      )}

      <div className="space-y-2">
        {filtradas.slice(0, mostrar).map(os => {
          const alerta = alertaPrazo(os);
          const exp = aberta === os.id;
          return (
            <div key={os.id} className={`border rounded-xl p-3 transition-colors ${travada(os) ? 'border-stone-100 bg-stone-50/60' : 'border-stone-100 hover:border-fpv-100'}`}>
              <div className="flex items-start gap-3">
                <div className="w-14 shrink-0 text-center">
                  <div className="font-bold text-stone-900 tabular-nums">{refDaOS(os)}</div>
                  {os.emergencial && <Siren size={13} className="text-red-500 mx-auto mt-1" />}
                </div>
                <button type="button" onClick={() => setAberta(exp ? null : (os.id ?? null))} className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium text-stone-800 truncate">{os.unidade}</div>
                  <div className="text-xs text-stone-500 truncate">{os.solicitado || os.servico || os.materiais || '—'}</div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {os.prioridade && <span className="text-[11px] font-black border rounded-full px-2 py-0.5 bg-red-600 text-white border-red-600">P{os.prioridade}</span>}
                    <span className={`text-[11px] font-bold border rounded-full px-2 py-0.5 ${pillCor(os.status)}`}>{os.status}{os.medicao ? ' · ' + os.medicao : ''}</span>
                    {os.excluida && <span className="text-[11px] font-bold border rounded-full px-2 py-0.5 bg-stone-800 text-white border-stone-800">🗑 EXCLUÍDA</span>}
                    {os.tipo && <span className={`text-[11px] font-bold border rounded-full px-2 py-0.5 ${os.tipo === 'Emergencial' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-stone-50 text-stone-500 border-stone-200'}`}>{os.tipo}</span>}
                    {medicaoFechada(os) && <span className="text-[11px] font-bold border rounded-full px-2 py-0.5 bg-stone-100 text-stone-500 border-stone-200">🔒 medição fechada</span>}
                    {alerta && <span className={`text-[11px] font-bold border rounded-full px-2 py-0.5 ${alerta.cls}`}>{alerta.txt}</span>}
                    {os.executor && <span className="text-[11px] text-stone-500">{os.executor}</span>}
                    {os.memoria_calculo && <span className="text-[11px] text-fpv-600 font-bold">📐 memória ok</span>}
                    {os.foto_urls?.length > 0 && <span className="text-[11px] text-stone-500">📷 {os.foto_urls.length}</span>}
                    {exp ? <ChevronUp size={13} className="text-stone-400" /> : <ChevronDown size={13} className="text-stone-300" />}
                  </div>
                </button>
                <div className="flex flex-col gap-1 shrink-0">
                  {travada(os) ? (
                    <span className="p-1.5 text-stone-300" title="Medição fechada — só a gestão altera"><Lock size={16} /></span>
                  ) : (
                    <>
                      {os.status !== 'Concluído' && (
                        <button onClick={() => concluir(os)} title="Marcar concluída"
                          className="p-1.5 text-fpv-600 hover:bg-fpv-50 rounded-lg"><CheckCircle2 size={16} /></button>
                      )}
                      {os.numero == null && (
                        <button onClick={() => vincularNumero(os)} title="Chegou a O.S. oficial por e-mail? Vincular nº"
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg"><Hash size={16} /></button>
                      )}
                      <button onClick={() => aoEditar(os)} title="Editar"
                        className="p-1.5 text-stone-400 hover:text-fpv-600 hover:bg-stone-50 rounded-lg"><Pencil size={16} /></button>
                      {podeExcluir && (
                        <button onClick={() => excluir(os)} title="Excluir"
                          className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16} /></button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* DESPACHO DA GESTÃO NO CARD RESUMIDO (Renan 08/07): chips
                  são SELEÇÃO — nada grava até tocar no "✔ Enviar" destacado.
                  Enviou → executor+P salvos → O.S. sai da fila "A designar"
                  e entra no quadro do designado. */}
              {podePriorizar && !travada(os) && (() => {
                const pd = pend[os.id ?? -1];
                const salvoP = os.prioridade ?? null;
                const salvoE = (os.executor || '').trim();
                const pAtual = pd ? pd.p : salvoP;
                const eAtual = pd ? pd.exec : salvoE;
                const mudou = !!pd; // pend só existe quando difere do salvo
                const jaDesignada = !pd && DESIGNADOS.some(d => d.executor === eAtual) && !!eAtual;
                // seleção que voltou a ser IGUAL ao salvo → limpa a pendência
                // (caso real 08/07: tirou e recolocou o mesmo nome e o card
                // ficava sem ENVIAR e sem selo — parecia travado)
                const aplica = (novoP: number | null, novoE: string) => setPend(prev => {
                  const n = { ...prev };
                  if (novoP === salvoP && novoE === salvoE) delete n[os.id ?? -1];
                  else n[os.id ?? -1] = { p: novoP, exec: novoE };
                  return n;
                });
                const marcaP = (p: number) => aplica(pAtual === p ? null : p, eAtual);
                const marcaE = (e: string) => { const novo = eAtual === e ? '' : e; aplica(pAtual ?? (novo ? 3 : null), novo); };
                return (
                  <div className="mt-2 ml-[4.25rem] flex items-center gap-1.5 flex-wrap">
                    {[1, 2, 3].map(p => (
                      <button key={p} onClick={() => marcaP(p)}
                        className={`text-[11px] font-bold border rounded-full px-2.5 py-0.5 ${pAtual === p ? 'bg-red-600 text-white border-red-600' : 'bg-white text-stone-500 border-stone-200'}`}>
                        P{p}
                      </button>
                    ))}
                    <span className="text-stone-200">·</span>
                    {DESIGNADOS.map(d => (
                      <button key={d.executor} onClick={() => marcaE(d.executor)}
                        className={`text-[11px] font-bold border rounded-full px-2.5 py-0.5 ${eAtual === d.executor ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-500 border-stone-200'}`}>
                        {d.rotulo.replace('Carlos Alberto', 'C. Alberto').replace('Eq. ', '')}
                      </button>
                    ))}
                    {mudou && (
                      <>
                        <button onClick={() => enviarDesignacao(os)} disabled={enviandoId === os.id}
                          className="text-[11px] font-black rounded-full px-3.5 py-1 bg-fpv-600 text-white shadow-md disabled:opacity-50 animate-pulse">
                          {enviandoId === os.id ? 'Enviando…' : '✔ ENVIAR'}
                        </button>
                        <button onClick={() => setPend(prev => { const n = { ...prev }; delete n[os.id ?? -1]; return n; })}
                          className="text-[11px] font-bold text-stone-400 underline">
                          cancelar
                        </button>
                      </>
                    )}
                    {jaDesignada && (
                      <>
                        <span className="text-[11px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-2 py-0.5">✔ designada</span>
                        {(() => {
                          const d = DESIGNADOS.find(x => x.executor === (os.executor || '').trim());
                          if (!d || !d.zap) return null;
                          const msg = `${d.rotulo}: te passei a O.S. ${refDaOS(os)} — ${os.unidade}. ${os.solicitado || os.servico || ''}${os.prioridade ? ` (P${os.prioridade})` : ''} · https://fpvieira.vercel.app`;
                          return (
                            <a href={`https://wa.me/${d.zap}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"
                              className="text-[11px] font-bold border rounded-full px-2.5 py-0.5 bg-green-50 text-green-700 border-green-200">
                              📲 Avisar
                            </a>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* descrição completa (spec do engenheiro: ver o texto da O.S.
                  do e-mail em qualquer status) — toque no card abre/fecha */}
              {exp && (
                <div className="mt-2 ml-[4.25rem] space-y-1.5 text-xs text-stone-600 border-t border-stone-100 pt-2">
                  {os.solicitado && <p><b className="text-stone-400 uppercase text-[10px]">Fiscal pediu (e-mail): </b>{os.solicitado}</p>}
                  {os.servico && <p><b className="text-stone-400 uppercase text-[10px]">Executado: </b>{os.servico}</p>}
                  {os.materiais && <p><b className="text-stone-400 uppercase text-[10px]">Materiais: </b>{os.materiais}</p>}
                  {os.memoria_calculo && <p><b className="text-stone-400 uppercase text-[10px]">Memória: </b>{os.memoria_calculo}</p>}
                  <p><b className="text-stone-400 uppercase text-[10px]">Fiscal: </b>{os.fiscal || '—'} · <b className="text-stone-400 uppercase text-[10px]">Entrada: </b>{os.entrada || '—'} · <b className="text-stone-400 uppercase text-[10px]">Conclusão: </b>{os.conclusao || '—'}</p>
                  {os.geo && (
                    <p><b className="text-stone-400 uppercase text-[10px]">Local do registro: </b>
                      <a href={`https://maps.google.com/?q=${os.geo.split(' ')[0]}`} target="_blank" rel="noreferrer" className="text-fpv-700 font-bold underline">📍 abrir no mapa</a>
                      <span className="text-stone-400"> ({os.geo})</span>
                    </p>
                  )}
                  {os.foto_urls?.length > 0 && (
                    <p className="flex gap-2 flex-wrap">
                      {os.foto_urls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="text-fpv-700 font-bold underline">📷 foto {i + 1}</a>
                      ))}
                    </p>
                  )}
                  {!os.solicitado && !os.servico && !os.materiais && !os.memoria_calculo && (
                    <p className="text-stone-400">Sem descrição registrada ainda — toque no lápis para completar.</p>
                  )}
                  {/* comandos de prioridade/designação subiram pro card
                      RESUMIDO (pedido Renan 08/07) — aqui só a leitura */}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {filtradas.length > mostrar && (
        <button onClick={() => setMostrar(m => m + 200)}
          className="w-full text-xs font-bold text-fpv-700 py-3">
          Carregar mais ({filtradas.length - mostrar} restantes)
        </button>
      )}
    </div>
  );
};

export default ListaOS;
