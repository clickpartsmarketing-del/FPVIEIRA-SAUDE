# FRENTE 2 — como o frontend vai chamar as RPC

> **NADA aqui foi aplicado nos componentes.** Este arquivo é a receita para o
> Renan trocar depois, com revisão, **um fluxo por vez**. O SQL
> (`05-rpc-transacionais.sql`) já pode rodar hoje: enquanto ninguém chamar as
> funções, elas ficam paradas sem efeito nenhum na operação.

---

## Por que trocar

Hoje um "salvar" do campo são 2 a 5 chamadas soltas ao Supabase. Se a rede cair
no meio (celular na escola, 3G ruim), fica **metade feito**:

| fluxo | o que acontece hoje se cair no meio |
|---|---|
| NovaOS + kit | O.S. salva, **kit não baixado** → material sumiu do estoque e do custo |
| Balcão do João | O.S. emergencial criada **sem** a saída, ou saída **sem** a O.S. |
| Pedido → saídas | pedido virou SEPARADO **sem** as saídas, ou saídas geradas **2x** |
| Oficializar fictícia | fictícia **cancelada** e material apontando pra ref que sumiu (as 168 órfãs da auditoria de 24/07) |

Com a RPC vira **uma chamada = uma transação**: ou tudo grava, ou nada grava.

---

## Regra de ouro: o `op_id`

Toda RPC recebe um `p_op_id` — um `uuid` gerado **no celular**. É ele que
garante: chamou 2x com o mesmo id (usuário bateu 2x, retry automático, rede
devolveu timeout mas o banco gravou), a 2ª volta com o **mesmo resultado** e
**não repete o efeito**. A resposta vem com `repetida: true`.

O `op_id` tem que ser **gerado uma vez por operação** e **reusado no retry** —
se você gerar um novo a cada tentativa, a proteção não existe.

Só **sucesso** é carimbado. Erro de negócio (`ok:false`) não entra no caderno,
então o usuário corrige e re-tenta **com o mesmo id** sem ficar preso — é assim
que funcionam os `confirm()` (`p_forcar_sem_vinculo`, `p_confirmar_fusao`).

### Arquivo novo sugerido: `services/rpc.ts`

```ts
import { supabase } from './supabaseClient';

export interface RpcResp {
  ok: boolean;
  id: number | null;
  erro: string | null;
  repetida?: boolean;
  [k: string]: any;
}

// uuid com fallback (WebView antigo de celular não tem crypto.randomUUID)
export const novoOpId = (): string => {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* segue */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

// chamada única com retry seguro: o MESMO op_id nas 3 tentativas, então
// repetir NUNCA duplica — só erro de rede é re-tentado.
export async function rpc(nome: string, args: Record<string, any>, tentativas = 3): Promise<RpcResp> {
  let ultimo = '';
  for (let t = 0; t < tentativas; t++) {
    const { data, error } = await supabase.rpc(nome, args);
    if (!error) return data as RpcResp;
    ultimo = error.message;
    // erro de permissão/parâmetro não melhora tentando de novo
    if (/permission|does not exist|invalid input/i.test(error.message)) break;
    await new Promise(r => setTimeout(r, 600 * (t + 1)));
  }
  return { ok: false, id: null, erro: `REDE: ${ultimo}` };
}
```

---

## FLUXO 1 — `components/NovaOS.tsx`: salvar O.S. + baixar kit

**Hoje** (linhas ~208-230): monta o texto `[KIT]`, chama `osService.salvarEquipe()`
e **depois** `osService.baixaKit()`. Duas viagens.

**Depois** — uma só. O `op_id` nasce junto do rascunho, para o retry reusar:

