-- =====================================================================
-- FPV CAMPO — PENDÊNCIAS DE BANCO (colar TUDO de uma vez no SQL Editor
-- do Supabase e clicar RUN — é idempotente, rodar 2x não quebra nada)
-- Projeto: fpv-campo22 (lgdnuyreaknxjswrfbjw)
-- =====================================================================

-- 1) ALMOXARIFADO (João) — tabela de saída de materiais
create table if not exists saida_material (
  id bigint generated always as identity primary key,
  data date not null default current_date,
  descricao text not null,
  quantidade numeric(12,2) not null default 1,
  unidade text not null default 'UND',
  os_ref text,            -- '1747' ou 'F-77' — vínculo com a O.S. (vazio = reposição)
  escola text,
  origem text default 'ALMOXARIFADO',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);

alter table saida_material enable row level security;

drop policy if exists "almox_select" on saida_material;
drop policy if exists "almox_insert" on saida_material;
drop policy if exists "almox_update" on saida_material;
drop policy if exists "almox_delete" on saida_material;
create policy "almox_select" on saida_material for select to authenticated using (true);
create policy "almox_insert" on saida_material for insert to authenticated with check (true);
create policy "almox_update" on saida_material for update to authenticated using (true) with check (true);
create policy "almox_delete" on saida_material for delete to authenticated using (true);

create index if not exists idx_saida_os_ref on saida_material(os_ref);
create index if not exists idx_saida_data on saida_material(data);

-- 1b) Colunas atuais da O.S. usadas pelo app
alter table os_campo add column if not exists solicitado text;
alter table os_campo add column if not exists area text;
alter table os_campo add column if not exists tipo text;
alter table os_campo add column if not exists prioridade int;

-- 2) SEQUÊNCIA FICTÍCIA — garante que a 1ª O.S. real seja F-77.
--    TRAVA DE SEGURANÇA: só ajusta se ainda NÃO existe nenhuma O.S.
--    com F-nº no banco (se já existir, não mexe — evita F duplicado).
create sequence if not exists seq_fict start with 77;
select case
  when not exists (select 1 from os_campo where numero_fict is not null)
  then setval('seq_fict', 76)
end as seq_ajustada;

-- 2b) ÁREA (disciplina) da O.S. — segmenta rota/chat e guia a memória
--     de cálculo p/ conversão EMOP (o app funciona sem, mas grava melhor com)
alter table os_campo add column if not exists area text;

-- 3) CONFERÊNCIA — deve devolver 1 linha com tudo 'OK'
select
  (select case when exists (select 1 from information_schema.tables
     where table_name = 'saida_material') then 'OK' else 'FALTOU' end) as tabela_almox,
  (select case when exists (select 1 from information_schema.columns
     where table_name = 'os_campo' and column_name = 'solicitado') then 'OK' else 'FALTOU' end) as coluna_solicitado,
  (select last_value from seq_fict) as seq_fict_atual_deve_ser_76;
