-- =====================================================================
-- ALMOXARIFADO v2 (spec engenheiro REV 000, 06/07/2026) — colar TUDO
-- no SQL Editor do fpv-campo22 e RUN. Idempotente.
-- Cria: estoque (cadastro c/ mínimo), entradas c/ NF, ferramentas,
-- solicitações das equipes, e confirmação de recebimento na saída.
-- =====================================================================

-- 1) SAÍDA ganha observação (origem "OUTRO" explicada), destinatário e
--    confirmação de recebimento no login de quem pediu
alter table saida_material add column if not exists obs text;
alter table saida_material add column if not exists destinatario text;
alter table saida_material add column if not exists recebido boolean;

-- 2) CADASTRO DE MATERIAIS/FERRAMENTAS — item com quantidade mínima.
--    saldo = saldo_inicial (contagem física) + entradas − saídas
create table if not exists estoque_item (
  id bigint generated always as identity primary key,
  descricao text not null unique,
  categoria text not null default 'DIVERSOS',
  unidade text not null default 'UND',
  qtd_minima numeric(12,2) not null default 0,
  saldo_inicial numeric(12,2) not null default 0,
  criado_em timestamptz not null default now()
);
alter table estoque_item enable row level security;
drop policy if exists "estoque_select" on estoque_item;
drop policy if exists "estoque_insert" on estoque_item;
drop policy if exists "estoque_update" on estoque_item;
drop policy if exists "estoque_delete" on estoque_item;
create policy "estoque_select" on estoque_item for select to authenticated using (true);
create policy "estoque_insert" on estoque_item for insert to authenticated with check (true);
create policy "estoque_update" on estoque_item for update to authenticated using (true) with check (true);
create policy "estoque_delete" on estoque_item for delete to authenticated
  using (auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','leony@fpv.app','renan@fpv.app','edmar@fpv.app','thiago@fpv.app'));


-- 2b) PALAVRAS-CHAVE / AUTOPREENCHIMENTO APRENDIDO (REV002)
-- Guarda termos digitados fora do catálogo para aparecerem como sugestão
-- nas próximas saídas, entradas e cadastros.
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

-- 3) ENTRADA de material (compra/reposição) com foto da NOTA FISCAL
create table if not exists entrada_material (
  id bigint generated always as identity primary key,
  data date not null default current_date,
  descricao text not null,
  quantidade numeric(12,2) not null default 1,
  unidade text not null default 'UND',
  origem text default 'COMPRA',
  nf_url text,
  obs text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
alter table entrada_material enable row level security;
drop policy if exists "entrada_select" on entrada_material;
drop policy if exists "entrada_insert" on entrada_material;
drop policy if exists "entrada_update" on entrada_material;
drop policy if exists "entrada_delete" on entrada_material;
create policy "entrada_select" on entrada_material for select to authenticated using (true);
create policy "entrada_insert" on entrada_material for insert to authenticated with check (true);
create policy "entrada_update" on entrada_material for update to authenticated using (true) with check (true);
create policy "entrada_delete" on entrada_material for delete to authenticated
  using (auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','leony@fpv.app','renan@fpv.app','edmar@fpv.app','thiago@fpv.app'));

-- 4) FERRAMENTAS — rastreio: em qual obra está, com quem, desde quando
create table if not exists ferramenta (
  id bigint generated always as identity primary key,
  descricao text not null,
  quantidade numeric(12,2) not null default 1,
  status text not null default 'ESTOQUE',  -- ESTOQUE | EM CAMPO
  com_quem text,
  obra text,
  desde date,
  obs text,
  criado_em timestamptz not null default now()
);
alter table ferramenta enable row level security;
drop policy if exists "ferr_select" on ferramenta;
drop policy if exists "ferr_insert" on ferramenta;
drop policy if exists "ferr_update" on ferramenta;
drop policy if exists "ferr_delete" on ferramenta;
create policy "ferr_select" on ferramenta for select to authenticated using (true);
create policy "ferr_insert" on ferramenta for insert to authenticated with check (true);
create policy "ferr_update" on ferramenta for update to authenticated using (true) with check (true);
create policy "ferr_delete" on ferramenta for delete to authenticated
  using (auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','leony@fpv.app','renan@fpv.app','edmar@fpv.app','thiago@fpv.app'));

-- 5) SOLICITAÇÕES das equipes (emergência/preventiva) ao almoxarifado
--    fluxo: PEDIDO (equipe) → SEPARADO (João) → RECEBIDO (equipe confirma)
create table if not exists solicitacao_material (
  id bigint generated always as identity primary key,
  data date not null default current_date,
  solicitante text not null,           -- prefixo do login (emergencia1, gilson…)
  os_ref text,
  itens text not null,                 -- um item por linha: "2 UND SIFÃO"
  status text not null default 'PEDIDO',
  obs text,
  criado_em timestamptz not null default now()
);
alter table solicitacao_material enable row level security;
drop policy if exists "solic_select" on solicitacao_material;
drop policy if exists "solic_insert" on solicitacao_material;
drop policy if exists "solic_update" on solicitacao_material;
drop policy if exists "solic_delete" on solicitacao_material;
create policy "solic_select" on solicitacao_material for select to authenticated using (true);
create policy "solic_insert" on solicitacao_material for insert to authenticated with check (true);
create policy "solic_update" on solicitacao_material for update to authenticated using (true) with check (true);
create policy "solic_delete" on solicitacao_material for delete to authenticated
  using (auth.jwt() ->> 'email' in
    ('lucas@fpv.app','rafael@fpv.app','leony@fpv.app','renan@fpv.app','edmar@fpv.app','thiago@fpv.app'));

create index if not exists idx_solic_status on solicitacao_material(status);
create index if not exists idx_entrada_desc on entrada_material(descricao);

-- 6) CONFERÊNCIA — 1 linha, tudo OK
select
  (select case when exists (select 1 from information_schema.tables where table_name='estoque_item') then 'OK' else 'FALTOU' end) as estoque_item,
  (select case when exists (select 1 from information_schema.tables where table_name='entrada_material') then 'OK' else 'FALTOU' end) as entrada_material,
  (select case when exists (select 1 from information_schema.tables where table_name='ferramenta') then 'OK' else 'FALTOU' end) as ferramenta,
  (select case when exists (select 1 from information_schema.tables where table_name='solicitacao_material') then 'OK' else 'FALTOU' end) as solicitacoes,
  (select case when exists (select 1 from information_schema.columns where table_name='saida_material' and column_name='destinatario') then 'OK' else 'FALTOU' end) as confirmacao_recebimento,
  (select case when exists (select 1 from information_schema.tables where table_name='apelido_material') then 'OK' else 'FALTOU' end) as apelidos_autocomplete;
