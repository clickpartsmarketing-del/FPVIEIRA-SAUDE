-- =====================================================================
-- 0001 · ESQUEMA-BASE REPRODUZIVEL  (baseline) — EDICAO SAUDE 094
--
-- Adaptado do baseline da Educacao (estado de producao 28/07/2026) para
-- a implantacao do contrato SAUDE 094 (005/2026) em ago/2026. Mudancas:
-- seq_fict comeca em 1 (contrato novo, sem cicatriz de papel), policies
-- de DELETE com lorran@fpv.app no lugar de joao@fpv.app, contrato
-- financeiro padrao 'Saude 094'.
--
-- Este arquivo sozinho, num banco Supabase VAZIO, reconstroi o FPV Campo
-- — 9 tabelas, os gatilhos, a RLS e o realtime. E o substituto dos .sql
-- soltos legados (ver seguranca/08-migrations-PLANO.md).
--
-- CONTEUDO CONSOLIDADO DE:
--   supabase.sql · almoxarifado.sql · RODAR-NO-SQL-EDITOR.sql ·
--   ALMOX-V2.sql · AUDITORIA-EDICOES.sql · AUDITORIA-RLS-FIX.sql ·
--   PENDENTES-CONSOLIDADO.sql · AUDITORIA-CORRECOES-2026-07-07.sql ·
--   TIPO-ATIVIDADE.sql · REALTIME-E-TIPO.sql · FINANCEIRO.sql
-- + as 3 colunas que existem em producao e NAO estavam em .sql nenhum
--   (oficializada_em, par_sugerido, geo — criadas a mao no painel).
--
-- NAO CONTEM (sao migrations proprias, aplicadas por cima):
--   0002 = seguranca/01..05 (RLS por papel, bucket privado)
--   0003 = seguranca/06-integridade.sql
--   0004 = seguranca/07-auditoria-estoque.sql
--   0005 = seguranca/09-fotos-privadas.sql
--
-- ORDEM: tipos -> sequencias -> tabelas -> funcoes -> gatilhos ->
--        indices -> RLS -> realtime. Nada referencia o que vem depois.
--
-- IDEMPOTENTE: rodar 2x nao quebra e nao regride seguranca (todo
-- create policy vem precedido de drop policy if exists — foi exatamente
-- a falta disso que criou a armadilha descrita no PLANO).
--
-- SEGURANCA IMPORTANTE: as policies aqui sao as ORIGINAIS ("todo
-- autenticado escreve"). Elas sao amplas de proposito — reproduzem o
-- estado historico. A 0002 aperta. Nunca rode este arquivo sozinho num
-- ambiente que ja tenha a 0002 aplicada sem rodar a 0002 logo em seguida.
-- =====================================================================

-- =====================================================================
-- 1) SEQUENCIAS
-- =====================================================================
create sequence if not exists public.seq_fict start with 1;


-- =====================================================================
-- 2) TABELAS
-- =====================================================================

-- 2.1 O.S. de campo — o coracao do sistema
create table if not exists public.os_campo (
  id              bigint generated always as identity primary key,
  numero          int,                    -- numero oficial do contrato
  numero_fict     int,                    -- legado F-nn (contagem ficticia)
  fict_ref        text,                   -- ref por equipe: L01, M01, G05, C01
  emergencial     boolean     not null default false,
  unidade         text        not null,   -- escola / unidade
  fiscal          text,
  classificacao   text,
  area            text,                   -- disciplina (guia conversao EMOP)
  tipo            text,                   -- Emergencial | Corretiva | Preventiva
  entrada         date,
  conclusao       date,
  executor        text,
  status          text        not null default 'Executando',
  medicao         text,                   -- 'MED 8'…
  solicitado      text,                   -- o que o fiscal pediu
  servico         text,                   -- o que foi executado
  materiais       text,
  memoria_calculo text,
  foto_urls       text[]      not null default '{}',
  assinado        boolean     not null default false,
  excluida        boolean     not null default false,  -- soft delete
  prioridade      int,
  oficializada_em timestamptz,            -- quando a ficticia virou oficial
  par_sugerido    text,                   -- par de fusao sugerido/aplicado
  geo             text,                   -- coordenada capturada em campo
  criado_por      uuid        default auth.uid(),
  criado_em       timestamptz not null default now()
);

