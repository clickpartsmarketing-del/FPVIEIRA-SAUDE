-- =====================================================================
-- FPV CAMPO — SEGURANÇA · ARQUIVO 01 de 04 · PAPÉIS
-- Tabela app_usuario + funções de papel + seed dos usuários reais.
--
-- ORDEM DE APLICAÇÃO:  01 → 04 → 02 → 03
--   (o 04 cria o fpv_check() que o 02 e o 03 usam; rodar fora de ordem
--    dá erro claro "function fpv_check does not exist" e NÃO quebra nada)
--
-- Este arquivo, sozinho, NÃO MUDA NENHUMA PERMISSÃO. Ele só cria a
-- tabela de papéis e as funções que leem o e-mail do JWT. Pode rodar
-- em produção no meio do expediente sem risco.
--
-- Idempotente (rodar 2x não quebra). ROLLBACK no fim do arquivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) TABELA DE PAPÉIS — a fonte única de "quem é quem".
--    Hoje a regra está hardcoded em 3 lugares (config.ts, App.tsx e uma
--    lista de e-mails copiada dentro de CADA policy). Aqui vira dado:
--    trocar de encarregado é 1 UPDATE, não um deploy.
-- ---------------------------------------------------------------------
create table if not exists app_usuario (
  email           text primary key,
  nome            text not null,
  papel           text not null default 'campo',
  -- nomes que este login PODE assumir como executor da O.S.
  -- (equipe emergencia1 = Wellington + Leandro; gilson = Gilson)
  executores      text[] not null default '{}',
  -- zonas (fiscal) que este login enxerga como suas — só emergência
  fiscais         text[] not null default '{}',
  -- P1..P3 é decisão de despacho: Nicolas, Renan e Lucas (RV000)
  pode_priorizar  boolean not null default false,
  -- contrato_financeiro: só a diretoria (decisão Renan 08/07)
  pode_financeiro boolean not null default false,
  ativo           boolean not null default true,
  obs             text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- papéis válidos (constraint criada só se ainda não existir)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_usuario_papel_ck') then
    alter table app_usuario add constraint app_usuario_papel_ck
      check (papel in ('diretoria','gestao','cadastro','almox','campo'));
  end if;
end $$;

comment on table app_usuario is
  'Papéis do FPV Campo Saúde. diretoria=Lucas/Rafael · gestao=engenharia/medição · cadastro=esteira (Brendah) · almox=Lorran · campo=encarregados e equipes de emergência.';

-- ---------------------------------------------------------------------
-- 2) E-MAIL DO JWT — bala de prata de tudo que vem depois.
--    Blindado: se não houver claim (service_role do n8n, job interno,
--    SQL Editor) devolve '' e o resto do modelo trata isso como
--    "processo interno" — n8n NÃO pode quebrar por causa da RLS.
-- ---------------------------------------------------------------------
create or replace function fpv_email() returns text
language plpgsql stable security definer set search_path = public
as $$
declare e text;
begin
  begin
    e := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    e := null;
  end;
  return lower(coalesce(e, ''));
end $$;

-- ---------------------------------------------------------------------
-- 3) O PAPEL DO USUÁRIO LOGADO.
--    STABLE = o Postgres avalia UMA vez por comando (não uma vez por
--    linha). Nas policies ela ainda é chamada como (select app_papel())
--    — esse embrulho força o plano a virar InitPlan, que é o truque
--    oficial de performance de RLS no Supabase. Com ~2000 O.S. isso é a
--    diferença entre a lista abrir na hora e a lista travar o celular.
--    SECURITY DEFINER = lê app_usuario sem cair na RLS da própria
--    app_usuario (senão vira recursão infinita).
-- ---------------------------------------------------------------------
create or replace function app_papel() returns text
language plpgsql stable security definer set search_path = public
as $$
declare v text; e text;
begin
  e := fpv_email();
  -- sem e-mail no token = service_role (n8n), job ou SQL Editor
  if e = '' then return 'servico'; end if;
  select u.papel into v from app_usuario u where u.email = e and u.ativo;
  -- login que existe no Auth mas ninguém cadastrou aqui: NÃO ganha nada
  -- de graça, mas também não some da tela (ele lê tudo, como todo mundo)
  return coalesce(v, 'desconhecido');
