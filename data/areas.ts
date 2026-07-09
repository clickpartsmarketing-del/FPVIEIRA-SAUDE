// =============================================================
// ÁREAS (disciplinas) — segmentam o ciclo inteiro: pergunta do
// chat, filtro da rota do Nicolas e GUIA da memória de cálculo.
// O guia é o que transforma a fala do campo em item EMOP:
// cada disciplina tem SUA unidade de medição (m², m, un, pontos).
// =============================================================

export interface Area {
  nome: string;
  emoji: string;
  palavras: string[];   // casam com servico/solicitado/materiais
  guiaMemoria: string;  // a "pergunta certa" da memória de cálculo
}

export const AREAS: Area[] = [
  {
    nome: 'Hidráulica', emoji: '🚰',
    palavras: ['hidraul', 'vazament', 'torneira', 'caixa d', 'descarga', 'sifao', 'esgoto', 'cano', 'tubo', 'valvula', 'bomba', 'registro', 'pia ', 'vaso sanit', 'mictorio', 'caixa de gordura', 'ralo', 'joelho', 'boia', 'chuveiro', 'bebedouro', 'engate', 'flexivel', 'assento sanit'],
    guiaMemoria: 'PONTOS trocados/instalados (un) · TUBO por diâmetro (m) · registros/válvulas/louças (un) · escavação se houve (m³). EMOP mede tubulação por METRO e conexões/louças por UNIDADE.'
  },
  {
    nome: 'Elétrica', emoji: '⚡',
    palavras: ['eletric', 'tomada', 'interruptor', 'lampada', 'luminaria', 'disjuntor', 'fiacao', 'fio ', 'cabo', 'quadro de luz', 'quadro de energia', 'refletor', 'reator', 'ventilador', 'bocal', 'spot', 'padrao de energia', 'curto'],
    guiaMemoria: 'PONTOS (tomadas/interruptores/luminárias) (un) · CABO por bitola (m) · disjuntores (un + amperagem) · eletroduto (m). EMOP mede cabo/eletroduto por METRO e pontos por UNIDADE.'
  },
  {
    nome: 'Pintura', emoji: '🖌️',
    palavras: ['pintura', 'pintar', 'pintad', 'tinta', 'latex', 'esmalte', 'massa corrida', 'selador', 'textura', 'grafiato', 'verniz', 'caiacao', 'rolo de la', 'lixamento'],
    guiaMemoria: 'ÁREA pintada = largura × altura (m²) por tipo (parede/teto/esquadria) · Nº DE DEMÃOS · tipo de tinta · preparo (lixa/massa/selador em m²). EMOP mede pintura por M² POR DEMÃO.'
  },
  {
    nome: 'Alvenaria/Civil', emoji: '🧱',
    palavras: ['alvenaria', 'parede', 'reboco', 'emboco', 'concreto', 'muro', 'piso', 'contrapiso', 'ceramica', 'porcelanato', 'azulejo', 'calcada', 'assentamento', 'demolic', 'bloco', 'tijolo', 'rejunte', 'argamassa', 'cimento', 'areia', 'brita', 'meio-fio', 'rampa'],
    guiaMemoria: 'ÁREA (m²) de parede/piso/revestimento · ESPESSURA de reboco/contrapiso (cm) · demolição (m² ou m³) · assentamento (m²). EMOP mede alvenaria e revestimento por M².'
  },
  {
    nome: 'Esquadrias/Serralheria', emoji: '🚪',
    palavras: ['porta', 'janela', 'fechadura', 'dobradica', 'portao', 'grade', 'solda', 'serralheria', 'vidro', 'box ', 'basculante', 'cadeado', 'trinco', 'macaneta', 'alambrado', 'tela ', 'corrimao', 'ferragem', 'mola aerea'],
    guiaMemoria: 'UNIDADES (portas/janelas/fechaduras) com DIMENSÕES L×A (m) · vidro (m²) · grade/alambrado (m²) · solda/reparo (un ou m). EMOP mede esquadria por M² ou UNIDADE.'
  },
  {
    nome: 'Telhado/Cobertura', emoji: '🏠',
    palavras: ['telha', 'telhado', 'cobertura', 'calha', 'rufo', 'cumeeira', 'laje', 'goteira', 'impermeabiliza', 'manta', 'forro', 'pvc', 'gesso', 'madeiramento', 'caibro', 'ripa', 'infiltrac'],
    guiaMemoria: 'ÁREA de cobertura/forro (m²) · CALHA/RUFO (metro linear) · telhas trocadas (un ou m²) · impermeabilização (m²). EMOP mede cobertura/forro por M² e calha por METRO.'
  },
  {
    nome: 'Outros', emoji: '🔧',
    palavras: [],
    guiaMemoria: 'QUANTIDADES e DIMENSÕES do que foi feito: m² (largura × altura), metro linear ou unidades — é o que converte em item EMOP na medição.'
  },
];

