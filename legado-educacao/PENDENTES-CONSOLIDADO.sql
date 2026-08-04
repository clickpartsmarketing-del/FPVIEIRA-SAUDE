-- =====================================================================
-- FPV CAMPO — TUDO QUE ESTÁ PENDENTE NO BANCO, NUM COLAR SÓ (06/07/2026)
-- Colar TUDO no SQL Editor do Supabase (fpv-campo22) e clicar RUN.
-- Idempotente: rodar 2x não quebra nada.
--
-- Inclui: (1) segurança DELETE  (2) coluna area  (3) NUMERAÇÃO POR
-- EQUIPE L01/M01 (decisão Renan 05/07 — substitui o F-nn nas novas)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) SEGURANÇA: DELETE de O.S. só gestão; saída de material só gestão+João
-- ---------------------------------------------------------------------
drop policy if exists "fpv_autenticados_delete" on os_campo;
drop policy if exists "fpv_gestores_delete" on os_campo;
create policy "fpv_gestores_delete" on os_campo
  for delete to authenticated
  using (
    auth.jwt() ->> 'email' in (
      'lucas@fpv.app', 'rafael@fpv.app', 'leony@fpv.app', 'renan@fpv.app', 'edmar@fpv.app'
    )
  );

drop policy if exists "almox_delete" on saida_material;
drop policy if exists "almox_delete_restrito" on saida_material;
create policy "almox_delete_restrito" on saida_material
  for delete to authenticated
  using (
    auth.jwt() ->> 'email' in (
      'lucas@fpv.app', 'rafael@fpv.app', 'leony@fpv.app', 'renan@fpv.app', 'edmar@fpv.app',
      'thiago@fpv.app'
    )
  );

-- ---------------------------------------------------------------------
-- 2) COLUNAS usadas pelo app atual
-- ---------------------------------------------------------------------
alter table os_campo add column if not exists area text;
alter table os_campo add column if not exists solicitado text;
alter table os_campo add column if not exists tipo text;
alter table os_campo add column if not exists prioridade int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'os_campo_prioridade_1_3') then
    alter table os_campo add constraint os_campo_prioridade_1_3
      check (prioridade is null or prioridade between 1 and 3);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) NUMERAÇÃO POR EQUIPE (L01, L02… Leandro · M01, M02… Miqueias)
--    O app calcula o próximo número e o índice ÚNICO garante que dois
--    celulares salvando juntos nunca criem o mesmo L-nº (um deles
--    recebe erro e o app tenta o seguinte sozinho).
--    F-77/F-78 antigas continuam como estão (legado exibido igual).
-- ---------------------------------------------------------------------
create sequence if not exists seq_fict start with 77;
alter table os_campo add column if not exists fict_ref text;
create unique index if not exists ux_os_fict_ref
  on os_campo(fict_ref) where fict_ref is not null;

-- trigger antigo só entra quando NÃO há nº oficial NEM ref de equipe
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

-- ---------------------------------------------------------------------
-- 4) CONFERÊNCIA — 1 linha, tudo OK
-- ---------------------------------------------------------------------
select
  (select case when exists (select 1 from pg_policies
     where tablename = 'os_campo' and policyname = 'fpv_gestores_delete')
     then 'OK' else 'FALTOU' end) as delete_os_restrito,
  (select case when exists (select 1 from pg_policies
     where tablename = 'saida_material' and policyname = 'almox_delete_restrito')
     then 'OK' else 'FALTOU' end) as delete_almox_restrito,
  (select case when exists (select 1 from information_schema.columns
     where table_name = 'os_campo' and column_name = 'area')
     then 'OK' else 'FALTOU' end) as coluna_area,
  (select case when exists (select 1 from information_schema.columns
     where table_name = 'os_campo' and column_name = 'solicitado')
     then 'OK' else 'FALTOU' end) as coluna_solicitado,
  (select case when exists (select 1 from information_schema.columns
     where table_name = 'os_campo' and column_name = 'prioridade')
     then 'OK' else 'FALTOU' end) as coluna_prioridade,
  (select case when exists (select 1 from information_schema.columns
     where table_name = 'os_campo' and column_name = 'fict_ref')
     then 'OK' else 'FALTOU' end) as coluna_ref_equipe;

-- Lembrete fora do SQL: Edge Functions > transcrever > "Verify JWT" = ON.