```ts
// no topo do componente, junto dos outros useState:
const opIdRef = useRef<string>(novoOpId());
// e em limpar()/após salvar com sucesso:  opIdRef.current = novoOpId();

// ... dentro de salvar(), no lugar do bloco salvarEquipe + baixaKit:
const r = await rpc('fpv_os_salvar_com_kit', {
  p_op_id: opIdRef.current,
  p_os: {
    id: os.id ?? null,                       // preenchido = edição
    numero: os.numero ? Number(os.numero) : null,
    emergencial: os.emergencial,
    tipo: os.tipo ?? null,
    unidade: os.unidade.trim(),
    fiscal: os.fiscal,
    classificacao: os.classificacao,
    entrada: os.entrada,                     // 'aaaa-mm-dd' ou null
    conclusao: os.conclusao,
    executor: os.executor,
    status: os.status,
    medicao: os.medicao,                     // ignorado se não for gestor
    area: os.area ?? null,
    solicitado: os.solicitado ?? '',
    servico: os.servico,
    materiais: os.materiais.trim(),          // SEM o "[KIT] ..." — a RPC monta
    memoria_calculo: os.memoria_calculo,
    foto_urls: urls,                         // upload das fotos continua ANTES
    geo: geo ?? null,
  },
  p_kit: baixaAuto ? itensKit : [],          // [{descricao, quantidade, unidade}]
  p_prefixo: prefixoRef ?? '',               // 'L' | 'M' | 'G' | 'C' | '' (=F-nº)
  p_baixa_kit: baixaAuto,
  p_permitir_duplicado: false,               // gestor confirma e re-chama com true
});

setSalvando(false);

if (!r.ok) {
  if (r.erro === 'NUMERO_DUPLICADO') {
    const c = r.conflito;
    if (!ehGestor) {
      setMsg(`⛔ A O.S. ${c.numero} JÁ EXISTE (${c.unidade} · ${c.status}). Se a sua é NOVA, deixe o Nº VAZIO — o sistema gera o ${prefixoRef ?? 'F'}-nº sozinho.`);
      return;
    }
    if (!confirm(`O.S. ${c.numero} já existe (${c.unidade} · ${c.status}). Criar DUPLICADA mesmo assim?`)) return;
    // MESMO op_id: se a 1ª tentativa tivesse gravado, não duplicaria
    const r2 = await rpc('fpv_os_salvar_com_kit', { /* …iguais… */, p_permitir_duplicado: true });
    /* trata r2 */
    return;
  }
  if (r.erro === 'MEDICAO_FECHADA') {
    setMsg(`🔒 Esta O.S. está na ${r.medicao} (medição FECHADA) — fale com a gestão.`);
    return;
  }
  setMsg('Erro ao salvar: ' + (r.erro || 'verifique a conexão'));
  return;
}

const msgKit = r.kit_baixado > 0 ? ` 📦 ${r.kit_baixado} item(ns) do kit baixados no estoque → O.S. ${r.ref}.` : '';
setMsg((os.id ? 'O.S. atualizada ✔' : `O.S. ${r.ref} registrada no banco central ✔`) + msgKit);
opIdRef.current = novoOpId();     // próxima O.S. = nova operação
```

**Duas mudanças de comportamento a conferir:**

1. O texto `[KIT] …` passa a ser montado **na RPC**. Se você deixar o
   `const materiais = [...]` de hoje, não duplica (a RPC só acrescenta se o
   texto ainda não tiver `[KIT]`), mas o certo é **tirar** e mandar
   `os.materiais.trim()` puro.
2. Sumiu o `⚠️ N item(ns) do kit NÃO baixaram — avise o João`. Não existe mais
   esse estado: ou a O.S. **e** o kit entraram, ou nenhum dos dois.

**O que continua igual:** upload de fotos (antes da chamada, com o
`confirm()` das que falharam), GEO, rascunho no `localStorage`, validações
síncronas, anti duplo-toque.

---

## FLUXO 2 — `components/AlmoxOS.tsx`: `salvarSaida` (balcão do João)

**Hoje**: gera a O.S. emergencial → insere a saída → atualiza status
`Pendente→Executando` → cadastra o item no estoque → grava o apelido. **Cinco**
chamadas.

