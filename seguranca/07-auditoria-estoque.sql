-- =====================================================================
-- FPV CAMPO — 07 · LIVRO-RAZAO DO ALMOXARIFADO  (achado ALTO 8)
-- Projeto: fpv-campo22 (lgdnuyreaknxjswrfbjw)
--
-- O PROBLEMA
--   Hoje SO a os_campo tem escrivao (trg_fpv_log_os -> os_campo_log,
--   3.177 linhas). O almoxarifado NAO tem nenhum. Ou seja: alguem edita
--   a quantidade de uma saida de material de 20 para 2, ou apaga a linha
--   inteira, e nao sobra rastro nenhum. E material que vira medicao —
--   dinheiro do contrato FP.094.
--
-- O QUE ESTE ARQUIVO FAZ
--   Cria UM livro-razao (estoque_log) cobrindo 6 tabelas:
--     saida_material · entrada_material · estoque_item ·
--     ferramenta · solicitacao_material · contrato_financeiro
--   Mesmo padrao do os_campo_log: guarda o ANTES, quem e quando.
--   Melhorias sobre o padrao antigo (justificadas abaixo):
--     + registra tambem o INSERT (no os_campo_log, saida fantasma nao
--       aparece; aqui aparece)
--     + guarda o DEPOIS alem do ANTES (diff completo, sem precisar
--       reconstruir a linha juntando logs)
--     + guarda a LISTA DE CAMPOS alterados (campos text[]) — a gestao le
--       "mexeram em quantidade" sem abrir dois JSON
--     + nao grava log quando o UPDATE nao mudou nada (menos ruido)
--     + o log e imutavel DE VERDADE: trigger recusa UPDATE/DELETE nele
--
-- 100% ADITIVO E REVERSIVEL. Nenhuma tabela existente muda de forma.
-- Nenhum trigger novo pode rejeitar gravacao do Joao ou das equipes —
-- todos sao AFTER e so escrevem no log.
--
-- COMO RODAR: SQL Editor do Supabase, pode colar inteiro. Idempotente.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — A TABELA DO LIVRO-RAZAO
-- =====================================================================

create table if not exists public.estoque_log (
  id           bigint generated always as identity primary key,
  tabela       text        not null,      -- saida_material, ferramenta, ...
  registro_id  bigint,                    -- id da linha afetada
  ref          text,                      -- identificacao humana (O.S., item...)
  acao         text        not null,      -- CRIADA | EDITADA | EXCLUIDA-FISICA
  campos       text[],                    -- colunas que mudaram (so em EDITADA)
  por_email    text,                      -- quem (do JWT) ou 'sistema'
  quando       timestamptz not null default now(),
  antes        jsonb,                     -- a linha inteira ANTES
  depois       jsonb                      -- a linha inteira DEPOIS
);

comment on table public.estoque_log is
  'Livro-razao imutavel do almoxarifado e do financeiro. Escrito SO por trigger '
  '(fpv_log_estoque, SECURITY DEFINER). Ninguem insere, edita ou apaga pela API.';

-- Colunas idempotentes (caso a tabela ja exista de uma execucao anterior)
alter table public.estoque_log add column if not exists campos text[];
alter table public.estoque_log add column if not exists depois jsonb;

create index if not exists idx_estoque_log_tabela    on public.estoque_log(tabela);
create index if not exists idx_estoque_log_registro  on public.estoque_log(tabela, registro_id);
create index if not exists idx_estoque_log_quando    on public.estoque_log(quando desc);
create index if not exists idx_estoque_log_por_email on public.estoque_log(por_email);
create index if not exists idx_estoque_log_acao      on public.estoque_log(acao);
create index if not exists idx_estoque_log_ref       on public.estoque_log(ref);


