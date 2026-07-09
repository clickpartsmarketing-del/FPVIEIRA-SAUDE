import React, { useEffect, useState } from 'react';
import { Siren, AlertTriangle, Camera, CheckCircle2, ArrowRight, Package, Send, ClipboardCheck } from 'lucide-react';
import { OSCampo, refDaOS } from '../types';
import { medDoMes } from '../config';
import { supabase } from '../services/supabaseClient';

// configuração do painel: equipe de emergência (filtra pela ZONA do
// fiscal) ou encarregado corretivo (filtra pelo EXECUTOR)
export interface PainelCfg {
  titulo: string;
  apelido: string;
  prefixo: string;
  membros: string[];
  filtro: (os: OSCampo) => boolean;
}

// =============================================================
// PAINEL DA EQUIPE DE EMERGÊNCIA — a zona do fiscal num relance:
// o que está estourando, o que falta evidência e o que priorizar
// AGORA. Alimenta o mesmo banco que a Gestão e o medidor veem.
// =============================================================

const dias = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

const rotulo = refDaOS;

interface Solicitacao {
  id?: number; data: string; solicitante: string; os_ref?: string | null;
  itens: string; status: string;
}

interface Props {
  lista: OSCampo[];
  cfg: PainelCfg;
  aoVerLista: () => void;
  aoNovaOS: () => void;
}