```ts
const opSaidaRef = useRef<string>(novoOpId());

const enviar = async (forcarSemVinculo = false) => {
  const r = await rpc('fpv_almox_saida', {
    p_op_id: opSaidaRef.current,
    p_saida: {
      data: saida.data,
      descricao: saida.descricao.trim(),
      quantidade: saida.quantidade,
      unidade: saida.unidade,
      os_ref: saida.os_ref,
      escola: saida.escola,
      origem: saida.origem,
      obs: saida.obs ?? '',
      destinatario: (saida.destinatario || '').trim(),
    },
    p_gerar_os: gerarOS,
    p_prefixo: PREFIXO_DEST[norm((saida.destinatario || '').trim())] ?? '',
    p_os_extra: {
      fiscal: fiscalDaEscola(saida.escola),
      executor: EXECUTOR_OPTIONS.find(x => norm(x) === norm(saida.destinatario || '')) || '',
    },
    p_forcar_sem_vinculo: forcarSemVinculo,
  });

  // nº digitado que não existe: mesma pergunta de hoje, e RE-CHAMA com o
  // MESMO op_id — por isso não corre risco de gravar duas saídas
  if (!r.ok && r.erro === 'OS_NAO_ENCONTRADA') {
    const ok = confirm(
      `A O.S. "${r.ref_digitada}" não existe no sistema.\n\n` +
      `OK = salvar SEM vínculo (fica anotado na observação)\nCancelar = corrigir o número`);
    if (!ok) return;
    return enviar(true);
  }
  if (!r.ok) { setMsg('Erro: ' + r.erro); return; }

  setMsg(`✅ Saída: ${saida.quantidade} ${saida.unidade} ${saida.descricao}`
    + (r.ref ? ` → O.S. ${r.ref}` : '')
    + (r.sem_vinculo ? ' ⚠️ SEM vínculo (nº anotado na obs)' : '')
    + (r.os_gerada ? ' 🚨 (O.S. emergencial GERADA agora)' : '')
    + ` · aguardando ✓ de ${saida.destinatario}`
    + (r.escola_ajustada ? ` · escola ajustada p/ ${r.escola_ajustada}` : '')
    + (r.item_cadastrado ? ' ⚠️ item fora do estoque — CADASTRADO automático' : '')
    + (r.status_alterado ? ` · O.S. ${r.ref} passou p/ EXECUTANDO` : ''));

  opSaidaRef.current = novoOpId();
  setGerarOS(false);
  setSaida(p => ({ ...SAIDA_VAZIA, data: p.data, escola: p.escola, os_ref: r.ref ?? '', origem: p.origem }));
  carregar();
};
```

**Ganho escondido:** se a ref digitada for uma fictícia **já oficializada**
(L20 que virou 1330), a RPC resolve sozinha e grava o material **já no número
oficial** — em vez de criar mais uma órfã.

---

## FLUXO 2b — `AlmoxOS.tsx`: `gerarSaidasDoPedido`

O `parsePedido()` **continua no frontend** (é ele que quebra o texto do pedido
em itens). Só o gravar muda:

```ts
const gerarSaidasDoPedido = async (q: Solicitacao) => {
  const itensP = parsePedido(q.itens);
  if (itensP.length === 0) { setMsg('Pedido sem itens para gerar.'); return; }
  const previa = itensP.map(i => `• ${i.quantidade} ${i.unidade} ${i.descricao}`).join('\n');
  if (!confirm(`Gerar ${itensP.length} saída(s) deste pedido de ${q.solicitante}?\n\n${previa}`)) return;

  setSalvando(true);
  const r = await rpc('fpv_almox_saidas_do_pedido', {
    p_op_id: novoOpId(),
    p_pedido_id: q.id,
    p_itens: itensP,                 // [{descricao, quantidade, unidade}]
    p_destinatario: null,            // null = a RPC extrai de q.solicitante
    p_forcar: false,
  });
  setSalvando(false);

  if (!r.ok && r.erro === 'PEDIDO_JA_ATENDIDO') {
    setMsg(`Este pedido já está ${r.status} — as saídas dele já foram geradas.`);
    carregar(); return;
  }
  if (!r.ok) { setMsg('Erro ao gerar saídas: ' + r.erro); return; }
  setMsg(`✅ ${r.saidas} saída(s) geradas${r.ref ? ' → O.S. ' + r.ref : ''}. Pedido marcado como SEPARADO.`);
  carregar();
};
```

