import React, { useEffect, useRef, useState } from 'react';
import { Save, Mic, Camera, X, Loader2, Eraser, Siren, PackageMinus, Plus, Minus } from 'lucide-react';
import { OSCampo, STATUS_OPTIONS, FISCAL_OPTIONS, CLASSIF_OPTIONS, EXECUTOR_OPTIONS, MED_OPTIONS, TIPO_OPTIONS, refDaOS } from '../types';
import { ESCOLAS } from '../data/escolas';
import { KIT_EMERGENCIAL } from '../data/materiais';
import { guiaMedida } from '../data/areas';
import { VOZ_ATIVA, GESTORES, EQUIPES, CORRETIVA, medDoMes, hojeLocal } from '../config';
import { osService } from '../services/osService';

const normaliza = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');

// defaults por login (spec Nicolas): equipe de emergência já entra com
// fiscal da zona + EMERGENCIAL ligado; encarregado corretivo já entra
// como executor — "responsável preenchido automaticamente com o login"
const vaziaPara = (usuario: string): OSCampo => {
  const equipe = EQUIPES[usuario];
  const corretiva = CORRETIVA[usuario];
  const executorLogado = corretiva?.executor ?? EXECUTOR_OPTIONS.find(e => normaliza(e) === normaliza(usuario));
  return {
    numero: null,
    emergencial: !!equipe,
    tipo: equipe ? 'Emergencial' : 'Corretiva',
    unidade: '',
    fiscal: equipe?.fiscal ?? 'Wellington',
    classificacao: equipe ? 'Emergencial' : 'Normal',
    entrada: hojeLocal(),
    conclusao: null,
    executor: executorLogado ?? '',
    status: 'Executando',
    medicao: '', solicitado: '', servico: '', materiais: '', memoria_calculo: '', foto_urls: []
  };
};

interface Props {
  editando: OSCampo | null;
  usuario: string;
  aoSalvar: () => void;
  aoCancelarEdicao: () => void;
}