const PainelEquipe: React.FC<Props> = ({ lista, cfg, aoVerLista, aoNovaOS }) => {
  // ===== material: pedir ao almoxarifado + confirmar recebimento =====
  const [pedidoAberto, setPedidoAberto] = useState(false);
  const [itensPedido, setItensPedido] = useState('');
  const [osPedido, setOsPedido] = useState('');
  const [membroPedido, setMembroPedido] = useState(''); // REV 001: quem da equipe pede
  const [meusPedidos, setMeusPedidos] = useState<Solicitacao[]>([]);
  const [retiradas, setRetiradas] = useState<any[]>([]);
  const [msgMat, setMsgMat] = useState('');

  const jaAbriuSozinho = React.useRef(false);
  const carregarMaterial = async () => {
    const { data } = await supabase.from('solicitacao_material').select('*')
      .like('solicitante', `${cfg.apelido}%`).order('criado_em', { ascending: false }).limit(6);
    if (data) setMeusPedidos(data as Solicitacao[]);
    // saídas do almoxarifado aguardando confirmação — match do destinatário
    // TOLERANTE (1º teste real: João digitou "Gilson " com espaço no fim)
    const { data: r } = await supabase.from('saida_material').select('*')
      .eq('recebido', false).order('criado_em', { ascending: false }).limit(50);
    if (r) {
      const nrm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const meus = [cfg.apelido, ...cfg.membros].map(nrm);
      const minhas = r.filter((s: any) => meus.includes(nrm(s.destinatario)));
      setRetiradas(minhas);
      // adoção real (12 pendentes, 0 confirmadas no dia 1): se tem coisa
      // p/ confirmar, a seção ABRE SOZINHA — 1ª vez por visita
      const temSeparado = (data || []).some((q: any) => q.status === 'SEPARADO');
      if ((minhas.length > 0 || temSeparado) && !jaAbriuSozinho.current) {
        jaAbriuSozinho.current = true;
        setPedidoAberto(true);
      }
    }
  };
  useEffect(() => { carregarMaterial(); }, []);

  // TEMPO REAL: quando o João separa o pedido ou registra retirada no
  // nome da equipe, o botão RECEBI aparece aqui na hora
  useEffect(() => {
    let t: any;
    const bump = () => { clearTimeout(t); t = setTimeout(carregarMaterial, 1200); };
    const ch = supabase.channel(`rt-material-${cfg.prefixo}`);
    for (const tb of ['solicitacao_material', 'saida_material']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump);
    }
    ch.subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, []);

  const enviandoRef = React.useRef(false);
  const enviarPedido = async () => {
    if (enviandoRef.current) return; // anti duplo-toque
    if (!itensPedido.trim()) { setMsgMat('Escreva os itens — um por linha, com quantidade.'); return; }
    // REV 001 do gestor: o pedido identifica a PESSOA, não só a equipe
    if (cfg.membros.length > 1 && !membroPedido) { setMsgMat('Toque em QUEM está pedindo (botões acima).'); return; }
    enviandoRef.current = true;
    const solicitante = membroPedido ? `${cfg.apelido} · ${membroPedido}` : cfg.apelido;
    const { error } = await supabase.from('solicitacao_material').insert([{
      solicitante, os_ref: osPedido || null, itens: itensPedido.trim()
    }]);
    enviandoRef.current = false;
    if (error) { setMsgMat(/solicitacao_material/.test(error.message) ? '⚠️ O gestor precisa rodar o ALMOX-V2.sql primeiro.' : 'Erro: ' + error.message); return; }
    setMsgMat('📦 Pedido enviado ao almoxarifado!');
    setItensPedido(''); setOsPedido(''); setMembroPedido(''); setPedidoAberto(false);
    carregarMaterial();
  };

  const confirmarRecebido = async (q: Solicitacao) => {
    await supabase.from('solicitacao_material').update({ status: 'RECEBIDO' }).eq('id', q.id);
    carregarMaterial();
  };
  const confirmarRetirada = async (r: any) => {
    await supabase.from('saida_material').update({ recebido: true }).eq('id', r.id);
    carregarMaterial();
  };
  const zona = lista.filter(o => cfg.filtro(o) && o.status !== 'Cancelada');
  // última numeração DA EQUIPE (spec do engenheiro: "no topo, qual foi a
  // última utilizada") — L/M-nº novo; cai pro F-nn legado se ainda não há
  const ultimaEquipe = lista.reduce((m, o) => {
    if (!o.fict_ref || !o.fict_ref.startsWith(cfg.prefixo)) return m;
    const n = parseInt(o.fict_ref.slice(cfg.prefixo.length), 10);
    return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  const ultimaF = lista.reduce((m, o) => Math.max(m, o.numero_fict || 0), 0);
  const chipUltima = ultimaEquipe > 0
    ? `última ${cfg.prefixo}${String(ultimaEquipe).padStart(2, '0')}`
    : ultimaF > 0 ? `última F-${ultimaF}` : '';
  const abertas = zona.filter(o => o.status !== 'Concluído');
  const estourou = (o: OSCampo) => {
    const d = dias(o.entrada);
    return d != null && d > (o.emergencial ? 2 : 15);
  };

  // PAINEL PESSOAL (decisão Renan 08/07): o colaborador vê SÓ o que é
  // dele — designadas para fazer + concluídas por ele. O placar da zona
  // (abertas/estouradas/sem foto/funil) SAIU: era herança da planilha,
  // assustava sem ser trabalho da equipe. A visão da zona continua na
  // lista ("Ver todas") e na Gestão.
  const doQuadro = lista.filter(o => {
    if (!o.prioridade || o.excluida || ['Concluído', 'Cancelada'].includes(o.status)) return false;
    return cfg.membros.includes((o.executor || '').trim());
  });
  const prioridade = [...doQuadro]
    .sort((a, b) => {
      if (a.prioridade !== b.prioridade) return (a.prioridade || 9) - (b.prioridade || 9);
      if (a.emergencial !== b.emergencial) return a.emergencial ? -1 : 1;
      return (dias(b.entrada) ?? 0) - (dias(a.entrada) ?? 0);
    }).slice(0, 8);
  // Assinatura + Concluídas GERAIS da base (ajuste Renan 08/07: o recorte
  // de 7 dias não interessava — vale o total do colaborador)
  const minhasAssinatura = lista.filter(o =>
    !o.excluida && o.status === 'Assinatura' &&
    cfg.membros.includes((o.executor || '').trim()));
  const minhasConcluidas = lista.filter(o =>
    !o.excluida && o.status === 'Concluído' &&
    cfg.membros.includes((o.executor || '').trim())
  ).sort((a, b) => (dias(a.conclusao) ?? 9999) - (dias(b.conclusao) ?? 9999));

  const Kpi = ({ n, rot, alerta }: { n: number; rot: string; alerta?: boolean }) => (
    <div className={`rounded-2xl border shadow-sm p-3 text-center ${alerta && n > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200'}`}>
      <div className={`text-2xl font-bold tabular-nums ${alerta && n > 0 ? 'text-red-700' : 'text-stone-900'}`}>{n}</div>
      <div className={`text-[10px] font-bold uppercase leading-tight ${alerta && n > 0 ? 'text-red-600' : 'text-stone-400'}`}>{rot}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Siren size={18} className="text-red-600" />
        <h2 className="font-bold text-stone-900 flex-1">{cfg.titulo}</h2>
        <span className="text-[11px] font-bold text-stone-400">{medDoMes()} vigente</span>
        {chipUltima && (
          <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 rounded-full px-2 py-0.5" title="última numeração usada pela equipe (a próxima o sistema gera sozinho)">
            {chipUltima}
          </span>
        )}
      </div>

      {/* placar PESSOAL — as 3 confirmações (Renan 08/07): designadas
          para fazer · em assinatura · concluídas (total na base) */}
      <div className="grid grid-cols-3 gap-2">
        <Kpi n={doQuadro.length} rot="para fazer (designadas)" alerta />
        <Kpi n={minhasAssinatura.length} rot="em assinatura" />
        <Kpi n={minhasConcluidas.length} rot="concluídas (total)" />
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
        <h3 className="font-bold text-stone-900 text-sm mb-2 flex items-center gap-2">
          <AlertTriangle size={15} className="text-red-600" /> Prioridade agora
        </h3>
        {prioridade.length === 0 && (
          <p className="text-sm text-stone-400 text-center py-6">
            Nada para fazer agora — quando a gestão te designar uma O.S., ela aparece aqui. 💪
          </p>
        )}
        <div className="space-y-1.5">
          {prioridade.map(o => {
            const d = dias(o.entrada);
            return (
              <div key={o.id} className="flex items-center gap-2.5 border border-stone-100 rounded-xl px-3 py-2">
                {o.prioridade && <span className="text-[10px] font-black bg-red-600 text-white rounded-full px-1.5 py-0.5 shrink-0">P{o.prioridade}</span>}
                <span className="w-12 shrink-0 text-center font-bold text-stone-900 tabular-nums text-sm">{rotulo(o)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-stone-800 truncate">{o.unidade}</div>
                  <div className="text-[11px] text-stone-400 truncate">{o.solicitado || o.servico || '—'}</div>
                </div>
                {o.emergencial && <Siren size={13} className="text-red-500 shrink-0" />}
                {!(o.foto_urls?.length > 0) && <Camera size={13} className="text-amber-500 shrink-0" />}
                {d != null && (
                  <span className={`text-[11px] font-bold border rounded-full px-2 py-0.5 shrink-0 ${estourou(o) ? 'bg-red-50 text-red-700 border-red-200' : 'bg-stone-50 text-stone-500 border-stone-200'}`}>
                    {d}d
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {abertas.length > 0 && (
          <button onClick={aoVerLista} className="w-full text-xs font-bold text-fpv-700 pt-3 flex items-center justify-center gap-1">
            Ver todas as suas O.S. <ArrowRight size={13} />
          </button>
        )}
      </div>

      {/* lista de concluídas SAIU do painel (Renan 08/07) — o TOTAL segue
          no placar de cima; o histórico completo fica na aba de O.S.
          (filtro "Concluídas") */}

      <div className="bg-fpv-50 border border-fpv-100 rounded-2xl p-4 text-sm text-fpv-900">
        <div className="flex items-start gap-3">
          <ClipboardCheck size={18} className="text-fpv-700 shrink-0 mt-0.5" />
          <div>
            <b className="block text-fpv-900">Roteiro simples da equipe</b>
            <span>1) Abra a prioridade. 2) Execute. 3) Tire foto e escreva a memória. 4) Só conclua quando estiver tudo completo.</span>
          </div>
        </div>
      </div>

      <button onClick={aoNovaOS}
        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-sm">
        <Siren size={18} /> REGISTRO DE ORDEM DE SERVIÇO / EMERGENCIAL AGORA
      </button>

      {/* ===== MATERIAL: pedir ao almoxarifado + confirmar recebimento ===== */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 space-y-2">
        <button onClick={() => setPedidoAberto(a => !a)} className="w-full flex items-center gap-2 text-sm font-bold text-stone-900">
          <Package size={16} className="text-fpv-600" /> Material com o almoxarifado
          {(retiradas.length > 0 || meusPedidos.some(q => q.status === 'SEPARADO')) &&
            <span className="text-[10px] bg-red-600 text-white rounded-full px-2 py-0.5">confirmar!</span>}
          <span className="ml-auto text-stone-400 font-medium text-xs">{pedidoAberto ? 'fechar ▲' : 'abrir ▼'}</span>
        </button>

        {pedidoAberto && (
          <div className="space-y-2 pt-1">
            {cfg.membros.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {cfg.membros.map(m => (
                  <button key={m} type="button" onClick={() => setMembroPedido(m)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold ${membroPedido === m ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'}`}>
                    {m}
                  </button>
                ))}
              </div>
            )}
            <textarea value={itensPedido} onChange={e => setItensPedido(e.target.value)} rows={3}
              placeholder={'um item por linha, com quantidade:\n2 UND SIFÃO\n10 M FIO 2,5MM'}
              className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500 resize-y" />
            <div className="flex gap-2">
              <input value={osPedido} onChange={e => setOsPedido(e.target.value)} placeholder="O.S. (opcional)"
                className="w-32 border border-stone-200 rounded-lg px-3 py-2 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
              <button onClick={enviarPedido} className="flex-1 bg-fpv-600 hover:bg-fpv-700 text-white font-bold rounded-lg py-2 text-sm flex items-center justify-center gap-1.5">
                <Send size={14} /> Enviar pedido
              </button>
            </div>
          </div>
        )}
        {msgMat && <p className="text-xs font-bold text-fpv-700">{msgMat}</p>}

        {meusPedidos.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {meusPedidos.map(q => (
              <div key={q.id} className="flex items-center gap-2 text-xs border border-stone-100 rounded-lg px-2.5 py-1.5">
                <span className="flex-1 min-w-0 truncate text-stone-600">{q.itens.split('\n')[0]}{q.itens.includes('\n') ? '…' : ''}{q.os_ref ? ` · O.S. ${q.os_ref}` : ''}</span>
                <span className={`font-bold rounded-full px-2 py-0.5 text-[10px] ${q.status === 'PEDIDO' ? 'bg-stone-100 text-stone-500' : q.status === 'SEPARADO' ? 'bg-amber-500 text-white' : 'bg-fpv-600 text-white'}`}>{q.status}</span>
                {q.status === 'SEPARADO' && (
                  <button onClick={() => confirmarRecebido(q)} className="font-bold text-white bg-fpv-600 rounded-full px-2 py-0.5 text-[10px]">RECEBI ✔</button>
                )}
              </div>
            ))}
          </div>
        )}

        {retiradas.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] font-bold text-amber-800">O almoxarifado registrou estas retiradas no seu nome — confirme:</p>
            {retiradas.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs border border-amber-200 bg-amber-50/50 rounded-lg px-2.5 py-1.5">
                <span className="flex-1 min-w-0 truncate text-stone-700"><b>{r.quantidade} {r.unidade}</b> {r.descricao}{r.os_ref ? ` · O.S. ${r.os_ref}` : ''}</span>
                <button onClick={() => confirmarRetirada(r)} className="font-bold text-white bg-fpv-600 rounded-full px-2 py-0.5 text-[10px]">RECEBI ✔</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-stone-400 text-center flex items-center justify-center gap-1">
        <CheckCircle2 size={12} /> Tudo que salvar aqui cai no banco central e na planilha do medidor.
      </p>
    </div>
  );
};

export default PainelEquipe;
