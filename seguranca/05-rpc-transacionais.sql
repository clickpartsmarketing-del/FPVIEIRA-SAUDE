-- =====================================================================
-- ⛔ NÃO APLIQUE ESTE ARQUIVO AINDA — LEIA (correção 28/07)
-- =====================================================================
-- A verificação adversarial pegou o seguinte: todas as RPC daqui são
-- SECURITY DEFINER e recebem "grant execute to authenticated". Dentro de
-- uma função SECURITY DEFINER o usuário vira o DONO da tabela, então a
-- RLS não se aplica E o gatilho de guarda (02) é pulado.
--
-- Resultado prático: com o frontend AINDA NÃO migrado, este arquivo não
-- entrega o benefício (nenhuma tela chama as RPC) mas ABRE UMA PORTA
-- NOVA — qualquer usuário logado poderia chamar fpv_os_salvar_com_kit
-- com um id e alterar uma O.S. que não é dele. É o mesmo furo que a
-- auditoria provou com o token do joao@fpv.app, por outro caminho.
--
-- ORDEM CORRETA:
--   1) aplicar 01 → 04 → 02 → 03 (papéis + RLS) e rodar em observação;
--   2) migrar as telas para chamar as RPC (ver 05-como-chamar-no-frontend.md);
--   3) ANTES de liberar: pôr a checagem de permissão DENTRO de cada RPC
--      (fpv_eh_gestor() or fpv_os_minha(...)) e restringir o SET às
--      colunas do perfil, espelhando os arrays do 02;
--   4) só então dar o grant a authenticated.
-- Enquanto isso: aplique só se quiser as funções criadas SEM grant
-- (revogue de authenticated no fim do arquivo).
-- =====================================================================

-- =====================================================================
-- FPV CAMPO — FRENTE 2: RPC TRANSACIONAIS  (achado CRÍTICO 3)
-- =====================================================================
-- PROBLEMA: hoje as operações que mexem em DINHEIRO/ESTOQUE acontecem
-- em VÁRIAS chamadas soltas do frontend. Se a rede cair no meio (celular
-- na escola, 3G ruim), fica METADE FEITO:
--   • O.S. salva e kit NÃO baixado  → material sumiu do custo da medição
--   • Saída gravada e O.S. emergencial NÃO criada (ou o contrário)
--   • Fictícia CANCELADA e material NÃO re-chaveado → saída órfã
--     (auditoria 24/07 achou 168 dessas — material já consumido que
--      sumiu do custo da O.S. que vai pra medição)
--   • Pedido virou SEPARADO e as saídas não entraram (ou entraram 2x)
--
-- SOLUÇÃO: cada fluxo vira UMA função no banco = UMA transação.
-- Ou tudo grava, ou NADA grava. Sem estado pela metade.
--
-- 3 GARANTIAS DE CADA RPC:
--   1) ATÔMICA  — função plpgsql roda dentro de UMA transação; qualquer
--                 RAISE desfaz tudo que ela já tinha feito.
--   2) IDEMPOTENTE — recebe p_op_id (uuid gerado no celular). Chamou 2x
--                 com o mesmo id (usuário bateu 2x / retry automático /
--                 rede devolveu timeout mas o banco gravou)? A 2ª volta
--                 com o MESMO resultado e NÃO repete o efeito.
--   3) RETORNO ÚNICO — sempre jsonb {ok, id, erro, ...extras}.
--                 NUNCA levanta exceção para erro de negócio (o app lê
--                 o campo 'erro'); exceção só para erro de verdade.
--
-- SEGURANÇA: são SECURITY DEFINER (rodam com poder de dono) — logo a
-- regra de quem-pode-o-quê mora AQUI, não no botão escondido do React.
-- Isso continua valendo quando a FRENTE 1 apertar a RLS.
--
-- APLICAÇÃO: 100% ADITIVO. Não altera nenhuma tabela existente a não
-- ser por 'add column if not exists' de colunas que o app JÁ usa. NÃO
-- derruba a operação: enquanto o frontend não for trocado, estas
-- funções ficam paradas sem efeito nenhum. Idempotente: rodar 2x não
-- quebra. ROLLBACK completo no fim do arquivo.
--
-- ORDEM: rodar DEPOIS do 01..04 da Frente 1 (ou antes — não conflita).
-- =====================================================================


-- =====================================================================
-- BLOCO 0 — PRÉ-REQUISITOS ADITIVOS (colunas que o app já grava e que
-- podem não existir no banco; o osService.ts tem gambiarra de "tira a
-- coluna e re-insere" justamente por causa disso)
-- =====================================================================
alter table os_campo add column if not exists par_sugerido    text;
alter table os_campo add column if not exists oficializada_em timestamptz;
alter table os_campo add column if not exists geo             text;
alter table os_campo add column if not exists area            text;
alter table os_campo add column if not exists tipo            text;
alter table os_campo add column if not exists solicitado      text;
alter table os_campo add column if not exists fict_ref        text;
alter table os_campo add column if not exists excluida        boolean not null default false;

alter table saida_material add column if not exists obs          text;
alter table saida_material add column if not exists destinatario text;
alter table saida_material add column if not exists recebido     boolean;

-- índices que as RPC usam para achar O.S. por referência
create index if not exists idx_os_numero    on os_campo(numero)    where numero is not null;
create index if not exists idx_os_fict_ref  on os_campo(fict_ref)  where fict_ref is not null;
create index if not exists idx_saida_os_ref on saida_material(os_ref);


-- =====================================================================
-- BLOCO 1 — CADERNO DE OPERAÇÕES (a idempotência)
-- Cada chamada carimba aqui o resultado. Chamou de novo com o mesmo
-- p_op_id → devolve o carimbo e não faz nada. Só SUCESSO é carimbado:
-- erro de negócio NÃO entra, então o usuário corrige e re-tenta com o
-- MESMO id sem ficar preso.
-- =====================================================================
create table if not exists fpv_operacao (
  op_id      text primary key,          -- uuid gerado no celular
  operacao   text not null,             -- nome da RPC
  resultado  jsonb not null,            -- o {ok,id,...} devolvido na 1ª vez
  por_email  text,
  criado_em  timestamptz not null default now()
);
create index if not exists idx_fpv_operacao_criado on fpv_operacao(criado_em);

alter table fpv_operacao enable row level security;
drop policy if exists "fpv_operacao_select" on fpv_operacao;
create policy "fpv_operacao_select" on fpv_operacao
  for select to authenticated using (true);
-- SEM policy de insert/update/delete de propósito: pela REST API ninguém
-- escreve nem apaga o caderno. Só as funções SECURITY DEFINER escrevem.


-- =====================================================================
-- BLOCO 2 — HELPERS (pequenos, reusados por todas as RPC)
-- =====================================================================

-- data de HOJE no fuso do celular (Brasília). NUNCA usar now()::date
-- cru: o servidor é UTC e depois das 21h carimbaria a data de AMANHÃ
-- (mesmo bug que o Renan achou no front em 06/07)
create or replace function public.fpv_hoje() returns date
language sql stable as $fn$
  select (now() at time zone 'America/Sao_Paulo')::date;
$fn$;

-- ---------------------------------------------------------------------
-- CORREÇÃO 28/07 (verificação adversarial): AQUI ESTAVAM DUAS BOMBAS.
--
-- 1) fpv_med_vigente(p_d date default null) — o 01-papeis.sql já cria
--    fpv_med_vigente() SEM argumento. "create or replace" NÃO substitui
--    uma pela outra: cria uma SOBRECARGA. A partir daí toda chamada sem
--    argumento vira ambígua (42725) — e a policy os_campo_update chama
--    exatamente assim. Resultado: TODO UPDATE em os_campo falharia para
--    quem não é gestão. As duas fórmulas são idênticas; fica a do 01.
--
-- 2) fpv_email() — a do 01 devolve '' quando não há JWT (é esse '' que
--    marca "processo interno": n8n, service_role, SQL Editor) e aplica
--    lower(). Esta devolvia 'sistema' e sem lower: o n8n perderia a
--    exceção nas policies e e-mail em caixa mista cairia em
--    'desconhecido' (o perfil mais restrito).
--
-- As duas funções agora vêm SÓ do 01-papeis.sql (aplicado antes).
-- ---------------------------------------------------------------------