-- colunas adicionadas depois da criacao original (ordem historica preservada)
alter table public.os_campo add column if not exists numero_fict     int;
alter table public.os_campo add column if not exists fict_ref        text;
alter table public.os_campo add column if not exists area            text;
alter table public.os_campo add column if not exists solicitado      text;
alter table public.os_campo add column if not exists tipo            text;
alter table public.os_campo add column if not exists excluida        boolean not null default false;
alter table public.os_campo add column if not exists prioridade      int;
alter table public.os_campo add column if not exists oficializada_em timestamptz;
alter table public.os_campo add column if not exists par_sugerido    text;
alter table public.os_campo add column if not exists geo             text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'os_campo_prioridade_1_3') then
    alter table public.os_campo add constraint os_campo_prioridade_1_3
      check (prioridade is null or prioridade between 1 and 3);
  end if;
end $$;

-- 2.2 Saida de material (almoxarifado do Joao)
create table if not exists public.saida_material (
  id           bigint generated always as identity primary key,
  data         date          not null default current_date,
  descricao    text          not null,
  quantidade   numeric(12,2) not null default 1,
  unidade      text          not null default 'UND',
  os_ref       text,          -- '1747' | 'F-77' | 'L01'  (vazio = reposicao)
  escola       text,
  origem       text          default 'ALMOXARIFADO',
  obs          text,
  destinatario text,
  recebido     boolean,       -- confirmacao de quem pediu
  criado_por   uuid          default auth.uid(),
  criado_em    timestamptz   not null default now()
);
alter table public.saida_material add column if not exists obs          text;
alter table public.saida_material add column if not exists destinatario text;
alter table public.saida_material add column if not exists recebido     boolean;

-- 2.3 Entrada de material (compra/reposicao, com foto da NF)
create table if not exists public.entrada_material (
  id         bigint generated always as identity primary key,
  data       date          not null default current_date,
  descricao  text          not null,
  quantidade numeric(12,2) not null default 1,
  unidade    text          not null default 'UND',
  origem     text          default 'COMPRA',
  nf_url     text,
  obs        text,
  criado_por uuid          default auth.uid(),
  criado_em  timestamptz   not null default now()
);

-- 2.4 Catalogo de itens (saldo = saldo_inicial + entradas - saidas)
create table if not exists public.estoque_item (
  id            bigint generated always as identity primary key,
  descricao     text          not null unique,
  categoria     text          not null default 'DIVERSOS',
  unidade       text          not null default 'UND',
  qtd_minima    numeric(12,2) not null default 0,
  saldo_inicial numeric(12,2) not null default 0,
  criado_em     timestamptz   not null default now()
);

-- 2.5 Ferramental (rastreio: onde esta, com quem, desde quando)
create table if not exists public.ferramenta (
  id         bigint generated always as identity primary key,
  descricao  text          not null,
  quantidade numeric(12,2) not null default 1,
  status     text          not null default 'ESTOQUE',   -- ESTOQUE | EM CAMPO
  com_quem   text,
  obra       text,
  desde      date,
  obs        text,
  criado_em  timestamptz   not null default now()
);

-- 2.6 Solicitacao das equipes (PEDIDO -> SEPARADO -> RECEBIDO)
create table if not exists public.solicitacao_material (
  id          bigint generated always as identity primary key,
  data        date        not null default current_date,
  solicitante text        not null,      -- prefixo do login
  os_ref      text,
  itens       text        not null,      -- um por linha: "2 UND SIFAO"
  status      text        not null default 'PEDIDO',
  obs         text,
  criado_em   timestamptz not null default now()
);