**Trava dupla:** além do `op_id`, o pedido só gera saídas se estiver com status
`PEDIDO`. Isso protege até do caso "duas abas abertas em celulares
diferentes", que o `gerandoRef` de hoje **não** cobre.

---

## FLUXO 3 — `components/ListaOS.tsx`: oficializar / vincular número

### 3a) confirmar o par sugerido (botão do matchmaking)

```ts
const oficializar = async (f: OSCampo, o: OSCampo) => {
  if (!confirm(`Confirmar que a ${refDaOS(f)} é a O.S. oficial ${o.numero}?`)) return;
  const r = await rpc('fpv_os_oficializar', {
    p_op_id: novoOpId(), p_fict_id: f.id, p_oficial_id: o.id,
  });
  if (!r.ok) { alert('Não deu para oficializar: ' + r.erro); return; }
  if (r.ja_estava) alert(`A ${r.ref_ficticia} já estava oficializada na ${r.numero}.`);
  else if (r.material_migrado > 0)
    alert(`✅ Oficializada na ${r.numero}.\n\n${r.material_migrado} lançamento(s) de material passaram da ${r.ref_ficticia} para a ${r.numero} — o custo segue com a O.S. que vai para a medição.`);
  aoMudar();
};
```

`rechavearMaterial()` some do componente: virou parte da transação.

### 3b) vincular o nº oficial que chegou por e-mail

```ts
const vincularNumero = async (os: OSCampo) => {
  const resp = prompt(`Nº OFICIAL da O.S. que chegou por e-mail\n(hoje é a ${refDaOS(os)} — ${os.unidade}):`);
  if (resp == null) return;
  const n = parseInt(resp.replace(/\D/g, ''), 10);
  if (!n) return;

  const opId = novoOpId();                 // um id para as DUAS tentativas
  let r = await rpc('fpv_os_vincular_numero', {
    p_op_id: opId, p_os_id: os.id, p_numero: n, p_confirmar_fusao: false,
  });

  // nº já existe = o fiscal emitiu UMA oficial cobrindo esta(s) emergência(s)
  if (!r.ok && r.erro === 'NUMERO_EXISTE') {
    const a = r.alvo;
    if (!confirm(`O nº ${n} JÁ EXISTE (${a.unidade} · ${a.status}).\n\nVINCULAR a ${refDaOS(os)} a ela? A oficial ${n} herda a memória e as fotos desta emergência, e a ${refDaOS(os)} vira registro "oficializada → ${n}".`)) return;
    r = await rpc('fpv_os_vincular_numero', {
      p_op_id: opId, p_os_id: os.id, p_numero: n, p_confirmar_fusao: true,
    });
  }

  if (!r.ok) { alert('Não deu para vincular: ' + r.erro); return; }
  if (r.material_migrado > 0)
    alert(`✅ Agora é a O.S. ${n}.\n\n${r.material_migrado} lançamento(s) de material passaram para a ${n}.`);
  aoMudar();
};
```

**`par_sugerido` acumulativo:** o caso real `L20+L21→1330` está coberto nos
**dois** caminhos (o de hoje só acumulava no `vincularNumero`). E não duplica:
vincular a mesma fictícia de novo não vira `L20+L20`.

---

## FLUXO 4 — `services/osService.ts`