end $$;

create or replace function app_eh_gestao() returns boolean
language sql stable security definer set search_path = public
as $$ select app_papel() in ('diretoria','gestao') $$;

create or replace function app_eh_almox() returns boolean
language sql stable security definer set search_path = public
as $$ select app_papel() = 'almox' $$;

-- processo interno (n8n / SQL Editor): passa por tudo, como sempre passou
create or replace function app_eh_servico() returns boolean
language sql stable security definer set search_path = public
as $$ select app_papel() = 'servico' $$;

create or replace function app_pode_priorizar() returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare b boolean; e text;
begin
  e := fpv_email();
  if e = '' then return true; end if;
  select u.pode_priorizar into b from app_usuario u where u.email = e and u.ativo;
  return coalesce(b, false);
end $$;

create or replace function app_pode_financeiro() returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare b boolean; e text;
begin
  e := fpv_email();
  if e = '' then return true; end if;
  select u.pode_financeiro into b from app_usuario u where u.email = e and u.ativo;
  return coalesce(b, false);
end $$;

-- nomes de executor que ESTE login pode assumir
create or replace function app_executores() returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare v text[]; e text;
begin
  e := fpv_email();
  if e = '' then return '{}'::text[]; end if;
  select u.executores into v from app_usuario u where u.email = e and u.ativo;
  return coalesce(v, '{}'::text[]);
end $$;

-- zonas (fiscal) deste login — só as equipes de emergência têm
create or replace function app_fiscais() returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare v text[]; e text;
begin
  e := fpv_email();
  if e = '' then return '{}'::text[]; end if;
  select u.fiscais into v from app_usuario u where u.email = e and u.ativo;
  return coalesce(v, '{}'::text[]);
end $$;

-- ---------------------------------------------------------------------
-- 4) MEDIÇÃO VIGENTE no banco — espelho EXATO do medDoMes() do config.ts
--    (julho/2026 = MED 8). Usada para travar O.S. de medição FECHADA:
--    medição fechada é dinheiro já faturado, não se mexe mais.
--    Fuso de Brasília, nunca UTC (lição do hojeLocal(), 06/07).
-- ---------------------------------------------------------------------
create or replace function fpv_med_vigente() returns text
language sql stable
as $$
  select 'MED ' || (
    8
    + (extract(year  from (now() at time zone 'America/Sao_Paulo'))::int - 2026) * 12
    + (extract(month from (now() at time zone 'America/Sao_Paulo'))::int - 7)
  )::text
$$;

-- ---------------------------------------------------------------------
-- 5) SEED — os usuários REAIS do config.ts, já com o papel certo.
--    ON CONFLICT: reaplica o papel sem apagar nada que o Renan tenha
--    ajustado à mão depois (nome/obs/ativo continuam do banco).
-- ---------------------------------------------------------------------
-- SEED SAÚDE (FP.096 · 005/2026, ago/2026): usuários reais do config.ts.
insert into app_usuario (email, nome, papel, executores, fiscais, pode_priorizar, pode_financeiro, obs) values
  -- DIRETORIA — enxerga o financeiro (RLS de contrato_financeiro)
  ('lucas@fpv.app',        'Lucas',         'diretoria', '{}', '{}', true,  true,  'gestor geral'),
  ('rafael@fpv.app',       'Rafael',        'diretoria', '{}', '{}', false, true,  'gestão'),
  -- GESTÃO / ENGENHARIA / MEDIÇÃO
  ('leony@fpv.app',        'Leony',         'gestao',    '{}', '{}', true,  false, 'engenharia · Saúde'),
  ('renan@fpv.app',        'Renan',         'gestao',    '{}', '{}', true,  false, 'gestão · despacho'),
  ('edmar@fpv.app',        'Edmar',         'gestao',    '{}', '{}', false, false, 'medição'),
  -- CADASTRO (esteira): cria e corrige O.S., mas não exclui nem prioriza
  ('brendah@fpv.app',      'Brendah',       'cadastro',  '{}', '{}', false, false, 'assistente · esteira'),
  -- ALMOXARIFADO: manda no material, não manda na O.S. de campo
  -- (troca 03/08/2026: saiu Thiago Rafael, entrou Lorran Souza)
  ('lorran@fpv.app',       'Lorran Souza',  'almox',     '{}', '{}', false, false, 'almoxarife · Saúde'),
  -- CAMPO · corretiva (painel pessoal por EXECUTOR, prefixos N/Q/E)
  ('neilson@fpv.app',      'Neilson',       'campo',     '{Neilson}',  '{}', false, false, 'eletricista'),
  ('queiroz@fpv.app',      'Queiroz',       'campo',     '{Queiroz}',  '{}', false, false, 'eletricista'),
  ('emiliano@fpv.app',     'Emiliano',      'campo',     '{Emiliano}', '{}', false, false, 'encarregado')
