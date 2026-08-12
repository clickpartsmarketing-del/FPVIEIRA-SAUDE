import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, Check, ChevronDown, Clock, Copy, Download, Hash,
  PenLine, Pencil, Route, Ruler, ShieldCheck, Siren, TriangleAlert, Undo2,
  UserCheck, X, Zap
} from 'lucide-react';
import { OSCampo, refDaOS } from '../types';
import { osService } from '../services/osService';
import { AREAS, areaDaOS, Area, guiaMedida } from '../data/areas';
import Financeiro from './Financeiro';

// =====================================================================
// Aba GESTÃO — 3 telas sob medida:
//   lucas/rafael → Boletim de saúde do contrato (só leitura)
//   nicolas      → Rota de conferência (app de rota, único que edita)
//   edmar        → Esteira de medição (5 selos + cobrança + export)
// Fonte única de verdade dos "selos" de prontidão: selosDaOS().
// =====================================================================

interface Props {
  lista: OSCampo[];
  papel: string;
  aoEditar: (os: OSCampo) => void;
  aoMudar: () => void;
  aoVerLista: () => void;
}

// ---------- helpers (funções puras) ----------

const DIA_MS = 86400000;
const CONCLUIDA_ALEM = ['Concluído', 'Assinatura'];

const diasDesde = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / DIA_MS));
};
const ha = (n: number | null) => (n == null ? '' : n === 0 ? 'hoje' : `há ${n}d`);
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

export const selosDaOS = (os: OSCampo) => {
  const concluida = !!os.conclusao || CONCLUIDA_ALEM.includes(os.status);
  const memoria = !!(os.memoria_calculo || '').trim();
  const foto = (os.foto_urls?.length || 0) > 0;
  const numero = os.numero != null;
  const assinatura = os.assinado === true;
  const contagem = [concluida, memoria, foto, numero, assinatura].filter(Boolean).length;
  return { concluida, memoria, foto, numero, assinatura, contagem };
};

// MED 8 = julho/2026 (a 7ª fechou em junho — âncora confirmada pelo Renan
// 05/07): avança sozinha na virada do mês; maior nº já lançado é o piso
const medAtual = (lista: OSCampo[]) => {
  const agora = new Date();
  // Saúde: MED 1 = março/2026 → julho/2026 = MED 5 (âncora da planilha oficial)
  const porCalendario = 5 + (agora.getFullYear() - 2026) * 12 + (agora.getMonth() - 6);
  const nums = lista
    .map(o => parseInt((o.medicao || '').replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n));
  return `MED ${Math.max(porCalendario, nums.length ? Math.max(...nums) : 0)}`;
};

const fechamentoMed = () => {
  const agora = new Date();
  const ultimo = new Date(agora.getFullYear(), agora.getMonth() + 1, 0);
  while (ultimo.getDay() === 0 || ultimo.getDay() === 6) ultimo.setDate(ultimo.getDate() - 1);
  return Math.max(0, Math.round((ultimo.getTime() - agora.getTime()) / DIA_MS));
};

const rotuloOS = (o: OSCampo) => refDaOS(o);

// estágio único de cada O.S. no fluxo da grana (sem dupla contagem)
const estagio = (o: OSCampo): 'cancelada' | 'medido' | 'assinado' | 'feito' | 'rua' | 'fila' => {
  if (o.status === 'Cancelada') return 'cancelada';
  if ((o.medicao || '') !== '') return 'medido';
  if (o.assinado && (!!o.conclusao || CONCLUIDA_ALEM.includes(o.status))) return 'assinado';
  if (CONCLUIDA_ALEM.includes(o.status)) return 'feito';
  if (o.status === 'Executando') return 'rua';
  return 'fila';
};

const gerarCSV = (oss: OSCampo[], nome: string) => {
  const head = ['OS', 'F', 'Unidade', 'Fiscal', 'Classificação', 'Entrada', 'Conclusão', 'Executor', 'Status', 'Medição', 'Fiscal pediu', 'Serviço executado', 'Materiais', 'Memória de cálculo', 'Fotos', 'Assinado'];
  const q = (v: any) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = oss.map(o => [o.numero, o.fict_ref || (o.numero_fict ? 'F-' + o.numero_fict : ''), o.unidade, o.fiscal, o.classificacao, br(o.entrada), br(o.conclusao), o.executor, o.status, o.medicao, o.solicitado, o.servico, o.materiais, o.memoria_calculo, o.foto_urls?.length || 0, o.assinado ? 'SIM' : 'NÃO'].map(q).join(';'));
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + head.join(';') + '\n' + rows.join('\n'));
  a.download = nome;
  a.click();
};

// ---------- sistema visual compartilhado ----------

const TONES: Record<string, string> = {
  fpv: 'bg-fpv-50 text-fpv-700 border-fpv-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  stone: 'bg-stone-100 text-stone-600 border-stone-200',
};

const Chip: React.FC<{ tone?: string; children: React.ReactNode; className?: string }> = ({ tone = 'stone', children, className = '' }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]} ${className}`}>{children}</span>
);

const Card: React.FC<{ accent?: string; className?: string; children: React.ReactNode }> = ({ accent, className = '', children }) => (
  <div className={`bg-white rounded-2xl border border-stone-200 shadow-sm p-4 ${accent || ''} ${className}`}>{children}</div>
);

const CORES_KPI: Record<string, string> = {
  fpv: 'text-fpv-600', amber: 'text-amber-600', red: 'text-red-600', stone: 'text-stone-900',
};
const KpiNumero: React.FC<{ valor: number | string; rotulo: string; tone?: string }> = ({ valor, rotulo, tone = 'stone' }) => (
  <div className="text-center">
    <div className={`text-2xl font-black tabular-nums ${CORES_KPI[tone]}`}>{valor}</div>
    <div className="text-[10px] font-bold uppercase text-stone-400 leading-tight">{rotulo}</div>
  </div>
);

const AnelProgresso: React.FC<{ pct: number; centro: string; sub?: string }> = ({ pct, centro, sub }) => (
  <div className="relative w-12 h-12 shrink-0">
    <svg viewBox="0 0 100 100" className="-rotate-90 w-12 h-12">
      <circle cx="50" cy="50" r="42" fill="none" stroke="#E6F1FB" strokeWidth="12" />
      <circle cx="50" cy="50" r="42" fill="none" stroke="#185FA5" strokeWidth="12" strokeLinecap="round"
        strokeDasharray="264" strokeDashoffset={264 * (1 - Math.min(1, Math.max(0, pct)))}
        style={{ transition: 'stroke-dashoffset 700ms' }} />
    </svg>
    <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
      <span className="text-sm font-black text-stone-900 tabular-nums">{centro}</span>
      {sub && <span className="text-[8px] text-stone-400 font-bold">{sub}</span>}
    </div>
  </div>
);

interface LinhaFunil { rotulo: string; n: number; cor: string; anotacao?: string; anotacaoRed?: boolean; }
const BarraFunil: React.FC<{ linhas: LinhaFunil[]; aoTocar?: () => void }> = ({ linhas, aoTocar }) => {
  const max = Math.max(1, ...linhas.map(l => l.n));
  return (
    <div className="space-y-1.5">
      {linhas.map((l, i) => {
        const pct = l.n > 0 ? Math.max(8, (l.n / max) * 100) : 0;
        const dentro = pct >= 18;
        return (
          <button key={i} onClick={aoTocar} className="w-full flex items-center gap-2 text-left">
            <span className="w-24 shrink-0 text-[11px] text-stone-600 text-right leading-tight">{l.rotulo}</span>
            <div className="relative flex-1 h-8 bg-stone-100 rounded-lg overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-lg" style={{ width: pct + '%', background: l.cor, transition: 'width 700ms' }} />
              <span className={`absolute inset-y-0 flex items-center text-[11px] font-bold tabular-nums ${dentro ? 'left-2 text-white' : 'text-stone-700'}`}
                style={dentro ? {} : { left: `calc(${pct}% + 8px)` }}>{l.n}</span>
            </div>
            <span className={`w-20 shrink-0 text-[10px] leading-tight ${l.anotacaoRed ? 'text-red-600 font-bold' : 'text-stone-400'}`}>{l.anotacao || ''}</span>
          </button>
        );
      })}
    </div>
  );
};

const BarraSegmentada: React.FC<{ segmentos: { n: number; cor: string; rotulo: string }[] }> = ({ segmentos }) => {
  const total = Math.max(1, segmentos.reduce((s, x) => s + x.n, 0));
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-stone-100">
        {segmentos.map((s, i) => s.n > 0 && (
          <div key={i} style={{ width: (s.n / total) * 100 + '%', background: s.cor, transition: 'width 700ms' }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {segmentos.map((s, i) => (
          <span key={i} className="flex items-center gap-1 text-[11px] text-stone-500">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.cor }} />
            {s.n} {s.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
};

// régua dos 5 selos — bolinhas C M F N A (tela do Edmar)
const ReguaSelos: React.FC<{ os: OSCampo }> = ({ os }) => {
  const s = selosDaOS(os);
  const itens: [string, boolean, boolean][] = [
    ['C', s.concluida, true], ['M', s.memoria, true], ['F', s.foto, false], ['N', s.numero, true], ['A', s.assinatura, true],
  ];
  return (
    <div className="flex gap-1">
      {itens.map(([letra, ok, fatal], i) => (
        <span key={i} className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center ${
          ok ? 'bg-fpv-100 text-fpv-700' : fatal ? 'bg-red-100 text-red-700 ring-1 ring-red-300' : 'bg-amber-100 text-amber-700'
        }`}>{letra}</span>
      ))}
    </div>
  );
};

