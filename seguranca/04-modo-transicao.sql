-- =====================================================================
-- FPV CAMPO — SEGURANÇA · ARQUIVO 04 de 04 · MODO DE TRANSIÇÃO
-- O interruptor. É ELE que decide se as regras dos arquivos 02 e 03
-- BLOQUEIAM de verdade ou apenas ANOTAM o que teriam bloqueado.
--
-- ORDEM DE APLICAÇÃO:  01 → 04 → 02 → 03
--   (roda ANTES do 02/03 porque as policies deles chamam fpv_check())
--
-- POR QUE ISSO EXISTE: tem medição em curso. RLS apertada no escuro
-- derruba o campo às 7h da manhã e ninguém entende por quê. Então as
-- regras entram DESLIGADAS: por 2-3 dias tudo continua passando, mas
-- cada operação que a regra nova teria barrado vira uma linha na
-- seguranca_bloqueio. No fim do período o Renan olha a lista:
--   lista vazia  → aperta o parafuso, ninguém sente nada
--   lista cheia  → a regra estava errada, corrige a regra (não o campo)
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) A CHAVE GERAL
--    modo = 'observar' (padrão, seguro) | 'aplicar' (bloqueia de fato)
--    erro_visivel = 'sim'  → quem for barrado recebe MENSAGEM clara
--                   'nao'  → barra em silêncio (a gravação só não acontece)
--    'sim' é o padrão porque falha silenciosa em app de medição é pior
--    que erro na tela: o campo acha que salvou e o dado não existe.
-- ---------------------------------------------------------------------
create table if not exists app_seguranca (
  chave       text primary key,
  valor       text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

insert into app_seguranca (chave, valor) values
  ('modo', 'observar'),
  ('erro_visivel', 'sim')
on conflict (chave) do nothing;   -- NUNCA sobrescreve o que já está lá

alter table app_seguranca enable row level security;
drop policy if exists "app_seguranca_select" on app_seguranca;
create policy "app_seguranca_select" on app_seguranca
  for select to authenticated using ( (select app_eh_gestao()) );
-- sem policy de escrita: o interruptor só se mexe pelo SQL Editor

-- ---------------------------------------------------------------------
-- 2) O CADERNO — o que TERIA sido bloqueado
-- ---------------------------------------------------------------------
create table if not exists seguranca_bloqueio (
  id        bigint generated always as identity primary key,
  quando    timestamptz not null default now(),
  email     text,
  papel     text,
  tabela    text,
  acao      text,          -- select | insert | update | delete
  motivo    text,          -- regra que reprovou / colunas proibidas
  ref       text,          -- nº da O.S., id do item…
  modo      text,          -- observado (passou) | bloqueado (barrou)
  detalhe   jsonb
);
create index if not exists idx_seg_bloqueio_quando on seguranca_bloqueio(quando desc);
create index if not exists idx_seg_bloqueio_email  on seguranca_bloqueio(email);

alter table seguranca_bloqueio enable row level security;
drop policy if exists "seg_bloqueio_select" on seguranca_bloqueio;
create policy "seg_bloqueio_select" on seguranca_bloqueio
  for select to authenticated using ( (select app_eh_gestao()) );
-- sem insert/update/delete pela API: só as funções SECURITY DEFINER escrevem

-- ---------------------------------------------------------------------
-- 3) LEITURA DO INTERRUPTOR (STABLE = 1 leitura por comando)
-- ---------------------------------------------------------------------
create or replace function fpv_modo() returns text
language plpgsql stable security definer set search_path = public
as $$
declare v text;
begin
  select valor into v from app_seguranca where chave = 'modo';
  return coalesce(v, 'observar');   -- na dúvida, NÃO bloqueia
exception when others then
  return 'observar';
end $$;

create or replace function fpv_erro_visivel() returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare v text;
begin
  select valor into v from app_seguranca where chave = 'erro_visivel';
  return coalesce(v, 'sim') = 'sim';
