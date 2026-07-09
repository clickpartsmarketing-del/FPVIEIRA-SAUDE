// UNIDADES DE SAÚDE do contrato FP.096 (005/2026) — lista canônica
// inicial extraída do diário de junho/2026 (grupo Elétrica FP + planilha
// do Leony). O arquivo mantém o NOME e os EXPORTS do padrão da Educação
// (escolas.ts / ESCOLAS / ZONA_ESCOLA) para não tocar nos componentes —
// aqui "escola" significa "unidade de saúde".
// ⚠ Zonas de fiscal ainda não definidas no Saúde: tudo nasce 'SEMUSA';
// quando o Leony definir os fiscais, preencher o de-para abaixo.
export const ZONA_ESCOLA: [string, string][] = [
  ["SEMUSA", "SEMUSA"],
  ["Hospital Municipal", "SEMUSA"],
  ["Pronto Socorro", "SEMUSA"],
  ["UPA", "SEMUSA"],
  ["Farmácia Municipal", "SEMUSA"],
  ["Posto Âncora", "SEMUSA"],
  ["Posto Cantagalo", "SEMUSA"],
  ["Posto Edméia", "SEMUSA"],
  ["Posto Nova Esperança", "SEMUSA"],
  ["Posto Nova Cidade", "SEMUSA"],
  ["Posto do Recanto", "SEMUSA"],
  ["Galpão Recanto", "SEMUSA"],
  ["Posto Rocha Leão", "SEMUSA"],
  ["Posto Nilson Marins", "SEMUSA"],
  ["Sal Sal (Extensão do Bosque)", "SEMUSA"],
  ["Saúde Mental", "SEMUSA"],
  ["Centro de Reabilitação", "SEMUSA"],
  ["Pré-Operatório", "SEMUSA"],
  ["Casa de Recuperação", "SEMUSA"],
  ["Casa da Criança", "SEMUSA"],
  ["DESGE", "SEMUSA"],
  ["COAD", "SEMUSA"],
  ["Prefeitura", "Central"],
  ["Caminhão Catarata / Tenda (eventos)", "Central"],
];

const normZ = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// fiscal da zona pela unidade — match exato normalizado, depois por
// contenção; sem match = SEMUSA (gestão corrige na edição)
export const fiscalDaEscola = (unidade: string): string => {
  const alvo = normZ(unidade);
  if (!alvo) return 'SEMUSA';
  for (const [nome, zona] of ZONA_ESCOLA) if (normZ(nome) === alvo) return zona;
  for (const [nome, zona] of ZONA_ESCOLA) {
    const n = normZ(nome);
    if (n.includes(alvo) || alvo.includes(n)) return zona;
  }
  return 'SEMUSA';
};

export const ESCOLAS = [
  "SEMUSA",
  "Hospital Municipal",
  "Pronto Socorro",
  "UPA",
  "Farmácia Municipal",
  "Posto Âncora",
  "Posto Cantagalo",
  "Posto Edméia",
  "Posto Nova Esperança",
  "Posto Nova Cidade",
  "Posto do Recanto",
  "Galpão Recanto",
  "Posto Rocha Leão",
  "Posto Nilson Marins",
  "Sal Sal (Extensão do Bosque)",
  "Saúde Mental",
  "Centro de Reabilitação",
  "Pré-Operatório",
  "Casa de Recuperação",
  "Casa da Criança",
  "DESGE",
  "COAD",
  "Prefeitura",
  "Caminhão Catarata / Tenda (eventos)"
];