on conflict (email) do update set
  papel           = excluded.papel,
  executores      = excluded.executores,
  fiscais         = excluded.fiscais,
  pode_priorizar  = excluded.pode_priorizar,
  pode_financeiro = excluded.pode_financeiro,
  atualizado_em   = now();

-- ---------------------------------------------------------------------
-- 6) RLS da própria app_usuario: cada um vê a SUA linha; gestão vê todas.
--    Escrita: NINGUÉM pela API — só SQL Editor / service_role (não há
--    policy de insert/update/delete de propósito).
--    (Isso também tira nome/telefone da mão de quem não precisa.)
-- ---------------------------------------------------------------------
alter table app_usuario enable row level security;
drop policy if exists "app_usuario_select" on app_usuario;
create policy "app_usuario_select" on app_usuario
  for select to authenticated
  using ( email = (select fpv_email()) or (select app_eh_gestao()) );

-- ---------------------------------------------------------------------
-- 7) REDE DE SEGURANÇA — quem está logado no Auth e NÃO tem papel aqui.
--    RODAR ISSO ANTES DE APERTAR (arquivo 04): se aparecer alguém nesta
--    lista, cadastre na app_usuario ANTES, senão essa pessoa entra em
--    modo mínimo e vai reclamar no dia seguinte.
-- ---------------------------------------------------------------------
create or replace function fpv_usuarios_sem_papel()
returns table (email text, ultimo_login timestamptz)
language sql security definer set search_path = public, auth
as $$
  select lower(u.email::text), u.last_sign_in_at
  from auth.users u
  where lower(u.email::text) not in (select a.email from app_usuario a)
  order by u.last_sign_in_at desc nulls last
$$;
revoke all on function fpv_usuarios_sem_papel() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) CONFERÊNCIA — 1 linha. Tudo OK e 11 usuários.
-- ---------------------------------------------------------------------
select
  (select case when exists (select 1 from information_schema.tables
     where table_name = 'app_usuario') then 'OK' else 'FALTOU' end)          as tabela_app_usuario,
  (select count(*) from app_usuario where ativo)                             as usuarios_ativos,
  (select count(*) from app_usuario where papel in ('diretoria','gestao'))   as gestao,
  (select count(*) from app_usuario where papel = 'campo')                   as campo,
  (select fpv_med_vigente())                                                 as medicao_vigente,
  (select count(*) from fpv_usuarios_sem_papel())                            as logins_sem_papel_CADASTRAR;

-- Quem ficou de fora (deve vir VAZIO):
-- select * from fpv_usuarios_sem_papel();

-- Conferir o mapa de papéis:
-- select email, nome, papel, executores, fiscais, pode_priorizar, pode_financeiro from app_usuario order by papel, email;

-- =====================================================================
-- ROLLBACK (desfaz este arquivo por inteiro — só depois de desfazer
-- o 02 e o 03, que dependem destas funções):
-- =====================================================================
-- drop function if exists fpv_usuarios_sem_papel();
-- drop function if exists fpv_med_vigente();
-- drop function if exists app_fiscais();
-- drop function if exists app_executores();
-- drop function if exists app_pode_financeiro();
-- drop function if exists app_pode_priorizar();
-- drop function if exists app_eh_servico();
-- drop function if exists app_eh_almox();
-- drop function if exists app_eh_gestao();
-- drop function if exists app_papel();
-- drop function if exists fpv_email();
-- drop policy if exists "app_usuario_select" on app_usuario;
-- drop table if exists app_usuario;
-- =====================================================================