-- prefixo do login: joao@fpv.app -> joao  (é assim que o App.tsx decide papel)
create or replace function public.fpv_login() returns text
language sql stable as $fn$
  select lower(split_part(public.fpv_email(), '@', 1));
$fn$;

-- QUEM É GESTÃO. Criada só se ainda NÃO existir — se a FRENTE 1 já
-- criou a versão dela (lendo de tabela de papéis), a dela PREVALECE.
-- Ponto único: mudou a gestão, muda só esta função.
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'fpv_eh_gestor' and n.nspname = 'public'
  ) then
    execute $f$
      create function public.fpv_eh_gestor() returns boolean
      language sql stable as $b$
        select public.fpv_login() in
          ('lucas','rafael','nicolas','renan','edmar');
      $b$;
    $f$;
  end if;
end
$do$;

-- REFERÊNCIA ÚNICA DA O.S. — espelho exato do refDaOS() do types.ts:
-- nº oficial > ref da equipe (L01/M01/G01/C01) > F-nn legado > S/Nº
create or replace function public.fpv_ref(p_numero int, p_fict_ref text, p_numero_fict int)
returns text language sql immutable as $fn$
  select coalesce(
    p_numero::text,
    nullif(btrim(coalesce(p_fict_ref, '')), ''),
    case when p_numero_fict is not null then 'F-' || p_numero_fict::text end,
    'S/Nº');
$fn$;

