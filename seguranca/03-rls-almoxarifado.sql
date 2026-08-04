-- =====================================================================
-- FPV CAMPO — SEGURANÇA · ARQUIVO 03 de 04 · RLS DO ALMOXARIFADO
-- estoque_item · entrada_material · saida_material · ferramenta ·
-- solicitacao_material · apelido_material · contrato_financeiro
--
-- Achado da auditoria: com o token do joao@fpv.app o PATCH num item de
-- estoque passou — mas o mesmo vale ao contrário: hoje QUALQUER login de
-- campo pode apagar o estoque inteiro pela REST API. As policies atuais
-- são todas 'using (true)' com uma lista de e-mails copiada e colada.
--
-- Princípio aqui: o ALMOXARIFE MANDA NO MATERIAL. O campo pede, confirma
-- que recebeu e dá baixa do kit emergencial — mais nada.
--
-- ORDEM DE APLICAÇÃO:  01 → 04 → 02 → 03
-- Entra em MODO OBSERVAÇÃO (arquivo 04). Idempotente. ROLLBACK no fim.
-- =====================================================================

do $$
declare faltando text;
begin
  if not exists (select 1 from pg_proc where proname = 'fpv_check') then
    raise exception 'Rode ANTES o 01-papeis.sql e o 04-modo-transicao.sql (nesta ordem). Nada foi alterado.';
  end if;
  -- tudo ou nada: script meio aplicado em almoxarifado é pior que nenhum
  select string_agg(t, ', ') into faltando
  from unnest(array['estoque_item','entrada_material','ferramenta','apelido_material',
                    'saida_material','solicitacao_material','contrato_financeiro']) t
  where to_regclass('public.'||t) is null;
  if faltando is not null then
    raise exception 'Faltam tabelas no banco: %. Rode ALMOX-V2.sql e/ou FINANCEIRO.sql antes. Nada foi alterado.', faltando;
  end if;
end $$;

-- colunas que o app já usa (ALMOX-V2) — garantia, não mexe em dado
alter table saida_material add column if not exists recebido     boolean;
alter table saida_material add column if not exists destinatario text;
alter table saida_material add column if not exists obs          text;

-- ---------------------------------------------------------------------
-- 0) QUEM MANDA NO MATERIAL
--    gestão/diretoria + almoxarife + processo interno (n8n)
-- ---------------------------------------------------------------------
create or replace function app_manda_no_material() returns boolean
language sql stable security definer set search_path = public
as $$ select app_papel() in ('diretoria','gestao','almox','servico') $$;

-- =====================================================================
-- 1) ESTOQUE_ITEM — o cadastro do material (saldo inicial = contagem
--    física do João). Campo LÊ (precisa achar o item na hora de pedir),
--    mas não cria, não edita e não apaga.
-- =====================================================================
alter table estoque_item enable row level security;
drop policy if exists "estoque_select" on estoque_item;
drop policy if exists "estoque_insert" on estoque_item;
drop policy if exists "estoque_update" on estoque_item;
drop policy if exists "estoque_delete" on estoque_item;

create policy "estoque_select" on estoque_item
  for select to authenticated using (true);
create policy "estoque_insert" on estoque_item
  for insert to authenticated
  with check ( fpv_check('estoque_item','insert', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) );
create policy "estoque_update" on estoque_item
  for update to authenticated
  using  ( fpv_check('estoque_item','update', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) )
  with check (true);
create policy "estoque_delete" on estoque_item
  for delete to authenticated
  using  ( fpv_check('estoque_item','delete', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) );

-- =====================================================================
-- 2) ENTRADA_MATERIAL — compra com foto da NF. Só o balcão lança.
-- =====================================================================
alter table entrada_material enable row level security;
drop policy if exists "entrada_select" on entrada_material;
drop policy if exists "entrada_insert" on entrada_material;
drop policy if exists "entrada_update" on entrada_material;
drop policy if exists "entrada_delete" on entrada_material;

create policy "entrada_select" on entrada_material
  for select to authenticated using (true);
create policy "entrada_insert" on entrada_material
  for insert to authenticated
  with check ( fpv_check('entrada_material','insert', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) );
create policy "entrada_update" on entrada_material
  for update to authenticated
  using  ( fpv_check('entrada_material','update', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) )
  with check (true);
create policy "entrada_delete" on entrada_material
  for delete to authenticated
  using  ( fpv_check('entrada_material','delete', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) );

-- =====================================================================
-- 3) FERRAMENTA — rastreio de quem está com o quê. Só o balcão mexe.
-- =====================================================================
alter table ferramenta enable row level security;
drop policy if exists "ferr_select" on ferramenta;
drop policy if exists "ferr_insert" on ferramenta;
drop policy if exists "ferr_update" on ferramenta;
drop policy if exists "ferr_delete" on ferramenta;

