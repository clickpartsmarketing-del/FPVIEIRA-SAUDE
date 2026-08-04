// =============================================================
// CONFIGURAÇÃO OPERACIONAL — SAÚDE (FP.096 · contrato 005/2026,
// Rio das Ostras). O que muda de semana em semana fica aqui.
// Parametrização inicial 09/07/2026 a partir do padrão da
// Educação — nomes/zonas a CONFIRMAR com Leony e Renan.
// =============================================================

// Voz DESLIGADA na semana 1 (lição da Educação: formulário primeiro,
// voz só depois do hábito criado). Religar = trocar para true.
export const VOZ_ATIVA = false;

// Quem vê a aba Gestão. Leony (engenheiro) cai na tela de rota e
// conferência; Edmar na esteira de medição; os demais no boletim.
export const GESTORES = ['leony', 'renan', 'lucas', 'rafael', 'edmar'];

// Lorran Souza cuida do estoque (troca de 03/08/2026 — saiu Thiago
// Rafael; regra nº 11: quem sai da operação sai das listas). No padrão
// da Educação o almoxarife é o usuário-ÂNCORA do onboarding (1º a
// entrar, movimenta o dia todo).
export const ALMOX = ['lorran'];

// Equipes de emergência POR ZONA de fiscal (padrão Educação). No Saúde
// as zonas ainda não foram definidas — os eletricistas entram abaixo
// no formato "corretiva" (painel pessoal por EXECUTOR). Quando o Leony
// definir zonas/fiscais, preencher aqui no mesmo formato da Educação.
export interface Equipe { fiscal: string; membros: string[]; prefixo: string; apelido: string; }
export const EQUIPES: Record<string, Equipe> = {};

// Encarregados de campo: painel próprio filtrado pelo EXECUTOR e
// numeração própria p/ O.S. sem nº oficial (N01 Neilson / Q01 Queiroz /
// E01 Emiliano) — no grupo "Elétrica FP" os dois eletricistas reportam
// individualmente, então cada um tem o seu painel.
export interface Corretiva { executor: string; prefixo: string; apelido: string; }
export const CORRETIVA: Record<string, Corretiva> = {
  neilson: { executor: 'Neilson', prefixo: 'N', apelido: 'Neilson' },
  queiroz: { executor: 'Queiroz', prefixo: 'Q', apelido: 'Queiroz' },
  emiliano: { executor: 'Emiliano', prefixo: 'E', apelido: 'Emiliano' },
};

// LOGIN EM 2 TOQUES (lição #2 da Educação: digitar e-mail no celular
// gera "muita recusa"): tocar no nome preenche o e-mail, só a senha é
// digitada. Usuário novo = criar no Supabase Auth + adicionar aqui
// (+ GESTORES/ALMOX/CORRETIVA se for o caso).
export interface Acesso { rotulo: string; email: string; dica: string; emoji: string; grupo: 'campo' | 'gestao'; }
export const ACESSOS: Acesso[] = [
  { rotulo: 'Neilson', email: 'neilson@fpv.app', dica: 'eletricista', emoji: '⚡', grupo: 'campo' },
  { rotulo: 'Queiroz', email: 'queiroz@fpv.app', dica: 'eletricista', emoji: '⚡', grupo: 'campo' },
  { rotulo: 'Emiliano', email: 'emiliano@fpv.app', dica: 'encarregado', emoji: '🔧', grupo: 'campo' },
  { rotulo: 'Lorran', email: 'lorran@fpv.app', dica: 'almoxarifado', emoji: '📦', grupo: 'campo' },
  { rotulo: 'Leony', email: 'leony@fpv.app', dica: 'engenharia', emoji: '👷', grupo: 'gestao' },
  { rotulo: 'Renan', email: 'renan@fpv.app', dica: 'gestão', emoji: '📊', grupo: 'gestao' },
  { rotulo: 'Lucas', email: 'lucas@fpv.app', dica: 'gestor geral', emoji: '📊', grupo: 'gestao' },
  { rotulo: 'Rafael', email: 'rafael@fpv.app', dica: 'gestão', emoji: '📊', grupo: 'gestao' },
  { rotulo: 'Edmar', email: 'edmar@fpv.app', dica: 'medição', emoji: '📐', grupo: 'gestao' },
  { rotulo: 'Brendah', email: 'brendah@fpv.app', dica: 'assistente', emoji: '📝', grupo: 'gestao' },
];

// DESIGNAÇÃO EM 1 TOQUE: a gestão escolhe quem toca a O.S. no card da
// lista. zap = WhatsApp com DDI+DDD, só dígitos; enquanto vazio, o
// botão "📲 Avisar" fica escondido para aquele destino.
export interface Designado { rotulo: string; executor: string; zap: string; }
export const DESIGNADOS: Designado[] = [
  { rotulo: 'Neilson', executor: 'Neilson', zap: '' },
  { rotulo: 'Queiroz', executor: 'Queiroz', zap: '' },
  { rotulo: 'Emiliano', executor: 'Emiliano', zap: '' },
];

// Medição vigente pelo calendário do SAÚDE: MED 1 = março/2026 (âncora
// da planilha oficial "MEDIÇÃO 01"), então julho/2026 = MED 5.
export const medDoMes = (d = new Date()) =>
  `MED ${5 + (d.getFullYear() - 2026) * 12 + (d.getMonth() - 6)}`;

// Data de HOJE no fuso do CELULAR (Brasília) — nunca usar toISOString()
// para data: ele devolve UTC (3h à frente) e depois das 21h carimbaria
// a data de AMANHÃ na saída/O.S. (lição #9 da Educação)
export const hojeLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
