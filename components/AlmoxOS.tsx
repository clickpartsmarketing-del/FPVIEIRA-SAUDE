import React, { useEffect, useState } from 'react';
import { PackageMinus, PackagePlus, Save, Loader2, Trash2, Link2, Undo2, Pencil, Search, TrendingUp, BarChart3, Boxes, Wrench, Inbox, Camera, CheckCircle2, Siren, Construction } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { osService } from '../services/osService';
import { OSCampo, refDaOS, EXECUTOR_OPTIONS } from '../types';
import { MATERIAIS, UNIDADES, ORIGENS, MINIMO_PADRAO_PCT } from '../data/materiais';
import { ESCOLAS, fiscalDaEscola } from '../data/escolas';
import { hojeLocal } from '../config';

// =============================================================
// ALMOXARIFADO v2 (spec engenheiro REV 000) — painel do João:
// Estatística · Saída · Cadastro/Entrada · Estoque · Ferramentas
// · Solicitações. saldo = contagem inicial + entradas − saídas.
// =============================================================

interface Saida {
  id?: number; data: string; descricao: string; quantidade: number; unidade: string;
  os_ref: string; escola: string; origem: string; obs?: string | null;
  destinatario?: string | null; recebido?: boolean | null; criado_em?: string;
}
interface ItemEstoque {
  id?: number; descricao: string; categoria: string; unidade: string;
  qtd_minima: number; saldo_inicial: number;
}
interface Entrada {
  id?: number; data: string; descricao: string; quantidade: number; unidade: string;
  origem: string; nf_url?: string | null; obs?: string | null;
}
interface Ferramenta {
  id?: number; descricao: string; quantidade: number; status: string;
  com_quem?: string | null; obra?: string | null; desde?: string | null;
  obs?: string | null; // "O.S. x" quando a entrega foi vinculada a um serviço
}
interface Solicitacao {
  id?: number; data: string; solicitante: string; os_ref?: string | null;
  itens: string; status: string; criado_em?: string;
}
// ANDAIME (portado da Educação v76 em 18/08): patrimônio PRÓPRIO, fora do
// contrato — NÃO entra em saida_material (que alimenta a medição/EMOP).
// Catálogo de peças + movimentos com retorno: disponível = total − abertos.
interface AndaimeItem {
  id?: number; descricao: string; quantidade_total: number; obs?: string | null;
}
interface AndaimeMov {
  id?: number; item_id: number; quantidade: number; obra?: string | null;
  com_quem?: string | null; os_ref?: string | null; saida: string; volta?: string | null;
}

const CATEGORIAS = ['ELÉTRICA', 'HIDRÁULICA', 'ESGOTO', 'CIVIL', 'PINTURA', 'FERRAMENTAS', 'DIVERSOS'];
const hoje = () => hojeLocal();
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const SAIDA_VAZIA: Saida = { data: hoje(), descricao: '', quantidade: 1, unidade: 'UND', os_ref: '', escola: '', origem: 'ALMOXARIFADO', obs: '', destinatario: '' };
const ITEM_VAZIO: ItemEstoque = { descricao: '', categoria: 'DIVERSOS', unidade: 'UND', qtd_minima: 0, saldo_inicial: 0 };
const ENTRADA_VAZIA: Entrada = { data: hoje(), descricao: '', quantidade: 1, unidade: 'UND', origem: 'COMPRA', obs: '' };

type SubAba = 'stats' | 'saida' | 'cadastro' | 'estoque' | 'ferramentas' | 'andaime' | 'solicitacoes';