-- =====================================================================
-- BLOCO 2 — RLS DO LOG
--
-- DECISAO (e diferente do os_campo_log de proposito):
--   os_campo_log  -> qualquer autenticado le (o encarregado precisa ver
--                    o historico da propria O.S.).
--   estoque_log   -> leitura so para GESTAO + o almoxarife Joao.
--                    Movimento de material e custo. Equipe de campo nao
--                    precisa ver quem mexeu no estoque.
--   contrato_financeiro dentro do log -> SO lucas e rafael, espelhando a
--                    "regua fechada" do FINANCEIRO.sql. Se o Renan/Nicolas
--                    lessem o log, leriam os valores dentro do jsonb.
--
-- NENHUMA policy de INSERT/UPDATE/DELETE. Com RLS ligada e sem policy,
-- a operacao e NEGADA para todo mundo via PostgREST. Quem escreve e o
-- trigger, que roda SECURITY DEFINER (dono da funcao) e nao passa por RLS.
-- =====================================================================

alter table public.estoque_log enable row level security;

-- ATENCAO — NAO usar FORCE ROW LEVEL SECURITY aqui.
-- FORCE aplicaria a RLS tambem ao DONO da tabela. O escrivao roda
-- SECURITY DEFINER como o dono (postgres), e como nao existe policy de
-- INSERT, o proprio log passaria a ser rejeitado — e, por causa do
-- tratamento de excecao do BLOCO 3, isso falharia EM SILENCIO: nenhuma
-- linha de log seria gravada e ninguem perceberia. Sem FORCE, o dono
-- ignora as policies (que e o que o trigger precisa) e todo mundo que
-- passa pela API continua limitado as duas policies de SELECT abaixo.
alter table public.estoque_log no force row level security;

drop policy if exists "estoque_log_select"      on public.estoque_log;
drop policy if exists "estoque_log_select_fin"  on public.estoque_log;

-- 2.1 Almoxarifado/estoque: gestao + Joao
create policy "estoque_log_select" on public.estoque_log
  for select to authenticated
  using (
    tabela <> 'contrato_financeiro'
    and auth.jwt() ->> 'email' in (
      'lucas@fpv.app','rafael@fpv.app','nicolas@fpv.app','renan@fpv.app',
      'edmar@fpv.app','joao@fpv.app'
    )
  );

-- 2.2 Financeiro: regua fechada (mesma do FINANCEIRO.sql)
create policy "estoque_log_select_fin" on public.estoque_log
  for select to authenticated
  using (
    tabela = 'contrato_financeiro'
    and auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app')
  );

-- 2.3 Cinto e suspensorio: tira o privilegio na unha tambem.
revoke insert, update, delete, truncate on public.estoque_log from anon, authenticated;
grant  select on public.estoque_log to authenticated;


-- =====================================================================
-- BLOCO 3 — O ESCRIVAO (funcao generica das 6 tabelas)
--
-- SECURITY DEFINER: precisa escrever no log mesmo quando quem disparou
-- (o Joao, uma equipe) nao tem permissao de insert la.
-- set search_path = public: obrigatorio em SECURITY DEFINER, senao um
-- usuario com CREATE em outro schema poderia sequestrar a funcao.
-- =====================================================================

create or replace function public.fpv_log_estoque()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_antes   jsonb;
  v_depois  jsonb;
  v_ref     text;
  v_acao    text;
  v_campos  text[];
  v_id      bigint;
  v_fonte   jsonb;