-- normalização de texto sem depender da extensão unaccent (que pode não
-- estar instalada no projeto): minúscula + sem acento. Espelha o norm()
-- do AlmoxOS.tsx, usado para comparar descrição de material.
create or replace function public.fpv_norm(p text) returns text
language sql immutable as $fn$
  select btrim(lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')));
$fn$;

-- limpa "O.S. 1234" / "os 1234" -> "1234"
create or replace function public.fpv_limpa_ref(p text) returns text
language sql immutable as $fn$
  select btrim(regexp_replace(coalesce(p, ''), '^O\.?S\.?\s*', '', 'i'));
$fn$;

-- PRÓXIMA NUMERAÇÃO. Trava de verdade contra 2 celulares no mesmo
-- segundo: pg_advisory_xact_lock segura o prefixo até o COMMIT.
--   L/M = equipes de emergência · G/C = corretiva (Gilson/Carlos)
--   ''  ou 'F' = F-nº global legado, com o PISO ANTI-COLISÃO 87 da
--   conciliação do papel (a contagem manual chegou a F-87 → sai F-88)
create or replace function public.fpv_proxima_ref(p_prefixo text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_pref text := upper(btrim(coalesce(p_prefixo, '')));
  v_max  int  := 0;
  v_f    int  := 0;
begin
  if v_pref not in ('', 'F', 'L', 'M', 'G', 'C') then
    raise exception 'PREFIXO_INVALIDO: %', v_pref;
  end if;

  if v_pref in ('', 'F') then
    perform pg_advisory_xact_lock(hashtext('fpv_num_F')::bigint);
    select coalesce(max(numero_fict), 0) into v_max from os_campo;
    select coalesce(max((substring(fict_ref from '^F-(\d+)$'))::int), 0)
      into v_f from os_campo where fict_ref ~ '^F-\d+$';
    return 'F-' || (greatest(v_max, v_f, 87) + 1)::text;
  end if;

  perform pg_advisory_xact_lock(hashtext('fpv_num_' || v_pref)::bigint);
  select coalesce(max((substring(fict_ref from '^' || v_pref || '(\d+)$'))::int), 0)
    into v_max from os_campo
    where fict_ref ~ ('^' || v_pref || '\d+$');
  -- 2 dígitos como o app (L01…L99) e cresce sozinho no L100
  return v_pref || lpad((v_max + 1)::text, 2, '0');
end
$fn$;

-- ACHA A O.S. PELA REFERÊNCIA DIGITADA NO BALCÃO.
-- Aceita nº oficial, L/M/G/C-nº e F-nn. Se cair numa FICTÍCIA que já foi
-- oficializada (excluida + par_sugerido = nº oficial), REDIRECIONA para
-- a oficial — assim material lançado numa ref velha já nasce no custo
-- certo, em vez de virar mais uma saída órfã.
create or replace function public.fpv_acha_os(p_ref text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_ref text := public.fpv_limpa_ref(p_ref);
  v_id  bigint;
  v_par text;
  v_ofi bigint;
begin
  if v_ref = '' then return null; end if;

  -- 1) O.S. VIVA com essa referência
  select id into v_id from os_campo
   where not coalesce(excluida, false) and coalesce(status, '') <> 'Cancelada'
     and ( (numero is not null and numero::text = v_ref)
        or upper(btrim(coalesce(fict_ref, ''))) = upper(v_ref)
        or (numero_fict is not null and 'F-' || numero_fict::text = upper(v_ref)) )
   order by id desc limit 1;
  if v_id is not null then return v_id; end if;

  -- 2) fictícia já oficializada → devolve a OFICIAL que herdou o serviço
  select par_sugerido into v_par from os_campo
   where upper(btrim(coalesce(fict_ref, ''))) = upper(v_ref)
      or (numero_fict is not null and 'F-' || numero_fict::text = upper(v_ref))
   order by id desc limit 1;
  if v_par is not null and v_par ~ '^\d+$' then
    select id into v_ofi from os_campo
     where numero = v_par::int and not coalesce(excluida, false)
     order by id desc limit 1;
    if v_ofi is not null then return v_ofi; end if;
  end if;

  return null;
end
$fn$;

-- RE-CHAVEAMENTO DO MATERIAL (o coração do achado das 168 saídas órfãs).
-- Quando a ref da O.S. muda (fictícia vira oficial, ou funde numa
-- oficial), TODO o material lançado na ref antiga tem que ir junto —
-- senão o custo já consumido some da O.S. que vai para a medição.
-- INVARIANTE CONFERIDA: soma de linhas antes = soma depois. Se sobrar
-- ou faltar UMA linha, levanta exceção e a transação inteira volta
-- atrás (a fictícia NÃO é cancelada com material perdido pra trás).
create or replace function public.fpv_rechavear_material(p_de text, p_para text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_de   text := public.fpv_limpa_ref(p_de);
  v_para text := public.fpv_limpa_ref(p_para);
  v_antes_de   int; v_antes_para int;
  v_dep_de     int; v_dep_para   int;
  v_saidas int; v_pedidos int;
begin
  if v_de = '' or v_para = '' or upper(v_de) = upper(v_para) then
    return jsonb_build_object('saidas', 0, 'pedidos', 0);
  end if;

  select count(*) into v_antes_de   from saida_material
    where upper(public.fpv_limpa_ref(os_ref)) = upper(v_de);
  select count(*) into v_antes_para from saida_material
    where upper(public.fpv_limpa_ref(os_ref)) = upper(v_para);

  with m as (
    update saida_material set os_ref = v_para
     where upper(public.fpv_limpa_ref(os_ref)) = upper(v_de)
     returning 1)
  select count(*) into v_saidas from m;

  with p as (
    update solicitacao_material set os_ref = v_para
     where upper(public.fpv_limpa_ref(os_ref)) = upper(v_de)
     returning 1)
  select count(*) into v_pedidos from p;

  select count(*) into v_dep_de   from saida_material
    where upper(public.fpv_limpa_ref(os_ref)) = upper(v_de);
  select count(*) into v_dep_para from saida_material
    where upper(public.fpv_limpa_ref(os_ref)) = upper(v_para);

  -- nenhuma linha pode SUMIR no caminho
  if v_dep_de <> 0 or v_dep_para <> (v_antes_de + v_antes_para) then
    raise exception 'MATERIAL_PERDIDO_NA_MIGRACAO de % (%->0) para % (%->%)',
      v_de, v_antes_de, v_para, v_antes_para, v_dep_para;
  end if;

  return jsonb_build_object('saidas', v_saidas, 'pedidos', v_pedidos);
end
$fn$;

-- CARIMBO DA IDEMPOTÊNCIA — usado no começo de cada RPC.
-- O advisory lock no p_op_id faz a 2ª chamada ESPERAR a 1ª commitar e
-- então achar o carimbo (em vez das duas gravarem junto).
create or replace function public.fpv_op_cache(p_op_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_res jsonb;
begin
  if p_op_id is null or btrim(p_op_id) = '' then return null; end if;
  perform pg_advisory_xact_lock(hashtext('fpv_op_' || p_op_id)::bigint);
  select resultado into v_res from fpv_operacao where op_id = p_op_id;
  if v_res is null then return null; end if;
  return v_res || jsonb_build_object('repetida', true);
end
$fn$;

create or replace function public.fpv_op_grava(p_op_id text, p_operacao text, p_res jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  -- só SUCESSO é carimbado: erro de negócio o usuário corrige e re-tenta
  if coalesce((p_res->>'ok')::boolean, false) and p_op_id is not null and btrim(p_op_id) <> '' then
    insert into fpv_operacao(op_id, operacao, resultado, por_email)
    values (p_op_id, p_operacao, p_res, public.fpv_email())
    on conflict (op_id) do nothing;
  end if;
  return p_res;
end
$fn$;


-- =====================================================================
-- BLOCO 3 — FLUXO 1: NovaOS.tsx
--   "salvar O.S." + "baixar kit emergencial no estoque"
-- HOJE: osService.salvarEquipe() → depois osService.baixaKit().
--   Caiu a rede entre as duas: O.S. no banco, kit NÃO baixado. O material
--   da emergência sumiu do estoque E do custo. Pior: o app manda um aviso
--   ("avise o João") que ninguém trata.
-- AGORA: uma transação. Ou a O.S. + as N linhas de saída entram juntas,
--   ou não entra nada.
--
-- p_os      : jsonb com os campos da O.S. (whitelist explícita — o que
--             não está na lista é IGNORADO; cliente não escolhe id,
--             criado_em, excluida nem numero_fict)
-- p_kit     : jsonb array [{descricao, quantidade, unidade}]
-- p_prefixo : 'L','M','G','C' ou '' (vira F-nº)
-- =====================================================================
create or replace function public.fpv_os_salvar_com_kit(
  p_op_id     text,
  p_os        jsonb,
  p_kit       jsonb   default '[]'::jsonb,
  p_prefixo   text    default '',
  p_baixa_kit boolean default true,
  p_permitir_duplicado boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cache   jsonb := public.fpv_op_cache(p_op_id);
  v_id      bigint := nullif(p_os->>'id', '')::bigint;
  v_numero  int    := nullif(p_os->>'numero', '')::int;
  v_ref     text;
  v_conf    record;
  v_atual   record;
  v_mat     text   := coalesce(p_os->>'materiais', '');
  v_txt_kit text;
  v_fotos   text[];
  v_tent    int    := 0;
  v_kit_n   int    := 0;
  v_res     jsonb;
begin
  if v_cache is not null then return v_cache; end if;

  -- ---------- validações de negócio (devolvem erro, não explodem) ----
  if btrim(coalesce(p_os->>'unidade', '')) = '' then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'UNIDADE_OBRIGATORIA');
  end if;

  v_fotos := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_os->'foto_urls', '[]'::jsonb))),
    '{}'::text[]);

  -- =================== CAMINHO EDIÇÃO ===================
  if v_id is not null then
    select * into v_atual from os_campo where id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'id', v_id, 'erro', 'OS_NAO_ENCONTRADA');
    end if;
    -- MEDIÇÃO FECHADA é intocável pelo campo (spec do engenheiro).
    -- Antes isso só existia no if do React → qualquer token editava.
    if btrim(coalesce(v_atual.medicao, '')) <> ''
       and v_atual.medicao <> public.fpv_med_vigente()
       and not public.fpv_eh_gestor() then
      return jsonb_build_object('ok', false, 'id', v_id, 'erro', 'MEDICAO_FECHADA',
                                'medicao', v_atual.medicao);
    end if;
    if coalesce(v_atual.excluida, false) and not public.fpv_eh_gestor() then
      return jsonb_build_object('ok', false, 'id', v_id, 'erro', 'OS_EXCLUIDA');
    end if;

    update os_campo set
      numero          = coalesce(v_numero, numero),
      emergencial     = coalesce((p_os->>'emergencial')::boolean, emergencial),
      tipo            = coalesce(nullif(p_os->>'tipo', ''), tipo),
      unidade         = coalesce(nullif(p_os->>'unidade', ''), unidade),
      fiscal          = coalesce(p_os->>'fiscal', fiscal),
      classificacao   = coalesce(p_os->>'classificacao', classificacao),
      entrada         = coalesce(nullif(p_os->>'entrada', '')::date, entrada),
      conclusao       = case when p_os ? 'conclusao'
                             then nullif(p_os->>'conclusao', '')::date else conclusao end,
      executor        = coalesce(p_os->>'executor', executor),
      status          = coalesce(nullif(p_os->>'status', ''), status),
      -- medição só a gestão redefine (o campo nunca manda medição)
      medicao         = case when public.fpv_eh_gestor() and p_os ? 'medicao'
                             then p_os->>'medicao' else medicao end,
      area            = coalesce(p_os->>'area', area),
      solicitado      = coalesce(p_os->>'solicitado', solicitado),
      servico         = coalesce(p_os->>'servico', servico),
      materiais       = coalesce(p_os->>'materiais', materiais),
      memoria_calculo = coalesce(p_os->>'memoria_calculo', memoria_calculo),
      foto_urls       = case when p_os ? 'foto_urls' then v_fotos else foto_urls end,
      geo             = coalesce(nullif(p_os->>'geo', ''), geo),
      prioridade      = coalesce(nullif(p_os->>'prioridade', '')::int, prioridade)
    where id = v_id;

    select public.fpv_ref(numero, fict_ref, numero_fict) into v_ref
      from os_campo where id = v_id;
    v_res := jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref,
                                'erro', null, 'kit_baixado', 0, 'criada', false);
    return public.fpv_op_grava(p_op_id, 'fpv_os_salvar_com_kit', v_res);
  end if;

  -- =================== CAMINHO CRIAÇÃO ===================
  -- GUARDA ANTI-DUPLICATA (caso real 06/07: digitaram "79" seguindo a
  -- contagem do papel e colidiram com a O.S. 79 oficial de janeiro)
  if v_numero is not null then
    select id, unidade, status into v_conf from os_campo
     where numero = v_numero and not coalesce(excluida, false)
     order by id desc limit 1;
    if found and not (p_permitir_duplicado and public.fpv_eh_gestor()) then
      return jsonb_build_object('ok', false, 'id', null, 'erro', 'NUMERO_DUPLICADO',
        'conflito', jsonb_build_object('id', v_conf.id, 'unidade', v_conf.unidade,
                                       'status', v_conf.status, 'numero', v_numero));
    end if;
  end if;

  -- texto do kit dentro dos materiais da própria O.S. (rastro na O.S.).
  -- só acrescenta se o front ainda não tiver acrescentado — assim dá pra
  -- trocar o componente sem medo de sair "[KIT]" duplicado.
  if jsonb_array_length(coalesce(p_kit, '[]'::jsonb)) > 0 and v_mat !~ '\[KIT\]' then
    select string_agg(
             (k->>'quantidade') || ' ' || coalesce(k->>'unidade', 'UND') || ' ' || (k->>'descricao'),
             ' + ')
      into v_txt_kit
      from jsonb_array_elements(p_kit) k;
    v_mat := btrim(concat_ws(E'\n', nullif(btrim(v_mat), ''), '[KIT] ' || v_txt_kit));
  end if;

  -- numeração: sem nº oficial → ref da equipe (L/M/G/C) ou F-nº.
  -- até 3 tentativas se OUTRO caminho (frontend antigo, n8n) fisgar o
  -- mesmo número no mesmo instante sem passar pelo advisory lock.
  loop
    v_tent := v_tent + 1;
    begin
      insert into os_campo (
        numero, fict_ref, emergencial, tipo, unidade, fiscal, classificacao,
        entrada, conclusao, executor, status, medicao, area, solicitado,
        servico, materiais, memoria_calculo, foto_urls, geo, prioridade
      ) values (
        v_numero,
        case when v_numero is null
             then coalesce(nullif(p_os->>'fict_ref', ''), public.fpv_proxima_ref(p_prefixo))
             else nullif(p_os->>'fict_ref', '') end,
        coalesce((p_os->>'emergencial')::boolean, false),
        nullif(p_os->>'tipo', ''),
        btrim(p_os->>'unidade'),
        nullif(p_os->>'fiscal', ''),
        nullif(p_os->>'classificacao', ''),
        coalesce(nullif(p_os->>'entrada', '')::date, public.fpv_hoje()),
        nullif(p_os->>'conclusao', '')::date,
        coalesce(p_os->>'executor', ''),
        coalesce(nullif(p_os->>'status', ''), 'Executando'),
        -- medição entra automática no fechamento; campo não escolhe
        case when public.fpv_eh_gestor() then coalesce(p_os->>'medicao', '') else '' end,
        nullif(p_os->>'area', ''),
        nullif(p_os->>'solicitado', ''),
        coalesce(p_os->>'servico', ''),
        v_mat,
        coalesce(p_os->>'memoria_calculo', ''),
        v_fotos,
        nullif(p_os->>'geo', ''),
        nullif(p_os->>'prioridade', '')::int
      ) returning id, public.fpv_ref(numero, fict_ref, numero_fict) into v_id, v_ref;
      exit;
    exception when unique_violation then
      -- nº OFICIAL colidindo = índice único da Frente 1 pegou a duplicata:
      -- devolve erro limpo (o app já sabe tratar NUMERO_DUPLICADO)
      if v_numero is not null then
        return jsonb_build_object('ok', false, 'id', null, 'erro', 'NUMERO_DUPLICADO',
          'conflito', jsonb_build_object('numero', v_numero), 'detalhe', sqlerrm);
      end if;
      if v_tent >= 3 then
        return jsonb_build_object('ok', false, 'id', null,
          'erro', 'COLISAO_NUMERACAO', 'detalhe', sqlerrm);
      end if;
      -- empate de numeração entre 2 celulares: o loop recalcula a próxima ref
    end;
  end loop;

  -- ---------- baixa do kit: MESMA transação ----------
  if p_baixa_kit and jsonb_array_length(coalesce(p_kit, '[]'::jsonb)) > 0 then
    insert into saida_material (data, descricao, quantidade, unidade, os_ref, escola, origem, obs)
    select public.fpv_hoje(),
           btrim(k->>'descricao'),
           (k->>'quantidade')::numeric,
           coalesce(nullif(k->>'unidade', ''), 'UND'),
           v_ref,
           btrim(p_os->>'unidade'),
           'KIT EMERGENCIAL',
           'Baixa automática do kit na O.S. ' || v_ref
      from jsonb_array_elements(p_kit) k
     where btrim(coalesce(k->>'descricao', '')) <> ''
       and coalesce((k->>'quantidade')::numeric, 0) > 0;
    get diagnostics v_kit_n = row_count;

    -- item que saiu e não existe no catálogo entra com contagem 0
    -- (mesma regra REV002 do balcão) — some do relatório o "material
    -- fantasma" que ninguém sabe de onde saiu
    insert into estoque_item (descricao, categoria, unidade, qtd_minima, saldo_inicial)
    select distinct on (public.fpv_norm(k->>'descricao'))
           btrim(k->>'descricao'), 'DIVERSOS',
           coalesce(nullif(k->>'unidade', ''), 'UND'), 0, 0
      from jsonb_array_elements(p_kit) k
     where btrim(coalesce(k->>'descricao', '')) <> ''
       and not exists (select 1 from estoque_item e
                        where public.fpv_norm(e.descricao) = public.fpv_norm(k->>'descricao'))
    on conflict (descricao) do nothing;
  end if;

  v_res := jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'erro', null,
                              'kit_baixado', v_kit_n, 'criada', true);
  return public.fpv_op_grava(p_op_id, 'fpv_os_salvar_com_kit', v_res);