create policy "ferr_select" on ferramenta
  for select to authenticated using (true);
create policy "ferr_insert" on ferramenta
  for insert to authenticated
  with check ( fpv_check('ferramenta','insert', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) );
create policy "ferr_update" on ferramenta
  for update to authenticated
  using  ( fpv_check('ferramenta','update', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) )
  with check (true);
create policy "ferr_delete" on ferramenta
  for delete to authenticated
  using  ( fpv_check('ferramenta','delete', (select app_manda_no_material()), 'só almoxarifado/gestão', descricao) );

-- =====================================================================
-- 4) APELIDO_MATERIAL — o autocomplete que o sistema aprende sozinho.
--    Quem digita no balcão é quem ensina. Sem delete para ninguém
--    (já era assim; memória de digitação não se apaga pela API).
-- =====================================================================
alter table apelido_material enable row level security;
drop policy if exists "apelido_select" on apelido_material;
drop policy if exists "apelido_insert" on apelido_material;
drop policy if exists "apelido_update" on apelido_material;

create policy "apelido_select" on apelido_material
  for select to authenticated using (true);
create policy "apelido_insert" on apelido_material
  for insert to authenticated
  with check ( fpv_check('apelido_material','insert', (select app_manda_no_material()), 'só almoxarifado/gestão', digitado) );
create policy "apelido_update" on apelido_material
  for update to authenticated
  using  ( fpv_check('apelido_material','update', (select app_manda_no_material()), 'só almoxarifado/gestão', digitado) )
  with check (true);

-- =====================================================================
-- 5) SAIDA_MATERIAL — o dinheiro do material. É o que cruza com a O.S.
--    na medição, então aqui a régua é fina:
--
--    LER      todos (o campo confere o que foi lançado no nome dele)
--    CRIAR    todos — porque o KIT EMERGENCIAL dá baixa automática pelo
--             celular da equipe (osService.baixaKit, NovaOS.tsx:226).
--             Tirar isso quebraria a emergência. Lançamento é ADITIVO e
--             fica com autor: melhor deixar entrar e auditar do que
--             perder a baixa do material usado às 22h numa escola.
--    ALTERAR  balcão/gestão: livre. Campo: SÓ 'recebido' (o botão RECEBI
--             do painel) e 'os_ref' (re-chaveamento quando a fictícia
--             vira nº oficial — ListaOS.tsx:130). Nada de mudar
--             quantidade ou descrição do que já saiu.
--    APAGAR   só balcão/gestão.
-- =====================================================================
alter table saida_material enable row level security;
drop policy if exists "almox_select"         on saida_material;
drop policy if exists "almox_insert"         on saida_material;
drop policy if exists "almox_update"         on saida_material;
drop policy if exists "almox_delete"         on saida_material;
drop policy if exists "almox_delete_restrito" on saida_material;
drop policy if exists "saida_select" on saida_material;
drop policy if exists "saida_insert" on saida_material;
drop policy if exists "saida_update" on saida_material;
drop policy if exists "saida_delete" on saida_material;

create policy "saida_select" on saida_material
  for select to authenticated using (true);
create policy "saida_insert" on saida_material
  for insert to authenticated with check (true);
create policy "saida_update" on saida_material
  for update to authenticated using (true) with check (true);
create policy "saida_delete" on saida_material
  for delete to authenticated
  using ( fpv_check('saida_material','delete', (select app_manda_no_material()), 'só almoxarifado/gestão apaga saída', os_ref) );