-- 2.7 Autocomplete aprendido (REV002)
create table if not exists public.apelido_material (
  id            bigint generated always as identity primary key,
  digitado      text        not null unique,
  canonico      text        not null,
  usos          int         not null default 1,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 2.8 Financeiro do contrato (regua fechada: so lucas e rafael)
create table if not exists public.contrato_financeiro (
  id            bigint generated always as identity primary key,
  contrato      text          not null default 'Saúde 094',
  mes           text          not null,
  ordem         int           not null default 0,
  custo_total   numeric(14,2) not null default 0,
  medicao_bruta numeric(14,2) not null default 0,
  mo_direta     numeric(14,2) not null default 0,
  mo_indireta   numeric(14,2) not null default 0,
  material      numeric(14,2) not null default 0,
  atualizado_em timestamptz   not null default now(),
  unique (contrato, mes)
);

-- 2.9 Livro-razao das O.S. (regra Renan 06/07: numero fixo, exclusao e marca)
create table if not exists public.os_campo_log (
  id        bigint generated always as identity primary key,
  os_id     bigint,
  ref       text,                     -- numero oficial, L/M/G/C-nn ou F-nn
  acao      text        not null,     -- EDITADA | EXCLUIDA | RESTAURADA | EXCLUIDA-FISICA
  por_email text,
  quando    timestamptz not null default now(),
  antes     jsonb                     -- a linha inteira como era ANTES
);


-- =====================================================================
-- 3) FUNCOES E GATILHOS
-- =====================================================================

-- 3.1 Numeracao ficticia: F-nn so quando NAO ha numero oficial nem ref
--     de equipe. Trava final do banco contra perda de numeracao.
create or replace function public.fpv_atribui_fict()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null and new.numero_fict is null and new.fict_ref is null then
    new.numero_fict := nextval('public.seq_fict');
  end if;
  return new;
end $$;

drop trigger if exists trg_fict on public.os_campo;
create trigger trg_fict before insert on public.os_campo
  for each row execute function public.fpv_atribui_fict();

-- 3.2 Escrivao da O.S.: grava o ANTES de todo update/delete.
create or replace function public.fpv_log_os()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare em text;
begin
  begin
    em := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'sistema');
  exception when others then
    em := 'sistema';
  end;

  if tg_op = 'DELETE' then
    insert into public.os_campo_log (os_id, ref, acao, por_email, antes)
    values (old.id,
            coalesce(old.numero::text, old.fict_ref, 'F-' || old.numero_fict::text, 'S/N'),
            'EXCLUIDA-FISICA', em, to_jsonb(old));
    return old;
  else
    insert into public.os_campo_log (os_id, ref, acao, por_email, antes)
    values (old.id,
            coalesce(old.numero::text, old.fict_ref, 'F-' || old.numero_fict::text, 'S/N'),
            case when new.excluida and not old.excluida then 'EXCLUIDA'
                 when old.excluida and not new.excluida then 'RESTAURADA'
                 else 'EDITADA' end,
            em, to_jsonb(old));
    return new;
  end if;
end $$;

drop trigger if exists trg_fpv_log_os on public.os_campo;
create trigger trg_fpv_log_os
  before update or delete on public.os_campo
  for each row execute function public.fpv_log_os();

-- 3.3 Alinhamento da sequencia ficticia com o que ja existe (seguro).
--     Banco novo (Saude): proximo F-nn = 1; com dados, max existente + 1.
select setval('public.seq_fict',
              coalesce((select max(numero_fict) from public.os_campo), 0) + 1,
              false);


-- =====================================================================
-- 4) INDICES
-- =====================================================================
create unique index if not exists ux_os_fict_ref
  on public.os_campo(fict_ref) where fict_ref is not null;

create index if not exists idx_saida_os_ref   on public.saida_material(os_ref);
create index if not exists idx_saida_data     on public.saida_material(data);
create index if not exists idx_entrada_desc   on public.entrada_material(descricao);
create index if not exists idx_solic_status   on public.solicitacao_material(status);
create index if not exists idx_apelido_usos   on public.apelido_material(usos desc);


-- =====================================================================
-- 5) ROW LEVEL SECURITY
-- Regra deste arquivo: TODO create policy tem drop policy if exists antes.
-- Isso e o que impede a regressao de seguranca descrita no PLANO.
-- =====================================================================

alter table public.os_campo             enable row level security;
alter table public.saida_material       enable row level security;
alter table public.entrada_material     enable row level security;
alter table public.estoque_item         enable row level security;
alter table public.ferramenta           enable row level security;
alter table public.solicitacao_material enable row level security;
alter table public.apelido_material     enable row level security;
alter table public.contrato_financeiro  enable row level security;
alter table public.os_campo_log         enable row level security;