end
$fn$;


-- =====================================================================
-- BLOCO 4 — FLUXO 2: AlmoxOS.tsx  (salvarSaida)
--   "gerar O.S. emergencial no balcão" + "registrar a saída de material"
--   + "Pendente vira Executando" + "cadastro automático do item"
-- HOJE: até 5 chamadas soltas. Caiu no meio: O.S. emergencial criada sem
--   saída nenhuma (fantasma na lista do fiscal) ou saída sem O.S. (mais
--   uma das 168 órfãs).
-- AGORA: uma transação só.
--
-- p_saida : {data, descricao, quantidade, unidade, os_ref, escola,
--            origem, obs, destinatario}
-- p_os_extra: {fiscal, executor}  (o front já sabe pelo fiscalDaEscola)
-- p_forcar_sem_vinculo: o usuário confirmou no confirm() que a O.S.
--   digitada não existe e quer salvar assim mesmo (nº fica anotado na obs)
-- =====================================================================
create or replace function public.fpv_almox_saida(
  p_op_id   text,
  p_saida   jsonb,
  p_gerar_os boolean default false,
  p_prefixo text    default '',
  p_os_extra jsonb  default '{}'::jsonb,
  p_forcar_sem_vinculo boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cache   jsonb := public.fpv_op_cache(p_op_id);
  v_ref     text  := public.fpv_limpa_ref(p_saida->>'os_ref');
  v_dest    text  := btrim(coalesce(p_saida->>'destinatario', ''));
  v_desc    text  := btrim(coalesce(p_saida->>'descricao', ''));
  v_qtd     numeric := coalesce((p_saida->>'quantidade')::numeric, 0);
  v_escola  text  := btrim(coalesce(p_saida->>'escola', ''));
  v_obs     text  := btrim(coalesce(p_saida->>'obs', ''));
  v_os_id   bigint;
  v_os      record;
  v_saida_id bigint;
  v_ajuste  text := null;
  v_status  text := null;
  v_cadastrou boolean := false;
  v_novaos  jsonb;
  v_res     jsonb;
begin
  if v_cache is not null then return v_cache; end if;

  -- ---------- validações ----------
  if v_desc = '' then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'MATERIAL_OBRIGATORIO');
  end if;
  if v_qtd <= 0 then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'QUANTIDADE_INVALIDA');
  end if;
  -- REV001 do gestor: TODA saída tem retirante — é ele que confirma no login
  if v_dest = '' then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'DESTINATARIO_OBRIGATORIO');
  end if;

  -- ---------- resolve o vínculo com a O.S. ----------
  if v_ref <> '' then
    v_os_id := public.fpv_acha_os(v_ref);
    if v_os_id is null then
      if not p_forcar_sem_vinculo then
        -- vínculo fantasma não entra: o app pergunta e re-chama com
        -- p_forcar_sem_vinculo := true e o MESMO p_op_id
        return jsonb_build_object('ok', false, 'id', null, 'erro', 'OS_NAO_ENCONTRADA',
                                  'ref_digitada', v_ref);
      end if;
      v_obs := btrim(v_obs || ' [O.S. digitada: ' || v_ref || ' — não encontrada no sistema]');
      v_ref := '';
    end if;
  end if;

  -- ---------- gera a O.S. EMERGENCIAL do balcão ----------
  -- (o João é o controlador dos emergenciais: a equipe passa no balcão
  --  ANTES de registrar a O.S., então a fictícia nasce aqui)
  if p_gerar_os and v_ref = '' then
    if v_escola = '' then
      return jsonb_build_object('ok', false, 'id', null, 'erro', 'ESCOLA_OBRIGATORIA_P_GERAR_OS');
    end if;
    v_novaos := public.fpv_os_salvar_com_kit(
      null,                       -- sem cache próprio: o cache é o desta RPC
      jsonb_build_object(
        'emergencial', true, 'tipo', 'Emergencial',
        'unidade', v_escola,
        'fiscal', coalesce(p_os_extra->>'fiscal', ''),
        'classificacao', 'Emergencial',
        'entrada', public.fpv_hoje()::text,
        'executor', coalesce(p_os_extra->>'executor', ''),
        'status', 'Executando',
        'solicitado', coalesce(nullif(v_obs, ''), 'Emergência atendida no almoxarifado'),
        'servico', '',
        'materiais', v_qtd::text || ' ' || coalesce(p_saida->>'unidade', 'UND') || ' ' || v_desc,
        'memoria_calculo', ''),
      '[]'::jsonb, p_prefixo, false);
    if not coalesce((v_novaos->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'id', null,
               'erro', 'FALHA_AO_GERAR_OS: ' || coalesce(v_novaos->>'erro', '?'));
    end if;
    v_os_id := (v_novaos->>'id')::bigint;
    v_ref   := v_novaos->>'ref';
  end if;

  -- ---------- escola do material = escola DA O.S. ----------
  -- (o formulário repete a escola anterior p/ agilizar o balcão e isso
  --  vinha carimbando material na unidade errada — 48 casos na auditoria)
  if v_os_id is not null then
    select * into v_os from os_campo where id = v_os_id;
    v_ref := public.fpv_ref(v_os.numero, v_os.fict_ref, v_os.numero_fict);
    if btrim(coalesce(v_os.unidade, '')) <> ''
       and public.fpv_norm(v_os.unidade) <> public.fpv_norm(v_escola) then
      v_ajuste := v_os.unidade;
      v_escola := v_os.unidade;
    end if;
  end if;

  -- ---------- a saída ----------
  insert into saida_material (data, descricao, quantidade, unidade, os_ref,
                              escola, origem, obs, destinatario, recebido)
  values (coalesce(nullif(p_saida->>'data', '')::date, public.fpv_hoje()),
          v_desc, v_qtd,
          coalesce(nullif(p_saida->>'unidade', ''), 'UND'),
          nullif(v_ref, ''), v_escola,
          coalesce(nullif(p_saida->>'origem', ''), 'ALMOXARIFADO'),
          nullif(v_obs, ''), v_dest, false)
  returning id into v_saida_id;

  -- ---------- SAIU MATERIAL = ESTÁ EXECUTANDO (regra Renan 10/07) ----
  if v_os_id is not null and v_os.status = 'Pendente' and not coalesce(v_os.excluida, false) then
    update os_campo set status = 'Executando' where id = v_os_id;
    v_status := 'Executando';
  end if;

  -- ---------- item fora do catálogo entra automático (REV002) ----------
  if not exists (select 1 from estoque_item where public.fpv_norm(descricao) = public.fpv_norm(v_desc)) then
    insert into estoque_item (descricao, categoria, unidade, qtd_minima, saldo_inicial)
    values (v_desc, 'DIVERSOS', coalesce(nullif(p_saida->>'unidade', ''), 'UND'), 0, 0)
    on conflict (descricao) do nothing;
    v_cadastrou := true;
  end if;

  -- ---------- vocabulário aprendido (REV002) ----------
  insert into apelido_material (digitado, canonico, usos)
  values (v_desc, v_desc, 1)
  on conflict (digitado) do update
     set usos = apelido_material.usos + 1, atualizado_em = now();

  v_res := jsonb_build_object('ok', true, 'id', v_saida_id, 'erro', null,
    'os_id', v_os_id, 'ref', nullif(v_ref, ''), 'os_gerada', (p_gerar_os and v_novaos is not null),
    'escola_ajustada', v_ajuste, 'status_alterado', v_status, 'item_cadastrado', v_cadastrou,
    'sem_vinculo', (v_ref = ''));
  return public.fpv_op_grava(p_op_id, 'fpv_almox_saida', v_res);
end
$fn$;


-- =====================================================================
-- BLOCO 5 — FLUXO 2b: AlmoxOS.tsx  (gerarSaidasDoPedido)
--   "N saídas do pedido" + "pedido vira SEPARADO"
-- HOJE: insert em lote e DEPOIS update do status. Se o update falhar, o
--   pedido continua aberto e o João gera as saídas DE NOVO (material
--   contado 2x no custo).
-- AGORA: transação + DUAS travas de repetição —
--   a) p_op_id (mesmo toque repetido)
--   b) CHAVE NATURAL: pedido já SEPARADO não gera de novo (protege até
--      de aba aberta em outro celular, com outro op_id)
-- =====================================================================
create or replace function public.fpv_almox_saidas_do_pedido(
  p_op_id    text,
  p_pedido_id bigint,
  p_itens    jsonb,                    -- [{descricao, quantidade, unidade}]
  p_destinatario text default null,
  p_forcar   boolean default false      -- gestão re-gera um pedido já separado
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cache jsonb := public.fpv_op_cache(p_op_id);
  v_ped   record;
  v_ref   text;
  v_escola text := '';
  v_os_id bigint;
  v_dest  text;
  v_n     int := 0;
  v_res   jsonb;
begin
  if v_cache is not null then return v_cache; end if;

  select * into v_ped from solicitacao_material where id = p_pedido_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'PEDIDO_NAO_ENCONTRADO');
  end if;

  -- chave natural da idempotência: pedido já atendido não gera de novo
  if v_ped.status <> 'PEDIDO' and not p_forcar then
    return jsonb_build_object('ok', false, 'id', p_pedido_id, 'erro', 'PEDIDO_JA_ATENDIDO',
                              'status', v_ped.status);
  end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', false, 'id', p_pedido_id, 'erro', 'PEDIDO_SEM_ITENS');
  end if;

  v_ref  := public.fpv_limpa_ref(v_ped.os_ref);
  v_os_id := public.fpv_acha_os(v_ref);
  if v_os_id is not null then
    select unidade, public.fpv_ref(numero, fict_ref, numero_fict)
      into v_escola, v_ref from os_campo where id = v_os_id;
  else
    v_ref := '';  -- ref que não resolve NÃO vira vínculo fantasma
  end if;

  -- destinatário: "emergencia1 · Leandro" → "Leandro"
  v_dest := coalesce(nullif(btrim(coalesce(p_destinatario, '')), ''),
             case when v_ped.solicitante like '%·%'
                  then btrim(split_part(v_ped.solicitante, '·', 2))
                  else v_ped.solicitante end);

  insert into saida_material (data, descricao, quantidade, unidade, os_ref,
                              escola, origem, obs, destinatario, recebido)
  select public.fpv_hoje(),
         btrim(i->>'descricao'),
         coalesce((i->>'quantidade')::numeric, 1),
         coalesce(nullif(i->>'unidade', ''), 'UND'),
         nullif(v_ref, ''), v_escola, 'ALMOXARIFADO',
         'Pedido #' || p_pedido_id || ' · ' || v_ped.solicitante,
         v_dest,
         null                    -- o RECEBI da equipe é feito no próprio pedido
    from jsonb_array_elements(p_itens) i
   where btrim(coalesce(i->>'descricao', '')) <> '';
  get diagnostics v_n = row_count;

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'id', p_pedido_id, 'erro', 'PEDIDO_SEM_ITENS_VALIDOS');
  end if;

  update solicitacao_material set status = 'SEPARADO' where id = p_pedido_id;

  -- catálogo automático dos itens novos (mesma regra do balcão)
  insert into estoque_item (descricao, categoria, unidade, qtd_minima, saldo_inicial)
  select distinct on (public.fpv_norm(i->>'descricao'))
         btrim(i->>'descricao'), 'DIVERSOS',
         coalesce(nullif(i->>'unidade', ''), 'UND'), 0, 0
    from jsonb_array_elements(p_itens) i
   where btrim(coalesce(i->>'descricao', '')) <> ''
     and not exists (select 1 from estoque_item e
                      where public.fpv_norm(e.descricao) = public.fpv_norm(i->>'descricao'))
  on conflict (descricao) do nothing;

  v_res := jsonb_build_object('ok', true, 'id', p_pedido_id, 'erro', null,
                              'saidas', v_n, 'ref', nullif(v_ref, ''), 'escola', v_escola);
  return public.fpv_op_grava(p_op_id, 'fpv_almox_saidas_do_pedido', v_res);