-- gatilho de COLUNA: mesma ideia do 02 — policy não compara antes×depois
create or replace function fpv_guarda_saida_material() returns trigger
language plpgsql security definer set search_path = public
as $$
declare p text; mudou text[] := '{}'; proibidas text[]; permitidas text[]; msg text;
begin
  if current_user in ('postgres','supabase_admin','supabase_auth_admin','service_role') then return new; end if;
  if fpv_email() = '' then return new; end if;
  p := app_papel();
  if app_manda_no_material() then return new; end if;

  -- campo / cadastro / login sem papel
  permitidas := array['recebido','os_ref'];

  if new.data                          is distinct from old.data                          then mudou := mudou || 'data'; end if;
  if btrim(coalesce(new.descricao,'')) is distinct from btrim(coalesce(old.descricao,'')) then mudou := mudou || 'descricao'; end if;
  if new.quantidade                    is distinct from old.quantidade                    then mudou := mudou || 'quantidade'; end if;
  if btrim(coalesce(new.unidade,''))   is distinct from btrim(coalesce(old.unidade,''))   then mudou := mudou || 'unidade'; end if;
  if btrim(coalesce(new.os_ref,''))    is distinct from btrim(coalesce(old.os_ref,''))    then mudou := mudou || 'os_ref'; end if;
  if btrim(coalesce(new.escola,''))    is distinct from btrim(coalesce(old.escola,''))    then mudou := mudou || 'escola'; end if;
  if btrim(coalesce(new.origem,''))    is distinct from btrim(coalesce(old.origem,''))    then mudou := mudou || 'origem'; end if;
  if btrim(coalesce(new.obs,''))       is distinct from btrim(coalesce(old.obs,''))       then mudou := mudou || 'obs'; end if;
  if btrim(coalesce(new.destinatario,'')) is distinct from btrim(coalesce(old.destinatario,'')) then mudou := mudou || 'destinatario'; end if;
  if new.recebido                      is distinct from old.recebido                      then mudou := mudou || 'recebido'; end if;

  if array_length(mudou,1) is null then return new; end if;

  select coalesce(array_agg(c),'{}'::text[]) into proibidas
  from unnest(mudou) c where not (c = any(permitidas));
  if array_length(proibidas,1) is null then return new; end if;

  msg := 'perfil ' || p || ' não altera saída: ' || array_to_string(proibidas, ', ');

  if fpv_modo() <> 'aplicar' then
    perform fpv_registra_bloqueio('saida_material','update', msg, old.os_ref, 'observado');
    return new;
  end if;
  perform fpv_registra_bloqueio('saida_material','update', msg, old.os_ref, 'bloqueado');
  if fpv_erro_visivel() then
    raise exception 'FPV: material que já saiu só o almoxarifado corrige (%).', array_to_string(proibidas, ', ')
      using errcode = '42501', hint = 'perfil ' || p;
  end if;
  return old;
end $$;

drop trigger if exists trg_fpv_guarda_saida on saida_material;
create trigger trg_fpv_guarda_saida
  before update on saida_material
  for each row execute function fpv_guarda_saida_material();

-- =====================================================================
-- 6) SOLICITACAO_MATERIAL — o pedido da equipe ao balcão.
--    Fluxo: PEDIDO (equipe) → SEPARADO (João) → RECEBIDO (equipe).
--    Campo pode criar e mudar status/os_ref; o texto do pedido depois de
--    enviado é do balcão (o João corrige o que veio errado).
-- =====================================================================
alter table solicitacao_material enable row level security;
drop policy if exists "solic_select" on solicitacao_material;
drop policy if exists "solic_insert" on solicitacao_material;
drop policy if exists "solic_update" on solicitacao_material;
drop policy if exists "solic_delete" on solicitacao_material;

create policy "solic_select" on solicitacao_material
  for select to authenticated using (true);
create policy "solic_insert" on solicitacao_material
  for insert to authenticated with check (true);
create policy "solic_update" on solicitacao_material
  for update to authenticated using (true) with check (true);
create policy "solic_delete" on solicitacao_material
  for delete to authenticated
  using ( fpv_check('solicitacao_material','delete', (select app_manda_no_material()), 'só almoxarifado/gestão', os_ref) );

create or replace function fpv_guarda_solicitacao() returns trigger
language plpgsql security definer set search_path = public
as $$
declare p text; mudou text[] := '{}'; proibidas text[]; permitidas text[]; msg text;
begin
  if current_user in ('postgres','supabase_admin','supabase_auth_admin','service_role') then return new; end if;
  if fpv_email() = '' then return new; end if;
  p := app_papel();
  if app_manda_no_material() then return new; end if;

  permitidas := array['status','os_ref'];

  if btrim(coalesce(new.solicitante,'')) is distinct from btrim(coalesce(old.solicitante,'')) then mudou := mudou || 'solicitante'; end if;
  if btrim(coalesce(new.itens,''))       is distinct from btrim(coalesce(old.itens,''))       then mudou := mudou || 'itens'; end if;
  if btrim(coalesce(new.status,''))      is distinct from btrim(coalesce(old.status,''))      then mudou := mudou || 'status'; end if;
  if btrim(coalesce(new.os_ref,''))      is distinct from btrim(coalesce(old.os_ref,''))      then mudou := mudou || 'os_ref'; end if;
  if btrim(coalesce(new.obs,''))         is distinct from btrim(coalesce(old.obs,''))         then mudou := mudou || 'obs'; end if;
  if new.data                            is distinct from old.data                            then mudou := mudou || 'data'; end if;

  if array_length(mudou,1) is null then return new; end if;
  select coalesce(array_agg(c),'{}'::text[]) into proibidas
  from unnest(mudou) c where not (c = any(permitidas));
  if array_length(proibidas,1) is null then return new; end if;

  msg := 'perfil ' || p || ' não altera pedido: ' || array_to_string(proibidas, ', ');
  if fpv_modo() <> 'aplicar' then
    perform fpv_registra_bloqueio('solicitacao_material','update', msg, old.os_ref, 'observado');
    return new;
  end if;
  perform fpv_registra_bloqueio('solicitacao_material','update', msg, old.os_ref, 'bloqueado');
  if fpv_erro_visivel() then
    raise exception 'FPV: o pedido já enviado é corrigido pelo almoxarifado (%).', array_to_string(proibidas, ', ')
      using errcode = '42501', hint = 'perfil ' || p;
  end if;
  return old;