const Toast: React.FC<{ msg: string; aoDesfazer?: () => void; aoFechar: () => void }> = ({ msg, aoDesfazer, aoFechar }) => (
  <div className="fixed bottom-24 inset-x-4 z-40 print-hidden">
    <div className="max-w-3xl mx-auto bg-fpv-900 text-white rounded-full px-5 py-3 flex items-center justify-between shadow-lg">
      <span className="text-sm font-medium truncate">{msg}</span>
      <span className="flex items-center gap-3 shrink-0 ml-3">
        {aoDesfazer && (
          <button onClick={aoDesfazer} className="text-fpv-100 underline text-sm font-bold flex items-center gap-1">
            <Undo2 size={14} /> Desfazer
          </button>
        )}
        <button onClick={aoFechar} className="text-fpv-300"><X size={15} /></button>
      </span>
    </div>
  </div>
);

// trilha do fluxo (empty states) — a aula de 20 segundos
const FluxoPassos: React.FC = () => {
  const passos = [
    ['O.S. entra — fiscal pede', ''],
    ['Equipe executa', ''],
    ['Foto + memória de cálculo', 'evidência'],
    ['Fiscal assina a folha', 'assinatura'],
    ['Entra na MED e vira cobrança', ''],
  ];
  return (
    <div className="space-y-0">
      {passos.map(([txt, chip], i) => (
        <div key={i}>
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-full bg-fpv-50 text-fpv-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="text-sm text-stone-700">{txt}</span>
            {chip && <Chip tone="amber">{chip}</Chip>}
          </div>
          {i < passos.length - 1 && <div className="w-px h-3 bg-fpv-100 ml-3" />}
        </div>
      ))}
    </div>
  );
};

const EmptyEnsina: React.FC<{ miolo: React.ReactNode }> = ({ miolo }) => (
  <div className="space-y-4">
    {miolo}
    <Card>
      <h3 className="font-bold text-stone-900 mb-3">Como a grana anda por aqui</h3>
      <FluxoPassos />
    </Card>
    <div className="bg-fpv-700 text-white rounded-2xl p-4 text-sm font-medium leading-snug">
      Na MED 02, serviço feito sem registro derrubou a medição para <span className="font-black">R$ 72 mil</span>.
      Este painel existe pra isso nunca mais acontecer.
    </div>
    <p className="text-[11px] text-stone-400 text-center">
      Contrato 005/2026 · 32 unidades de saúde · numeração própria a partir da F-1
    </p>
  </div>
);

// =====================================================================
// TELA 1 — GESTOR (lucas / rafael): boletim de saúde em 15 segundos
// =====================================================================