end
$fn$;


-- =====================================================================
-- BLOCO 6 — FLUXO 3: ListaOS.tsx  (oficializar / vincularNumero / rechavear)
-- É O FLUXO MAIS PERIGOSO DO SISTEMA: mexe em DUAS O.S. e no MATERIAL.
-- HOJE são 3-4 chamadas soltas SEM checar retorno (nenhum `await` olha
--   o error). Caiu no meio depois do 2º update: a fictícia está
--   CANCELADA e o material continua apontando pra ref dela, que sumiu
--   da lista → custo perdido na medição.
-- AGORA: uma transação, com a invariante do material conferida no fim.
--
-- Interna: fusão de uma FICTÍCIA dentro de uma OFICIAL.
--   p_modo 'MATCH'   = confirmação do par sugerido (botão do matchmaking)
--   p_modo 'VINCULO' = nº oficial digitado que JÁ EXISTE (caso L20+L21→1330)
-- =====================================================================
create or replace function public.fpv_os_fundir(
  p_fict_id    bigint,
  p_oficial_id bigint,
  p_modo       text default 'MATCH'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_f record; v_o record;
  v_ref_f text; v_ref_o text;
  v_marca text; v_mem text; v_par text;
  v_status text; v_concl date;
  v_mig jsonb;
begin
  if p_fict_id is null or p_oficial_id is null or p_fict_id = p_oficial_id then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'IDS_INVALIDOS');
  end if;

  -- trava as duas linhas na ordem do id (evita deadlock com outra fusão)
  perform 1 from os_campo where id in (p_fict_id, p_oficial_id) order by id for update;

  select * into v_f from os_campo where id = p_fict_id;
  if not found then return jsonb_build_object('ok', false, 'id', null, 'erro', 'FICTICIA_NAO_ENCONTRADA'); end if;
  select * into v_o from os_campo where id = p_oficial_id;
  if not found then return jsonb_build_object('ok', false, 'id', null, 'erro', 'OFICIAL_NAO_ENCONTRADA'); end if;

  if v_o.numero is null then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'ALVO_SEM_NUMERO_OFICIAL');
  end if;
  if coalesce(v_o.excluida, false) then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'OFICIAL_EXCLUIDA');
  end if;
  -- IDEMPOTÊNCIA POR CHAVE NATURAL: fictícia já oficializada não funde 2x
  if coalesce(v_f.excluida, false) then
    return jsonb_build_object('ok', true, 'id', v_o.id, 'erro', null,
      'ref_ficticia', public.fpv_ref(v_f.numero, v_f.fict_ref, v_f.numero_fict),
      'numero', v_o.numero, 'material_migrado', 0, 'ja_estava', true);
  end if;

  v_ref_f := public.fpv_ref(v_f.numero, v_f.fict_ref, v_f.numero_fict);
  v_ref_o := v_o.numero::text;

  -- par_sugerido ACUMULATIVO ('L20+L21'): uma oficial pode cobrir
  -- VÁRIAS emergências. Sem duplicar a mesma ref se repetir a operação.
  v_par := btrim(coalesce(v_o.par_sugerido, ''));
  if v_par = '' then
    v_par := v_ref_f;
  elsif not (('+' || v_par || '+') like ('%+' || v_ref_f || '+%')) then
    v_par := v_par || '+' || v_ref_f;
  end if;

  -- status/conclusão: oficial Pendente herda o andamento real do campo
  v_status := v_o.status; v_concl := v_o.conclusao;
  if v_o.status = 'Pendente' and coalesce(v_f.status, '') not in ('', 'Pendente') then
    v_status := v_f.status;
    v_concl  := coalesce(v_f.conclusao, v_o.conclusao);
  end if;

  if p_modo = 'VINCULO' then
    -- o texto que a gestão lê depois na medição: de onde veio o serviço
    v_marca := 'Executado via emergência ' || v_ref_f
             || case when btrim(coalesce(v_f.executor, '')) <> '' then ' (' || v_f.executor || ')' else '' end
             || case when v_f.conclusao is not null then ' em ' || v_f.conclusao::text else '' end;
    v_mem := btrim(coalesce(v_o.memoria_calculo, ''));
    v_mem := case when v_mem <> '' then v_mem || E'\n' else '' end
           || v_marca
           || case when btrim(coalesce(v_f.memoria_calculo, '')) <> ''
                   then ' — ' || btrim(v_f.memoria_calculo) else '' end;

    update os_campo set
      memoria_calculo = v_mem,
      foto_urls       = (select coalesce(array_agg(distinct u), '{}')
                           from unnest(coalesce(v_o.foto_urls, '{}') || coalesce(v_f.foto_urls, '{}')) u),
      materiais       = case when btrim(coalesce(v_f.materiais, '')) <> ''
                             then btrim(concat_ws(E'\n', nullif(btrim(coalesce(v_o.materiais, '')), ''),
                                                        btrim(v_f.materiais)))
                             else v_o.materiais end,
      executor        = case when btrim(coalesce(v_o.executor, '')) = ''
                             then coalesce(v_f.executor, v_o.executor) else v_o.executor end,
      par_sugerido    = v_par,
      oficializada_em = now(),
      status          = v_status,
      conclusao       = v_concl
    where id = v_o.id;
  else  -- MATCH (par sugerido pelo matchmaking)
    update os_campo set
      foto_urls       = (select coalesce(array_agg(distinct u), '{}')
                           from unnest(coalesce(v_o.foto_urls, '{}') || coalesce(v_f.foto_urls, '{}')) u),
      servico         = coalesce(nullif(btrim(coalesce(v_o.servico, '')), ''), v_f.servico),
      memoria_calculo = coalesce(nullif(btrim(coalesce(v_o.memoria_calculo, '')), ''), v_f.memoria_calculo),
      materiais       = btrim(concat_ws(E'\n', nullif(btrim(coalesce(v_o.materiais, '')), ''),
                                               nullif(btrim(coalesce(v_f.materiais, '')), ''))),
      executor        = coalesce(nullif(btrim(coalesce(v_o.executor, '')), ''), v_f.executor),
      prioridade      = coalesce(v_o.prioridade, v_f.prioridade),
      par_sugerido    = v_par,
      oficializada_em = now(),
      status          = v_status,
      conclusao       = v_concl
    where id = v_o.id;
  end if;

  -- a fictícia vira MARCA de oficializada: EXCLUSÃO LÓGICA, nunca delete.
  -- O número dela segue OCUPADO na contagem e o trigger os_campo_log
  -- registra quem/quando/o que era antes.
  update os_campo
     set excluida = true, status = 'Cancelada', par_sugerido = v_ref_o
   where id = v_f.id;

  -- MATERIAL VAI JUNTO (a razão de tudo isso existir)
  v_mig := public.fpv_rechavear_material(v_ref_f, v_ref_o);

  return jsonb_build_object('ok', true, 'id', v_o.id, 'erro', null,
    'ref_ficticia', v_ref_f, 'numero', v_o.numero,
    'material_migrado', (v_mig->>'saidas')::int,
    'pedidos_migrados', (v_mig->>'pedidos')::int,
    'par_sugerido', v_par, 'ja_estava', false);