begin
  -- quem
  begin
    v_email := coalesce(
      nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
      'sistema');
  exception when others then
    v_email := 'sistema';
  end;

  v_antes  := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_depois := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_fonte  := coalesce(v_depois, v_antes);

  -- UPDATE que nao mudou nada nao vira linha de log
  if tg_op = 'UPDATE' and v_antes = v_depois then
    return null;
  end if;

  v_acao := case tg_op
              when 'INSERT' then 'CRIADA'
              when 'UPDATE' then 'EDITADA'
              when 'DELETE' then 'EXCLUIDA-FISICA'
            end;

  v_id := nullif(v_fonte ->> 'id', '')::bigint;

  -- lista das colunas que mudaram (uniao dos dois lados, cobre coluna
  -- que existe so no ANTES ou so no DEPOIS apos um ALTER TABLE)
  if tg_op = 'UPDATE' then
    select array_agg(distinct k order by k) into v_campos
    from (
      select a.key as k from jsonb_each(v_antes) a
       where a.value is distinct from (v_depois -> a.key)
      union
      select b.key from jsonb_each(v_depois) b
       where b.value is distinct from (v_antes -> b.key)
    ) x
    where k <> 'atualizado_em';   -- ruido: muda em toda edicao
  end if;

  -- identificacao humana (o que a gestao le na tela do log)
  v_ref := case tg_table_name
    when 'saida_material' then
      'O.S. ' || coalesce(nullif(v_fonte ->> 'os_ref',''), 'S/N')
      || ' · ' || coalesce(v_fonte ->> 'descricao','?')
      || ' (' || coalesce(v_fonte ->> 'quantidade','?')
      || ' ' || coalesce(v_fonte ->> 'unidade','') || ')'
    when 'entrada_material' then
      'ENTRADA ' || coalesce(v_fonte ->> 'descricao','?')
      || ' (' || coalesce(v_fonte ->> 'quantidade','?')
      || ' ' || coalesce(v_fonte ->> 'unidade','') || ')'
      || ' · ' || coalesce(v_fonte ->> 'origem','')
    when 'estoque_item' then
      'ITEM ' || coalesce(v_fonte ->> 'descricao','?')
    when 'ferramenta' then
      'FERRAMENTA ' || coalesce(v_fonte ->> 'descricao','?')
      || ' [' || coalesce(v_fonte ->> 'status','') || ']'
      || coalesce(' com ' || nullif(v_fonte ->> 'com_quem',''), '')
    when 'solicitacao_material' then
      'PEDIDO ' || coalesce(v_fonte ->> 'solicitante','?')
      || ' · O.S. ' || coalesce(nullif(v_fonte ->> 'os_ref',''), 'S/N')
      || ' [' || coalesce(v_fonte ->> 'status','') || ']'
    when 'contrato_financeiro' then
      coalesce(v_fonte ->> 'contrato','FP.094') || ' · ' || coalesce(v_fonte ->> 'mes','?')
    else coalesce(v_fonte ->> 'descricao', v_id::text, '?')
  end;

  insert into public.estoque_log
    (tabela, registro_id, ref, acao, campos, por_email, antes, depois)
  values
    (tg_table_name, v_id, v_ref, v_acao, v_campos, v_email, v_antes, v_depois);

  return null;   -- AFTER trigger: retorno ignorado
exception when others then
  -- FILOSOFIA: o log NUNCA pode derrubar a operacao do almoxarifado.
  -- Se por qualquer motivo a escrita do log falhar, a gravacao original
  -- segue e fica um aviso no log do Postgres.
  raise warning 'fpv_log_estoque falhou em %.% (%): %',
    tg_table_name, tg_op, coalesce(v_id::text,'?'), sqlerrm;
  return null;
end $$;

comment on function public.fpv_log_estoque() is
  'Escrivao generico do almoxarifado/financeiro. AFTER INSERT/UPDATE/DELETE. '
  'Nunca bloqueia a operacao de origem.';