-- ---------------------------------------------------------------------
-- TRAVA DE REGRESSÃO — CORREÇÃO 28/07 (verificação adversarial)
--
-- As policies abaixo são as PERMISSIVAS de hoje (using(true)). Elas
-- existem para montar um banco NOVO do zero. Num banco que JÁ recebeu o
-- modelo por papéis (seguranca/01..04), reaplicar este baseline seria
-- um desastre silencioso: policy permissiva SE SOMA com OR, então
-- "fpv_autenticados_update using(true)" ao lado de "os_campo_update"
-- transforma toda a RLS nova em decoração — e o loop do 5.3 APAGA as
-- policies endurecidas do almoxarifado, que têm os mesmos nomes.
-- O Renan aplicaria e continuaria achando que está protegido.
--
-- Por isso: se fpv_check() existe, o modelo por papéis está instalado e
-- esta seção inteira é PULADA.
-- ---------------------------------------------------------------------
-- O SQL Editor do Supabase roda o script colado como UMA transação:
-- se este bloco aborta, NADA do baseline é aplicado. É essa a trava.
do $guard$
begin
  if exists (select 1 from pg_proc where proname = 'fpv_check') then
    raise exception using
      message = 'BASELINE BLOQUEADO — este banco já tem o modelo por papéis (fpv_check existe).',
      detail  = 'Reaplicar o 0001 recriaria as policies permissivas using(true) POR CIMA da RLS endurecida e apagaria as policies do almoxarifado (mesmos nomes). A proteção viraria decoração sem ninguém perceber.',
      hint    = 'Banco NOVO: rode 0001 e depois seguranca/01→04→02→03. Banco JÁ configurado: não rode o 0001. Se precisar mesmo recriar as permissivas, remova este bloco de propósito.';
  end if;
end
$guard$;

-- Daqui para baixo só executa em banco SEM o modelo por papéis.
-- (Em banco novo: rode 0001 e DEPOIS seguranca/01→04→02→03.)

-- 5.1 os_campo — leitura/escrita para autenticado, DELETE so gestao
drop policy if exists "fpv_autenticados_select" on public.os_campo;
drop policy if exists "fpv_autenticados_insert" on public.os_campo;
drop policy if exists "fpv_autenticados_update" on public.os_campo;
drop policy if exists "fpv_autenticados_delete" on public.os_campo;   -- <<< a armadilha
drop policy if exists "fpv_gestores_delete"     on public.os_campo;
create policy "fpv_autenticados_select" on public.os_campo
  for select to authenticated using (true);
create policy "fpv_autenticados_insert" on public.os_campo
  for insert to authenticated with check (true);
create policy "fpv_autenticados_update" on public.os_campo
  for update to authenticated using (true) with check (true);
create policy "fpv_gestores_delete" on public.os_campo
  for delete to authenticated
  using (auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','renan@fpv.app','edmar@fpv.app','leony@fpv.app'));

-- 5.2 saida_material — DELETE so gestao + Lorran (almoxarife da Saude)
drop policy if exists "almox_select"          on public.saida_material;
drop policy if exists "almox_insert"          on public.saida_material;
drop policy if exists "almox_update"          on public.saida_material;
drop policy if exists "almox_delete"          on public.saida_material;  -- <<< a armadilha
drop policy if exists "almox_delete_restrito" on public.saida_material;
create policy "almox_select" on public.saida_material
  for select to authenticated using (true);
create policy "almox_insert" on public.saida_material
  for insert to authenticated with check (true);
create policy "almox_update" on public.saida_material
  for update to authenticated using (true) with check (true);
create policy "almox_delete_restrito" on public.saida_material
  for delete to authenticated
  using (auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','renan@fpv.app',
     'edmar@fpv.app','leony@fpv.app','lorran@fpv.app'));

-- 5.3/5.4/5.5/5.6 estoque_item, entrada_material, ferramenta, solicitacao
do $$
declare
  t   text;
  pfx text;
  gestao text := $g$auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','renan@fpv.app','edmar@fpv.app','leony@fpv.app','lorran@fpv.app')$g$;
begin
  foreach t in array array['estoque_item','entrada_material','ferramenta','solicitacao_material']
  loop
    pfx := case t when 'estoque_item'         then 'estoque'
                  when 'entrada_material'     then 'entrada'
                  when 'ferramenta'           then 'ferr'
                  when 'solicitacao_material' then 'solic' end;
    execute format('drop policy if exists "%s_select" on public.%I', pfx, t);
    execute format('drop policy if exists "%s_insert" on public.%I', pfx, t);
    execute format('drop policy if exists "%s_update" on public.%I', pfx, t);
    execute format('drop policy if exists "%s_delete" on public.%I', pfx, t);
    execute format('create policy "%s_select" on public.%I for select to authenticated using (true)', pfx, t);
    execute format('create policy "%s_insert" on public.%I for insert to authenticated with check (true)', pfx, t);
    execute format('create policy "%s_update" on public.%I for update to authenticated using (true) with check (true)', pfx, t);
    execute format('create policy "%s_delete" on public.%I for delete to authenticated using (%s)', pfx, t, gestao);
  end loop;
