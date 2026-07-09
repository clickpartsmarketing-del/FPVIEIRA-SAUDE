import { supabase } from './supabaseClient';
import { OSCampo } from '../types';
import { hojeLocal } from '../config';

export const osService = {
  // AUDITORIA: antes, um erro no meio da paginação devolvia lista PARCIAL
  // em silêncio → KPIs da Gestão calculados sobre dados incompletos sem
  // ninguém saber. Agora devolve { dados, erro } e o App decide o que exibir.
  async listar(): Promise<{ dados: OSCampo[]; erro: string | null }> {
    // o PostgREST corta em 1000 linhas por requisição — com a planilha
    // importada (~1.8k O.S.) é preciso paginar até vir página incompleta
    const PAGINA = 1000;
    const todas: OSCampo[] = [];
    for (let off = 0; off < 10000; off += PAGINA) {
      const { data, error } = await supabase
        .from('os_campo')
        .select('*')
        .order('criado_em', { ascending: false })
        .range(off, off + PAGINA - 1);
      if (error) {
        console.error('Erro ao listar O.S.:', error.message);
        return { dados: todas, erro: error.message };
      }
      todas.push(...(data as OSCampo[]));
      if (!data || data.length < PAGINA) break;
    }
    return { dados: todas, erro: null };
  },

  async salvar(os: OSCampo): Promise<{ ok: boolean; erro?: string; os?: OSCampo }> {
    const payload = { ...os };
    delete (payload as any).id;
    delete (payload as any).criado_em;

    if (os.id) {
      let { error } = await supabase.from('os_campo').update(payload).eq('id', os.id);
      // resiliência: banco sem coluna nova ainda ('area'/'geo') → tira e salva
      if (error && /'(area|geo)'/i.test(error.message)) {
        const p2: any = { ...payload };
        delete p2.area; delete p2.geo;
        ({ error } = await supabase.from('os_campo').update(p2).eq('id', os.id));
      }
      return { ok: !error, erro: error?.message };
    }
    // PISO ANTI-COLISÃO COM O PAPEL (conciliação 06/07: a contagem manual
    // já chegou a F-87): sem nº oficial e sem ref de equipe, o app gera o
    // F-nº AQUI com piso 88 — o trigger do banco vira só reserva
    if (!payload.numero && !payload.fict_ref) {
      const f = await this.proximaF();
      if (f) payload.fict_ref = `F-${f}`;
    }

    // insert devolve a linha gravada — o trigger do banco atribui o F-nº
    let { data, error } = await supabase.from('os_campo').insert([payload]).select().single();

    // resiliência a colunas que ainda não existem no banco (SQL pendente):
    // vai tirando a coluna apontada no erro e re-inserindo, em cadeia
    let base: any = { ...payload };

    // sem 'fict_ref' (numeração de equipe) → tira; sai F-nn do trigger
    if (error && /fict_ref/i.test(error.message) && !/duplicate|unique/i.test(error.message)) {
      delete base.fict_ref;
      ({ data, error } = await supabase.from('os_campo').insert([base]).select().single());
    }

    // sem 'tipo' (Emergencial/Corretiva/Preventiva) → tira e re-insere
    if (error && /'tipo'/i.test(error.message)) {
      delete base.tipo;
      ({ data, error } = await supabase.from('os_campo').insert([base]).select().single());
    }

    // sem 'area' → tira e re-insere
    if (error && /'area'/i.test(error.message)) {
      delete base.area;
      ({ data, error } = await supabase.from('os_campo').insert([base]).select().single());
    }

    // sem 'geo' (GEO-COLUNA.sql pendente) → tira e re-insere
    if (error && /'geo'/i.test(error.message)) {
      delete base.geo;
      ({ data, error } = await supabase.from('os_campo').insert([base]).select().single());
    }

    // empate no F-nº (dois salvamentos juntos): recalcula e tenta 1x
    if (error && /duplicate|unique/i.test(error.message) && String(base.fict_ref || '').startsWith('F-')) {
      const f2 = await this.proximaF();
      if (f2) {
        base.fict_ref = `F-${f2}`;
        ({ data, error } = await supabase.from('os_campo').insert([base]).select().single());
      }
    }

    // resiliência: se o banco ainda não tem a coluna 'solicitado',
    // funde o pedido do fiscal dentro do serviço e salva mesmo assim
    if (error && /solicitado/i.test(error.message)) {
      const p2: any = { ...base };
      if (p2.solicitado) {
        p2.servico = `[FISCAL PEDIU] ${p2.solicitado} | [EXECUTADO] ${p2.servico || ''}`.trim();
      }
      delete p2.solicitado;
      delete p2.area;     // banco sem 'solicitado' também não tem 'area'
      delete p2.fict_ref; // nem a numeração de equipe
      delete p2.tipo;     // nem o tipo de atividade
      const r2 = await supabase.from('os_campo').insert([p2]).select().single();
      return { ok: !r2.error, erro: r2.error?.message, os: r2.data as OSCampo };
    }

    return { ok: !error, erro: error?.message, os: data as OSCampo };
  },

  // EXCLUSÃO = MARCA, nunca apaga (regra Renan 06/07): a linha fica no
  // banco com excluida=true, o número segue ocupado na contagem e o
  // trigger do banco grava quem/quando/o que era no os_campo_log
  async excluir(id: number): Promise<boolean> {
    let { error } = await supabase.from('os_campo')
      .update({ excluida: true, status: 'Cancelada' }).eq('id', id);
    // banco sem a coluna ainda (AUDITORIA-EDICOES.sql pendente) →
    // ao menos cancela; NUNCA mais delete físico pelo app
    if (error && /excluida/i.test(error.message)) {
      ({ error } = await supabase.from('os_campo')
        .update({ status: 'Cancelada' }).eq('id', id));
    }
    return !error;
  },

  // Próximo F-nº GLOBAL calculado pelo app: maior entre F-nn legado
  // (numero_fict), F-refs novas e o PISO 87 (contagem do papel chegou
  // lá em 24/06 — conciliação da planilha da Brendah). Dispensa o
  // setval do banco. null = coluna fict_ref ausente (deixa p/ o trigger).
  async proximaF(): Promise<number | null> {
    try {
      const [a, b] = await Promise.all([
        supabase.from('os_campo').select('numero_fict').not('numero_fict', 'is', null)
          .order('numero_fict', { ascending: false }).limit(1),
        supabase.from('os_campo').select('fict_ref').like('fict_ref', 'F-%'),
      ]);
      if (b.error) return null; // sem coluna fict_ref → trigger resolve
      let m = 87;
      const nf = (a.data?.[0] as any)?.numero_fict;
      if (nf && nf > m) m = nf;
      for (const r of (b.data as { fict_ref: string }[]) || []) {
        const n = parseInt(String(r.fict_ref).slice(2), 10);
        if (!isNaN(n) && n > m) m = n;
      }
      return m + 1;
    } catch { return null; }
  },

  // O nº oficial digitado já existe? (guarda anti-duplicata — caso real
  // 06/07: equipe digitou "79" seguindo a contagem do papel e colidiu
  // com a O.S. 79 oficial de janeiro)
  async numeroExiste(n: number): Promise<OSCampo | null> {
    const { data, error } = await supabase.from('os_campo')
      .select('id,numero,unidade,status').eq('numero', n).limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0] as OSCampo;
  },

  // NUMERAÇÃO POR EQUIPE (L01/M01…): calcula o próximo da equipe; o índice
  // único do banco derruba empate de 2 celulares e o salvarEquipe re-tenta.
  // Devolve null se a coluna fict_ref ainda não existe (fallback = F-nn).
  async proximaRefEquipe(prefixo: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('os_campo')
      .select('fict_ref')
      .like('fict_ref', `${prefixo}%`);
    if (error) return /fict_ref/i.test(error.message) ? null : `${prefixo}01`;
    let maior = 0;
    for (const r of (data as { fict_ref: string }[] | null) || []) {
      const n = parseInt((r.fict_ref || '').slice(prefixo.length), 10);
      if (!isNaN(n) && n > maior) maior = n;
    }
    return `${prefixo}${String(maior + 1).padStart(2, '0')}`;
  },

  // Salva O.S. NOVA da equipe com a ref L/M-nº — até 3 tentativas se outro
  // celular pegar o mesmo número no mesmo segundo (erro de chave única).
  async salvarEquipe(os: OSCampo, prefixo: string): Promise<{ ok: boolean; erro?: string; os?: OSCampo }> {
    if (os.id || os.numero) return this.salvar(os); // edição/nº oficial: fluxo normal
    for (let tent = 0; tent < 3; tent++) {
      const ref = await this.proximaRefEquipe(prefixo);
      if (!ref) return this.salvar(os); // banco sem a coluna ainda → F-nn do trigger
      const r = await this.salvar({ ...os, fict_ref: ref });
      if (r.ok || !/duplicate|unique|ux_os_fict_ref/i.test(r.erro || '')) return r;
    }
    return this.salvar(os); // 3 empates seguidos (improvável) → F-nn garante o registro
  },

  // Próximo número da contagem FICTÍCIA (legado do Chat; piso atualizado
  // p/ 88 após a conciliação mostrar o papel em F-87).
  async proximaFict(): Promise<number> {
    const INICIO_FICT = 88;
    const { data, error } = await supabase
      .from('os_campo')
      .select('numero_fict')
      .not('numero_fict', 'is', null)
      .order('numero_fict', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return INICIO_FICT;
    return Math.max((data[0] as any).numero_fict + 1, INICIO_FICT);
  },

  // KIT EMERGENCIAL: baixa automática no estoque — cada item usado vira
  // uma linha de saida_material amarrada à O.S. (origem KIT EMERGENCIAL),
  // exatamente como se o João tivesse lançado. Devolve quantas falharam.
  async baixaKit(itens: { descricao: string; quantidade: number; unidade: string }[], osRef: string, escola: string): Promise<number> {
    if (!itens.length) return 0;
    const hoje = hojeLocal();
    const linhas = itens.map(i => ({
      data: hoje, descricao: i.descricao, quantidade: i.quantidade,
      unidade: i.unidade, os_ref: osRef || null, escola, origem: 'KIT EMERGENCIAL'
    }));
    const { error } = await supabase.from('saida_material').insert(linhas);
    return error ? itens.length : 0;
  },

  async uploadFoto(file: File): Promise<string | null> {
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `os/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('fotos-os').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('fotos-os').getPublicUrl(path);
      return data.publicUrl;
    } catch (e: any) {
      console.error('Erro no upload da foto:', e.message);
      return null;
    }
  },

  // AUDITORIA: sobe o lote e informa quantas FALHARAM — foto de evidência
  // perdida em silêncio é glosa na medição. Quem chama decide avisar.
  async uploadFotos(files: File[]): Promise<{ urls: string[]; falhas: number }> {
    const urls: string[] = [];
    let falhas = 0;
    for (const f of files) {
      const u = await this.uploadFoto(f);
      if (u) urls.push(u); else falhas++;
    }
    return { urls, falhas };
  }
};
