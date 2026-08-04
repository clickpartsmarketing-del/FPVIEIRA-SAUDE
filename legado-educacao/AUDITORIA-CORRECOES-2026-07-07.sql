-- =====================================================================
-- FPV CAMPO — CORREÇÕES DE AUDITORIA 07/07/2026
-- Rodar no SQL Editor do Supabase APÓS supabase.sql/almoxarifado.sql.
-- Idempotente: pode rodar mais de uma vez.
--
-- Objetivo: alinhar o banco ao app atual e aos DOCs RV000/REV001/REV002
-- sem apagar dados e sem mudar a arquitetura.
-- =====================================================================

-- 1) Colunas usadas pelo app atual de O.S.
alter table os_campo add column if not exists area text;
alter table os_campo add column if not exists solicitado text;
alter table os_campo add column if not exists tipo text;
alter table os_campo add column if not exists fict_ref text;
alter table os_campo add column if not exists excluida boolean not null default false;
alter table os_campo add column if not exists prioridade int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'os_campo_prioridade_1_3') then
    alter table os_campo add constraint os_campo_prioridade_1_3
      check (prioridade is null or prioridade between 1 and 3);
  end if;
end $$;

-- 2) Numeração fictícia segura (F-nn só se não houver nº oficial nem L/M/G/C)
create sequence if not exists seq_fict start with 77;
create unique index if not exists ux_os_fict_ref
  on os_campo(fict_ref) where fict_ref is not null;

create or replace function fpv_atribui_fict() returns trigger as $$
begin
  if new.numero is null and new.numero_fict is null and new.fict_ref is null then
    new.numero_fict := nextval('seq_fict');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_fict on os_campo;
create trigger trg_fict before insert on os_campo
  for each row execute function fpv_atribui_fict();

-- 3) Saída de material: campos da confirmação e vínculo
create table if not exists saida_material (
  id bigint generated always as identity primary key,
  data date not null default current_date,
  descricao text not null,
  quantidade numeric(12,2) not null default 1,
  unidade text not null default 'UND',
  os_ref text,
  escola text,
  origem text default 'ALMOXARIFADO',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
alter table saida_material add column if not exists obs text;
alter table saida_material add column if not exists destinatario text;
alter table saida_material add column if not exists recebido boolean;
alter table saida_material enable row level security;

-- 4) Tabela de palavras aprendidas para autocomplete acumulativo (REV002)
create table if not exists apelido_material (
  id bigint generated always as identity primary key,
  digitado text not null unique,
  canonico text not null,
  usos int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table apelido_material enable row level security;
drop policy if exists "apelido_select" on apelido_material;
drop policy if exists "apelido_insert" on apelido_material;
drop policy if exists "apelido_update" on apelido_material;
create policy "apelido_select" on apelido_material for select to authenticated using (true);
create policy "apelido_insert" on apelido_material for insert to authenticated with check (true);
create policy "apelido_update" on apelido_material for update to authenticated using (true) with check (true);
create index if not exists idx_apelido_usos on apelido_material(usos desc);

-- 5) Segurança: exclusão física restrita. O app usa soft delete para O.S.
drop policy if exists "fpv_autenticados_delete" on os_campo;
drop policy if exists "fpv_gestores_delete" on os_campo;
create policy "fpv_gestores_delete" on os_campo
  for delete to authenticated
  using (auth.jwt() ->> 'email' in (
    'lucas@fpv.app','rafael@fpv.app','leony@fpv.app','renan@fpv.app','edmar@fpv.app'
  ));

drop policy if exists "almox_delete" on saida_material;
drop policy if exists "almox_delete_restrito" on saida_material;
create policy "almox_delete_restrito" on saida_material
  for delete to authenticated
  using (auth.jwt() ->> 'email' in (
    'lucas@fpv.app','rafael@fpv.app','leony@fpv.app','renan@fpv.app','edmar@fpv.app','thiago@fpv.app'
  ));

-- 6) Conferência final
select
  (select case when exists (select 1 from information_schema.columns where table_name='os_campo' and column_name='solicitado') then 'OK' else 'FALTOU' end) as coluna_solicitado,
  (select case when exists (select 1 from information_schema.columns where table_name='os_campo' and column_name='prioridade') then 'OK' else 'FALTOU' end) as coluna_prioridade,
  (select case when exists (select 1 from information_schema.columns where table_name='os_campo' and column_name='fict_ref') then 'OK' else 'FALTOU' end) as coluna_fict_ref,
  (select case when exists (select 1 from information_schema.tables where table_name='apelido_material') then 'OK' else 'FALTOU' end) as tabela_apelido_material,
  (select case when exists (select 1 from information_schema.columns where table_name='saida_material' and column_name='recebido') then 'OK' else 'FALTOU' end) as coluna_recebido;