const normalizar = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// =============================================================
// SERVIÇOS MEDIDOS (pedido do Nicolas): a prévia do que entra na
// medição por MEDIDA — tudo que não dá pra contabilizar só pela
// saída de material. Cada serviço tem SUA fórmula/unidade EMOP.
// =============================================================
export interface ServicoMedido { nome: string; palavras: string[]; guia: string; }

export const SERVICOS_MEDIDOS: ServicoMedido[] = [
  { nome: 'Pintura', palavras: ['pintur', 'pintad', 'pintar', 'latex', 'grafiato', 'textura', 'caiac', 'esmalte'], guia: 'PINTURA: m² = largura × altura de CADA pano, nº de DEMÃOS e tipo de tinta (EMOP paga por m² por demão)' },
  { nome: 'Escavação', palavras: ['escava', 'vala', 'cavou', 'cavar'], guia: 'ESCAVAÇÃO: m³ = comprimento × largura × PROFUNDIDADE (em metros)' },
  { nome: 'Reaterro', palavras: ['reaterro', 'aterro', 'compacta'], guia: 'REATERRO: m³ = comprimento × largura × altura compactada' },
  { nome: 'Concreto', palavras: ['concret', 'laje', 'sapata', 'contrapiso', 'calcada'], guia: 'CONCRETO/CONTRAPISO: comprimento × largura × ESPESSURA (m³ ou m²+esp.) e o traço se souber' },
  { nome: 'Portão/Esquadria', palavras: ['portao', 'porta ', 'janela', 'grade', 'alambrado', 'basculante'], guia: 'PORTÃO/ESQUADRIA: UNIDADES + dimensões de cada um (largura × altura em m)' },
  { nome: 'Alvenaria', palavras: ['alvenaria', 'parede', 'muro', 'bloco', 'tijolo'], guia: 'ALVENARIA: m² = comprimento × altura da parede + tipo/espessura do bloco' },
  { nome: 'Emboço/Reboco', palavras: ['emboc', 'reboc', 'chapisc', 'massa unica'], guia: 'EMBOÇO/REBOCO: m² da superfície + espessura média (cm)' },
  { nome: 'Piso/Revestimento', palavras: ['piso', 'ceramica', 'porcelanato', 'azulejo', 'revestiment'], guia: 'PISO/REVESTIMENTO: m² assentado = comprimento × largura de cada ambiente' },
  { nome: 'Louças/Metais', palavras: ['vaso sanit', 'retirada de vaso', 'assento', 'pia ', 'torneira', 'mictorio', 'lavatorio', 'cuba'], guia: 'LOUÇAS/METAIS: UNIDADES — conta RETIRADA e INSTALAÇÃO como serviços separados' },
  { nome: 'Calha/Rufo', palavras: ['calha', 'rufo', 'pingadeira'], guia: 'CALHA/RUFO: METROS LINEARES + largura da chapa se souber' },
  { nome: 'Forro', palavras: ['forro', 'gesso', 'pvc'], guia: 'FORRO: m² = comprimento × largura do ambiente' },
  { nome: 'Capina/Roçada', palavras: ['capina', 'rocada', 'limpeza de terreno', 'mato'], guia: 'CAPINA/ROÇADA: m² da área limpa (comprimento × largura)' },
];

// Guia de medida ESPECÍFICO pelo texto do serviço; cai pro guia da
// área quando nenhum serviço medido é reconhecido.
export const guiaMedida = (textoServico: string, areaNome?: string | null): string => {
  const t = normalizar(textoServico);
  const hits = SERVICOS_MEDIDOS.filter(s => s.palavras.some(p => t.includes(p)));
  if (hits.length) return hits.slice(0, 2).map(h => h.guia).join(' · ');
  if (areaNome) {
    const a = AREAS.find(x => x.nome === areaNome);
    if (a) return a.guiaMemoria;
  }
  return areaDoTexto(textoServico).guiaMemoria;
};

// Classifica uma O.S. pela área com mais palavras-chave casadas.
// Vale tanto p/ O.S. novas (chat marca a área) quanto p/ as 1.800
// importadas da planilha (classificadas pelo texto do serviço).
export const areaDoTexto = (texto: string): Area => {
  const t = normalizar(texto);
  let melhor = AREAS[AREAS.length - 1]; // Outros
  let melhorPts = 0;
  for (const a of AREAS) {
    let pts = 0;
    for (const p of a.palavras) if (t.includes(p)) pts++;
    if (pts > melhorPts) { melhorPts = pts; melhor = a; }
  }
  return melhor;
};

export const areaDaOS = (os: { area?: string | null; servico?: string; solicitado?: string; materiais?: string }): Area => {
  if (os.area) {
    const fixa = AREAS.find(a => a.nome === os.area);
    if (fixa) return fixa;
  }
  return areaDoTexto(`${os.servico || ''} ${os.solicitado || ''} ${os.materiais || ''}`);
};