end
$fn$;

-- ---------------------------------------------------------------------
-- 3a) CONFIRMAR O PAR SUGERIDO (botão do matchmaking na ListaOS)
-- ---------------------------------------------------------------------
create or replace function public.fpv_os_oficializar(
  p_op_id      text,
  p_fict_id    bigint,
  p_oficial_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cache jsonb := public.fpv_op_cache(p_op_id);
  v_res   jsonb;
begin
  if v_cache is not null then return v_cache; end if;
  -- fundir duas O.S. mexe no dinheiro da medição: só gestão
  if not public.fpv_eh_gestor() then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'SEM_PERMISSAO');
  end if;
  v_res := public.fpv_os_fundir(p_fict_id, p_oficial_id, 'MATCH');
  return public.fpv_op_grava(p_op_id, 'fpv_os_oficializar', v_res);
end
$fn$;

-- ---------------------------------------------------------------------
-- 3b) VINCULAR O Nº OFICIAL que chegou por e-mail do fiscal.
--   • nº LIVRE   → a fictícia GANHA o número e o material lançado no
--                  L20/F-12 é re-chaveado pro nº (senão nenhuma consulta
--                  do almoxarifado resolve mais aquela ref)
--   • nº EXISTE  → FUSÃO (regra Renan 22/07: uma oficial cobrindo várias
--                  emergências → par_sugerido acumulativo 'L20+L21')
--                  exige p_confirmar_fusao (o app pergunta antes)
-- ---------------------------------------------------------------------
create or replace function public.fpv_os_vincular_numero(
  p_op_id  text,
  p_os_id  bigint,
  p_numero int,
  p_confirmar_fusao boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cache jsonb := public.fpv_op_cache(p_op_id);
  v_os    record;
  v_alvo  record;
  v_ref_antes text;
  v_mig   jsonb;
  v_res   jsonb;
begin
  if v_cache is not null then return v_cache; end if;
  if p_numero is null or p_numero <= 0 then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'NUMERO_INVALIDO');
  end if;

  select * into v_os from os_campo where id = p_os_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'OS_NAO_ENCONTRADA');
  end if;
  if coalesce(v_os.excluida, false) then
    return jsonb_build_object('ok', false, 'id', p_os_id, 'erro', 'OS_EXCLUIDA');
  end if;
  if v_os.numero = p_numero then   -- já é esse número: nada a fazer
    return jsonb_build_object('ok', true, 'id', p_os_id, 'erro', null,
                              'numero', p_numero, 'material_migrado', 0, 'ja_estava', true);
  end if;

  select * into v_alvo from os_campo
   where numero = p_numero and not coalesce(excluida, false) and id <> p_os_id
   order by id desc limit 1;

  -- ---------- nº JÁ EXISTE → fusão ----------
  if found then
    if not p_confirmar_fusao then
      return jsonb_build_object('ok', false, 'id', null, 'erro', 'NUMERO_EXISTE',
        'alvo', jsonb_build_object('id', v_alvo.id, 'unidade', v_alvo.unidade,
                                   'status', v_alvo.status, 'numero', p_numero));
    end if;
    v_res := public.fpv_os_fundir(p_os_id, v_alvo.id, 'VINCULO');
    return public.fpv_op_grava(p_op_id, 'fpv_os_vincular_numero', v_res);
  end if;

  -- ---------- nº LIVRE → a fictícia ganha o número ----------
  v_ref_antes := public.fpv_ref(v_os.numero, v_os.fict_ref, v_os.numero_fict);
  update os_campo
     set numero = p_numero,
         oficializada_em = coalesce(oficializada_em, now())
   where id = p_os_id;
  -- fict_ref é PRESERVADO de propósito: o cruzamento de material feito
  -- no L20/F-12 continua rastreável no razão.
  v_mig := public.fpv_rechavear_material(v_ref_antes, p_numero::text);

  v_res := jsonb_build_object('ok', true, 'id', p_os_id, 'erro', null,
    'numero', p_numero, 'ref_antes', v_ref_antes,
    'material_migrado', (v_mig->>'saidas')::int,
    'pedidos_migrados', (v_mig->>'pedidos')::int, 'ja_estava', false);
  return public.fpv_op_grava(p_op_id, 'fpv_os_vincular_numero', v_res);