const TelaGestor: React.FC<Props> = ({ lista, aoVerLista }) => {
  const med = medAtual(lista);
  const diasFecha = fechamentoMed();

  if (lista.length === 0) {
    return (
      <EmptyEnsina miolo={
        <Card accent="border-l-[6px] border-l-fpv-500">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-fpv-500 inline-block" />
            <span className="font-bold text-lg text-stone-900">Contrato pronto pra rodar</span>
          </div>
          <p className="text-sm text-stone-500 mt-1">{med} fecha em {diasFecha} dias · aguardando a primeira O.S. do campo</p>
          <div className="grid grid-cols-3 gap-2 mt-3 opacity-40">
            <KpiNumero valor={0} rotulo="prontas p/ medir" />
            <KpiNumero valor={0} rotulo="paradas na assinatura" />
            <KpiNumero valor={0} rotulo="emergenciais abertas" />
          </div>
        </Card>
      } />
    );
  }

  const ativos = lista.filter(o => o.status !== 'Cancelada');
  const porEstagio: Record<string, OSCampo[]> = { fila: [], rua: [], feito: [], assinado: [], medido: [] };
  ativos.forEach(o => { const e = estagio(o); if (porEstagio[e]) porEstagio[e].push(o); });

  const idadeMaisVelha = (oss: OSCampo[], campo: 'entrada' | 'conclusao') => {
    const ds = oss.map(o => diasDesde(o[campo] || o.entrada)).filter((n): n is number => n != null);
    return ds.length ? Math.max(...ds) : null;
  };

  // --- pulso do contrato ---
  // "pronta p/ medir" = mesma régua do Edmar: os 5 selos completos
  const prontas = porEstagio.assinado.filter(o => selosDaOS(o).contagem === 5).length;
  const paradasAss = porEstagio.feito.length;
  const emergAbertas = ativos.filter(o => o.emergencial && ['Pendente', 'Executando', 'Material'].includes(o.status));
  const idadeAssMax = idadeMaisVelha(porEstagio.feito, 'conclusao') ?? 0;
  const emergMax = emergAbertas.length ? Math.max(...emergAbertas.map(o => diasDesde(o.entrada) ?? 0)) : 0;
  const semNumVelhas = porEstagio.feito.concat(porEstagio.assinado)
    .filter(o => o.numero == null).map(o => diasDesde(o.conclusao || o.entrada) ?? 0);
  const semNumMax = semNumVelhas.length ? Math.max(...semNumVelhas) : 0;

  let nivel: 'verde' | 'atencao' | 'vermelho' = 'verde';
  if (idadeAssMax > 7 || emergMax > 1 || semNumMax > 5) nivel = 'atencao';
  if (idadeAssMax > 15 || emergMax > 2 || semNumMax > 10) nivel = 'vermelho';

  const PULSO = {
    verde: { borda: 'border-l-fpv-500', bola: 'bg-fpv-500', txt: 'Contrato em dia' },
    atencao: { borda: 'border-l-amber-500', bola: 'bg-amber-500', txt: 'Tem coisa parando' },
    vermelho: { borda: 'border-l-red-500', bola: 'bg-red-500 animate-pulse', txt: 'Tem dinheiro apodrecendo' },
  }[nivel];

  // --- vai virar glosa (só concluídas ou além; furo mais grave por O.S.) ---
  const poolGlosa = porEstagio.feito.concat(porEstagio.assinado, porEstagio.medido);
  const furoDe = (o: OSCampo): [string, number] | null => {
    const s = selosDaOS(o);
    if (o.emergencial && !s.numero) return ['EMERG. SEM Nº', 0];
    if (!s.numero) return ['SEM Nº', 1];
    if (!s.memoria) return ['SEM MEMÓRIA', 2];
    if (!s.foto) return ['SEM FOTO', 3];
    return null;
  };
  const riscos = poolGlosa
    .map(o => ({ o, furo: furoDe(o) }))
    .filter((x): x is { o: OSCampo; furo: [string, number] } => x.furo != null)
    .sort((a, b) => a.furo[1] - b.furo[1] || (diasDesde(b.o.conclusao || b.o.entrada) ?? 0) - (diasDesde(a.o.conclusao || a.o.entrada) ?? 0));

  // --- ritmo (4 janelas de 7 dias) ---
  const bucket = (iso?: string | null) => {
    const d = diasDesde(iso);
    return d == null || d > 27 ? -1 : 3 - Math.floor(d / 7);
  };
  const semanas = [0, 1, 2, 3].map(i => ({ entrou: 0, saiu: 0, i }));
  ativos.forEach(o => {
    const be = bucket(o.entrada); if (be >= 0) semanas[be].entrou++;
    const bc = bucket(o.conclusao); if (bc >= 0) semanas[bc].saiu++;
  });
  const maxSem = Math.max(1, ...semanas.map(s => Math.max(s.entrou, s.saiu)));
  const totEntrou = semanas.reduce((s, x) => s + x.entrou, 0);
  const totSaiu = semanas.reduce((s, x) => s + x.saiu, 0);

  const agoraMes = new Date();
  const mesAtual = `${agoraMes.getFullYear()}-${String(agoraMes.getMonth() + 1).padStart(2, '0')}`;
  const concMes = ativos.filter(o => (o.conclusao || '').startsWith(mesAtual));
  const porExec: Record<string, number> = {};
  concMes.forEach(o => { const e = o.executor || '—'; porExec[e] = (porExec[e] || 0) + 1; });
  const top2 = Object.values(porExec).sort((a, b) => b - a).slice(0, 2).reduce((s, n) => s + n, 0);
  const pctTop2 = concMes.length ? Math.round((top2 / concMes.length) * 100) : 0;

  // --- MED em uma linha ---
  const naMed = ativos.filter(o => o.medicao === med).length;
  const emRisco = paradasAss;

  return (
    <div className="space-y-4">
      {/* 1 — PULSO */}
      <Card accent={`border-l-[6px] ${PULSO.borda}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full inline-block ${PULSO.bola}`} />
          <span className="font-bold text-lg text-stone-900">{PULSO.txt}</span>
        </div>
        <p className="text-sm text-stone-500 mt-0.5">{med} fecha em {diasFecha} dias</p>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <KpiNumero valor={prontas} rotulo="prontas p/ medir" tone="fpv" />
          <KpiNumero valor={paradasAss} rotulo="paradas na assinatura" tone={idadeAssMax > 15 ? 'red' : idadeAssMax > 7 ? 'amber' : 'stone'} />
          <KpiNumero valor={emergAbertas.length} rotulo="emergenciais abertas" tone={emergAbertas.length ? 'red' : 'stone'} />
        </div>
        {emergAbertas.length > 0 && emergMax > 1 && (
          <div className="mt-3">
            <Chip tone="red"><Siren size={12} /> {emergAbertas.length} emergencia{emergAbertas.length > 1 ? 'is' : 'l'} há +48h</Chip>
          </div>
        )}
      </Card>

      {/* 2 — FUNIL DA GRANA */}
      <Card>
        <h3 className="font-bold text-stone-900 mb-3">Funil da grana</h3>
        <BarraFunil aoTocar={aoVerLista} linhas={[
          { rotulo: 'Na fila', n: porEstagio.fila.length, cor: '#d6d3d1', anotacao: ha(idadeMaisVelha(porEstagio.fila, 'entrada')) },
          { rotulo: 'Na rua', n: porEstagio.rua.length, cor: '#5F93C4', anotacao: ha(idadeMaisVelha(porEstagio.rua, 'entrada')) },
          { rotulo: 'Feito, sem assinatura', n: porEstagio.feito.length, cor: '#fbbf24', anotacao: ha(idadeMaisVelha(porEstagio.feito, 'conclusao')), anotacaoRed: idadeAssMax > 15 },
          { rotulo: 'Assinado, esperando medição', n: porEstagio.assinado.length, cor: '#185FA5', anotacao: ha(idadeMaisVelha(porEstagio.assinado, 'conclusao')) },
          { rotulo: 'Medido ✓', n: porEstagio.medido.length, cor: '#0F3C6A' },
        ]} />
        <p className="text-[11px] text-stone-400 mt-3 border-t border-dashed border-stone-200 pt-2">
          Aqui morreram 141 O.S. na planilha velha. Aqui não.
        </p>
      </Card>

      {/* 3 — VAI VIRAR GLOSA */}
      {riscos.length === 0 ? (
        <Card>
          <div className="flex items-center gap-2 text-fpv-700">
            <ShieldCheck size={18} />
            <span className="text-sm font-bold">Documentação 100% — pode medir tranquilo</span>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center gap-2 bg-red-50 text-red-700 -m-4 mb-3 p-3 rounded-t-2xl">
            <TriangleAlert size={16} />
            <h3 className="font-bold text-sm">Vai virar glosa</h3>
          </div>
          <div className="space-y-2">
            {riscos.slice(0, 4).map(({ o, furo }) => (
              <div key={o.id} className="flex items-center gap-2">
                <Chip tone="red">{furo[0]}</Chip>
                <span className="text-xs text-stone-700 truncate flex-1">{rotuloOS(o)} · {o.unidade}</span>
                <span className="text-[11px] text-stone-400 tabular-nums shrink-0">{ha(diasDesde(o.conclusao || o.entrada))}</span>
              </div>
            ))}
          </div>
          {riscos.length > 4 && (
            <button onClick={aoVerLista} className="text-xs font-bold text-red-700 mt-3">ver todas as {riscos.length} →</button>
          )}
        </Card>
      )}

      {/* 4 — RITMO */}
      <Card>
        <h3 className="font-bold text-stone-900 mb-1">Ritmo</h3>
        <p className="text-[11px] text-stone-400 mb-3">últimas 4 semanas · <span className="text-stone-500">■ entrou</span> · <span className="text-fpv-600">■ saiu</span></p>
        <div className="flex items-end justify-around h-24 gap-2">
          {semanas.map(s => (
            <div key={s.i} className="flex items-end gap-1 flex-1 justify-center h-full">
              <div className="flex flex-col items-center justify-end h-full w-5">
                <span className="text-[10px] text-stone-500 tabular-nums">{s.entrou || ''}</span>
                <div className="w-full bg-stone-300 rounded-t" style={{ height: Math.max(s.entrou ? 6 : 2, (s.entrou / maxSem) * 70) + 'px' }} />
              </div>
              <div className="flex flex-col items-center justify-end h-full w-5">
                <span className="text-[10px] text-fpv-700 font-bold tabular-nums">{s.saiu || ''}</span>
                <div className="w-full bg-fpv-500 rounded-t" style={{ height: Math.max(s.saiu ? 6 : 2, (s.saiu / maxSem) * 70) + 'px' }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-around mt-1">
          {semanas.map(s => <span key={s.i} className="text-[10px] text-stone-400">sem {s.i + 1}</span>)}
        </div>
        {totEntrou + totSaiu >= 10 && (
          <p className={`text-xs font-bold mt-3 ${totSaiu >= totEntrou ? 'text-fpv-700' : 'text-amber-700'}`}>
            {totSaiu >= totEntrou ? 'Saindo mais do que entra ✓' : 'Entrando mais do que sai — fila crescendo'}
          </p>
        )}
        {concMes.length >= 10 && (
          <div className="mt-3 border-t border-stone-100 pt-3">
            <BarraSegmentada segmentos={[
              { n: top2, cor: '#134D87', rotulo: 'top 2 executores' },
              { n: concMes.length - top2, cor: '#e7e5e4', rotulo: 'resto da equipe' },
            ]} />
            <p className={`text-xs mt-1.5 ${pctTop2 > 60 ? 'text-amber-700 font-bold' : 'text-stone-500'}`}>
              Top 2 carregam {pctTop2}% do mês{pctTop2 > 60 ? ' — contrato não pode depender de 2 costas' : ''}
            </p>
          </div>
        )}
      </Card>

      {/* 5 — MED EM UMA LINHA */}
      <Card>
        <h3 className="font-bold text-stone-900 mb-3">{med} — como está o pacote</h3>
        <BarraSegmentada segmentos={[
          { n: naMed, cor: '#0F3C6A', rotulo: 'na medição' },
          { n: prontas, cor: '#5F93C4', rotulo: 'prontas' },
          { n: emRisco, cor: '#fbbf24', rotulo: 'em risco' },
        ]} />
        {emRisco > 0 && (
          <p className="text-xs text-amber-700 font-bold mt-2">
            {emRisco} O.S. podem ficar de fora se não assinar antes do fechamento
          </p>
        )}
        <p className="text-[11px] text-stone-400 mt-3">meta do contrato: ~R$ 974 mil/mês · FP.094 · atualizado agora</p>
      </Card>
    </div>
  );
};

// =====================================================================
// TELA 2 — ENGENHEIRO (nicolas): app de rota, não dashboard
// =====================================================================

const TelaEngenheiro: React.FC<Props> = ({ lista, aoEditar, aoMudar }) => {
  const [aberta, setAberta] = useState<string | null>(null);
  const [puladas, setPuladas] = useState<string[]>([]);
  const [filtro, setFiltro] = useState<'todas' | 'semfoto' | 'semnum'>('todas');
  // contadores do dia persistem no sessionStorage — trocar de aba não pode zerar o placar
  const agoraDia = new Date();
  const diaHoje = `${agoraDia.getFullYear()}-${String(agoraDia.getMonth() + 1).padStart(2, '0')}-${String(agoraDia.getDate()).padStart(2, '0')}`;
  const lerKpiDia = (k: 'a' | 'f'): number => {
    try {
      const v = JSON.parse(sessionStorage.getItem('fpvKpiRota') || 'null');
      return v && v.dia === diaHoje ? (v[k] || 0) : 0;
    } catch { return 0; }
  };
  const [assinadasHoje, setAssinadasHoje] = useState<number>(() => lerKpiDia('a'));
  const [fechadasHoje, setFechadasHoje] = useState<number>(() => lerKpiDia('f'));
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  // segmentação por ÁREA (disciplina) + editor rápido de memória de cálculo
  // (textarea NÃO-controlada via ref: CartaoOS é recriado a cada render do
  //  pai, e um value controlado remontaria o campo a cada tecla)
  const [filtroArea, setFiltroArea] = useState<string>('todas');
  const [memEditId, setMemEditId] = useState<number | null>(null);
  const memRef = useRef<HTMLTextAreaElement | null>(null);
  const areaPorId = useMemo(() => {
    const mapa = new Map<number, Area>();
    lista.forEach(o => { if (o.id != null) mapa.set(o.id, areaDaOS(o)); });
    return mapa;
  }, [lista]);
  const areaDe = (o: OSCampo): Area => (o.id != null && areaPorId.get(o.id)) || areaDaOS(o);
  useEffect(() => {
    sessionStorage.setItem('fpvKpiRota', JSON.stringify({ dia: diaHoje, a: assinadasHoje, f: fechadasHoje }));
  }, [assinadasHoje, fechadasHoje]);

  const emRota = (o: OSCampo) => o.status === 'Assinatura' || (o.status === 'Concluído' && !o.assinado);
  const rotaOS = lista.filter(emRota);

  if (lista.length === 0) {
    return (
      <EmptyEnsina miolo={
        <Card>
          <svg viewBox="0 0 300 90" className="w-full h-20 mb-2">
            <path d="M 15 70 Q 90 20 150 50 T 285 30" fill="none" stroke="#5F93C4" strokeWidth="2.5" strokeDasharray="6 6" />
            <circle cx="15" cy="70" r="11" fill="#185FA5" />
            <text x="15" y="74" textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">1</text>
            <circle cx="150" cy="50" r="11" fill="white" stroke="#5F93C4" strokeWidth="2" />
            <text x="150" y="54" textAnchor="middle" fill="#185FA5" fontSize="11" fontWeight="bold">2</text>
            <circle cx="285" cy="30" r="11" fill="white" stroke="#5F93C4" strokeWidth="2" />
            <text x="285" y="34" textAnchor="middle" fill="#185FA5" fontSize="11" fontWeight="bold">3</text>
          </svg>
          <h3 className="font-bold text-stone-900 text-lg">Sua rota monta sozinha.</h3>
          <p className="text-sm text-stone-500 mt-1 mb-3">Quando as O.S. do campo caírem aqui, o app ordena as unidades por urgência e você só segue a fila.</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-stone-600"><Camera size={15} className="text-amber-600 shrink-0" /> Foto — sem foto não mede</div>
            <div className="flex items-center gap-2 text-sm text-stone-600"><Ruler size={15} className="text-amber-600 shrink-0" /> Memória — as medidas valem dinheiro</div>
            <div className="flex items-center gap-2 text-sm text-stone-600"><PenLine size={15} className="text-fpv-600 shrink-0" /> Assinatura — é ela que destrava a cobrança</div>
          </div>
        </Card>
      } />
    );
  }

  // paradas: escola → O.S. em rota
  const porEscola: Record<string, OSCampo[]> = {};
  rotaOS.forEach(o => { (porEscola[o.unidade] = porEscola[o.unidade] || []).push(o); });

  const scoreEscola = (oss: OSCampo[]) => {
    let s = 0;
    oss.forEach(o => {
      s += o.status === 'Assinatura' ? 3 : 2;
      const sel = selosDaOS(o);
      s += (sel.foto ? 0 : 1) + (sel.memoria ? 0 : 1) + (sel.numero ? 0 : 1);
      if (o.emergencial) s += 3;
    });
    return s;
  };
  const fiscalDe = (oss: OSCampo[]) => {
    const c: Record<string, number> = {};
    oss.forEach(o => { const f = o.fiscal || '—'; c[f] = (c[f] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
  };

  let paradas = Object.entries(porEscola).map(([escola, oss]) => ({
    escola, oss,
    score: scoreEscola(oss),
    fiscal: fiscalDe(oss),
    maisVelha: Math.max(0, ...oss.map(o => diasDesde(o.conclusao || o.entrada) ?? 0)),
  }));

  // fiscais adjacentes: agrupa por fiscal, grupo mais urgente primeiro
  const grupos: Record<string, typeof paradas> = {};
  paradas.forEach(p => { (grupos[p.fiscal] = grupos[p.fiscal] || []).push(p); });
  paradas = Object.values(grupos)
    .map(g => g.sort((a, b) => b.score - a.score || b.maisVelha - a.maisVelha))
    .sort((a, b) => Math.max(...b.map(p => p.score)) - Math.max(...a.map(p => p.score)))
    .flat();

  // puladas vão pro fim
  paradas = paradas.filter(p => !puladas.includes(p.escola))
    .concat(paradas.filter(p => puladas.includes(p.escola)));

  // rota REAL (sem filtro) — anel, header e celebração usam esta contagem
  const totalParadas = paradas.length;
  // filtros só mudam a exibição da fila
  if (filtroArea !== 'todas') {
    paradas = paradas
      .map(p => ({ ...p, oss: p.oss.filter(o => areaDe(o).nome === filtroArea) }))
      .filter(p => p.oss.length > 0);
  }
  if (filtro === 'semfoto') paradas = paradas.filter(p => p.oss.some(o => !selosDaOS(o).foto));
  if (filtro === 'semnum') paradas = paradas.filter(p => p.oss.some(o => !selosDaOS(o).numero));

  const totalFolhas = rotaOS.length;
  const semFoto = rotaOS.filter(o => !selosDaOS(o).foto).length;
  const semNum = rotaOS.filter(o => !selosDaOS(o).numero).length;
  const totalParadasDia = totalParadas + fechadasHoje;
  const pctDia = totalParadasDia ? fechadasHoje / totalParadasDia : 0;

  const assinar = async (o: OSCampo) => {
    const anterior = { assinado: o.assinado, status: o.status };
    const novo = { ...o, assinado: true, status: o.status === 'Assinatura' ? 'Concluído' : o.status };
    const r = await osService.salvar(novo);
    if (!r.ok) { setToast({ msg: `Erro ao assinar: ${r.erro || 'tente de novo'}` }); return; }
    setAssinadasHoje(n => n + 1);
    const restantes = (porEscola[o.unidade] || []).filter(x => x.id !== o.id).length;
    if (restantes === 0) { setFechadasHoje(n => n + 1); setAberta(null); }
    setToast({
      msg: `O.S. ${rotuloOS(o)} assinada ✓`,
      undo: async () => { await osService.salvar({ ...o, ...anterior }); setAssinadasHoje(n => Math.max(0, n - 1)); if (restantes === 0) setFechadasHoje(n => Math.max(0, n - 1)); setToast(null); aoMudar(); },
    });
    setTimeout(() => setToast(t => (t && t.msg.startsWith(`O.S. ${rotuloOS(o)}`) ? null : t)), 6000);
    aoMudar();
  };

  const salvarMemoria = async (o: OSCampo) => {
    const texto = (memRef.current?.value ?? '').trim();
    const r = await osService.salvar({ ...o, memoria_calculo: texto });
    if (r.ok) {
      setMemEditId(null);
      setToast({ msg: `📐 Memória da O.S. ${rotuloOS(o)} salva` });
      setTimeout(() => setToast(t => (t && t.msg.startsWith('📐') ? null : t)), 4000);
      aoMudar();
    } else {
      setToast({ msg: `Erro ao salvar memória: ${r.erro || 'tente de novo'}` });
    }
  };

  const PiluIcones: Record<string, any> = { foto: Camera, memoria: Ruler, numero: Hash };
  const CartaoOS: React.FC<{ o: OSCampo }> = ({ o }) => {
    const s = selosDaOS(o);
    const ar = areaDe(o);
    const parado = diasDesde(o.conclusao || o.entrada);
    const pilulas: { key: 'foto' | 'memoria' | 'numero'; okTxt: string; faltaTxt: string }[] = [
      { key: 'foto', okTxt: 'Foto ✓', faltaTxt: 'Sem foto' },
      { key: 'memoria', okTxt: 'Memória ✓', faltaTxt: 'Sem medida' },
      { key: 'numero', okTxt: `Nº ${o.numero ?? ''}`, faltaTxt: 'Sem nº' },
    ];
    return (
      <div className="border border-stone-200 rounded-xl p-3 bg-white">
        <div className="flex items-center gap-2 mb-1.5">
          {o.emergencial && <Zap size={14} className="text-red-500 shrink-0" />}
          <span className={`font-mono font-bold text-sm px-1.5 py-0.5 rounded ${s.numero ? 'bg-fpv-50 text-fpv-700' : 'bg-amber-50 text-amber-700'}`}>{rotuloOS(o)}</span>
          <span className="text-xs text-stone-600 truncate flex-1">{o.servico || o.solicitado || '—'}</span>
        </div>
        <div className="text-[11px] text-stone-500 mb-2 flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-fpv-700">{ar.emoji} {ar.nome}</span>
          <span>· {o.executor || 'sem executor'}</span>
          {parado != null && parado > 0 && (
            <span className={parado > 14 ? 'text-red-600 font-bold' : ''}>· parado {ha(parado)}</span>
          )}
        </div>

        {/* memória de cálculo — edição rápida guiada pela área (conversão EMOP) */}
        {memEditId === o.id ? (
          <div className="mb-2 border border-fpv-100 rounded-xl p-2.5 bg-fpv-50/40">
            <p className="text-[11px] text-fpv-700 font-medium mb-1.5 leading-snug">
              📐 <b>{ar.emoji} {ar.nome}</b> — {guiaMedida(`${o.servico || ''} ${o.solicitado || ''}`, ar.nome)}
            </p>
            <textarea
              ref={memRef}
              defaultValue={o.memoria_calculo || ''}
              rows={3}
              autoFocus
              placeholder="ex.: parede 3,85 × 1,20 = 4,62 m² · 2 demãos"
              className="w-full border border-stone-200 rounded-lg px-2.5 py-2 text-sm bg-white outline-none focus:border-fpv-500"
            />
            <div className="flex gap-2 mt-1.5">
              <button onClick={() => salvarMemoria(o)}
                className="flex-1 bg-fpv-600 active:bg-fpv-700 text-white font-bold text-xs py-2.5 rounded-lg">
                Salvar memória
              </button>
              <button onClick={() => setMemEditId(null)}
                className="px-3 border border-stone-200 rounded-lg text-xs font-bold text-stone-500">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setMemEditId(o.id!)}
            className="w-full mb-2 text-left border border-dashed border-fpv-100 rounded-xl px-2.5 py-2 text-[11px] text-fpv-700 bg-fpv-50/30">
            📐 <b>Memória:</b>{' '}
            {(o.memoria_calculo || '').trim()
              ? `${o.memoria_calculo.slice(0, 90)}${o.memoria_calculo.length > 90 ? '…' : ''}`
              : 'vazia — toca aqui pra preencher (guia da área aparece)'}
          </button>
        )}
        <div className="grid grid-cols-4 gap-1.5 mb-2">
          {pilulas.map(p => {
            const ok = s[p.key];
            const Icone = PiluIcones[p.key];
            return (
              <button key={p.key} onClick={() => { if (!ok) aoEditar(o); }}
                className={`h-10 rounded-lg flex items-center justify-center gap-1 text-[10px] font-bold ${
                  ok ? 'bg-fpv-100 text-fpv-700' : 'bg-amber-50 text-amber-700 border border-dashed border-amber-300'
                }`}>
                <Icone size={12} /> {ok ? p.okTxt : p.faltaTxt}
              </button>
            );
          })}
          <div className={`h-10 rounded-lg flex items-center justify-center gap-1 text-[10px] font-bold ${
            s.assinatura ? 'bg-fpv-100 text-fpv-700' : 'bg-amber-50 text-amber-700 border border-dashed border-amber-300'
          }`}>
            <PenLine size={12} /> {s.assinatura ? 'Assinada ✓' : 'Falta assinar'}
          </div>
        </div>
        {!(s.foto && s.memoria) && !s.assinatura && (
          <p className="text-[11px] text-amber-700 font-medium mb-2">Sem foto e memória não mede. Resolve isso primeiro.</p>
        )}
        <div className="flex gap-2">
          <button onClick={() => assinar(o)} disabled={s.assinatura || !(s.foto && s.memoria)}
            className={`h-11 flex-1 rounded-xl font-bold text-sm ${
              s.assinatura ? 'bg-fpv-100 text-fpv-700' : s.foto && s.memoria ? 'bg-fpv-600 active:bg-fpv-700 text-white' : 'bg-stone-200 text-stone-400'
            }`}>
            {s.assinatura ? 'Assinada ✓' : 'Assinou ✓'}
          </button>
          <button onClick={() => aoEditar(o)} className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-stone-600 font-bold text-sm flex items-center gap-1.5">
            <Pencil size={14} /> Corrigir
          </button>
        </div>
      </div>
    );
  };

  const FiltroChip: React.FC<{ id: 'todas' | 'semfoto' | 'semnum'; children: React.ReactNode }> = ({ id, children }) => (
    <button onClick={() => setFiltro(f => (f === id ? 'todas' : id))}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
        filtro === id ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'
      }`}>{children}</button>
  );

  return (
    <div className="space-y-4">
      {/* header sticky da rota */}
      <div className="sticky top-[60px] z-10 -mx-4 px-4 py-2 bg-[#F3F5F8]/95 backdrop-blur print-hidden">
        <div className="flex items-center gap-3">
          <AnelProgresso pct={pctDia} centro={String(totalParadas)} sub="paradas" />
          <div className="flex-1">
            <div className="font-bold text-stone-900 flex items-center gap-1.5"><Route size={16} className="text-fpv-600" /> Rota de hoje</div>
            <div className="text-xs text-stone-500">{totalParadas} parada{totalParadas !== 1 ? 's' : ''} · {totalFolhas} folha{totalFolhas !== 1 ? 's' : ''} p/ assinar</div>
          </div>
        </div>
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          <FiltroChip id="todas"><PenLine size={12} className="inline mr-1" />P/ assinar {totalFolhas}</FiltroChip>
          <FiltroChip id="semfoto"><Camera size={12} className="inline mr-1" />Sem foto {semFoto}</FiltroChip>
          <FiltroChip id="semnum"><Hash size={12} className="inline mr-1" />Sem nº {semNum}</FiltroChip>
        </div>
        {/* segmentação por ÁREA — o ciclo do Nicolas roda disciplina a disciplina */}
        <div className="flex gap-2 mt-1.5 overflow-x-auto pb-1">
          <button onClick={() => setFiltroArea('todas')}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
              filtroArea === 'todas' ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'
            }`}>Todas as áreas</button>
          {AREAS.map(a => {
            const n = rotaOS.filter(o => areaDe(o).nome === a.nome).length;
            if (n === 0) return null;
            return (
              <button key={a.nome} onClick={() => setFiltroArea(f => (f === a.nome ? 'todas' : a.nome))}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${
                  filtroArea === a.nome ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'
                }`}>{a.emoji} {a.nome} {n}</button>
            );
          })}
        </div>
      </div>

      {totalParadas === 0 ? (
        <Card className="bg-gradient-to-b from-fpv-50 to-white">
          <div className="flex flex-col items-center text-center py-4">
            <div className="w-14 h-14 rounded-full bg-fpv-500 text-white flex items-center justify-center mb-3"><Check size={28} /></div>
            <h3 className="font-bold text-lg text-stone-900">Rota fechada 💪</h3>
            <div className="grid grid-cols-3 gap-4 mt-4 w-full">
              <KpiNumero valor={assinadasHoje} rotulo="assinadas hoje" tone="fpv" />
              <KpiNumero valor={fechadasHoje} rotulo="unidades visitadas" />
              <KpiNumero valor={lista.filter(o => o.status !== 'Cancelada' && !(o.medicao || '') && selosDaOS(o).contagem === 5).length} rotulo={`prontas pra ${medAtual(lista)}`} tone="fpv" />
            </div>
            <p className="text-xs text-stone-400 mt-4">Amanhã o app monta a rota de novo.</p>
          </div>
        </Card>
      ) : paradas.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-500 text-center py-4">
            Nenhuma parada com esse filtro.{' '}
            <button onClick={() => setFiltro('todas')} className="font-bold text-fpv-700 underline">limpar filtro</button>
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {paradas.map((p, i) => {
            const ehProxima = i === 0;
            const expandida = aberta === p.escola;
            return (
              <div key={p.escola}>
                <Card accent={ehProxima ? 'border-l-4 border-l-fpv-500' : ''} className={ehProxima ? '' : 'py-3'}>
                  {ehProxima && !expandida && <div className="text-[10px] font-black uppercase text-fpv-600 mb-1">Próxima parada</div>}
                  <button onClick={() => setAberta(expandida ? null : p.escola)} className="w-full text-left">
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        ehProxima ? 'bg-fpv-500 text-white' : 'bg-white border-2 border-fpv-300 text-fpv-700'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold text-stone-900 ${ehProxima ? 'text-lg leading-tight' : 'text-sm'}`}>{p.escola}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <Chip tone="fpv"><UserCheck size={11} /> {p.fiscal}</Chip>
                          <span className="text-[11px] text-stone-500">{p.oss.length} O.S.</span>
                          {p.oss.some(o => o.emergencial) && <Chip tone="red"><Zap size={11} /> emergencial</Chip>}
                        </div>
                      </div>
                      <ChevronDown size={18} className={`text-stone-400 shrink-0 transition-transform ${expandida ? 'rotate-180' : ''}`} />
                    </div>
                    {ehProxima && p.maisVelha > 7 && !expandida && (
                      <div className="flex items-center gap-1.5 text-amber-700 text-xs font-medium mt-2">
                        <Clock size={13} /> Mais antiga parada {ha(p.maisVelha)}
                      </div>
                    )}
                  </button>
                  {ehProxima && !expandida && (
                    <button onClick={() => setAberta(p.escola)}
                      className="mt-3 w-full h-12 bg-fpv-600 active:bg-fpv-700 text-white font-semibold rounded-xl">
                      Cheguei — abrir O.S.
                    </button>
                  )}
                  {expandida && (
                    <div className="mt-3 space-y-2">
                      {p.oss
                        .slice()
                        .sort((a, b) => (b.emergencial ? 1 : 0) - (a.emergencial ? 1 : 0) || (diasDesde(b.conclusao || b.entrada) ?? 0) - (diasDesde(a.conclusao || a.entrada) ?? 0))
                        .map(o => <CartaoOS key={o.id} o={o} />)}
                      <button onClick={() => { setPuladas(ps => [...ps.filter(x => x !== p.escola), p.escola]); setAberta(null); }}
                        className="w-full text-xs text-stone-400 font-bold py-2">
                        Pular parada — mando pro fim da fila
                      </button>
                    </div>
                  )}
                </Card>
              </div>
            );
          })}
          <p className="text-xs text-stone-400 text-center py-2">Fim da rota. O resto tá em dia.</p>
        </div>
      )}

      {toast && <Toast msg={toast.msg} aoDesfazer={toast.undo} aoFechar={() => setToast(null)} />}
    </div>
  );
};

// =====================================================================
// TELA 3 — MEDIÇÃO (edmar): esteira dos 5 selos + cobrança + export
// =====================================================================

const TelaMedicao: React.FC<Props> = ({ lista, aoVerLista }) => {
  const [filtroNivel, setFiltroNivel] = useState<'todas' | 'prontas' | 'falta1' | 'travadas'>('todas');
  const [filtroSelo, setFiltroSelo] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(50);
  const [confirmar, setConfirmar] = useState<'prontas' | 'tudo' | null>(null);
  const [foraAberto, setForaAberto] = useState(false);

  const med = medAtual(lista);

  if (lista.length === 0) {
    return (
      <EmptyEnsina miolo={
        <div className="space-y-4">
          <div className="bg-fpv-700 text-white rounded-2xl p-4">
            <div className="font-bold">{med} — Medição do mês</div>
            <div className="flex gap-6 mt-2">
              <div><span className="text-3xl font-black">0</span><div className="text-[10px] font-bold text-fpv-100 uppercase">prontas</div></div>
              <div><span className="text-3xl font-black">0</span><div className="text-[10px] font-bold text-fpv-100 uppercase">na fila</div></div>
            </div>
          </div>
          <Card>
            <h3 className="font-bold text-stone-900 mb-3">Os 5 selos que destravam a cobrança</h3>
            <div className="space-y-2.5">
              {[
                ['C', 'Concluída — serviço executado no campo'],
                ['M', 'Memória de cálculo — sem medida, não mede'],
                ['F', 'Foto — evidência contra questionamento da fiscalização'],
                ['N', 'Nº oficial — sem número, não entra na MED'],
                ['A', 'Assinatura do fiscal — sem ela é glosa na certa'],
              ].map(([l, txt]) => (
                <div key={l} className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-stone-100 text-stone-500 text-xs font-black flex items-center justify-center shrink-0">{l}</span>
                  <span className="text-sm text-stone-600">{txt}</span>
                </div>
              ))}
            </div>
          </Card>
          <button disabled className="w-full bg-stone-200 text-stone-400 font-bold py-3.5 rounded-xl text-sm">
            Nada pra exportar ainda — a primeira O.S. chega essa semana
          </button>
        </div>
      } />
    );
  }

  // universo medível: sem MED atribuída, concluída ou além, não cancelada
  const universo = lista.filter(o => o.status !== 'Cancelada' && !(o.medicao || '') && selosDaOS(o).concluida);
  const prontas = universo.filter(o => selosDaOS(o).contagem === 5);
  const falta1 = universo.filter(o => selosDaOS(o).contagem === 4);
  const travadas = universo.filter(o => selosDaOS(o).contagem <= 3);
  const jaMedidas = lista.filter(o => (o.medicao || '') !== '').length;

  // funil cumulativo dos 5 selos
  const ordemSelos: ('concluida' | 'memoria' | 'foto' | 'numero' | 'assinatura')[] = ['concluida', 'memoria', 'foto', 'numero', 'assinatura'];
  const cumulativo = ordemSelos.map((_, i) =>
    universo.filter(o => { const s = selosDaOS(o); return ordemSelos.slice(0, i + 1).every(k => s[k]); }).length
  );
  const paraExatamente = (o: OSCampo, i: number) => {
    const s = selosDaOS(o);
    return ordemSelos.slice(0, i).every(k => s[k]) && !s[ordemSelos[i]];
  };

  // fila
  let fila = universo.slice();
  if (filtroNivel === 'prontas') fila = fila.filter(o => selosDaOS(o).contagem === 5);
  if (filtroNivel === 'falta1') fila = fila.filter(o => selosDaOS(o).contagem === 4);
  if (filtroNivel === 'travadas') fila = fila.filter(o => selosDaOS(o).contagem <= 3);
  if (filtroSelo != null) fila = fila.filter(o => paraExatamente(o, filtroSelo));
  if (busca.trim()) {
    const b = busca.trim().toLowerCase();
    fila = fila.filter(o => o.unidade.toLowerCase().includes(b) || String(o.numero ?? '').includes(b) || `f-${o.numero_fict ?? ''}`.includes(b) || (o.fict_ref || '').toLowerCase().includes(b));
  }
  fila.sort((a, b) => selosDaOS(b).contagem - selosDaOS(a).contagem || (diasDesde(b.conclusao || b.entrada) ?? 0) - (diasDesde(a.conclusao || a.entrada) ?? 0));

  // cobrar hoje — pendência agrupada por responsável
  const devedores: { key: string; nome: string; resumo: string; tone: string; itens: { os: OSCampo; falta: string }[]; texto: string }[] = [];
  const porExec: Record<string, { os: OSCampo; falta: string }[]> = {};
  universo.forEach(o => {
    const s = selosDaOS(o);
    const faltas: string[] = [];
    if (!s.memoria) faltas.push('memória de cálculo');
    if (!s.foto) faltas.push('foto');
    if (faltas.length) {
      const e = o.executor || 'Sem executor';
      (porExec[e] = porExec[e] || []).push({ os: o, falta: faltas.join(' + ') });
    }
  });
  Object.entries(porExec).forEach(([nome, itens]) => {
    const mems = itens.filter(i => i.falta.includes('memória')).length;
    const fts = itens.filter(i => i.falta.includes('foto')).length;
    devedores.push({
      key: 'exec-' + nome, nome,
      resumo: [mems ? `deve ${mems} memória${mems > 1 ? 's' : ''}` : '', fts ? `${fts} foto${fts > 1 ? 's' : ''}` : ''].filter(Boolean).join(', '),
      tone: 'amber', itens,
      texto: `${nome}, pra entrar na ${med} faltam: ${itens.map(i => `${i.falta} da O.S. ${rotuloOS(i.os)} (${i.os.unidade})`).join('; ')}.`,
    });
  });
  const pAssinar = universo.filter(o => { const s = selosDaOS(o); return !s.assinatura && s.memoria && s.foto; });
  if (pAssinar.length) {
    const porFiscal: Record<string, number> = {};
    pAssinar.forEach(o => { const f = o.fiscal || '—'; porFiscal[f] = (porFiscal[f] || 0) + 1; });
    devedores.push({
      key: 'leony', nome: 'Leony',
      resumo: `colher ${pAssinar.length} assinatura${pAssinar.length > 1 ? 's' : ''} (${Object.entries(porFiscal).map(([f, n]) => `${n} ${f}`).join(', ')})`,
      tone: 'red',
      itens: pAssinar.map(os => ({ os, falta: `assinatura do ${os.fiscal || 'fiscal'}` })),
      texto: `Leony, pra fechar a ${med} faltam as assinaturas: ${pAssinar.map(o => `O.S. ${rotuloOS(o)} (${o.unidade} — ${o.fiscal})`).join('; ')}.`,
    });
  }
  const semNumero = universo.filter(o => !selosDaOS(o).numero);
  if (semNumero.length) {
    devedores.push({
      key: 'prefeitura', nome: 'Prefeitura / Fiscal',
      resumo: `${semNumero.length} O.S. sem nº oficial`,
      tone: 'red',
      itens: semNumero.map(os => ({ os, falta: `nº oficial (rodando como ${rotuloOS(os)})` })),
      texto: `Fiscal, precisamos do nº oficial destas O.S. pra ${med}: ${semNumero.map(o => `${rotuloOS(o)} (${o.unidade})`).join('; ')}.`,
    });
  }
  devedores.sort((a, b) => b.itens.length - a.itens.length);

  const copiar = async (d: { key: string; texto: string }) => {
    try { await navigator.clipboard.writeText(d.texto); } catch { /* clipboard bloqueado — segue o jogo */ }
    setCopiado(d.key);
    setTimeout(() => setCopiado(c => (c === d.key ? null : c)), 2000);
  };

  const faltaGrave = (o: OSCampo) => {
    const s = selosDaOS(o);
    if (!s.memoria) return 'Falta: memória de cálculo — não mede sem ela';
    if (!s.numero) return `Falta: nº oficial (rodando como ${rotuloOS(o)})`;
    if (!s.assinatura) return `Falta: assinatura do ${o.fiscal || 'fiscal'}`;
    if (!s.foto) return 'Falta: foto — risco na fiscalização';
    return '';
  };

  // complemento exato do universo medível: sem MED, não cancelada, ainda não concluída
  const emAndamento = lista.filter(o => o.status !== 'Cancelada' && !(o.medicao || '') && !selosDaOS(o).concluida).length;
  const canceladas = lista.filter(o => o.status === 'Cancelada').length;

  const PlacarBtn: React.FC<{ id: 'prontas' | 'falta1' | 'travadas'; n: number; rotulo: string; badge?: string }> = ({ id, n, rotulo, badge }) => (
    <button onClick={() => { setFiltroNivel(f => (f === id ? 'todas' : id)); setFiltroSelo(null); }}
      className={`flex-1 rounded-xl py-2 px-1 ${filtroNivel === id ? 'bg-fpv-900/60 ring-2 ring-fpv-300' : ''}`}>
      <div className="text-3xl font-black tabular-nums flex items-center justify-center gap-1">
        {n}{badge && <span className={`w-2 h-2 rounded-full inline-block ${badge}`} />}
      </div>
      <div className="text-[9px] font-bold uppercase text-fpv-100 leading-tight">{rotulo}</div>
    </button>
  );

  return (
    <div className="space-y-4 pb-32">
      {/* placar sticky */}
      <div className="sticky top-[60px] z-10 -mx-4 px-4 print-hidden">
        <div className="bg-fpv-700 text-white rounded-2xl p-3 shadow-md">
          <div className="text-sm font-bold px-1">{med} — Medição do mês</div>
          <div className="flex gap-1 mt-1 text-center">
            <PlacarBtn id="prontas" n={prontas.length} rotulo="prontas pra medir" />
            <PlacarBtn id="falta1" n={falta1.length} rotulo="falta 1 selo" badge="bg-amber-400" />
            <PlacarBtn id="travadas" n={travadas.length} rotulo="travadas" badge="bg-red-400" />
          </div>
          <div className="h-1.5 rounded-full bg-fpv-900 mt-2 overflow-hidden">
            <div className="h-full bg-fpv-300 rounded-full" style={{ width: (universo.length ? (prontas.length / universo.length) * 100 : 0) + '%', transition: 'width 700ms' }} />
          </div>
          <div className="text-[11px] text-fpv-100 mt-1 px-1">
            {prontas.length} de {universo.length} O.S. prontas · já medidas em MEDs anteriores: {jaMedidas}
          </div>
        </div>
      </div>

      {/* funil dos 5 selos */}
      <Card>
        <h3 className="font-bold text-stone-900 mb-3">Onde a O.S. para</h3>
        <div className="space-y-1.5">
          {[
            ['Concluída', ''],
            ['+ Memória de cálculo', 'sem memória: não mede'],
            ['+ Foto', 'sem foto: risco na fiscalização'],
            ['+ Nº oficial', 'sem nº: não entra na MED'],
            ['+ Assinatura do fiscal', 'sem assinatura: glosa'],
          ].map(([rotulo, quedaTxt], i) => {
            const n = cumulativo[i];
            const queda = i > 0 ? cumulativo[i - 1] - n : 0;
            const max = Math.max(1, cumulativo[0]);
            const pct = n > 0 ? Math.max(8, (n / max) * 100) : 0;
            const cores = ['#5F93C4', '#3D7CB4', '#2A6CA9', '#185FA5', '#0F3C6A'];
            return (
              <button key={i} onClick={() => { setFiltroSelo(s => (s === i ? null : i)); setFiltroNivel('todas'); }}
                disabled={i === 0}
                className={`w-full flex items-center gap-2 text-left ${filtroSelo === i ? 'ring-2 ring-fpv-300 rounded-lg' : ''}`}>
                <span className="w-28 shrink-0 text-[11px] text-stone-600 text-right leading-tight">{rotulo}</span>
                <div className="relative flex-1 h-8 bg-stone-100 rounded-lg overflow-hidden">
                  <div className="absolute inset-y-0 left-0 rounded-lg" style={{ width: pct + '%', background: cores[i], transition: 'width 700ms' }} />
                  <span className={`absolute inset-y-0 flex items-center text-[11px] font-bold tabular-nums ${pct >= 18 ? 'left-2 text-white' : 'text-stone-700'}`}
                    style={pct >= 18 ? {} : { left: `calc(${pct}% + 8px)` }}>{n}</span>
                </div>
                <span className="w-24 shrink-0 text-[9px] leading-tight text-red-600 font-semibold">
                  {queda > 0 ? `-${queda} · ${quedaTxt}` : ''}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-stone-400 mt-2">Toque num degrau pra ver quem parou ali.</p>
      </Card>

      {/* cobrar hoje */}
      <Card>
        <h3 className="font-bold text-stone-900 mb-3">Cobrar hoje</h3>
        {devedores.length === 0 ? (
          <p className="text-sm text-fpv-700 font-bold flex items-center gap-2"><ShieldCheck size={16} /> Ninguém devendo nada. Medição limpa.</p>
        ) : (
          <div className="space-y-2">
            {devedores.map(d => (
              <div key={d.key} className="border border-stone-200 rounded-xl overflow-hidden">
                <button onClick={() => setGrupoAberto(g => (g === d.key ? null : d.key))}
                  className="w-full flex items-center gap-2.5 p-3 text-left">
                  <span className="w-8 h-8 rounded-full bg-fpv-100 text-fpv-700 font-bold text-xs flex items-center justify-center shrink-0">
                    {d.nome.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-stone-900">{d.nome}</div>
                    <div className={`text-[11px] font-medium truncate ${d.tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{d.resumo}</div>
                  </div>
                  <ChevronDown size={16} className={`text-stone-400 shrink-0 transition-transform ${grupoAberto === d.key ? 'rotate-180' : ''}`} />
                </button>
                {grupoAberto === d.key && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {d.itens.map(({ os, falta }) => (
                      <div key={os.id} className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-stone-700 shrink-0">{rotuloOS(os)}</span>
                        <span className="text-stone-500 truncate flex-1">{os.unidade}</span>
                        <span className="text-stone-400 shrink-0">{falta}</span>
                      </div>
                    ))}
                    <button onClick={() => copiar(d)}
                      className="mt-2 w-full border border-fpv-300 text-fpv-700 font-bold text-xs py-2.5 rounded-lg flex items-center justify-center gap-1.5">
                      {copiado === d.key ? <><Check size={13} /> Copiado!</> : <><Copy size={13} /> Copiar cobrança p/ WhatsApp</>}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* fila da MED */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-bold text-stone-900 flex-1">Fila da {med} ({fila.length})</h3>
          {(filtroNivel !== 'todas' || filtroSelo != null) && (
            <button onClick={() => { setFiltroNivel('todas'); setFiltroSelo(null); }} className="text-[11px] font-bold text-fpv-700">limpar filtro ×</button>
          )}
        </div>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar escola ou nº da O.S."
          className="w-full mb-3 px-3 py-2 text-sm border border-stone-200 rounded-lg bg-stone-50 outline-none focus:border-fpv-500" />
        <p className="text-[10px] text-stone-400 mb-2">mais prontas primeiro</p>
        {fila.length === 0 && <p className="text-sm text-stone-400 text-center py-6">Nada aqui com esse filtro.</p>}
        <div className="space-y-2">
          {fila.slice(0, mostrar).map(o => {
            const s = selosDaOS(o);
            const pronta = s.contagem === 5;
            return (
              <div key={o.id} className={`border rounded-xl p-3 ${pronta ? 'border-l-4 border-l-fpv-500 border-stone-200' : 'border-stone-200'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  {o.emergencial && <Zap size={13} className="text-red-400 shrink-0" />}
                  <span className={`font-mono font-bold text-sm ${s.numero ? 'text-stone-900' : 'text-amber-700'}`}>{rotuloOS(o)}</span>
                  <span className="text-xs text-stone-600 truncate flex-1">{o.unidade}</span>
                  <span className="text-[10px] text-stone-400 shrink-0" title="área">{areaDaOS(o).emoji}</span>
                  {pronta && <span className="text-[9px] font-black bg-fpv-500 text-white rounded px-1.5 py-0.5 shrink-0">PRONTA</span>}
                </div>
                <div className="flex items-center gap-2">
                  <ReguaSelos os={o} />
                  <span className="text-[10px] text-stone-400 bg-stone-100 rounded px-1.5 py-0.5 ml-auto shrink-0">
                    concluída {ha(diasDesde(o.conclusao || o.entrada))}
                  </span>
                </div>
                {!pronta && <p className="text-[11px] text-red-700 mt-1.5">{faltaGrave(o)}</p>}
              </div>
            );
          })}
        </div>
        {fila.length > mostrar && (
          <button onClick={() => setMostrar(m => m + 50)} className="w-full text-xs font-bold text-fpv-700 py-3">
            Carregar mais ({fila.length - mostrar} restantes)
          </button>
        )}
      </Card>

      {/* fora do jogo */}
      <div className="text-xs text-stone-500 px-1">
        <button onClick={() => setForaAberto(f => !f)} className="flex items-center gap-1">
          Fora da {med}: {emAndamento} em andamento · {canceladas} cancelada{canceladas !== 1 ? 's' : ''} · {jaMedidas} já medida{jaMedidas !== 1 ? 's' : ''}
          <ChevronDown size={13} className={`transition-transform ${foraAberto ? 'rotate-180' : ''}`} />
        </button>
        {foraAberto && (
          <div className="flex gap-2 mt-2">
            <button onClick={aoVerLista} className="bg-stone-100 rounded-full px-3 py-1 font-bold">ver na aba O.S. →</button>
          </div>
        )}
      </div>

      {/* barra de export fixa (acima da nav do app) */}
      <div className="fixed bottom-[80px] left-0 right-0 z-20 px-4 print-hidden">
        <div className="max-w-3xl mx-auto bg-white/95 backdrop-blur border border-stone-200 rounded-2xl shadow-lg p-3">
          <button onClick={() => setConfirmar('prontas')} disabled={prontas.length === 0}
            className="w-full bg-fpv-600 active:bg-fpv-700 disabled:bg-stone-200 disabled:text-stone-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm">
            <Download size={16} />
            {prontas.length ? `Exportar PRONTAS (${prontas.length}) — ${med}` : 'Nada 100% pronto ainda. Cobre as pendências acima.'}
          </button>
          <button onClick={() => setConfirmar('tudo')} className="w-full text-[11px] text-stone-500 underline mt-2">
            exportar tudo ({lista.length}) p/ conferência
          </button>
        </div>
      </div>

      {/* confirmação do export */}
      {confirmar && (
        <div className="fixed inset-0 z-30 bg-black/30 flex items-end justify-center print-hidden" onClick={() => setConfirmar(null)}>
          <div className="w-full max-w-3xl bg-white rounded-t-3xl p-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />
            {confirmar === 'prontas' ? (
              <>
                <h3 className="font-bold text-stone-900">{med} · {prontas.length} O.S. · {new Set(prontas.map(o => o.unidade)).size} unidade{new Set(prontas.map(o => o.unidade)).size !== 1 ? 's' : ''}</h3>
                <p className="text-sm text-stone-500 mt-1">5 selos ok em todas. Gerar CSV pra planilha de medição?</p>
              </>
            ) : (
              <>
                <h3 className="font-bold text-stone-900">Exportar TODAS as {lista.length} O.S.</h3>
                <p className="text-sm text-amber-700 font-medium mt-1">
                  Atenção: {lista.length - prontas.length} O.S. incompletas nesse arquivo. Não usar como medição oficial — só conferência.
                </p>
              </>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => {
                if (confirmar === 'prontas') gerarCSV(prontas, `${med.replace(' ', '')}_prontas.csv`);
                else gerarCSV(lista, 'OS_campo_completo_conferencia.csv');
                setConfirmar(null);
              }} className="flex-1 bg-fpv-600 text-white font-bold py-3 rounded-xl text-sm">Gerar CSV</button>
              <button onClick={() => setConfirmar(null)} className="px-5 border border-stone-300 rounded-xl text-sm font-bold text-stone-600">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =====================================================================

const Gestao: React.FC<Props> = (props) => {
  if (props.papel === 'leony') return <TelaEngenheiro {...props} />;
  if (props.papel === 'edmar') return <TelaMedicao {...props} />;
  return (
    <>
      <TelaGestor {...props} />
      {/* 💰 financeiro: SÓ Lucas/Rafael (decisão Renan 08/07 — a trava
          real é a RLS da contrato_financeiro; aqui é só o gate visual) */}
      {['lucas', 'rafael'].includes(props.papel) && <Financeiro />}
    </>
  );
};

export default Gestao;
