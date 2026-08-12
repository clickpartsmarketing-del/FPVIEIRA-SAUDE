// UNIDADES DE SAÚDE do contrato 005/2026 — lista canônica OFICIAL
// transcrita do "Anexo I — Unidades da Secretaria Municipal de Saúde"
// (fotos do contrato enviadas pelo Renan em 12/08/2026, 32 unidades).
// O arquivo mantém o NOME e os EXPORTS do padrão da Educação
// (escolas.ts / ESCOLAS / ZONA_ESCOLA) para não tocar nos componentes —
// aqui "escola" significa "unidade de saúde".
//
// Convenção dos nomes: forma curta de campo na frente (é o que a equipe
// digita/vê), complemento oficial entre parênteses. O nº do Anexo I está
// no comentário de cada linha — é a ponte para a medição oficial.
//
// Grafias conferidas pelo Renan contra o papel em 12/08/2026: Cória
// Gomes da Silva (4), ESF Clínica da Família Paulo H. Gussen (13),
// Naelma Monteira (21), COGA (7).
// ⚠ Zonas de fiscal ainda não definidas no Saúde: tudo nasce 'SEMUSA';
// quando o Leony definir os fiscais, preencher o de-para abaixo.

export const ESCOLAS = [
  // ---- grandes unidades ----
  "SEMUSA (Sede)",                                        // 32
  "Hospital Municipal Naelma Monteira (HMNM)",            // 21
  "Pronto Socorro Maria Rosa da Conceição",               // 23
  "UPA Valmir Hespanhol",                                 // 31
  "Farmácia Municipal",                                   // 20
  "Resgate 24h",                                          // 24
  // ---- ESF / postos ----
  "ESF Âncora",                                           // 9  (diário: Posto Âncora)
  "ESF Cantagalo",                                        // 10 (diário: Posto Cantagalo)
  "ESF Cidade Praiana",                                   // 11
  "ESF Cláudio Ribeiro",                                  // 12
  "Clínica da Família Paulo H. Gussen",                   // 13
  "ESF Dona Edimeia (Edméia)",                            // 14 (diário: Posto Edméia)
  "ESF Mar do Norte",                                     // 15
  "ESF Nova Cidade",                                      // 16 (diário: Posto Nova Cidade)
  "ESF Operário",                                         // 17
  "ESF Recanto",                                          // 18 (diário: Posto do Recanto)
  "ESF Rocha Leão",                                       // 19 (diário: Posto Rocha Leão)
  // ---- UBS ----
  "UBS Boca da Barra",                                    // 27
  "UBS Jardim Mariléia",                                  // 28
  "UBS Nova Esperança",                                   // 29 (diário: Posto Nova Esperança)
  "UBS Nilson Gonçalves Marins",                          // 30 (diário: Posto Nilson Marins)
  // ---- centros e especializadas ----
  "Extensão do Bosque (Sal Sal)",                         // 6  Centro de Saúde
  "Ambulatório de Saúde Mental",                          // 1  (diário: Saúde Mental)
  "CAPS",                                                 // 2  Centro de Atenção Psicossocial
  "CAPSI Rui Ribeiro de Freitas",                         // 3  infantojuvenil
  "Centro de Reabilitação Rocha Leão (Cória Gomes)",      // 4
  "Centro de Reabilitação Laércio Lúcio de Carvalho",     // 5
  "NASCA (Saúde da Criança e Adolescente)",               // 22
  "Residência Terapêutica I",                             // 25
  "Residência Terapêutica II",                            // 26
  // ---- administrativas ----
  "COGA (Gestão Auditoria)",                              // 7  (diário: COAD — conferir se é a mesma)
  "DESGE",                                                // 8
  // ---- fora do Anexo I: a equipe reportou serviço nesses locais em
  // junho; manter até o Leony confirmar o enquadramento ----
  "Galpão Recanto",
  "Prefeitura",
  "Caminhão Catarata / Tenda (eventos)",
  "Pré-Operatório",
  "Casa de Recuperação",
  "Casa da Criança",
];

// fiscal por unidade — Saúde ainda sem zonas: oficiais = SEMUSA,
// locais fora do anexo = Central (padrão herdado do rascunho anterior)
export const ZONA_ESCOLA: [string, string][] = ESCOLAS.map(e => [
  e,
  (e === "Prefeitura" || e.startsWith("Caminhão Catarata")) ? "Central" : "SEMUSA",
]);

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