end $$;

drop trigger if exists trg_fpv_guarda_solic on solicitacao_material;
create trigger trg_fpv_guarda_solic
  before update on solicitacao_material
  for each row execute function fpv_guarda_solicitacao();

-- =====================================================================
-- 7) CONTRATO_FINANCEIRO — mesma régua de hoje (Lucas e Rafael), só que
--    lendo da app_usuario em vez de e-mail chumbado na policy. Trocar
--    quem vê o financeiro vira 1 UPDATE, sem SQL de policy.
--    OBS: aqui NÃO usa fpv_check — em SELECT a regra é seca; ninguém
--    "observa" leitura de financeiro, ou vê ou não vê.
-- =====================================================================
alter table contrato_financeiro enable row level security;
drop policy if exists "fin_select" on contrato_financeiro;
drop policy if exists "fin_insert" on contrato_financeiro;
drop policy if exists "fin_update" on contrato_financeiro;
drop policy if exists "fin_delete" on contrato_financeiro;

create policy "fin_select" on contrato_financeiro
  for select to authenticated using ( (select app_pode_financeiro()) );
create policy "fin_insert" on contrato_financeiro
  for insert to authenticated with check ( (select app_pode_financeiro()) );
create policy "fin_update" on contrato_financeiro
  for update to authenticated
  using ( (select app_pode_financeiro()) ) with check ( (select app_pode_financeiro()) );
create policy "fin_delete" on contrato_financeiro
  for delete to authenticated using ( (select app_pode_financeiro()) );

-- =====================================================================
-- 8) CONFERÊNCIA
-- =====================================================================
select
  (select count(*) from pg_policies where tablename='estoque_item')          as pol_estoque,
  (select count(*) from pg_policies where tablename='saida_material')        as pol_saida,
  (select count(*) from pg_policies where tablename='solicitacao_material')  as pol_solicitacao,
  (select count(*) from pg_policies where tablename='contrato_financeiro')   as pol_financeiro,
  (select case when exists (select 1 from pg_trigger where tgname='trg_fpv_guarda_saida')
     then 'OK' else 'FALTOU' end)                                            as gatilho_saida,
  (select case when exists (select 1 from pg_trigger where tgname='trg_fpv_guarda_solic')
     then 'OK' else 'FALTOU' end)                                            as gatilho_solicitacao,
  (select valor from app_seguranca where chave='modo')                       as modo;

-- Nenhuma policy pode ter sobrado com e-mail chumbado (deve vir VAZIO):
-- select tablename, policyname from pg_policies where qual like '%@fpv.app%' or with_check like '%@fpv.app%';

-- =====================================================================
-- ROLLBACK deste arquivo (volta ao ALMOX-V2.sql + AUDITORIA-CORRECOES):
-- =====================================================================
-- No susto, primeiro: select fpv_seguranca_observar();
--
-- drop trigger if exists trg_fpv_guarda_solic on solicitacao_material;
-- drop trigger if exists trg_fpv_guarda_saida on saida_material;
-- drop function if exists fpv_guarda_solicitacao();
-- drop function if exists fpv_guarda_saida_material();
-- drop function if exists app_manda_no_material();
--
-- do $$ declare r record; begin
--   for r in select tablename, policyname from pg_policies
--            where tablename in ('estoque_item','entrada_material','ferramenta',
--                                'apelido_material','saida_material','solicitacao_material',
--                                'contrato_financeiro')
--   loop execute format('drop policy if exists %I on %I', r.policyname, r.tablename); end loop;
-- end $$;
--
-- -- e então rodar de novo, na ordem: ALMOX-V2.sql · almoxarifado.sql ·
-- -- AUDITORIA-CORRECOES-2026-07-07.sql · FINANCEIRO.sql
-- =====================================================================