exception when others then
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 4) O REGISTRO (usado pelas policies e pelos gatilhos)
-- ---------------------------------------------------------------------
create or replace function fpv_registra_bloqueio(
  p_tabela text, p_acao text, p_motivo text, p_ref text, p_modo text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into seguranca_bloqueio (email, papel, tabela, acao, motivo, ref, modo)
  values (fpv_email(), app_papel(), p_tabela, p_acao, p_motivo, p_ref, p_modo);
exception when others then
  null;   -- log NUNCA pode derrubar a operação do campo
end $$;

-- ---------------------------------------------------------------------
-- 5) O JUIZ — é isto que as policies do 02 e do 03 chamam.
--
--    p_ok = true  → passa, sem barulho.
--    p_ok = false → depende do modo:
--       observar → ANOTA e DEIXA PASSAR   (nada muda para o campo)
--       aplicar  → ANOTA e BARRA
--                  (com erro_visivel='sim' levanta exceção com texto
--                   em português; com 'nao' devolve false e o PostgREST
--                   simplesmente não grava)
--
--    ATENÇÃO: nunca usar em policy de SELECT (levantaria exceção no
--    meio de uma listagem). Nas policies de SELECT a regra é escrita
--    direto, sem fpv_check.
-- ---------------------------------------------------------------------
create or replace function fpv_check(
  p_tabela text, p_acao text, p_ok boolean, p_motivo text default null, p_ref text default null
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(p_ok, false) then return true; end if;

  if fpv_modo() <> 'aplicar' then
    perform fpv_registra_bloqueio(p_tabela, p_acao, coalesce(p_motivo,'regra nova'), p_ref, 'observado');
    return true;                       -- MODO TRANSIÇÃO: passa igual
  end if;

  perform fpv_registra_bloqueio(p_tabela, p_acao, coalesce(p_motivo,'regra nova'), p_ref, 'bloqueado');

  if fpv_erro_visivel() then
    raise exception
      'FPV: seu acesso (%) não permite % em %. Fale com a gestão.',
      coalesce(nullif(app_papel(),''),'desconhecido'), p_acao, p_tabela
      using errcode = '42501',
            hint = coalesce(p_motivo, 'regra de perfil');
  end if;

  return false;
end $$;

-- ---------------------------------------------------------------------
-- 6) OS INTERRUPTORES — é só rodar UMA linha no SQL Editor
-- ---------------------------------------------------------------------
create or replace function fpv_seguranca_observar() returns text
language plpgsql security definer set search_path = public
as $$
begin
  update app_seguranca set valor='observar', atualizado_em=now(), atualizado_por=fpv_email() where chave='modo';
  return '🟡 MODO OBSERVAÇÃO: nada é bloqueado; o que a regra barraria fica na seguranca_bloqueio.';
end $$;

create or replace function fpv_seguranca_aplicar() returns text
language plpgsql security definer set search_path = public
as $$
begin
  update app_seguranca set valor='aplicar', atualizado_em=now(), atualizado_por=fpv_email() where chave='modo';
  return '🔴 MODO APLICAR: as regras de perfil passam a BLOQUEAR de verdade.';
end $$;

-- só a diretoria/gestão pode chamar pela API (e mesmo assim não precisa)
revoke all on function fpv_seguranca_observar() from public, anon, authenticated;
revoke all on function fpv_seguranca_aplicar()  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) OS RELATÓRIOS QUE O RENAN VAI OLHAR NO 3º DIA
-- ---------------------------------------------------------------------

-- (a) resumo: quem bateria na parede, em quê, quantas vezes
create or replace view v_seguranca_resumo as
select email, papel, tabela, acao, motivo,
       count(*) as vezes,
       min(quando) as primeira,
       max(quando) as ultima
from seguranca_bloqueio
group by email, papel, tabela, acao, motivo
order by count(*) desc;