const NovaOS: React.FC<Props> = ({ editando, usuario, aoSalvar, aoCancelarEdicao }) => {
  const equipe = EQUIPES[usuario];
  const corretiva = CORRETIVA[usuario];
  // prefixo da numeração automática: L/M (equipes) ou G/C (corretiva)
  const prefixoRef = equipe?.prefixo ?? corretiva?.prefixo;
  const ehGestor = GESTORES.includes(usuario);
  const [os, setOs] = useState<OSCampo>(() => vaziaPara(usuario));
  const [fotos, setFotos] = useState<File[]>([]);
  const [kit, setKit] = useState<Record<string, number>>({}); // descricao → qtd usada
  const [kitAberto, setKitAberto] = useState(false);
  const [baixaAuto, setBaixaAuto] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [ouvindo, setOuvindo] = useState(false);
  const recRef = useRef<any>(null);
  const fotoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editando) {
      setOs({ ...editando });
      // evita carregar fotos/kit de um formulário anterior para a O.S. editada
      setFotos([]);
      setKit({});
      setKitAberto(false);
      setMsg('');
    }
  }, [editando]);

  useEffect(() => {
    if (!VOZ_ATIVA) return; // voz desligada nesta semana — formulário é digitado
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      recRef.current = new SR();
      recRef.current.lang = 'pt-BR';
      recRef.current.continuous = true;
      recRef.current.interimResults = false;
      recRef.current.onresult = (ev: any) => {
        let texto = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) texto += ev.results[i][0].transcript;
        setOs(prev => ({ ...prev, memoria_calculo: (prev.memoria_calculo ? prev.memoria_calculo + ' ' : '') + texto.trim() }));
      };
      recRef.current.onend = () => setOuvindo(false);
    }
  }, []);

  const ditar = () => {
    if (!recRef.current) { setMsg('Ditado não suportado neste navegador — use o Chrome.'); return; }
    if (ouvindo) { recRef.current.stop(); setOuvindo(false); }
    else { recRef.current.start(); setOuvindo(true); }
  };

  const campo = (k: keyof OSCampo, v: any) => setOs(prev => ({ ...prev, [k]: v }));

  const limpar = () => { setOs(vaziaPara(usuario)); setFotos([]); setKit({}); setKitAberto(false); setMsg(''); aoCancelarEdicao(); };

  const mudaKit = (descricao: string, delta: number) =>
    setKit(prev => {
      const q = Math.max(0, (prev[descricao] || 0) + delta);
      const novo = { ...prev };
      if (q === 0) delete novo[descricao]; else novo[descricao] = q;
      return novo;
    });

  const itensKit = KIT_EMERGENCIAL
    .filter(i => kit[i.descricao] > 0)
    .map(i => ({ descricao: i.descricao, quantidade: kit[i.descricao], unidade: i.unidade }));

  // guia de medida específico pelo texto do serviço (fórmula EMOP certa)
  const guia = guiaMedida(`${os.servico} ${os.solicitado || ''}`.trim(), os.area);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return; // anti duplo-toque (refatoração sênior 06/07)
    // ===== validações SÍNCRONAS (antes de travar o botão) =====
    if (!os.unidade.trim()) { setMsg('Informe a unidade (escola).'); return; }
    if (equipe && !os.executor) { setMsg('Toque em QUEM EXECUTOU (botões da equipe).'); return; }
    // MEDIÇÃO FECHADA é intocável pelo campo (spec do engenheiro) —
    // só a vigente edita; gestão corrige com essa responsabilidade
    if (!ehGestor && os.id && (os.medicao || '').trim() && os.medicao !== medDoMes()) {
      setMsg(`🔒 Esta O.S. está na ${os.medicao} (medição FECHADA) — não pode mais ser alterada. Fale com a gestão.`);
      return;
    }
    // SÓ CONCLUI COMPLETA — ajuste Renan 08/07: memória + executor seguem
    // obrigatórios; FOTO virou confirmável (O.S. chega assinada e a foto
    // está no grupo do WhatsApp — o campo dá baixa, evidência anexa depois)
    if (!ehGestor && os.status === 'Concluído') {
      const falta: string[] = [];
      if (!os.memoria_calculo.trim()) falta.push('memória de cálculo');
      if (!os.executor.trim()) falta.push('executor');
      if (falta.length > 0) { setMsg(`⛔ Para CONCLUIR falta: ${falta.join(' + ')}. Sem as informações a O.S. não será concluída.`); return; }
      if (os.foto_urls.length + fotos.length === 0 &&
          !confirm('Concluir SEM FOTO no app?\n\nOK só se a foto já está no GRUPO do WhatsApp — a gestão confere e anexa depois.')) {
        setMsg('Conclusão pausada — anexe a foto ou confirme que ela está no grupo.');
        return;
      }
    }
    // ===== daqui pra baixo é assíncrono: botão TRAVADO =====
    setSalvando(true);
    setMsg('');
    // GUARDA ANTI-DUPLICATA (caso real 06/07: digitaram "79" seguindo a
    // contagem do papel e colidiu com a O.S. 79 oficial de janeiro)
    if (!os.id && os.numero) {
      const existe = await osService.numeroExiste(Number(os.numero));
      if (existe) {
        if (!ehGestor) {
          setSalvando(false);
          setMsg(`⛔ A O.S. ${os.numero} JÁ EXISTE (${existe.unidade} · ${existe.status}). Se a sua é NOVA, deixe o Nº VAZIO — o sistema gera o ${prefixoRef ?? 'F'}-nº sozinho. Se é a mesma, ache-a na lista e edite pelo lápis.`);
          return;
        }
        if (!confirm(`O.S. ${os.numero} já existe (${existe.unidade} · ${existe.status}). Criar DUPLICADA mesmo assim?`)) { setSalvando(false); return; }
      }
    }

    // AUDITORIA: se o upload de foto falhar (sinal ruim na escola), NÃO salva
    // silenciosamente sem evidência — pergunta antes. Foto perdida = risco de glosa.
    const { urls: novas, falhas } = await osService.uploadFotos(fotos);
    if (falhas > 0) {
      const segue = confirm(`⚠️ ${falhas} foto(s) FALHARAM no envio (sinal fraco?).\n\nOK = salvar mesmo assim (sem essas fotos)\nCancelar = tentar de novo com as fotos`);
      if (!segue) { setSalvando(false); setMsg(`Envio pausado — ${falhas} foto(s) não subiram. Tente salvar de novo.`); return; }
    }
    const urls = [...os.foto_urls, ...novas];

    // GEO (Renan 08/07): carimba onde o celular estava ao salvar — prova
    // de presença na escola. NÃO trava o salvamento: sem sinal ou sem
    // permissão, segue sem coordenada.
    const geo = await new Promise<string | null>(res => {
      if (!('geolocation' in navigator)) return res(null);
      const t = setTimeout(() => res(null), 4000);
      navigator.geolocation.getCurrentPosition(
        p => { clearTimeout(t); res(`${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)} ±${Math.round(p.coords.accuracy)}m`); },
        () => { clearTimeout(t); res(null); },
        { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 }
      );
    });

    // itens do kit entram por escrito nos materiais da O.S. (rastro na própria O.S.)
    const textoKit = itensKit.map(i => `${i.quantidade} ${i.unidade} ${i.descricao}`).join(' + ');
    const materiais = [os.materiais.trim(), textoKit ? `[KIT] ${textoKit}` : ''].filter(Boolean).join('\n');

    const dados = { ...os, materiais, foto_urls: urls, numero: os.numero ? Number(os.numero) : null, ...(geo ? { geo } : {}) };
    // sem nº oficial → numeração automática da equipe/encarregado
    // (L/M emergência · G/C corretiva), gerada no banco
    const resultado = prefixoRef
      ? await osService.salvarEquipe(dados, prefixoRef)
      : await osService.salvar(dados);
    setSalvando(false);
    if (!resultado.ok) { setMsg('Erro ao salvar: ' + (resultado.erro || 'verifique a conexão')); return; }

    const salva = resultado.os;
    const ref = salva && (salva.numero != null || salva.fict_ref || salva.numero_fict) ? refDaOS(salva) : '';

    // baixa automática do kit no estoque, amarrada ao nº que o banco devolveu
    let msgKit = '';
    if (!os.id && itensKit.length > 0 && baixaAuto) {
      const falhasKit = await osService.baixaKit(itensKit, ref, os.unidade);
      msgKit = falhasKit > 0
        ? ` ⚠️ ${falhasKit} item(ns) do kit NÃO baixaram no estoque — avise o João.`
        : ` 📦 ${itensKit.length} item(ns) do kit baixados no estoque${ref ? ' → O.S. ' + ref : ''}.`;
    }

    setMsg((os.id ? 'O.S. atualizada ✔' : `O.S. ${ref ? ref + ' ' : ''}registrada no banco central ✔`) + (falhas > 0 ? ` (sem ${falhas} foto(s) que falharam)` : '') + msgKit);
    setOs(vaziaPara(usuario));
    setFotos([]);
    setKit({});
    setKitAberto(false);
    aoSalvar();
  };

  // classificação legada (I/II/III da planilha importada) continua visível na edição
  const classifs = os.classificacao && !CLASSIF_OPTIONS.includes(os.classificacao)
    ? [...CLASSIF_OPTIONS, os.classificacao] : CLASSIF_OPTIONS;

  return (
    <form onSubmit={salvar} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-4">
      <div className="space-y-2">
        <h2 className="font-bold text-stone-900">{os.id ? `Editando O.S. ${refDaOS(os)}` : 'Registrar O.S. de campo'}</h2>
        {/* tipo da atividade (decisão Renan 06/07): 3 opções no lugar do
            liga/desliga — emergencial continua acionando kit/prazos */}
        <div className="flex gap-2">
          {TIPO_OPTIONS.map(t => {
            const ativo = (os.tipo ?? (os.emergencial ? 'Emergencial' : '')) === t;
            const corAtivo = t === 'Emergencial' ? 'bg-red-600 text-white border-red-600' : 'bg-fpv-600 text-white border-fpv-600';
            return (
              <button key={t} type="button"
                onClick={() => setOs(prev => ({ ...prev, tipo: t, emergencial: t === 'Emergencial' }))}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-2 py-2 rounded-full border ${ativo ? corAtivo : 'bg-stone-50 text-stone-500 border-stone-200'}`}>
                {t === 'Emergencial' && <Siren size={13} />} {t.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      {equipe && !os.id && (
        <p className="text-[11px] text-stone-500 -mt-2">
          {equipe.apelido} · fiscal {equipe.fiscal} já preenchido · sem nº? o sistema gera o <b>{equipe.prefixo}-nº</b> na hora · medição vigente: <b>{medDoMes()}</b> (automática no fechamento)
        </p>
      )}
      {corretiva && !os.id && (
        <p className="text-[11px] text-stone-500 -mt-2">
          {corretiva.executor} já preenchido como executor · sem nº? o sistema gera o <b>{corretiva.prefixo}-nº</b> na hora · medição vigente: <b>{medDoMes()}</b>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Nº da O.S.</label>
          <input type="number" value={os.numero ?? ''} onChange={e => campo('numero', e.target.value ? Number(e.target.value) : null)}
            placeholder={prefixoRef ? `vazio = gera ${prefixoRef}-nº` : 'vazio = gera F-nº'}
            className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Data (edite se retroativo)</label>
          <input type="date" value={os.entrada ?? ''} onChange={e => campo('entrada', e.target.value || null)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Unidade (escola)</label>
        <input list="escolas" value={os.unidade} onChange={e => campo('unidade', e.target.value)} required
          placeholder="comece a digitar…"
          className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
        <datalist id="escolas">{ESCOLAS.map(e => <option key={e} value={e} />)}</datalist>
      </div>

      {/* executor em 1 toque: membros da equipe do login */}
      {equipe && (
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Quem executou (equipe)</label>
          <div className="flex gap-2 flex-wrap">
            {equipe.membros.map(m => (
              <button key={m} type="button" onClick={() => campo('executor', m)}
                className={`rounded-full border px-3.5 py-2 text-xs font-bold ${os.executor === m ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Fiscal</label>
          <select value={os.fiscal} onChange={e => campo('fiscal', e.target.value)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500">
            {FISCAL_OPTIONS.map(f => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Classificação</label>
          <select value={os.classificacao} onChange={e => campo('classificacao', e.target.value)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500">
            {classifs.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        {!equipe && (
          <div>
            <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Executor</label>
            <input list="executores" value={os.executor} onChange={e => campo('executor', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
            <datalist id="executores">{EXECUTOR_OPTIONS.map(x => <option key={x} value={x} />)}</datalist>
          </div>
        )}
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Status</label>
          <select value={os.status} onChange={e => campo('status', e.target.value)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500">
            {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Conclusão</label>
          <input type="date" value={os.conclusao ?? ''} onChange={e => campo('conclusao', e.target.value || null)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
        </div>
        {/* medição SAIU do painel do campo (decisão Renan 05/07): entra
            automática no fechamento — MED do mês vigente. Gestão ainda edita. */}
        {ehGestor && (
          <div>
            <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Medição</label>
            <select value={os.medicao} onChange={e => campo('medicao', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500">
              {(os.medicao && !MED_OPTIONS.includes(os.medicao) ? [...MED_OPTIONS, os.medicao] : MED_OPTIONS)
                .map(m => <option key={m} value={m}>{m || '—'}</option>)}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">O que o fiscal solicitou</label>
        <textarea value={os.solicitado ?? ''} onChange={e => campo('solicitado', e.target.value)} rows={2}
          placeholder="a demanda que chegou (e-mail, WhatsApp ou verbal do fiscal)"
          className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500 resize-y" />
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Serviço executado</label>
        <textarea value={os.servico} onChange={e => campo('servico', e.target.value)} rows={2}
          placeholder="ex.: troca de 2 sifões e 1 torneira no banheiro masc. bloco B"
          className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500 resize-y" />
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Materiais utilizados</label>
        <textarea value={os.materiais} onChange={e => campo('materiais', e.target.value)} rows={2}
          placeholder="ex.: 2 UND sifão + 1 UND torneira + 1 UND fita teflon"
          className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500 resize-y" />
      </div>

      {/* KIT EMERGENCIAL (spec Nicolas): lista padrão, baixa automática no estoque */}
      {!os.id && (equipe || os.emergencial) && (
        <div className="border border-red-100 bg-red-50/40 rounded-xl p-3">
          <button type="button" onClick={() => setKitAberto(a => !a)}
            className="w-full flex items-center gap-2 text-sm font-bold text-red-700">
            <PackageMinus size={16} /> Kit emergencial
            {itensKit.length > 0 && <span className="text-[11px] bg-red-600 text-white rounded-full px-2 py-0.5">{itensKit.length}</span>}
            <span className="ml-auto text-stone-400 font-medium text-xs">{kitAberto ? 'fechar ▲' : 'usar itens do kit ▼'}</span>
          </button>
          {kitAberto && (
            <div className="mt-3 space-y-1.5">
              {KIT_EMERGENCIAL.map(i => (
                <div key={i.descricao} className="flex items-center gap-2 text-sm bg-white border border-stone-100 rounded-lg px-3 py-1.5">
                  <span className="flex-1 min-w-0 truncate text-stone-700">{i.descricao}</span>
                  <span className="text-[10px] text-stone-400">{i.unidade}</span>
                  <button type="button" onClick={() => mudaKit(i.descricao, -1)} className="p-1 text-stone-400 hover:text-red-600"><Minus size={14} /></button>
                  <span className={`w-7 text-center font-bold tabular-nums ${kit[i.descricao] ? 'text-red-700' : 'text-stone-300'}`}>{kit[i.descricao] || 0}</span>
                  <button type="button" onClick={() => mudaKit(i.descricao, +1)} className="p-1 text-stone-400 hover:text-fpv-600"><Plus size={14} /></button>
                </div>
              ))}
              <label className="flex items-center gap-2 text-xs font-bold text-stone-600 pt-1 cursor-pointer">
                <input type="checkbox" checked={baixaAuto} onChange={e => setBaixaAuto(e.target.checked)} />
                dar baixa automática no estoque ao salvar
              </label>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Memória de cálculo (medidas do campo)
          {VOZ_ATIVA && (
            <button type="button" onClick={ditar}
              className={`float-right flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${ouvindo ? 'bg-red-500 text-white border-red-500 animate-pulse' : 'bg-fpv-50 text-fpv-700 border-fpv-100 hover:bg-fpv-100'}`}>
              <Mic size={13} /> {ouvindo ? 'Ouvindo… toque p/ parar' : 'Ditar por voz'}
            </button>
          )}
        </label>
        {(os.servico || os.solicitado) && (
          <p className="text-[11px] text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-lg px-2.5 py-1.5 mb-1.5">📐 {guia}</p>
        )}
        <textarea value={os.memoria_calculo} onChange={e => campo('memoria_calculo', e.target.value)} rows={3}
          placeholder="ex.: parede 3,85 × 1,20 = 4,62 m² · rodapé 7 m lineares · 2 und porta 0,80"
          className="w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500 resize-y" />
      </div>

      <div>
        <label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Fotos (antes / depois)</label>
        <input ref={fotoRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { if (e.target.files) { const selecionadas = Array.from(e.target.files) as File[]; setFotos(prev => [...prev, ...selecionadas].slice(0, 7)); } e.target.value = ''; }} />
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => fotoRef.current?.click()}
            className="flex items-center gap-2 text-sm font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 px-4 py-2.5 rounded-lg hover:bg-fpv-100">
            <Camera size={16} /> Tirar / anexar foto
          </button>
          {fotos.map((f, i) => (
            <span key={i} className="flex items-center gap-1 text-xs bg-stone-100 border border-stone-200 rounded-full px-3 py-1.5">
              📷 {f.name.slice(0, 14)}…
              <button type="button" onClick={() => setFotos(fotos.filter((_, j) => j !== i))}><X size={12} /></button>
            </span>
          ))}
          {os.foto_urls.length > 0 && <span className="text-xs text-stone-400">{os.foto_urls.length} já no banco</span>}
        </div>
      </div>

      {msg && <div className="text-sm font-medium text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-lg px-3 py-2">{msg}</div>}

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={salvando}
          className="flex-1 bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
          {salvando ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {salvando ? 'Enviando…' : (os.id ? 'Salvar alterações' : 'Salvar O.S.')}
        </button>
        <button type="button" onClick={limpar}
          className="px-4 py-3.5 rounded-xl border border-stone-200 text-stone-500 hover:bg-stone-50" title="Limpar">
          <Eraser size={18} />
        </button>
      </div>
    </form>
  );
};

export default NovaOS;