| função de hoje | vira |
|---|---|
| `salvar(os)` | `fpv_os_salvar_com_kit` com `p_kit: []` |
| `salvarEquipe(os, prefixo)` | a mesma, com `p_prefixo` — o retry de 3 tentativas **sai** (o advisory lock do banco resolve a colisão de 2 celulares) |
| `baixaKit(...)` | some — virou o `p_kit` |
| `proximaF()` / `proximaRefEquipe()` / `proximaFict()` | `fpv_os_proxima_ref(p_prefixo)` — só para **mostrar** na tela; quem numera de verdade é a RPC de salvar, dentro da transação |
| `excluir(id)` | `fpv_os_excluir` (exclusão lógica + só gestão, agora no banco) |
| `numeroExiste(n)` | pode ficar (é só leitura) — mas a validação que **vale** é o `NUMERO_DUPLICADO` da RPC |
| `listar()`, `uploadFoto(s)` | **não mudam** |

```ts
// exemplo do excluir
const r = await rpc('fpv_os_excluir', { p_op_id: novoOpId(), p_os_id: id, p_motivo: null });
if (!r.ok) alert(r.erro === 'SEM_PERMISSAO' ? 'Só a gestão exclui O.S.' : r.erro!);
```

A cadeia de "tira a coluna e re-insere" do `salvar()` (linhas 67-117) pode ser
**apagada** depois que o SQL rodar: o Bloco 0 do `05-rpc-transacionais.sql` cria
todas as colunas que faltavam (`area`, `geo`, `tipo`, `solicitado`, `fict_ref`,
`par_sugerido`, `oficializada_em`).

---

## Ordem de troca sugerida (uma por semana, com medição rodando)

1. **Fluxo 2b (pedido → saídas)** — menor volume, efeito mais visível, e é o
   que hoje mais duplica material.
2. **Fluxo 3 (oficializar/vincular)** — só a gestão usa, dá pra conferir cada
   caso na hora.
3. **Fluxo 2 (balcão do João)** — volume alto; testar 1 dia com o João ao lado.
4. **Fluxo 1 (NovaOS)** — o que mais gente usa; por último.

Em todas: o código antigo pode ficar atrás de um `if` de emergência
(`const USAR_RPC = true;` no `config.ts`) para voltar em 1 minuto se algo
estranho aparecer no meio da medição.

---

## Como PROVAR que funcionou

```sql
-- 1) o caderno de idempotência está registrando?
select operacao, count(*), max(criado_em) from fpv_operacao group by 1 order by 2 desc;

-- 2) apareceu saída órfã NOVA depois da troca? (tem que continuar 0)
select count(*) from saida_material s
 where btrim(coalesce(s.os_ref,'')) <> ''
   and public.fpv_acha_os(s.os_ref) is null
   and s.criado_em > '2026-07-28';

-- 3) alguma O.S. com kit no texto e SEM saída de kit no banco?
--    (o buraco do fluxo 1 — tem que voltar vazio)
select o.id, public.fpv_ref(o.numero, o.fict_ref, o.numero_fict) as ref
  from os_campo o
 where o.materiais ~ '\[KIT\]' and o.criado_em > '2026-07-28'
   and not exists (select 1 from saida_material s
                    where s.origem = 'KIT EMERGENCIAL'
                      and upper(public.fpv_limpa_ref(s.os_ref))
                        = upper(public.fpv_ref(o.numero, o.fict_ref, o.numero_fict)));

-- 4) fictícia cancelada com material ainda apontando pra ela? (tem que ser 0)
select count(*) from os_campo o join saida_material s
    on upper(public.fpv_limpa_ref(s.os_ref)) = upper(coalesce(o.fict_ref,'@'))
 where o.excluida and o.par_sugerido ~ '^\d+$';
```

E o teste de mesa (duplo-toque não duplica) está comentado no fim do
`05-rpc-transacionais.sql` — roda dentro de `begin; … rollback;`, não suja
o banco.