end $$;

-- 5.7 apelido_material — sem delete de proposito (dicionario so cresce)
drop policy if exists "apelido_select" on public.apelido_material;
drop policy if exists "apelido_insert" on public.apelido_material;
drop policy if exists "apelido_update" on public.apelido_material;
create policy "apelido_select" on public.apelido_material
  for select to authenticated using (true);
create policy "apelido_insert" on public.apelido_material
  for insert to authenticated with check (true);
create policy "apelido_update" on public.apelido_material
  for update to authenticated using (true) with check (true);

-- 5.8 contrato_financeiro — regua fechada (decisao Renan 08/07)
drop policy if exists "fin_select" on public.contrato_financeiro;
drop policy if exists "fin_insert" on public.contrato_financeiro;
drop policy if exists "fin_update" on public.contrato_financeiro;
drop policy if exists "fin_delete" on public.contrato_financeiro;
create policy "fin_select" on public.contrato_financeiro for select to authenticated
  using (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));
create policy "fin_insert" on public.contrato_financeiro for insert to authenticated
  with check (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));
create policy "fin_update" on public.contrato_financeiro for update to authenticated
  using      (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'))
  with check (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));
create policy "fin_delete" on public.contrato_financeiro for delete to authenticated
  using (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));

-- 5.9 os_campo_log — SO leitura. Nenhuma policy de escrita: pela API o
--     log e intocavel para todo mundo, inclusive gestao. So o trigger escreve.
drop policy if exists "log_select" on public.os_campo_log;
create policy "log_select" on public.os_campo_log
  for select to authenticated using (true);


-- =====================================================================
-- 6) REALTIME (tela do Joao atualiza sozinha quando a equipe pede material)
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['os_campo','saida_material','solicitacao_material',
                           'estoque_item','entrada_material','ferramenta']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- ja estava na publicacao
      when undefined_object then
        raise notice 'publicacao supabase_realtime nao existe neste ambiente';
    end;
  end loop;
end $$;


-- =====================================================================
-- 7) STORAGE — fora do SQL puro (feito no painel)
--   Bucket 'fotos-os'. O estado HISTORICO era PUBLIC (achado ALTO 4).
--   A migration 0005 (seguranca/09-fotos-privadas.sql) fecha o bucket.
--   Este baseline NAO recria o bucket publico de proposito: num ambiente
--   novo, crie ja privado e rode a 0005.
-- =====================================================================


-- =====================================================================
-- 8) CONFERENCIA
-- =====================================================================
select
  (select count(*) from information_schema.tables
    where table_schema='public'
      and table_name in ('os_campo','saida_material','entrada_material','estoque_item',
                         'ferramenta','solicitacao_material','apelido_material',
                         'contrato_financeiro','os_campo_log'))            as tabelas_deve_ser_9,
  (select count(*) from pg_trigger where tgname in ('trg_fict','trg_fpv_log_os')) as triggers_deve_ser_2,
  (select count(*) from pg_policies where schemaname='public')             as policies,
  (select count(*) from pg_publication_tables where pubname='supabase_realtime'
     and tablename in ('os_campo','saida_material','solicitacao_material',
                       'estoque_item','entrada_material','ferramenta'))    as realtime_deve_ser_6;

select public.fpv_migracao(
  '0001',
  'Baseline: 9 tabelas, seq_fict, trg_fict, trg_fpv_log_os, RLS e realtime',
  '0001_baseline.sql',
  'Consolida os 11 .sql historicos da raiz do repo. Estado de producao em 28/07/2026.');

-- =====================================================================
-- ROLLBACK: NAO EXISTE rollback para um baseline. Ele e o ponto zero.
-- Para desfazer num ambiente de teste: drop schema public cascade;
-- create schema public;  (NUNCA em producao.)
-- =====================================================================
