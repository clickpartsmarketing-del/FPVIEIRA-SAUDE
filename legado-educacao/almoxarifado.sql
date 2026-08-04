-- =====================================================================
-- ALMOXARIFADO (João) — tabela de saída de materiais
-- Rodar no SQL Editor do Supabase (uma vez).
-- Espelha a planilha "SAÍDA DE MATERIAIS — EDUCAÇÃO" e cruza com as
-- O.S. do campo pela referência (nº oficial ou F-nn).
-- =====================================================================

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

create policy "almox_select" on saida_material for select to authenticated using (true);
create policy "almox_insert" on saida_material for insert to authenticated with check (true);
create policy "almox_update" on saida_material for update to authenticated using (true) with check (true);
create policy "almox_delete" on saida_material for delete to authenticated using (true);

create index if not exists idx_saida_os_ref on saida_material(os_ref);
create index if not exists idx_saida_data on saida_material(data);
