-- =====================================================================
-- FPV CAMPO — MÓDULO FINANCEIRO (08/07/2026)
-- Rodar no SQL Editor do Supabase. Idempotente.
--
-- Visão RESTRITA: decisão Renan 08/07 ("fecha a régua") — SOMENTE
-- lucas@fpv.app e rafael@fpv.app leem/escrevem. A restrição é AQUI,
-- no banco (RLS por e-mail), não só na tela. NENHUM valor financeiro
-- vive no código do app (repo é público).
-- =====================================================================

create table if not exists contrato_financeiro (
  id bigint generated always as identity primary key,
  contrato text not null default 'FP.094',
  mes text not null,                 -- DEZEMBRO, JANEIRO, ...
  ordem int not null default 0,      -- posição no ano-contrato (dez = 0)
  custo_total numeric(14,2) not null default 0,
  medicao_bruta numeric(14,2) not null default 0,
  mo_direta numeric(14,2) not null default 0,
  mo_indireta numeric(14,2) not null default 0,
  material numeric(14,2) not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (contrato, mes)
);

alter table contrato_financeiro enable row level security;

drop policy if exists "fin_select" on contrato_financeiro;
drop policy if exists "fin_insert" on contrato_financeiro;
drop policy if exists "fin_update" on contrato_financeiro;
drop policy if exists "fin_delete" on contrato_financeiro;

create policy "fin_select" on contrato_financeiro for select to authenticated
  using (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));
create policy "fin_insert" on contrato_financeiro for insert to authenticated
  with check (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));
create policy "fin_update" on contrato_financeiro for update to authenticated
  using (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'))
  with check (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));
create policy "fin_delete" on contrato_financeiro for delete to authenticated
  using (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app'));

-- Conferência: deve sair OK + regra restrita
select
  (select case when exists (select 1 from information_schema.tables
     where table_name='contrato_financeiro') then 'OK' else 'FALTOU' end) as tabela,
  (select case when exists (select 1 from pg_policies
     where tablename='contrato_financeiro' and policyname='fin_select'
       and qual like '%lucas@fpv.app%' and qual not like '%nicolas%')
     then 'RESTRITA OK' else 'CONFERIR' end) as regua;
