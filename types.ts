export interface OSCampo {
  id?: number;
  numero: number | null;
  numero_fict?: number | null; // legado F-nn (sequência global antiga)
  fict_ref?: string | null;    // numeração POR EQUIPE: N01, Q01, E01…
  emergencial: boolean;
  tipo?: string | null; // Emergencial | Corretiva | Preventiva
  unidade: string;
  fiscal: string;
  classificacao: string;
  entrada: string | null;
  conclusao: string | null;
  executor: string;
  status: string;
  medicao: string;
  area?: string | null;
  solicitado?: string;
  servico: string;
  materiais: string;
  memoria_calculo: string;
  foto_urls: string[];
  criado_em?: string;
  assinado?: boolean;
  excluida?: boolean; // marca de exclusão — número preservado, log no banco
  geo?: string | null; // "lat,lng ±Xm" capturado ao salvar (prova de presença)
  prioridade?: number | null;     // 1..3 — definida pela gestão
  par_sugerido?: string | null;   // matchmaking fictícia↔oficial (n8n)
  oficializada_em?: string | null;
}

// referência única da O.S. em TODA tela/planilha: nº oficial > ref da
// equipe (N01/Q01/E01) > F-nn legado > sem número
export const refDaOS = (o: Pick<OSCampo, 'numero' | 'fict_ref' | 'numero_fict'>): string =>
  o.numero != null ? String(o.numero)
    : (o.fict_ref || (o.numero_fict ? `F-${o.numero_fict}` : 'S/Nº'));

export const TIPO_OPTIONS = ['Emergencial', 'Corretiva', 'Preventiva'];
// funil herdado da Educação: pendente → executando → assinatura →
// avaliando → concluída (Material = aguardando material). Status novo
// aqui → revisar FILTROS_STATUS (ListaOS) e o funil (PainelEquipe).
export const STATUS_OPTIONS = ['Pendente', 'Executando', 'Assinatura', 'Avaliando', 'Concluído', 'Material', 'Cancelada'];
// ⚠ SAÚDE: nomes dos fiscais da prefeitura/SEMUSA ainda não confirmados
// com o Leony — 'SEMUSA' é o padrão de toda unidade até lá.
export const FISCAL_OPTIONS = ['SEMUSA', 'Central'];
export const CLASSIF_OPTIONS = ['Emergencial', 'Urgente', 'Normal'];
// REGRA (herdada da Educação): quem sai da operação SAI desta lista — o
// histórico mora só no banco (os_campo.executor guarda o nome como texto;
// a busca retroativa consulta os registros, não as opções).
export const EXECUTOR_OPTIONS = ['Neilson', 'Queiroz', 'Emiliano', 'Serviço Externo'];
// Saúde: MED 1 = março/2026. Junho (MED 4) está em fechamento agora e
// julho (MED 5) é a vigente pelo calendário — por isso as duas abertas.
export const MED_OPTIONS = ['', 'MED 4', 'MED 5'];