end
$fn$;


-- =====================================================================
-- BLOCO 7 — FLUXO 4: services/osService.ts (salvar / numeração / excluir)
-- O salvar já está coberto pelo fpv_os_salvar_com_kit (kit vazio).
-- Faltam a numeração consultada de fora e a EXCLUSÃO LÓGICA.
-- =====================================================================

-- o app pergunta a próxima ref antes de abrir o formulário (só leitura)
create or replace function public.fpv_os_proxima_ref(p_prefixo text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return jsonb_build_object('ok', true, 'id', null, 'erro', null,
                            'ref', public.fpv_proxima_ref(p_prefixo));
exception when others then
  return jsonb_build_object('ok', false, 'id', null, 'erro', sqlerrm);
end
$fn$;

-- EXCLUSÃO = MARCA, nunca apaga (regra Renan 06/07). O número segue
-- ocupado na contagem e o trigger grava quem/quando/o que era.
-- Sai material vinculado junto? NÃO — o material continua no razão, só
-- é DEVOLVIDO explicitamente pelo botão do João.
create or replace function public.fpv_os_excluir(
  p_op_id text,
  p_os_id bigint,
  p_motivo text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cache jsonb := public.fpv_op_cache(p_op_id);
  v_os record; v_mat int; v_res jsonb;
begin
  if v_cache is not null then return v_cache; end if;
  if not public.fpv_eh_gestor() then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'SEM_PERMISSAO');
  end if;
  select * into v_os from os_campo where id = p_os_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'id', null, 'erro', 'OS_NAO_ENCONTRADA');
  end if;
  if coalesce(v_os.excluida, false) then
    return jsonb_build_object('ok', true, 'id', p_os_id, 'erro', null, 'ja_estava', true);
  end if;

  select count(*) into v_mat from saida_material
   where upper(public.fpv_limpa_ref(os_ref))
       = upper(public.fpv_ref(v_os.numero, v_os.fict_ref, v_os.numero_fict));

  update os_campo
     set excluida = true, status = 'Cancelada',
         solicitado = case when p_motivo is null then solicitado
                           else btrim(concat_ws(' ', solicitado, '[EXCLUÍDA: ' || p_motivo || ']')) end
   where id = p_os_id;

  v_res := jsonb_build_object('ok', true, 'id', p_os_id, 'erro', null,
    'ref', public.fpv_ref(v_os.numero, v_os.fict_ref, v_os.numero_fict),
    'material_vinculado', v_mat, 'ja_estava', false);
  return public.fpv_op_grava(p_op_id, 'fpv_os_excluir', v_res);