-- =====================================================================
-- BLOCO 4 — PENDURAR O ESCRIVAO NAS 6 TABELAS
-- AFTER (nao BEFORE): so registra o que realmente entrou no banco.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array['saida_material','entrada_material','estoque_item',
                           'ferramenta','solicitacao_material','contrato_financeiro']
  loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('drop trigger if exists trg_log_estoque on public.%I', t);
      execute format(
        'create trigger trg_log_estoque
           after insert or update or delete on public.%I
           for each row execute function public.fpv_log_estoque()', t);
      raise notice 'escrivao ligado em %', t;
    else
      raise notice 'tabela % nao existe — pulando', t;
    end if;
  end loop;
end $$;


-- =====================================================================
-- BLOCO 5 — IMUTABILIDADE DE VERDADE
--
-- RLS ja impede escrita pela API (PostgREST). Mas quem tiver a
-- service_role key (o n8n, por exemplo) ignora RLS. Este trigger recusa
-- UPDATE/DELETE no log em QUALQUER caminho, inclusive service_role.
-- Se um dia for preciso expurgar historico antigo, desabilite o trigger
-- explicitamente — vira um ato consciente, nao um acidente.
-- =====================================================================

create or replace function public.fpv_log_imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'LIVRO-RAZAO IMUTAVEL: % em %.% nao e permitido. O log so aceita INSERT pelo escrivao.',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists trg_estoque_log_imutavel on public.estoque_log;
create trigger trg_estoque_log_imutavel
  before update or delete on public.estoque_log
  for each row execute function public.fpv_log_imutavel();

-- MESMA protecao para o livro-razao das O.S. (hoje ele NAO tem).
-- Deixo LIGADO: o os_campo_log ja nao tem policy de escrita, entao nada
-- no app depende de editar/apagar log. Se algo quebrar, o rollback do
-- BLOCO 7 tira so este trigger.
drop trigger if exists trg_os_campo_log_imutavel on public.os_campo_log;
create trigger trg_os_campo_log_imutavel
  before update or delete on public.os_campo_log
  for each row execute function public.fpv_log_imutavel();

-- Fecha o os_campo_log tambem no nivel de privilegio:
revoke insert, update, delete, truncate on public.os_campo_log from anon, authenticated;


-- =====================================================================
-- BLOCO 6 — VIEWS DE LEITURA (o que a gestao realmente abre)
-- As views herdam a RLS da estoque_log (security_invoker), entao nao
-- viram porta dos fundos para o financeiro.
-- =====================================================================

-- 6.1 Ultimos movimentos, em linguagem de gente
create or replace view public.vw_estoque_log_recente
with (security_invoker = true) as
select l.id,
       l.quando,
       l.por_email,
       l.tabela,
       l.acao,
       l.ref,
       array_to_string(l.campos, ', ') as campos_alterados,
       l.registro_id
from public.estoque_log l
order by l.quando desc;

-- 6.2 O que mais importa: quantidade de material mexida DEPOIS de lancada
create or replace view public.vw_estoque_log_qtd_alterada
with (security_invoker = true) as
select l.id, l.quando, l.por_email, l.tabela, l.registro_id, l.ref,
       l.antes  ->> 'quantidade' as qtd_antes,
       l.depois ->> 'quantidade' as qtd_depois,
       l.antes  ->> 'os_ref'     as os_antes,
       l.depois ->> 'os_ref'     as os_depois
from public.estoque_log l
where l.acao = 'EDITADA'
  and l.tabela in ('saida_material','entrada_material')
  and ('quantidade' = any(l.campos) or 'os_ref' = any(l.campos))
order by l.quando desc;

comment on view public.vw_estoque_log_qtd_alterada is
  'Toda vez que alguem mudou a QUANTIDADE ou a O.S. de um material JA lancado. '
  'Conferir esta view antes de fechar a medicao.';

-- 6.3 Exclusoes fisicas — o que sumiu do banco e quem mandou sumir
create or replace view public.vw_estoque_log_exclusoes
with (security_invoker = true) as
select l.id, l.quando, l.por_email, l.tabela, l.registro_id, l.ref, l.antes
from public.estoque_log l
where l.acao = 'EXCLUIDA-FISICA'
order by l.quando desc;

-- 6.4 Placar por usuario (30 dias)
create or replace view public.vw_estoque_log_por_usuario
with (security_invoker = true) as
select por_email,
       tabela,
       count(*) filter (where acao = 'CRIADA')          as criou,
       count(*) filter (where acao = 'EDITADA')         as editou,
       count(*) filter (where acao = 'EXCLUIDA-FISICA') as apagou,
       max(quando)                                     as ultima_acao
from public.estoque_log
where quando > now() - interval '30 days'
group by por_email, tabela
order by 3 desc, 4 desc;


-- =====================================================================
-- BLOCO 7 — ROLLBACK COMPLETO
-- =====================================================================
/*
-- 7.1 desliga os escrivaes
do $$
declare t text;
begin
  foreach t in array array['saida_material','entrada_material','estoque_item',
                           'ferramenta','solicitacao_material','contrato_financeiro']
  loop
    execute format('drop trigger if exists trg_log_estoque on public.%I', t);
  end loop;
end $$;

-- 7.2 tira as travas de imutabilidade
drop trigger if exists trg_estoque_log_imutavel   on public.estoque_log;
drop trigger if exists trg_os_campo_log_imutavel  on public.os_campo_log;

-- 7.3 views e funcoes
drop view     if exists public.vw_estoque_log_por_usuario;
drop view     if exists public.vw_estoque_log_exclusoes;
drop view     if exists public.vw_estoque_log_qtd_alterada;
drop view     if exists public.vw_estoque_log_recente;
drop function if exists public.fpv_log_estoque();
drop function if exists public.fpv_log_imutavel();

-- 7.4 A TABELA DE LOG: por padrao NAO apagar (e prova documental).
--     So descomente se realmente quiser jogar o historico fora.
--     Precisa remover a trava do 7.2 antes.
-- drop table if exists public.estoque_log;
*/


-- =====================================================================
-- BLOCO 8 — TESTE DE ACEITE (prova que funciona, sem sujar dado real)
--
-- Rode como service_role no SQL Editor. Cria um item de teste, edita,
-- apaga, confere que gerou 3 linhas de log, e limpa tudo no fim.
-- =====================================================================
/*
do $$
declare v_id bigint; v_n int;
begin
  insert into public.estoque_item (descricao, categoria, unidade, qtd_minima)
  values ('ZZZ TESTE AUDITORIA — APAGAR', 'DIVERSOS', 'UND', 0)
  returning id into v_id;

  update public.estoque_item set qtd_minima = 99 where id = v_id;
  update public.estoque_item set qtd_minima = 99 where id = v_id;  -- nao muda nada
  delete from public.estoque_item where id = v_id;

  select count(*) into v_n from public.estoque_log
   where tabela = 'estoque_item' and registro_id = v_id;

  if v_n <> 3 then
    raise exception 'FALHOU: esperava 3 linhas de log (CRIADA/EDITADA/EXCLUIDA), veio %', v_n;
  end if;

  raise notice 'TESTE OK — 3 linhas de log geradas para o registro %', v_id;
  raise notice 'Confira e depois limpe com: delete from estoque_log where registro_id = % and tabela = ''estoque_item'';', v_id;
end $$;

-- Ver o resultado do teste:
-- select quando, acao, ref, campos, por_email from estoque_log
--  where ref like 'ITEM ZZZ TESTE%' order by id;

-- Limpar o teste (precisa derrubar a trava de imutabilidade por 1 segundo):
-- alter table public.estoque_log disable trigger trg_estoque_log_imutavel;
-- delete from public.estoque_log where ref like 'ITEM ZZZ TESTE%';
-- alter table public.estoque_log enable  trigger trg_estoque_log_imutavel;
*/


-- =====================================================================
-- BLOCO 9 — CONFERENCIA (so leitura). Tudo tem que sair 'OK'.
-- =====================================================================
with c(grupo, item, ok) as (
  select '1 TABELA', 'estoque_log existe',
    exists(select 1 from information_schema.tables
           where table_schema='public' and table_name='estoque_log')
  union all select '1 TABELA', 'colunas antes/depois/campos',
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='estoque_log'
        and column_name in ('antes','depois','campos')) = 3

  union all select '2 RLS', 'RLS ligada na estoque_log',
    (select relrowsecurity from pg_class where oid = 'public.estoque_log'::regclass)
  union all select '2 RLS', 'FORCE RLS DESLIGADA (senao o escrivao nao escreve)',
    not (select relforcerowsecurity from pg_class where oid = 'public.estoque_log'::regclass)
  union all select '2 RLS', 'apenas policies de SELECT (zero de escrita)',
    (select count(*) from pg_policies where tablename='estoque_log' and cmd <> 'SELECT') = 0
  union all select '2 RLS', 'policy do financeiro restrita a lucas+rafael',
    exists(select 1 from pg_policies where tablename='estoque_log'
             and policyname='estoque_log_select_fin'
             and qual like '%lucas@fpv.app%' and qual not like '%nicolas%')

  union all select '3 ESCRIVAO', 'funcao fpv_log_estoque e SECURITY DEFINER',
    exists(select 1 from pg_proc where proname='fpv_log_estoque' and prosecdef)
  union all select '3 ESCRIVAO', 'search_path fixado na funcao',
    exists(select 1 from pg_proc where proname='fpv_log_estoque'
             and array_to_string(proconfig,',') like '%search_path%')
  union all select '3 ESCRIVAO', 'trigger nas 6 tabelas',
    (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where t.tgname='trg_log_estoque'
        and c.relname in ('saida_material','entrada_material','estoque_item',
                          'ferramenta','solicitacao_material','contrato_financeiro')) = 6
  union all select '3 ESCRIVAO', 'cobre INSERT+UPDATE+DELETE',
    -- bits do tgtype: INSERT=4, DELETE=8, UPDATE=16  =>  4+8+16 = 28
    (select bool_and((t.tgtype & 28) = 28) from pg_trigger t where t.tgname='trg_log_estoque')

  union all select '4 IMUTAVEL', 'trava na estoque_log',
    exists(select 1 from pg_trigger where tgname='trg_estoque_log_imutavel')
  union all select '4 IMUTAVEL', 'trava na os_campo_log',
    exists(select 1 from pg_trigger where tgname='trg_os_campo_log_imutavel')

  union all select '5 VIEWS', 'vw_estoque_log_recente',
    exists(select 1 from information_schema.views
           where table_schema='public' and table_name='vw_estoque_log_recente')
  union all select '5 VIEWS', 'vw_estoque_log_qtd_alterada',
    exists(select 1 from information_schema.views
           where table_schema='public' and table_name='vw_estoque_log_qtd_alterada')
  union all select '5 VIEWS', 'vw_estoque_log_exclusoes',
    exists(select 1 from information_schema.views
           where table_schema='public' and table_name='vw_estoque_log_exclusoes')
  union all select '5 VIEWS', 'vw_estoque_log_por_usuario',
    exists(select 1 from information_schema.views
           where table_schema='public' and table_name='vw_estoque_log_por_usuario')
)
select case when ok then 'OK' else '>>> FALTOU' end as res, grupo, item
from c order by ok asc, grupo, item;

-- Cobertura de auditoria por tabela — panorama do achado ALTO 8 resolvido:
select c.relname as tabela,
       case when exists (select 1 from pg_trigger t
                          where t.tgrelid = c.oid and not t.tgisinternal
                            and t.tgname in ('trg_log_estoque','trg_fpv_log_os'))
            then 'AUDITADA' else '>>> SEM AUDITORIA' end as situacao
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('os_campo','saida_material','entrada_material','estoque_item',
                    'ferramenta','solicitacao_material','contrato_financeiro',
                    'apelido_material')
order by 2, 1;

-- =====================================================================
-- NOTA DE VOLUME: estoque_log cresce ~1 linha por movimento. Com o ritmo
-- atual (3.133 saidas em ~5 meses) isso da ~700 linhas/mes. Irrelevante
-- para o plano Supabase. Nao precisa de expurgo nos proximos anos —
-- e se precisar, o expurgo tem que ser ato consciente (BLOCO 5).
--
-- FIM DO 07-auditoria-estoque.sql
-- =====================================================================