const AlmoxOS: React.FC<{ listaOS: OSCampo[]; ehGestor?: boolean; usuario?: string }> = ({ listaOS, ehGestor = false, usuario = '' }) => {
  const [sub, setSub] = useState<SubAba>('stats');
  const [saida, setSaida] = useState<Saida>({ ...SAIDA_VAZIA });
  const [saidas, setSaidas] = useState<Saida[]>([]);
  const [itens, setItens] = useState<ItemEstoque[]>([]);
  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [ferramentas, setFerramentas] = useState<Ferramenta[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [item, setItem] = useState<ItemEstoque>({ ...ITEM_VAZIO });
  const [entrada, setEntrada] = useState<Entrada>({ ...ENTRADA_VAZIA });
  const [nfFoto, setNfFoto] = useState<File | null>(null);
  const [novaFerr, setNovaFerr] = useState({ descricao: '', quantidade: 1 });
  const [andItens, setAndItens] = useState<AndaimeItem[]>([]);
  const [andMovs, setAndMovs] = useState<AndaimeMov[]>([]); // só os em aberto (volta null)
  const [novoAnd, setNovoAnd] = useState({ descricao: '', quantidade: 1 });
  const [andAberto, setAndAberto] = useState<number | null>(null);
  const [faltaAndaime, setFaltaAndaime] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [buscaLista, setBuscaLista] = useState('');
  const [catFiltro, setCatFiltro] = useState('TODAS');
  const [mostrar, setMostrar] = useState(30);
  const [faltaSQL, setFaltaSQL] = useState(false);
  const [ferrAberta, setFerrAberta] = useState<number | null>(null); // ficha da ferramenta
  const [apelidos, setApelidos] = useState<string[]>([]); // autopreenchimento acumulativo (REV002)
  const [mesFiltro, setMesFiltro] = useState('TODOS'); // histórico por mês (REV002)
  // contagem: Leony/Renan + Lucas (gestor geral) — desenho da Educação (REV001)
  const podeAjustarContagem = ['leony', 'renan', 'lucas'].includes(usuario);

  const carregar = async () => {
    const [rs, ri, re, rf, rq] = await Promise.all([
      supabase.from('saida_material').select('*').order('criado_em', { ascending: false }).limit(400),
      supabase.from('estoque_item').select('*').order('descricao'),
      supabase.from('entrada_material').select('*').order('criado_em', { ascending: false }).limit(200),
      supabase.from('ferramenta').select('*').order('descricao'),
      supabase.from('solicitacao_material').select('*').order('criado_em', { ascending: false }).limit(100),
    ]);
    if (!rs.error && rs.data) setSaidas(rs.data as Saida[]);
    if (!ri.error && ri.data) setItens(ri.data as ItemEstoque[]);
    // vocabulário aprendido com a digitação (REV002)
    const ra = await supabase.from('apelido_material').select('digitado').order('usos', { ascending: false }).limit(500);
    if (!ra.error && ra.data) setApelidos((ra.data as { digitado: string }[]).map(a => a.digitado));
    if (!re.error && re.data) setEntradas(re.data as Entrada[]);
    if (!rf.error && rf.data) setFerramentas(rf.data as Ferramenta[]);
    if (!rq.error && rq.data) setSolicitacoes(rq.data as Solicitacao[]);
    setFaltaSQL(!!ri.error && /estoque_item/.test(ri.error.message));
    // andaime é módulo novo: sem a migration 0006 a aba avisa em vez de quebrar
    const [ra1, ra2] = await Promise.all([
      supabase.from('andaime_item').select('*').order('descricao'),
      supabase.from('andaime_movimento').select('*').is('volta', null).order('saida'),
    ]);
    if (!ra1.error && ra1.data) setAndItens(ra1.data as AndaimeItem[]);
    if (!ra2.error && ra2.data) setAndMovs(ra2.data as AndaimeMov[]);
    setFaltaAndaime(!!ra1.error && /andaime/.test(ra1.error.message));
  };
  useEffect(() => { carregar(); }, []);

  // TEMPO REAL: pedido da equipe, saída, entrada ou devolução pinga na
  // tela do Lorran sem apertar nada (debounce contra rajadas)
  useEffect(() => {
    let t: any;
    const bump = () => { clearTimeout(t); t = setTimeout(carregar, 1200); };
    const ch = supabase.channel('rt-almox');
    for (const tb of ['saida_material', 'solicitacao_material', 'estoque_item', 'entrada_material', 'ferramenta', 'andaime_item', 'andaime_movimento']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, bump);
    }
    ch.subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, []);

  // ===== saldo por item: contagem inicial + entradas − saídas (devolução
  // já entra negativa na saída, então somar de volta é automático) =====
  const somaPor = (rows: { descricao: string; quantidade: number }[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) { const k = norm(r.descricao); m[k] = (m[k] || 0) + Number(r.quantidade || 0); }
    return m;
  };
  const entradasPor = somaPor(entradas);
  const saidasPor = somaPor(saidas);
  const saldoDe = (i: ItemEstoque) => Number(i.saldo_inicial || 0) + (entradasPor[norm(i.descricao)] || 0) - (saidasPor[norm(i.descricao)] || 0);
  // mínimo efetivo: o cadastrado no item OU a % padrão do setor sobre a
  // contagem inicial (pedido Renan/Lucas 06/07 — só painel do João)
  const minimoDe = (i: ItemEstoque): { min: number; padrao: boolean } | null => {
    if (i.qtd_minima > 0) return { min: i.qtd_minima, padrao: false };
    const pct = MINIMO_PADRAO_PCT[i.categoria] ?? 15;
    if (pct > 0 && i.saldo_inicial > 0) return { min: i.saldo_inicial * pct / 100, padrao: true };
    return null;
  };
  // alerta do spec: sinalizar a 50% e a 20% da quantidade mínima
  const nivelDe = (i: ItemEstoque) => {
    const m = minimoDe(i);
    if (!m) return null;
    const s = saldoDe(i);
    const suf = m.padrao ? ' · padrão setor' : '';
    if (s <= 0) return { rot: '🚨 EM FALTA', cls: 'bg-red-600 text-white border-red-600' };
    if (s <= m.min * 0.2) return { rot: '🔴 CRÍTICO' + suf, cls: 'bg-red-50 text-red-700 border-red-200' };
    if (s <= m.min * 0.5) return { rot: '🟠 repor já' + suf, cls: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (s <= m.min) return { rot: '🟡 no mínimo' + suf, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    return null;
  };
  const emFalta = itens.filter(i => (i.qtd_minima > 0 || i.saldo_inicial > 0) && saldoDe(i) <= 0);
  const top10Acabando = itens
    .map(i => ({ i, s: saldoDe(i), m: minimoDe(i) }))
    .filter(x => x.m)
    .map(x => ({ i: x.i, s: x.s, r: x.s / x.m!.min }))
    .sort((a, b) => a.r - b.r)
    .slice(0, 10);

  const ehDevolucao = (s: Saida) => s.quantidade < 0 || /devolu/i.test(s.origem || '');
  const hojeStr = hoje();
  const seteDias = hojeLocal(new Date(Date.now() - 7 * 86400000));
  const saidasHoje = saidas.filter(s => s.data === hojeStr && !ehDevolucao(s));
  const semOS = saidas.filter(s => !ehDevolucao(s) && !(s.os_ref || '').trim());
  const pedidosAbertos = solicitacoes.filter(q => q.status === 'PEDIDO');
  // O.S. emergenciais em aberto (spec: só emergencial, pendente/executando)
  const emergAbertas = listaOS.filter(o => o.emergencial && ['Pendente', 'Executando', 'Material'].includes(o.status));

  // só O.S. VIVAS no dropdown (excluída/cancelada não recebe material —
  // refatoração sênior 06/07)
  const refsOS = listaOS
    .filter(os => !os.excluida && os.status !== 'Cancelada')
    .map(os => {
      const r = refDaOS(os);
      return { ref: r === 'S/Nº' ? '' : r, rotulo: `${r} — ${os.unidade}` };
    }).filter(r => r.ref);
  const escolheuOS = (v: string) => {
    const achada = listaOS.find(os => refDaOS(os) === v);
    setSaida(p => ({ ...p, os_ref: v, escola: achada ? achada.unidade : p.escola }));
  };

  // um destinatário confirma o recebimento no login dele (spec)
  // Thiago de volta às retiradas (Renan 12/08); equipes da Educação removidas
  const DESTINATARIOS = [...EXECUTOR_OPTIONS, 'Thiago'];

  // O ALMOXARIFE É O CONTROLADOR DOS EMERGENCIAIS (lição #1 da expansão:
  // o fluxo real começa no balcão — o campo pega material ANTES de
  // registrar a O.S.), então a fictícia nasce AQUI: prefixo por quem
  // retira. Saúde: Lorran Souza no balcão; N Neilson / Q Queiroz /
  // E Emiliano.
  const PREFIXO_DEST: Record<string, string> = {
    'neilson': 'N',
    'queiroz': 'Q',
    'emiliano': 'E',
  };
  const [gerarOS, setGerarOS] = useState(false);

  const salvarSaida = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saida.descricao.trim()) { setMsg('Escolha o material.'); return; }
    if (!saida.quantidade || saida.quantidade <= 0) { setMsg('Quantidade precisa ser maior que zero.'); return; }
    const dest = (saida.destinatario || '').trim();
    // REV 001 do gestor: TODA saída tem retirante — é ele que confirma no login
    if (!dest) { setMsg('Informe QUEM RETIROU — regra do gestor: toda saída tem confirmação no login de quem levou.'); return; }
    let osRef = (saida.os_ref || '').trim();

    // gera a O.S. EMERGENCIAL no balcão e já vincula a saída a ela
    if (gerarOS && !osRef) {
      if (!saida.escola.trim()) { setMsg('Para gerar a O.S. informe a UNIDADE.'); return; }
      if (!dest) { setMsg('Para gerar a O.S. informe QUEM RETIROU (é o executor dela).'); return; }
      setSalvando(true); setMsg('');
      const executor = EXECUTOR_OPTIONS.find(x => norm(x) === norm(dest)) || '';
      const novaOS: any = {
        numero: null, emergencial: true, tipo: 'Emergencial',
        unidade: saida.escola, fiscal: fiscalDaEscola(saida.escola),
        classificacao: 'Emergencial', entrada: hoje(), conclusao: null,
        executor, status: 'Executando', medicao: '',
        solicitado: saida.obs || 'Emergência atendida no almoxarifado',
        servico: '', materiais: `${saida.quantidade} ${saida.unidade} ${saida.descricao}`,
        memoria_calculo: '', foto_urls: []
      };
      const prefixo = PREFIXO_DEST[norm(dest)];
      const r = prefixo ? await osService.salvarEquipe(novaOS, prefixo) : await osService.salvar(novaOS);
      if (!r.ok || !r.os) { setSalvando(false); setMsg('Erro ao gerar a O.S.: ' + (r.erro || '?')); return; }
      osRef = refDaOS(r.os);
      setSalvando(false);
    }

    setSalvando(true); setMsg('');
    const payload: any = { ...saida, os_ref: osRef, destinatario: dest || null };
    delete payload.id; delete payload.criado_em;
    payload.recebido = dest ? false : null;
    let { error } = await supabase.from('saida_material').insert([payload]);
    // banco sem as colunas novas (ALMOX-V2.sql pendente) → salva sem elas
    if (error && /obs|destinatario|recebido/i.test(error.message)) {
      delete payload.obs; delete payload.destinatario; delete payload.recebido;
      ({ error } = await supabase.from('saida_material').insert([payload]));
    }
    setSalvando(false);
    if (error) { setMsg('Erro: ' + error.message); return; }

    // REV002: material FORA do estoque → alerta + cadastro automático
    // com saldo NEGATIVO até a contagem real (gestão ajusta no 🧮)
    let alertaCad = '';
    const jaCadastrado = itens.some(i => norm(i.descricao) === norm(saida.descricao));
    if (!jaCadastrado) {
      const { error: ec } = await supabase.from('estoque_item').insert([{
        descricao: saida.descricao.trim(), categoria: 'DIVERSOS',
        unidade: saida.unidade, qtd_minima: 0, saldo_inicial: 0
      }]);
      if (!ec) alertaCad = ` ⚠️ item fora do estoque — CADASTRADO automático (saldo ficará NEGATIVO até a contagem da gestão).`;
    }
    // aprendizado de digitação (REV002): termo fora do catálogo vira sugestão
    if (!MATERIAIS.some(m => norm(m) === norm(saida.descricao))) {
      const dig = saida.descricao.trim();
      const { data: ap } = await supabase.from('apelido_material').select('id,usos').eq('digitado', dig).limit(1);
      if (ap && ap.length > 0) {
        await supabase.from('apelido_material').update({ usos: (ap[0] as any).usos + 1 }).eq('id', (ap[0] as any).id);
      } else {
        await supabase.from('apelido_material').insert([{ digitado: dig, canonico: dig }]);
      }
    }

    setMsg(`✅ Saída: ${saida.quantidade} ${saida.unidade} ${saida.descricao}${osRef ? ' → O.S. ' + osRef : ''}${gerarOS && osRef ? ' 🚨 (O.S. emergencial GERADA agora)' : ''}${dest ? ` · aguardando ✓ de ${dest}` : ''}${alertaCad}`);
    setGerarOS(false);
    setSaida(p => ({ ...SAIDA_VAZIA, data: p.data, escola: p.escola, os_ref: osRef, origem: p.origem }));
    carregar();
  };

  const salvarItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.descricao.trim()) { setMsg('Informe o material/ferramenta.'); return; }
    setSalvando(true); setMsg('');
    const payload: any = { ...item }; delete payload.id;
    let { error } = await supabase.from('estoque_item').insert([payload]);
    if (error && /duplicate|unique/i.test(error.message)) {
      ({ error } = await supabase.from('estoque_item').update(payload).eq('descricao', item.descricao));
    }
    setSalvando(false);
    if (error) { setMsg(/estoque_item/.test(error.message) ? '⚠️ Rode o ALMOX-V2.sql no Supabase primeiro.' : 'Erro: ' + error.message); return; }
    setMsg(`✅ ${item.descricao} no catálogo (mín. ${item.qtd_minima} ${item.unidade}).`);
    setItem({ ...ITEM_VAZIO }); carregar();
  };

  const salvarEntrada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entrada.descricao.trim()) { setMsg('Informe o material da entrada.'); return; }
    setSalvando(true); setMsg('');
    let nf_url: string | null = null;
    if (nfFoto) nf_url = await osService.uploadFoto(nfFoto);
    const payload: any = { ...entrada, nf_url }; delete payload.id;
    const { error } = await supabase.from('entrada_material').insert([payload]);
    setSalvando(false);
    if (error) { setMsg(/entrada_material/.test(error.message) ? '⚠️ Rode o ALMOX-V2.sql no Supabase primeiro.' : 'Erro: ' + error.message); return; }
    setMsg(`✅ Entrada: ${entrada.quantidade} ${entrada.unidade} ${entrada.descricao}${nf_url ? ' 🧾 NF anexada' : (nfFoto ? ' ⚠️ NF falhou no envio' : '')}`);
    setEntrada({ ...ENTRADA_VAZIA }); setNfFoto(null); carregar();
  };

  const criarFerramenta = async () => {
    if (!novaFerr.descricao.trim()) return;
    const { error } = await supabase.from('ferramenta').insert([{ descricao: novaFerr.descricao, quantidade: novaFerr.quantidade }]);
    if (error) { setMsg(/ferramenta/.test(error.message) ? '⚠️ Rode o ALMOX-V2.sql primeiro.' : 'Erro: ' + error.message); return; }
    setNovaFerr({ descricao: '', quantidade: 1 }); carregar();
  };
  const entregarFerr = async (f: Ferramenta) => {
    const quem = prompt(`Entregar "${f.descricao}" para quem? (encarregado/equipe)`); if (!quem) return;
    const obra = prompt('Em qual obra/unidade?') || '';
    // elo opcional com a O.S. (Renan/Lucas 06/07): rastreia não só COM
    // QUEM está, mas EM QUAL SERVIÇO — sem virar baixa de estoque
    const osRef = (prompt('Vinculada a alguma O.S.? (opcional — nº, L/M-nº ou F-nº)') || '').trim();
    await supabase.from('ferramenta').update({
      status: 'EM CAMPO', com_quem: quem.trim(), obra, desde: hoje(),
      obs: osRef ? `O.S. ${osRef}` : null
    }).eq('id', f.id);
    carregar();
  };
  const receberFerr = async (f: Ferramenta) => {
    await supabase.from('ferramenta').update({ status: 'ESTOQUE', com_quem: null, obra: null, desde: null, obs: null }).eq('id', f.id);
    carregar();
  };
  // João consulta E corrige o vínculo depois da entrega (pedido Renan
  // 06/07: "precisa acessar os dados de onde foi parar")
  const editarVinculoFerr = async (f: Ferramenta) => {
    const quem = prompt('Com quem está?', f.com_quem || ''); if (quem == null) return;
    const obra = prompt('Em qual obra/unidade?', f.obra || ''); if (obra == null) return;
    const osAtual = (f.obs || '').replace(/^O\.S\.\s*/i, '').trim();
    const osRef = (prompt('O.S. vinculada (vazio = sem vínculo):', osAtual) ?? osAtual).trim();
    const { error } = await supabase.from('ferramenta').update({
      com_quem: quem.trim() || f.com_quem,
      obra: obra.trim() || null,
      obs: osRef ? `O.S. ${osRef}` : null
    }).eq('id', f.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`✏️ ${f.descricao}: vínculo atualizado.`); carregar();
  };

  // ===== ANDAIME (patrimônio fora do contrato — portado da Educação v76) =====
  const disponivelAnd = (i: AndaimeItem) =>
    Number(i.quantidade_total || 0) - andMovs.filter(m => m.item_id === i.id).reduce((t, m) => t + Number(m.quantidade || 0), 0);
  const criarAndaime = async () => {
    if (!novoAnd.descricao.trim()) { setMsg('Informe a peça de andaime.'); return; }
    const { error } = await supabase.from('andaime_item').insert([{ descricao: novoAnd.descricao.trim().toUpperCase(), quantidade_total: novoAnd.quantidade }]);
    if (error) { setMsg(/andaime/.test(error.message) ? '⚠️ Rode a migration 0006_andaime.sql primeiro (SQL Editor).' : 'Erro: ' + error.message); return; }
    setNovoAnd({ descricao: '', quantidade: 1 }); setMsg('✅ Peça de andaime cadastrada.'); carregar();
  };
  // envio PARCIAL por natureza: andaime sai em lote (12 painéis p/ uma unidade)
  const enviarAndaime = async (i: AndaimeItem) => {
    const disp = disponivelAnd(i);
    if (disp <= 0) { setMsg(`Sem saldo no pátio de ${i.descricao}.`); return; }
    const qtd = parseFloat(prompt(`Quantas unidades de "${i.descricao}"? (no pátio: ${disp})`, String(disp)) || '');
    if (!qtd || qtd <= 0) return;
    if (qtd > disp) { setMsg(`Só há ${disp} no pátio de ${i.descricao}.`); return; }
    const obra = prompt('Para qual obra/unidade?'); if (obra == null || !obra.trim()) return;
    const quem = prompt('Com quem (responsável)?') || '';
    const { error } = await supabase.from('andaime_movimento').insert([{ item_id: i.id, quantidade: qtd, obra: obra.trim(), com_quem: quem.trim() || null, saida: hoje() }]);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`🏗 ${qtd}× ${i.descricao} → ${obra.trim()}.`); carregar();
  };
  const voltouAndaime = async (m: AndaimeMov, i: AndaimeItem) => {
    if (!confirm(`Confirmar retorno de ${m.quantidade}× ${i.descricao} de ${m.obra || '?'}?`)) return;
    const { error } = await supabase.from('andaime_movimento').update({ volta: hoje() }).eq('id', m.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`↩️ ${m.quantidade}× ${i.descricao} de volta ao pátio.`); carregar();
  };
  const editarAndaime = async (i: AndaimeItem) => {
    const desc = prompt('Peça (descrição):', i.descricao); if (desc == null || !desc.trim()) return;
    const qt = parseFloat(prompt('Quantidade TOTAL (patrimônio):', String(i.quantidade_total)) || '');
    if (!qt || qt <= 0) return;
    const { error } = await supabase.from('andaime_item').update({ descricao: desc.trim().toUpperCase(), quantidade_total: qt }).eq('id', i.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`✏️ ${desc.trim()} atualizado.`); carregar();
  };
  const excluirAndaime = async (i: AndaimeItem) => {
    const fora = andMovs.filter(m => m.item_id === i.id).length;
    if (!confirm(`Apagar "${i.descricao}" do andaime?${fora ? `\n⚠️ Há ${fora} movimento(s) em aberto — somem junto.` : ''}\n(Use só p/ cadastro errado — retorno é o "← voltou".)`)) return;
    const { error } = await supabase.from('andaime_item').delete().eq('id', i.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`🗑 ${i.descricao} apagado do andaime.`); carregar();
  };

  // REV 001 do gestor: Lorran edita descrição/unidade/mínimo; a CONTAGEM
  // (saldo inicial) só a gestão ajusta — separação de funções
  const editarItem = async (i: ItemEstoque) => {
    const desc = prompt('Descrição do item:', i.descricao); if (desc == null || !desc.trim()) return;
    const un = prompt('Unidade (UND, M, KG…):', i.unidade) || i.unidade;
    const minS = prompt('Quantidade MÍNIMA (alerta):', String(i.qtd_minima)); if (minS == null) return;
    const min = parseFloat(minS.replace(',', '.'));
    const { error } = await supabase.from('estoque_item')
      .update({ descricao: desc.trim(), unidade: un.trim(), qtd_minima: isNaN(min) ? i.qtd_minima : min })
      .eq('id', i.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`✏️ ${desc.trim()} atualizado.`); carregar();
  };
  // REV002: excluir item do estoque — só gestão (RLS já restringe no banco)
  const excluirItem = async (i: ItemEstoque) => {
    if (!confirm(`Excluir "${i.descricao}" do catálogo do estoque?\n(As saídas históricas dele NÃO são apagadas.)`)) return;
    const { error } = await supabase.from('estoque_item').delete().eq('id', i.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`🗑 ${i.descricao} removido do catálogo.`); carregar();
  };
  const ajustarContagem = async (i: ItemEstoque) => {
    const s = prompt(`CONTAGEM física de "${i.descricao}" (ajuste de GESTÃO — atual: ${i.saldo_inicial}):`, String(i.saldo_inicial));
    if (s == null) return;
    const v = parseFloat(s.replace(',', '.'));
    if (isNaN(v) || v < 0) { setMsg('Valor inválido.'); return; }
    const { error } = await supabase.from('estoque_item').update({ saldo_inicial: v }).eq('id', i.id);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`🧮 Contagem de ${i.descricao} ajustada para ${v} (gestão).`); carregar();
  };

  const marcarSeparado = async (q: Solicitacao) => {
    await supabase.from('solicitacao_material').update({ status: 'SEPARADO' }).eq('id', q.id);
    carregar();
  };
  // auto-resposta do spec: cada linha do pedido casada contra o estoque
  const checaLinha = (linha: string): { ok: boolean | null; txt: string } => {
    const l = norm(linha);
    const achado = itens.find(i => {
      const palavras = norm(i.descricao).split(/[^a-z0-9]+/).filter(w => w.length > 3);
      return palavras.some(w => l.includes(w));
    });
    if (!achado) return { ok: null, txt: 'conferir' };
    return saldoDe(achado) > 0 ? { ok: true, txt: `tem (${saldoDe(achado)} ${achado.unidade})` } : { ok: false, txt: 'ZERADO' };
  };

  const excluirSaida = async (s: Saida) => {
    if (!s.id || !confirm(`Excluir ${s.quantidade} ${s.unidade} ${s.descricao}?`)) return;
    await supabase.from('saida_material').delete().eq('id', s.id); carregar();
  };
  const devolver = async (s: Saida) => {
    const resp = prompt(`Quantas ${s.unidade} de "${s.descricao}" VOLTARAM pro estoque?\n(saíram ${s.quantidade}${s.os_ref ? ' na O.S. ' + s.os_ref : ''})`);
    if (resp == null) return;
    const q = parseFloat(resp.replace(',', '.'));
    if (!q || q <= 0 || q > s.quantidade) { setMsg('Quantidade de devolução inválida.'); return; }
    const { error } = await supabase.from('saida_material').insert([{ data: hoje(), descricao: s.descricao, quantidade: -q, unidade: s.unidade, os_ref: s.os_ref || null, escola: s.escola, origem: 'DEVOLUÇÃO' }]);
    if (error) { setMsg('Erro: ' + error.message); return; }
    setMsg(`↩ +${q} ${s.unidade} ${s.descricao} de volta ao saldo.`); carregar();
  };
  const editarQt = async (s: Saida) => {
    const resp = prompt(`Corrigir a quantidade de "${s.descricao}" (atual: ${s.quantidade} ${s.unidade}):`, String(s.quantidade));
    if (resp == null) return;
    const q = parseFloat(resp.replace(',', '.'));
    if (isNaN(q) || q === 0) { setMsg('Quantidade inválida.'); return; }
    await supabase.from('saida_material').update({ quantidade: q }).eq('id', s.id); carregar();
  };
  const confirmarRecebidoManual = async (s: Saida) => {
    await supabase.from('saida_material').update({ recebido: true }).eq('id', s.id); carregar();
  };

  // vocabulário único p/ autopreenchimento em TODAS as funções (REV002):
  // catálogo fixo + itens do estoque + termos APRENDIDOS da digitação
  const VOCABULARIO = Array.from(new Set([
    ...MATERIAIS,
    ...itens.map(i => i.descricao),
    ...apelidos,
  ]));

  // trava da medição vigente nas saídas (REV002): fora do mês vigente = só gestão
  const mesVigente = hoje().slice(0, 7);
  const travadaSaida = (s: Saida) => !ehGestor && (s.data || '').slice(0, 7) !== mesVigente;
  const mesesDisponiveis = Array.from(new Set(saidas.map(s => (s.data || '').slice(0, 7)).filter(Boolean))).sort().reverse();

  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500';
  const SubBtn = ({ id, icon: Icon, rot, badge }: { id: SubAba; icon: any; rot: string; badge?: number }) => (
    <button onClick={() => setSub(id)}
      className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-full border whitespace-nowrap ${sub === id ? 'bg-fpv-600 text-white border-fpv-600' : 'bg-white text-stone-600 border-stone-200'}`}>
      <Icon size={13} /> {rot}
      {badge != null && badge > 0 && <span className={`text-[10px] rounded-full px-1.5 ${sub === id ? 'bg-white text-fpv-700' : 'bg-red-600 text-white'}`}>{badge}</span>}
    </button>
  );

  const ListaSaidas = ({ limite }: { limite: number }) => (
    <div className="space-y-1.5">
      {saidas.filter(s =>
        (mesFiltro === 'TODOS' || (s.data || '').slice(0, 7) === mesFiltro) && (
          !buscaLista ||
          s.descricao.toLowerCase().includes(buscaLista.toLowerCase()) ||
          (s.escola || '').toLowerCase().includes(buscaLista.toLowerCase()) ||
          (s.os_ref || '').toLowerCase().includes(buscaLista.toLowerCase())
        )
      ).slice(0, limite).map(s => {
        const dev = ehDevolucao(s);
        const trav = travadaSaida(s);
        return (
          <div key={s.id} className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-sm ${dev ? 'border-amber-200 bg-amber-50/60' : trav ? 'border-stone-100 bg-stone-50/60' : 'border-stone-100'}`}>
            <span className="text-[11px] text-stone-400 tabular-nums shrink-0">{s.data?.split('-').reverse().slice(0, 2).join('/')}</span>
            <span className="flex-1 min-w-0 truncate">
              {dev ? <b className="text-amber-700">↩ +{Math.abs(s.quantidade)} {s.unidade}</b> : <b>{s.quantidade} {s.unidade}</b>} {s.descricao}
              {dev && <span className="text-[10px] text-amber-700 font-bold"> · devolução</span>}
              {/kit emergencial/i.test(s.origem || '') && <span className="text-[10px] text-red-600 font-bold"> · 🚨 kit</span>}
              {s.recebido === false && <span className="text-[10px] text-amber-700 font-bold"> · aguardando ✓ {s.destinatario}</span>}
              {s.recebido === true && <span className="text-[10px] text-fpv-700 font-bold"> · recebido ✔</span>}
            </span>
            {s.os_ref
              ? <span className="text-[11px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-2 py-0.5 shrink-0">O.S. {s.os_ref}</span>
              : <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">sem O.S.</span>}
            {trav ? (
              <span className="p-1 text-stone-300 shrink-0" title="Mês fechado — só a gestão altera">🔒</span>
            ) : (
              <>
                {s.recebido === false && (
                  <button onClick={() => confirmarRecebidoManual(s)} title="Confirmar recebimento (assinou no papel)"
                    className="p-1 text-stone-300 hover:text-fpv-600 shrink-0"><CheckCircle2 size={14} /></button>
                )}
                {!dev && <button onClick={() => devolver(s)} title="Devolução" className="p-1 text-stone-300 hover:text-amber-600 shrink-0"><Undo2 size={14} /></button>}
                <button onClick={() => editarQt(s)} title="Corrigir quantidade" className="p-1 text-stone-300 hover:text-fpv-600 shrink-0"><Pencil size={14} /></button>
                <button onClick={() => excluirSaida(s)} className="p-1 text-stone-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <SubBtn id="stats" icon={BarChart3} rot="Estatística" />
        <SubBtn id="saida" icon={PackageMinus} rot="Saída" />
        <SubBtn id="cadastro" icon={PackagePlus} rot="Cadastro" />
        <SubBtn id="estoque" icon={Boxes} rot="Estoque" />
        <SubBtn id="ferramentas" icon={Wrench} rot="Ferramentas" />
        <SubBtn id="andaime" icon={Construction} rot="Andaime" />
        <SubBtn id="solicitacoes" icon={Inbox} rot="Pedidos" badge={pedidosAbertos.length} />
      </div>

      {faltaSQL && (
        <div className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          ⚠️ O banco ainda não tem as tabelas do Almox v2 — rode o <b>ALMOX-V2.sql</b> no SQL Editor. A Saída continua funcionando normal.
        </div>
      )}
      {msg && <div className="text-sm font-medium text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-lg px-3 py-2">{msg}</div>}

      {/* datalist GLOBAL (REV002): catálogo + estoque + termos aprendidos,
          disponível em TODAS as funções do almoxarifado */}
      <datalist id="materiais">{VOCABULARIO.map(m => <option key={m} value={m} />)}</datalist>

      {/* ============ ESTATÍSTICA ============ */}
      {sub === 'stats' && (
        <>
          {emFalta.length > 0 && (
            <div className="text-xs font-bold text-white bg-red-600 rounded-xl px-3 py-2.5">
              🚨 EM FALTA (saldo zerado/negativo): {emFalta.slice(0, 6).map(i => i.descricao).join(' · ')}{emFalta.length > 6 ? ` e mais ${emFalta.length - 6}` : ''} — repor!
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-3 text-center">
              <div className="text-2xl font-bold text-stone-900 tabular-nums">{saidasHoje.length}</div>
              <div className="text-[10px] font-bold uppercase text-stone-400">saídas hoje</div>
            </div>
            <div className={`rounded-2xl border shadow-sm p-3 text-center ${semOS.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-stone-200'}`}>
              <div className={`text-2xl font-bold tabular-nums ${semOS.length > 0 ? 'text-amber-700' : 'text-stone-900'}`}>{semOS.length}</div>
              <div className={`text-[10px] font-bold uppercase ${semOS.length > 0 ? 'text-amber-600' : 'text-stone-400'}`}>sem O.S.</div>
            </div>
            <div className={`rounded-2xl border shadow-sm p-3 text-center ${pedidosAbertos.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-stone-200'}`}>
              <div className={`text-2xl font-bold tabular-nums ${pedidosAbertos.length > 0 ? 'text-red-700' : 'text-stone-900'}`}>{pedidosAbertos.length}</div>
              <div className={`text-[10px] font-bold uppercase ${pedidosAbertos.length > 0 ? 'text-red-600' : 'text-stone-400'}`}>pedidos abertos</div>
            </div>
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-3 text-center">
              <div className="text-2xl font-bold text-stone-900 tabular-nums">{saidas.filter(s => ehDevolucao(s) && s.data >= seteDias).length}</div>
              <div className="text-[10px] font-bold uppercase text-stone-400">devoluções 7d</div>
            </div>
          </div>

          {top10Acabando.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-2">
                <TrendingUp size={15} className="text-red-600" /> Top 10 perto de acabar (vs. mínimo)
              </h3>
              <div className="space-y-1">
                {top10Acabando.map(({ i, s }) => {
                  const nv = nivelDe(i);
                  return (
                    <div key={i.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 truncate text-stone-700">{i.descricao}</span>
                      <b className="tabular-nums">{s} {i.unidade}</b>
                      <span className="text-[10px] text-stone-400">mín {(() => { const m = minimoDe(i); return m ? Math.round(m.min * 10) / 10 : ''; })()}</span>
                      {nv && <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 ${nv.cls}`}>{nv.rot}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {emergAbertas.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-2">
                <Siren size={15} className="text-red-600" /> Emergenciais em aberto ({emergAbertas.length}) — material pode ser pedido a qualquer hora
              </h3>
              <div className="space-y-1">
                {emergAbertas.slice(0, 8).map(o => (
                  <div key={o.id} className="flex items-center gap-2 text-sm">
                    <b className="w-12 shrink-0 tabular-nums">{refDaOS(o)}</b>
                    <span className="flex-1 min-w-0 truncate text-stone-700">{o.unidade}</span>
                    <span className="text-[10px] text-stone-400">{o.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
            <h3 className="font-bold text-stone-900 mb-3 text-sm">Últimas saídas</h3>
            <ListaSaidas limite={10} />
          </div>
        </>
      )}

      {/* ============ SAÍDA ============ */}
      {sub === 'saida' && (
        <>
          <form onSubmit={salvarSaida} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-4">
            <h2 className="font-bold text-stone-900 flex items-center gap-2"><PackageMinus size={18} className="text-fpv-600" /> Saída de material / ferramenta</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Data</label>
                <input type="date" value={saida.data} onChange={e => setSaida(p => ({ ...p, data: e.target.value }))} className={inputCls} /></div>
              <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Origem</label>
                <select value={saida.origem} onChange={e => setSaida(p => ({ ...p, origem: e.target.value }))} className={inputCls}>
                  {ORIGENS.map(o => <option key={o}>{o}</option>)}
                </select></div>
            </div>
            <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Material (catálogo + aprendidos)</label>
              <input list="materiais" value={saida.descricao} onChange={e => setSaida(p => ({ ...p, descricao: e.target.value }))} required placeholder="ex.: SIF… já completa SIFÃO" className={inputCls} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Quantidade</label>
                <input type="number" step="0.01" min="0" value={saida.quantidade} onChange={e => setSaida(p => ({ ...p, quantidade: parseFloat(e.target.value) || 0 }))} className={inputCls} /></div>
              <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Unidade</label>
                <select value={saida.unidade} onChange={e => setSaida(p => ({ ...p, unidade: e.target.value }))} className={inputCls}>
                  {UNIDADES.map(u => <option key={u}>{u}</option>)}
                </select></div>
            </div>
            <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1"><Link2 size={11} className="inline mr-1" />O.S. vinculada (o coração do cruzamento)</label>
              <input list="refs-os" value={saida.os_ref} onChange={e => escolheuOS(e.target.value)} placeholder="nº oficial, L/M-nº ou F-nn — escolher puxa a unidade" className="w-full border-2 border-fpv-100 rounded-lg px-3 py-2.5 text-sm bg-fpv-50/40 outline-none focus:border-fpv-500" />
              <datalist id="refs-os">{refsOS.map(r => <option key={r.rotulo} value={r.ref}>{r.rotulo}</option>)}</datalist>
              {!(saida.os_ref || '').trim() && (
                <label className={`mt-2 flex items-center gap-2 text-xs font-bold px-3 py-2.5 rounded-xl cursor-pointer border ${gerarOS ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  <input type="checkbox" checked={gerarOS} onChange={e => setGerarOS(e.target.checked)} className="hidden" />
                  <Siren size={14} /> {gerarOS ? 'VAI GERAR a O.S. emergencial ao salvar (unidade + quem retirou obrigatórios)' : 'Emergência SEM O.S.? Toque aqui — o sistema gera a O.S. e vincula'}
                </label>
              )}</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Unidade / destino</label>
                <input list="escolas-almox" value={saida.escola} onChange={e => setSaida(p => ({ ...p, escola: e.target.value }))} className={inputCls} />
                <datalist id="escolas-almox">{ESCOLAS.map(e2 => <option key={e2} value={e2} />)}</datalist></div>
              <div><label className={`block text-[11px] font-bold uppercase mb-1 ${(saida.destinatario || '').trim() ? 'text-stone-500' : 'text-amber-600'}`}>Quem retirou (confirma no login)</label>
                <input list="destinatarios" value={saida.destinatario || ''} onChange={e => setSaida(p => ({ ...p, destinatario: e.target.value }))} placeholder="quem levou? (rastro!)"
                  className={(saida.destinatario || '').trim() ? inputCls : 'w-full border-2 border-amber-300 rounded-lg px-3 py-2.5 text-sm bg-amber-50/40 outline-none focus:border-fpv-500'} />
                <datalist id="destinatarios">{DESTINATARIOS.map(d => <option key={d} value={d} />)}</datalist></div>
            </div>
            <div><label className="block text-[11px] font-bold uppercase text-stone-500 mb-1">Observação (de onde veio, detalhe da origem…)</label>
              <input value={saida.obs || ''} onChange={e => setSaida(p => ({ ...p, obs: e.target.value }))} placeholder="ex.: comprado na Hidro Luz p/ emergência" className={inputCls} /></div>
            <button type="submit" disabled={salvando} className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
              {salvando ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Registrar saída
            </button>
          </form>

          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <h3 className="font-bold text-stone-900 text-sm flex-1">Histórico de saídas <span className="text-stone-400 font-medium">({saidas.length})</span></h3>
              <select value={mesFiltro} onChange={e => setMesFiltro(e.target.value)}
                className="text-xs border border-stone-200 rounded-lg bg-stone-50 px-2 py-1 outline-none focus:border-fpv-500">
                <option value="TODOS">Todos os meses</option>
                {mesesDisponiveis.map(m => <option key={m} value={m}>{m.split('-').reverse().join('/')}{m === mesVigente ? ' (vigente)' : ' 🔒'}</option>)}
              </select>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2 text-stone-400" />
                <input value={buscaLista} onChange={e => setBuscaLista(e.target.value)} placeholder="material, unidade, O.S…" className="pl-7 pr-2 py-1 text-xs border border-stone-200 rounded-lg bg-stone-50 outline-none focus:border-fpv-500 w-40" />
              </div>
            </div>
            <ListaSaidas limite={mostrar} />
            {saidas.length > mostrar && !buscaLista && (
              <button onClick={() => setMostrar(m => m + 100)} className="w-full text-xs font-bold text-fpv-700 py-3">Carregar mais</button>
            )}
          </div>
        </>
      )}

      {/* ============ CADASTRO (item + entrada c/ NF) ============ */}
      {sub === 'cadastro' && (
        <>
          <form onSubmit={salvarItem} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-3">
            <h2 className="font-bold text-stone-900 text-sm">Cadastro no estoque (com quantidade mínima)</h2>
            <input list="materiais" value={item.descricao} onChange={e => setItem(p => ({ ...p, descricao: e.target.value }))} placeholder="material ou ferramenta" className={inputCls} />
            <div className="grid grid-cols-2 gap-3">
              <select value={item.categoria} onChange={e => setItem(p => ({ ...p, categoria: e.target.value }))} className={inputCls}>
                {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={item.unidade} onChange={e => setItem(p => ({ ...p, unidade: e.target.value }))} className={inputCls}>
                {UNIDADES.map(u => <option key={u}>{u}</option>)}
              </select>
              <div><label className="block text-[10px] font-bold uppercase text-stone-400 mb-0.5">Qtd MÍNIMA (alerta)</label>
                <input type="number" step="0.01" min="0" value={item.qtd_minima} onChange={e => setItem(p => ({ ...p, qtd_minima: parseFloat(e.target.value) || 0 }))} className={inputCls} /></div>
              <div><label className="block text-[10px] font-bold uppercase text-stone-400 mb-0.5">Contagem ATUAL (saldo inicial)</label>
                <input type="number" step="0.01" min="0" value={item.saldo_inicial} onChange={e => setItem(p => ({ ...p, saldo_inicial: parseFloat(e.target.value) || 0 }))} className={inputCls} /></div>
            </div>
            <button type="submit" disabled={salvando} className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-3 rounded-xl">Salvar no catálogo</button>
          </form>

          <form onSubmit={salvarEntrada} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-3">
            <h2 className="font-bold text-stone-900 text-sm">Entrada de material (compra) — com foto da NOTA</h2>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={entrada.data} onChange={e => setEntrada(p => ({ ...p, data: e.target.value }))} className={inputCls} />
              <input value={entrada.origem} onChange={e => setEntrada(p => ({ ...p, origem: e.target.value }))} placeholder="origem/fornecedor" className={inputCls} />
            </div>
            <input list="materiais" value={entrada.descricao} onChange={e => setEntrada(p => ({ ...p, descricao: e.target.value }))} placeholder="material" className={inputCls} />
            <div className="grid grid-cols-2 gap-3">
              <input type="number" step="0.01" min="0" value={entrada.quantidade} onChange={e => setEntrada(p => ({ ...p, quantidade: parseFloat(e.target.value) || 0 }))} className={inputCls} />
              <select value={entrada.unidade} onChange={e => setEntrada(p => ({ ...p, unidade: e.target.value }))} className={inputCls}>
                {UNIDADES.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <input value={entrada.obs || ''} onChange={e => setEntrada(p => ({ ...p, obs: e.target.value }))} placeholder="observação / nº da NF" className={inputCls} />
            <label className="flex items-center gap-2 text-sm font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 px-4 py-2.5 rounded-lg cursor-pointer w-fit">
              <Camera size={16} /> {nfFoto ? `🧾 ${nfFoto.name.slice(0, 18)}…` : 'Foto da nota fiscal'}
              <input type="file" accept="image/*" className="hidden" onChange={e => setNfFoto(e.target.files?.[0] || null)} />
            </label>
            <button type="submit" disabled={salvando} className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2">
              {salvando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Registrar entrada
            </button>
          </form>
        </>
      )}

      {/* ============ ESTOQUE ============ */}
      {sub === 'estoque' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
          <h2 className="font-bold text-stone-900 text-sm mb-3">Estoque ({itens.length} itens cadastrados)</h2>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {['TODAS', ...CATEGORIAS].map(c => (
              <button key={c} onClick={() => setCatFiltro(c)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${catFiltro === c ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-500 border-stone-200'}`}>{c}</button>
            ))}
          </div>
          {itens.length === 0 && <p className="text-sm text-stone-400 text-center py-6">Nenhum item cadastrado — comece pela aba Cadastro (contagem física + mínimo).</p>}
          <div className="space-y-1">
            {itens.filter(i => catFiltro === 'TODAS' || i.categoria === catFiltro).map(i => {
              const s = saldoDe(i); const nv = nivelDe(i);
              return (
                <div key={i.id} className="flex items-center gap-2 text-sm border-b border-stone-50 py-1.5">
                  <span className="flex-1 min-w-0 truncate text-stone-700">{i.descricao}</span>
                  <span className="text-[10px] text-stone-400">{i.categoria}</span>
                  <b className={`tabular-nums ${s <= 0 ? 'text-red-600' : 'text-stone-900'}`}>{s} {i.unidade}</b>
                  {i.qtd_minima > 0 && <span className="text-[10px] text-stone-400">mín {i.qtd_minima}</span>}
                  {nv && <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 ${nv.cls}`}>{nv.rot}</span>}
                  <button onClick={() => editarItem(i)} title="Editar descrição/unidade/mínimo"
                    className="p-1 text-stone-300 hover:text-fpv-600 shrink-0"><Pencil size={13} /></button>
                  {podeAjustarContagem && (
                    <button onClick={() => ajustarContagem(i)} title="Ajustar CONTAGEM (Nicolas/Renan/Lucas)"
                      className="text-[10px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-2 py-0.5 shrink-0">🧮</button>
                  )}
                  <button onClick={() => excluirItem(i)} title="Excluir item do catálogo"
                      className="p-1 text-stone-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ FERRAMENTAS ============ */}
      {sub === 'ferramentas' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-3">
          <h2 className="font-bold text-stone-900 text-sm">Ferramentas — quem está com o quê, em qual obra</h2>
          <div className="flex gap-2">
            <input value={novaFerr.descricao} onChange={e => setNovaFerr(p => ({ ...p, descricao: e.target.value }))} placeholder="ex.: MARTELETE BOSCH" className={inputCls} />
            <input type="number" min="1" value={novaFerr.quantidade} onChange={e => setNovaFerr(p => ({ ...p, quantidade: parseFloat(e.target.value) || 1 }))} className="w-20 border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
            <button onClick={criarFerramenta} className="bg-fpv-500 hover:bg-fpv-600 text-white font-bold px-4 rounded-xl text-sm">＋</button>
          </div>
          {ferramentas.length === 0 && <p className="text-sm text-stone-400 text-center py-4">Nenhuma ferramenta cadastrada.</p>}
          {/* REV 001 do gestor: listagem POR RESPONSÁVEL (tópicos) */}
          {(() => {
            const linha = (f: Ferramenta) => {
              const osRef = (f.obs || '').replace(/^O\.S\.\s*/i, '').trim();
              const osVinc = osRef ? listaOS.find(o => refDaOS(o) === osRef) : undefined;
              const aberta = ferrAberta === f.id;
              return (
                <div key={f.id} className={`border rounded-xl px-3 py-2 text-sm ${f.status === 'EM CAMPO' ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100'}`}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setFerrAberta(aberta ? null : (f.id ?? null))} className="flex-1 min-w-0 text-left truncate">
                      <b>{f.quantidade > 1 ? f.quantidade + '× ' : ''}{f.descricao}</b>
                      {f.status === 'EM CAMPO' && (
                        osRef
                          ? <span className="text-[11px] font-bold text-fpv-700"> · O.S. {osRef}</span>
                          : <span className="text-[11px] font-bold text-amber-700"> · SEM O.S. vinculada</span>
                      )}
                      <span className="text-[10px] text-stone-400"> {aberta ? '▲' : '▼'}</span>
                    </button>
                    {f.status === 'EM CAMPO' && (
                      <button onClick={() => editarVinculoFerr(f)} title="Editar com quem / obra / O.S."
                        className="p-1 text-stone-300 hover:text-fpv-600 shrink-0"><Pencil size={13} /></button>
                    )}
                    {f.status === 'ESTOQUE'
                      ? <button onClick={() => entregarFerr(f)} className="text-[11px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-3 py-1 shrink-0">entregar →</button>
                      : <button onClick={() => receberFerr(f)} className="text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-3 py-1 shrink-0">← voltou</button>}
                  </div>
                  {/* a FICHA: onde a ferramenta foi parar (pedido Renan 06/07) */}
                  {aberta && (
                    <div className="mt-1.5 pt-1.5 border-t border-amber-100 text-[11px] text-stone-600 space-y-0.5">
                      {f.status === 'EM CAMPO' ? (
                        <>
                          <p>👷 Com: <b>{f.com_quem || '—'}</b></p>
                          <p>📍 Obra: <b>{f.obra || '— (toque no lápis p/ preencher)'}</b></p>
                          <p>🔗 O.S.: <b className={osRef ? 'text-fpv-700' : 'text-amber-700'}>{osRef || 'SEM VÍNCULO (toque no lápis)'}</b>{osVinc ? <span className="text-stone-500"> — {osVinc.unidade} · {osVinc.status}</span> : ''}</p>
                          <p>📅 Em campo desde: {f.desde ? f.desde.split('-').reverse().join('/') : '—'}</p>
                        </>
                      ) : (
                        <p>📦 No estoque do almoxarifado — disponível, sem vínculo com O.S.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            };
            const emCampo = ferramentas.filter(f => f.status === 'EM CAMPO');
            const noEstoque = ferramentas.filter(f => f.status !== 'EM CAMPO');
            // PLACAR DE SALDO (portado da Educação v74): a tela listava mas não
            // SOMAVA. Soma por UNIDADE (quantidade), não por cadastro: carrinho
            // de mão 4x conta 4. +7 dias em campo = cobrar devolução.
            const unid = (fs: Ferramenta[]) => fs.reduce((t, f) => t + Number(f.quantidade || 1), 0);
            // T12:00 evita o off-by-one de fuso ao parsear data pura (padrão hojeLocal)
            const fora7 = emCampo.filter(f => f.desde && (Date.now() - new Date(f.desde + 'T12:00:00').getTime()) / 86400000 >= 7);
            // SALDO UNITÁRIO POR FERRAMENTA (v75): itens numerados ("SERRA
            // MÁRMORE 01/02/03") viram uma FAMÍLIA só, com o saldo ao lado.
            // O sufixo removido é apenas "número (+1 letra)" no FIM: "MARTELETE
            // 5KG" e "ESCADA 7 DEGRAUS" não são tocados.
            const familia = (d: string) => d.trim().toUpperCase().replace(/\s+\d+\s*[A-ZÀ-Ü]?$/, '').replace(/\s{2,}/g, ' ').trim() || d.trim().toUpperCase();
            const familias: Record<string, { total: number; campo: number }> = {};
            for (const f of ferramentas) {
              const k = familia(f.descricao);
              const q = Number(f.quantidade || 1);
              (familias[k] = familias[k] || { total: 0, campo: 0 }).total += q;
              if (f.status === 'EM CAMPO') familias[k].campo += q;
            }
            const grupos: Record<string, Ferramenta[]> = {};
            for (const f of emCampo) { const k = (f.com_quem || 'Sem responsável').trim(); (grupos[k] = grupos[k] || []).push(f); }
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-stone-50 border border-stone-200 rounded-xl py-2">
                    <div className="text-lg font-bold text-stone-800">{unid(ferramentas)}</div>
                    <div className="text-[10px] text-stone-500 font-medium">UNIDADES NO TOTAL</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl py-2">
                    <div className="text-lg font-bold text-amber-800">{unid(emCampo)}</div>
                    <div className="text-[10px] text-amber-700 font-medium">EM CAMPO</div>
                  </div>
                  <div className="bg-fpv-50 border border-fpv-100 rounded-xl py-2">
                    <div className="text-lg font-bold text-fpv-700">{unid(noEstoque)}</div>
                    <div className="text-[10px] text-fpv-700 font-medium">NO ESTOQUE</div>
                  </div>
                </div>
                {fora7.length > 0 && (
                  <p className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                    ⏰ {fora7.length} ferramenta(s) em campo há 7+ dias — cobrar devolução
                  </p>
                )}
                {/* saldo de cada ferramenta ao lado do nome — rolagem rápida do Lorran */}
                {Object.keys(familias).length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-stone-500 mb-1.5">📊 Saldo por ferramenta</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {Object.entries(familias).sort((a, b) => a[0].localeCompare(b[0])).map(([nome, s]) => (
                        <div key={nome} className="flex items-center justify-between gap-2 border border-stone-100 rounded-lg px-2.5 py-1 text-[12px]">
                          <span className="truncate font-medium text-stone-700">{nome}</span>
                          <span className={`shrink-0 font-bold ${s.total - s.campo === 0 ? 'text-amber-700' : 'text-fpv-700'}`}>
                            {s.total - s.campo}/{s.total} no estoque{s.campo > 0 ? ` · ${s.campo} em campo` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0])).map(([quem, fs]) => (
                  <div key={quem}>
                    <div className="text-xs font-bold text-amber-800 mb-1.5">🧰 {quem} <span className="font-medium text-amber-600">({fs.reduce((t, f) => t + Number(f.quantidade || 1), 0)} item(ns) em campo)</span></div>
                    <div className="space-y-1.5">{fs.map(linha)}</div>
                  </div>
                ))}
                {noEstoque.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-stone-500 mb-1.5">📦 No estoque ({unid(noEstoque)} unid · {noEstoque.length} cadastros)</div>
                    <div className="space-y-1.5">{noEstoque.map(linha)}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ============ ANDAIME (patrimônio fora do contrato) ============ */}
      {sub === 'andaime' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-3">
          <h2 className="font-bold text-stone-900 text-sm">Andaime — patrimônio próprio <span className="text-stone-400 font-medium">(fora do contrato, não entra na medição)</span></h2>
          {faltaAndaime && (
            <p className="text-[12px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              ⚠️ Módulo novo: peça ao Renan para rodar a migration <b>0006_andaime.sql</b> no SQL Editor do Supabase — a aba liga sozinha depois.
            </p>
          )}
          <div className="flex gap-2">
            <input value={novoAnd.descricao} onChange={e => setNovoAnd(p => ({ ...p, descricao: e.target.value }))} placeholder="ex.: PAINEL 1,00 X 1,00" className={inputCls} />
            <input type="number" min="1" value={novoAnd.quantidade} onChange={e => setNovoAnd(p => ({ ...p, quantidade: parseFloat(e.target.value) || 1 }))} className="w-20 border border-stone-200 rounded-lg px-3 py-2.5 text-sm bg-stone-50 outline-none focus:border-fpv-500" />
            <button onClick={criarAndaime} className="bg-fpv-500 hover:bg-fpv-600 text-white font-bold px-4 rounded-xl text-sm">＋</button>
          </div>
          {!faltaAndaime && andItens.length === 0 && <p className="text-sm text-stone-400 text-center py-4">Nenhuma peça cadastrada — comece pelo ＋ (descrição + quantidade total).</p>}
          <div className="space-y-1.5">
            {andItens.map(i => {
              const movs = andMovs.filter(m => m.item_id === i.id);
              const fora = movs.reduce((t, m) => t + Number(m.quantidade || 0), 0);
              const disp = Number(i.quantidade_total || 0) - fora;
              const aberta = andAberto === i.id;
              return (
                <div key={i.id} className={`border rounded-xl px-3 py-2 text-sm ${fora > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-stone-100'}`}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setAndAberto(aberta ? null : (i.id ?? null))} className="flex-1 min-w-0 text-left truncate">
                      <b>{i.descricao}</b>
                      <span className={`text-[11px] font-bold ${disp === 0 ? 'text-amber-700' : 'text-fpv-700'}`}> · {disp}/{i.quantidade_total} no pátio{fora > 0 ? ` · ${fora} em obra` : ''}</span>
                      <span className="text-[10px] text-stone-400"> {aberta ? '▲' : '▼'}</span>
                    </button>
                    <button onClick={() => editarAndaime(i)} title="Corrigir descrição/quantidade total" className="p-1 text-stone-300 hover:text-fpv-600 shrink-0"><Pencil size={13} /></button>
                    <button onClick={() => excluirAndaime(i)} title="Apagar cadastro errado" className="p-1 text-stone-300 hover:text-red-500 shrink-0"><Trash2 size={13} /></button>
                    <button onClick={() => enviarAndaime(i)} className="text-[11px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-3 py-1 shrink-0">enviar →</button>
                  </div>
                  {aberta && (
                    <div className="mt-1.5 pt-1.5 border-t border-amber-100 text-[11px] text-stone-600 space-y-1">
                      {movs.length === 0 && <p>📦 Tudo no pátio — nenhum movimento em aberto.</p>}
                      {movs.map(m => (
                        <div key={m.id} className="flex items-center gap-2">
                          <span className="flex-1">🏗 {m.quantidade}× em <b>{m.obra || '?'}</b> · {m.com_quem || 'sem responsável'} · desde {m.saida ? m.saida.split('-').reverse().join('/') : '—'}</span>
                          <button onClick={() => voltouAndaime(m, i)} className="text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-3 py-1 shrink-0">← voltou</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ SOLICITAÇÕES ============ */}
      {sub === 'solicitacoes' && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
          <h2 className="font-bold text-stone-900 text-sm mb-3">Pedidos das equipes <span className="text-stone-400 font-medium">({solicitacoes.length})</span></h2>
          {solicitacoes.length === 0 && <p className="text-sm text-stone-400 text-center py-6">Nenhum pedido ainda — as equipes pedem pelo Painel delas.</p>}
          <div className="space-y-2">
            {solicitacoes.map(q => (
              <div key={q.id} className={`border rounded-xl p-3 ${q.status === 'PEDIDO' ? 'border-red-200 bg-red-50/40' : q.status === 'SEPARADO' ? 'border-amber-200 bg-amber-50/40' : 'border-stone-100'}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <b className="text-sm text-stone-900">{q.solicitante}</b>
                  {q.os_ref && <span className="text-[11px] font-bold text-fpv-700 bg-fpv-50 border border-fpv-100 rounded-full px-2 py-0.5">O.S. {q.os_ref}</span>}
                  <span className="text-[11px] text-stone-400 flex-1">{q.data?.split('-').reverse().slice(0, 2).join('/')}</span>
                  <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${q.status === 'PEDIDO' ? 'bg-red-600 text-white' : q.status === 'SEPARADO' ? 'bg-amber-500 text-white' : 'bg-fpv-600 text-white'}`}>{q.status}</span>
                </div>
                <div className="space-y-0.5">
                  {q.itens.split('\n').filter(l => l.trim()).map((l, i) => {
                    const c = checaLinha(l);
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 min-w-0 truncate text-stone-700">{l}</span>
                        <span className={`text-[10px] font-bold ${c.ok === true ? 'text-fpv-700' : c.ok === false ? 'text-red-600' : 'text-stone-400'}`}>
                          {c.ok === true ? '✔ ' : c.ok === false ? '✗ ' : '? '}{c.txt}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {q.status === 'PEDIDO' && (
                  <button onClick={() => marcarSeparado(q)} className="mt-2 w-full text-xs font-bold text-white bg-fpv-600 hover:bg-fpv-700 rounded-lg py-2">
                    ✔ Material separado (avisa a equipe)
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlmoxOS;