-- (b) só o que aconteceu nos últimos 3 dias (o período de observação)
create or replace view v_seguranca_ultimos3dias as
select quando, email, papel, tabela, acao, motivo, ref, modo
from seguranca_bloqueio
where quando > now() - interval '3 days'
order by quando desc;

-- VIEW não herda RLS da tabela de baixo (roda com o dono, que é o
-- postgres). Sem isto, qualquer login leria o caderno inteiro pela API —
-- e ele tem e-mail e papel de todo mundo. Estes relatórios são para o
-- SQL Editor do Renan, não para o app.
revoke all on v_seguranca_resumo       from anon, authenticated;
revoke all on v_seguranca_ultimos3dias from anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) CONFERÊNCIA
-- ---------------------------------------------------------------------
select
  (select valor from app_seguranca where chave='modo')          as modo_atual,
  (select valor from app_seguranca where chave='erro_visivel')  as erro_visivel,
  (select count(*) from seguranca_bloqueio)                     as anotacoes,
  (select case when exists (select 1 from pg_proc where proname='fpv_check')
     then 'OK' else 'FALTOU' end)                               as juiz_fpv_check;

-- =====================================================================
-- MANUAL DE USO (o passo a passo do Renan)
-- =====================================================================
-- DIA 0  — rodar 01, 04, 02, 03 (nesta ordem). Modo nasce 'observar':
--          NADA muda para as 23 pessoas. Avisar ninguém é o certo aqui,
--          justamente porque não muda nada.
--
-- DIA 1..3 — deixar rodar o expediente normal (incluindo um fechamento
--          de semana e um dia de almoxarifado cheio). Olhar 1x/dia:
--              select * from v_seguranca_resumo;
--
--          Como ler:
--          · linha do JOÃO em os_campo/update → conferir: ele só pode
--            mexer em status/serviço/materiais. Se aparecer outra coluna,
--            é fluxo real que eu não mapeei → AJUSTAR A REGRA no 02.
--          · linha de EQUIPE em O.S. que não é dela → normalmente é a
--            fusão de fictícia com nº oficial; o 02 já libera as colunas
--            da fusão. Se o motivo for outro, ajustar.
--          · linha de alguém em 'desconhecido' → é login sem cadastro:
--                select * from fpv_usuarios_sem_papel();
--            cadastrar na app_usuario ANTES de apertar.
--
-- DIA 3  — se v_seguranca_resumo estiver vazia (ou só com coisas que
--          REALMENTE não deveriam acontecer), apertar:
--              select fpv_seguranca_aplicar();
--          Efeito é IMEDIATO e não precisa de deploy do app.
--
-- DEU RUIM? Voltar em 1 comando, sem deploy, sem migration, sem reiniciar
-- nada — o app nem percebe:
--              select fpv_seguranca_observar();
--
-- Quer barrar em silêncio em vez de mostrar erro na tela?
--              update app_seguranca set valor='nao' where chave='erro_visivel';
--          (não recomendado: some com o aviso e o campo acha que salvou)
-- =====================================================================

-- =====================================================================
-- ROLLBACK deste arquivo:
-- =====================================================================
-- ATENÇÃO: só rodar DEPOIS do rollback do 02 e do 03 — as policies deles
-- chamam fpv_check(); derrubar a função antes deixa as tabelas sem
-- conseguir gravar. Se precisar de emergência, o correto é:
--     select fpv_seguranca_observar();   -- resolve 99% dos casos
--
-- drop view if exists v_seguranca_ultimos3dias;
-- drop view if exists v_seguranca_resumo;
-- drop function if exists fpv_seguranca_aplicar();
-- drop function if exists fpv_seguranca_observar();
-- drop function if exists fpv_check(text,text,boolean,text,text);
-- drop function if exists fpv_registra_bloqueio(text,text,text,text,text);
-- drop function if exists fpv_erro_visivel();
-- drop function if exists fpv_modo();
-- drop table if exists seguranca_bloqueio;
-- drop table if exists app_seguranca;
-- =====================================================================
