-- =====================================================================
-- 0000 · CONTROLE DE VERSAO DO SCHEMA
-- Primeira migration a rodar em QUALQUER ambiente (producao, copia,
-- maquina do Nicolas). Sem ela nao da para saber o que ja foi aplicado.
--
-- Idempotente. Nao depende de nenhuma tabela do app.
-- =====================================================================

create table if not exists public.schema_version (
  versao      text        primary key,          -- '0001', '0002'…
  descricao   text        not null,
  arquivo     text,                             -- nome do .sql de origem
  aplicado_em timestamptz not null default now(),
  aplicado_por text       not null default current_user,
  observacao  text
);

comment on table public.schema_version is
  'Uma linha por migration aplicada. IMUTAVEL: migration ja registrada nunca '
  'e reescrita — se precisar mudar algo, cria-se a proxima numerada.';

-- Registrador. Chamado na ULTIMA linha de toda migration.
-- Devolve true se registrou agora, false se ja estava registrada.
create or replace function public.fpv_migracao(
  p_versao text, p_descricao text, p_arquivo text default null,
  p_observacao text default null)
returns boolean
language plpgsql
as $$
declare
  v_linhas int;
  v_nova   boolean;
begin
  insert into public.schema_version (versao, descricao, arquivo, observacao)
  values (p_versao, p_descricao, p_arquivo, p_observacao)
  on conflict (versao) do nothing;
  -- ROW_COUNT e inteiro: nao da para atribuir direto a um boolean.
  get diagnostics v_linhas = row_count;
  v_nova := (v_linhas > 0);
  if v_nova then
    raise notice 'migration % aplicada: %', p_versao, p_descricao;
  else
    raise notice 'migration % JA estava aplicada — nada mudou', p_versao;
  end if;
  return v_nova;
end $$;

-- Guarda: usada no TOPO de migrations caras/destrutivas para abortar cedo.
create or replace function public.fpv_migracao_pendente(p_versao text)
returns boolean
language sql stable
as $$
  select not exists (select 1 from public.schema_version where versao = p_versao);
$$;

-- Leitura: o que este banco tem hoje.
create or replace view public.vw_schema_version as
select versao, descricao, arquivo, aplicado_em, aplicado_por, observacao
from public.schema_version
order by versao;

-- O controle de versao NAO fica exposto ao app.
alter table public.schema_version enable row level security;
-- Sem policy nenhuma = ninguem le pela API. Leitura so pelo SQL Editor
-- (service_role / painel), que e onde a migration roda mesmo.

select public.fpv_migracao('0000', 'Tabela de controle de versao do schema',
                           '0000_schema_version.sql');

-- ROLLBACK:
-- drop view     if exists public.vw_schema_version;
-- drop function if exists public.fpv_migracao_pendente(text);
-- drop function if exists public.fpv_migracao(text,text,text,text);
-- drop table    if exists public.schema_version;