end
$fn$;


-- =====================================================================
-- BLOCO 8 — PERMISSÕES DE EXECUÇÃO
-- Ninguém anônimo executa. As funções internas (fundir/rechavear/op_*)
-- NÃO são expostas: só as RPC públicas.
-- =====================================================================
do $do$
declare f text;
begin
  -- internas: tira do PUBLIC e não dá pra ninguém (só o SECURITY DEFINER chama)
  foreach f in array array[
    'public.fpv_os_fundir(bigint,bigint,text)',
    'public.fpv_rechavear_material(text,text)',
    'public.fpv_op_cache(text)',
    'public.fpv_op_grava(text,text,jsonb)',
    'public.fpv_proxima_ref(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  -- públicas: só usuário LOGADO
  foreach f in array array[
    'public.fpv_os_salvar_com_kit(text,jsonb,jsonb,text,boolean,boolean)',
    'public.fpv_almox_saida(text,jsonb,boolean,text,jsonb,boolean)',
    'public.fpv_almox_saidas_do_pedido(text,bigint,jsonb,text,boolean)',
    'public.fpv_os_oficializar(text,bigint,bigint)',
    'public.fpv_os_vincular_numero(text,bigint,int,boolean)',
    'public.fpv_os_excluir(text,bigint,text)',
    'public.fpv_os_proxima_ref(text)',
    'public.fpv_acha_os(text)',
    'public.fpv_ref(int,text,int)',
    'public.fpv_hoje()',
    'public.fpv_norm(text)',
    'public.fpv_limpa_ref(text)',
    'public.fpv_login()',
    -- fpv_med_vigente() e fpv_email() são do 01-papeis.sql (o grant
    -- delas é feito lá) — não repetir aqui, senão volta a sobrecarga
    'public.fpv_eh_gestor()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$do$;


-- =====================================================================
-- BLOCO 9 — CONFERÊNCIA (deve sair 1 linha, tudo OK)
-- =====================================================================
select
  (select case when count(*) = 7 then 'OK ('||count(*)||')' else 'FALTOU ('||count(*)||'/7)' end
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('fpv_os_salvar_com_kit','fpv_almox_saida','fpv_almox_saidas_do_pedido',
       'fpv_os_oficializar','fpv_os_vincular_numero','fpv_os_excluir','fpv_os_proxima_ref')
  ) as rpc_criadas,
  (select case when exists (select 1 from information_schema.tables
     where table_name = 'fpv_operacao') then 'OK' else 'FALTOU' end) as caderno_idempotencia,
  public.fpv_hoje()::text        as hoje_brasilia,
  public.fpv_med_vigente()       as medicao_vigente,
  public.fpv_proxima_ref('L')    as proxima_L,
  public.fpv_proxima_ref('')     as proxima_F;


-- =====================================================================
-- TESTE DE MESA (rodar UMA VEZ, no SQL Editor, e conferir o resultado).
-- Cria uma O.S. de teste numa "ESCOLA TESTE RPC", confere a atomicidade
-- e DESFAZ tudo com rollback — NÃO suja o banco de produção.
-- =====================================================================
-- begin;
--   -- 1) O.S. + kit numa transação só
--   select public.fpv_os_salvar_com_kit(
--     'teste-001',
--     '{"unidade":"ESCOLA TESTE RPC","emergencial":true,"tipo":"Emergencial",
--       "fiscal":"Wellington","executor":"Leandro","status":"Executando",
--       "servico":"teste","materiais":"","memoria_calculo":"","foto_urls":[]}'::jsonb,
--     '[{"descricao":"FITA TEFLON","quantidade":2,"unidade":"UND"}]'::jsonb,
--     'L');
--   -- 2) MESMA chamada de novo: tem que voltar "repetida": true e NÃO
--   --    criar segunda O.S. nem segunda baixa de kit
--   select public.fpv_os_salvar_com_kit(
--     'teste-001',
--     '{"unidade":"ESCOLA TESTE RPC"}'::jsonb, '[]'::jsonb, 'L');
--   -- 3) conferir: 1 O.S. e 1 saída
--   select (select count(*) from os_campo where unidade='ESCOLA TESTE RPC') as os,
--          (select count(*) from saida_material where escola='ESCOLA TESTE RPC') as saidas;
-- rollback;   -- <<< NÃO ESQUEÇA: desfaz o teste inteiro


-- =====================================================================
-- ROLLBACK COMPLETO (colar no SQL Editor se precisar voltar atrás)
-- Seguro: enquanto o frontend não chamar as RPC, dropar não afeta nada.
-- NÃO apaga nenhum dado de produção — só as funções e o caderno.
-- =====================================================================
-- drop function if exists public.fpv_os_salvar_com_kit(text,jsonb,jsonb,text,boolean,boolean);
-- drop function if exists public.fpv_almox_saida(text,jsonb,boolean,text,jsonb,boolean);
-- drop function if exists public.fpv_almox_saidas_do_pedido(text,bigint,jsonb,text,boolean);
-- drop function if exists public.fpv_os_oficializar(text,bigint,bigint);
-- drop function if exists public.fpv_os_vincular_numero(text,bigint,int,boolean);
-- drop function if exists public.fpv_os_excluir(text,bigint,text);
-- drop function if exists public.fpv_os_proxima_ref(text);
-- drop function if exists public.fpv_os_fundir(bigint,bigint,text);
-- drop function if exists public.fpv_rechavear_material(text,text);
-- drop function if exists public.fpv_acha_os(text);
-- drop function if exists public.fpv_op_cache(text);
-- drop function if exists public.fpv_op_grava(text,text,jsonb);
-- drop function if exists public.fpv_proxima_ref(text);
-- drop function if exists public.fpv_ref(int,text,int);
-- drop function if exists public.fpv_norm(text);
-- drop function if exists public.fpv_limpa_ref(text);
-- drop function if exists public.fpv_hoje();
-- drop function if exists public.fpv_login();
-- -- fpv_med_vigente() e fpv_email() pertencem ao 01-papeis.sql:
-- -- NÃO dropar aqui (o 02/03 dependem delas)
-- -- fpv_eh_gestor: só dropar se a FRENTE 1 não estiver usando
-- -- drop function if exists public.fpv_eh_gestor();
-- drop table if exists public.fpv_operacao;
-- -- as colunas do BLOCO 0 NÃO devem ser dropadas: o app já as usa.
-- =====================================================================
-- MANUTENÇÃO: o caderno de operações cresce ~1 linha por gravação.
-- Limpeza trimestral (não é urgente, são linhas minúsculas):
--   delete from fpv_operacao where criado_em < now() - interval '90 days';
-- =====================================================================
