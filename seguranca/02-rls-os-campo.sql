-- =====================================================================
-- FPV CAMPO — SEGURANÇA · ARQUIVO 02 de 04 · RLS DA O.S. DE CAMPO
-- Fecha o achado CRÍTICO 1 na tabela que É a medição (os_campo, ~2000
-- linhas, dinheiro real). Prova do problema: o token do joao@fpv.app
-- (almoxarife) conseguiu dar PATCH na O.S. 882 e DELETE passou.
--
-- ORDEM DE APLICAÇÃO:  01 → 04 → 02 → 03
-- Este arquivo entra em MODO OBSERVAÇÃO (definido no 04): no dia da
-- aplicação NADA é bloqueado — só anotado. Ver 04-modo-transicao.sql.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- TRAVA DE ORDEM: erro claro em vez de meia aplicação
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'fpv_check') then
    raise exception 'Rode ANTES o 01-papeis.sql e o 04-modo-transicao.sql (nesta ordem). Nada foi alterado.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 0) COLUNAS QUE O APP JÁ GRAVA MAS PODEM NÃO EXISTIR NO BANCO
--    (o ListaOS.tsx grava par_sugerido/oficializada_em na oficialização
--     e o osService grava geo). Se faltar, o gatilho do item 3 não teria
--     como comparar. Aditivo e idempotente — não mexe em dado nenhum.
-- ---------------------------------------------------------------------
alter table os_campo add column if not exists par_sugerido    text;
alter table os_campo add column if not exists oficializada_em timestamptz;
alter table os_campo add column if not exists geo             text;

-- ---------------------------------------------------------------------
-- 1) AS DUAS PERGUNTAS QUE TODA REGRA DE O.S. FAZ
-- ---------------------------------------------------------------------

-- (a) esse nome de executor/fiscal é um dos MEUS? (tolerante a espaço
--     e caixa — o campo digita "Gilson " com espaço no fim)
create or replace function fpv_nome_bate(p_nome text, p_lista text[])
returns boolean language sql immutable
as $$
  select exists (
    select 1 from unnest(coalesce(p_lista, '{}'::text[])) a
    where lower(btrim(a)) = lower(btrim(coalesce(p_nome, '')))
      and btrim(coalesce(p_nome,'')) <> ''
  )
$$;

-- (b) essa O.S. é MINHA?
--     encarregado → sou o EXECUTOR   (Gilson vê/edita as do Gilson)
--     equipe emerg.→ é a minha ZONA  (equipe 1 = fiscal Wellington)
--     qualquer um  → eu que criei    (criado_por = meu uid)
--     sem executor → ainda não é de ninguém: quem está com ela na mão
--                    completa (é assim que o campo trabalha hoje)
create or replace function fpv_os_minha(p_executor text, p_fiscal text, p_criado_por uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select
       btrim(coalesce(p_executor,'')) = ''
    or fpv_nome_bate(p_executor, app_executores())
    or fpv_nome_bate(p_fiscal,   app_fiscais())
    or (p_criado_por is not null and p_criado_por = auth.uid())
$$;

-- ---------------------------------------------------------------------
-- 2) POLICIES — o que cada perfil faz com a O.S.
--
--    LER      todo mundo lê TUDO. Regra do Renan (10/07, caso do Gilson
--             com a O.S. no papel que "não existia"): veterano troca
--             serviço e precisa achar O.S. de qualquer equipe. NÃO mexer.
--    CRIAR    gestão, cadastro (Brendah) e campo. O almoxarife NÃO abre
--             O.S. de campo — ele não tem nem a aba.
--    ALTERAR  regra por LINHA aqui (medição fechada é intocável) e regra
--             por COLUNA no gatilho do item 3 (é lá que dá para comparar
--             o antes com o depois).
--    APAGAR   NINGUÉM. Exclusão no FPV é lógica (excluida=true) desde
--             06/07 — o número fica ocupado para sempre no livro-razão.
-- ---------------------------------------------------------------------
alter table os_campo enable row level security;

-- limpa TODAS as versões antigas (senão a policy velha 'using(true)'
-- continua valendo em paralelo — policies permissivas se SOMAM)
drop policy if exists "fpv_autenticados_select" on os_campo;
drop policy if exists "fpv_autenticados_insert" on os_campo;
drop policy if exists "fpv_autenticados_update" on os_campo;
drop policy if exists "fpv_autenticados_delete" on os_campo;
drop policy if exists "fpv_gestores_delete"     on os_campo;
drop policy if exists "os_campo_select"         on os_campo;
drop policy if exists "os_campo_insert"         on os_campo;
drop policy if exists "os_campo_update"         on os_campo;

-- LER: aberto para quem está logado (decisão de operação, não descuido)
create policy "os_campo_select" on os_campo
  for select to authenticated
  using (true);

-- CRIAR
--   CORREÇÃO 28/07 (verificação adversarial): a versão anterior negava
--   INSERT para o almoxarife inteiro — e isso QUEBRARIA O BALCÃO. O João
--   abre O.S. EMERGENCIAL no balcão hoje (AlmoxOS.tsx:262-281, toggle
--   gerarOS) quando o material sai às 22h e não existe O.S. ainda; foi
--   justamente para isso que a função foi feita. Ele segue sem poder
--   abrir corretiva/preventiva — só a emergencial do balcão.
create policy "os_campo_insert" on os_campo
  for insert to authenticated
  with check (
    fpv_check(
      'os_campo', 'insert',
      (select app_papel()) <> 'almox'
        or coalesce(emergencial, false)
        or btrim(coalesce(tipo, '')) = 'Emergencial',
      'almoxarife só abre O.S. emergencial (balcão)',
      coalesce(numero::text, fict_ref, 'S/N')
    )
  );

-- ALTERAR (regra de LINHA — o que dá para decidir olhando só o "antes")
--   MEDIÇÃO FECHADA = INTOCÁVEL. Se a O.S. já está numa medição que não
--   é a vigente, ela virou fatura: só gestão corrige. É a mesma regra
--   que a tela já mostra (NovaOS.tsx:150) — a diferença é que agora ela
--   vale também para quem chamar a API por fora.
create policy "os_campo_update" on os_campo
  for update to authenticated
  using (
    fpv_check(
      'os_campo', 'update',
      (select app_eh_gestao()) or (select app_eh_servico())
        or btrim(coalesce(medicao,'')) = ''
        or medicao = fpv_med_vigente(),
      'O.S. em medição fechada — só a gestão altera',
      coalesce(numero::text, fict_ref, 'F-'||numero_fict::text, 'S/N')
    )
  )
  with check (true);   -- o "depois" é conferido coluna a coluna no gatilho

-- APAGAR: nenhuma policy + revogação do privilégio na tabela.
-- Dois cadeados de propósito: sem policy o PostgREST devolve 0 linhas
-- (falha silenciosa); sem o GRANT ele devolve 403 com mensagem.
-- O app NUNCA usa delete físico (osService.excluir faz soft delete).
revoke delete on table os_campo from authenticated;
revoke delete on table os_campo from anon;

-- ---------------------------------------------------------------------
-- 3) O GATILHO DE COLUNA — o coração da regra
--
--    Por que gatilho e não policy: uma policy enxerga a linha ANTES
--    (using) ou DEPOIS (with check), nunca as duas juntas. "O João pode
--    mudar o serviço mas não o número" é uma comparação antes×depois —
--    só o gatilho consegue. E ele roda em QUALQUER caminho de escrita
--    (app, REST, curl com token roubado): não tem como desviar.
--
--    Bônus: o gatilho compara VALOR, não presença no JSON. O app manda a
--    linha inteira em toda edição (osService.salvar) — sem comparar
--    valor, toda edição pareceria mexer em tudo.
--
--    QUEM PODE O QUÊ:
--    gestão/diretoria  tudo
--    serviço (n8n)     tudo (não pode quebrar a integração)
--    cadastro/Brendah  tudo, MENOS excluir e priorizar
--    almoxarife/João   SÓ status, serviço e materiais (o balcão)
--    campo             O.S. dele: tudo menos prioridade; excluir só na
--                      oficialização (fictícia que virou nº oficial)
--                      O.S. dos outros: só as colunas da FUSÃO
--                      (é o fluxo "chegou o nº oficial por e-mail" do
--                       ListaOS.tsx:256, que hoje qualquer login usa)
-- ---------------------------------------------------------------------
create or replace function fpv_guarda_os_campo() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  p          text;
  mudou      text[] := '{}';
  proibidas  text[] := '{}';
  permitidas text[];
  minha      boolean;
  oficializando boolean;
  ref        text;
  msg        text;
begin
  -- processo interno (SQL Editor, service_role/n8n, migrations): passa
  if current_user in ('postgres','supabase_admin','supabase_auth_admin','service_role') then
    return new;
  end if;
  if fpv_email() = '' then return new; end if;

  p := app_papel();
  if p in ('diretoria','gestao','servico') then return new; end if;

  ref := coalesce(new.numero::text, new.fict_ref, 'F-'||new.numero_fict::text, 'S/N');

  -- ---- o que mudou de verdade (valor, não payload) ----
  if coalesce(new.numero,-1)        is distinct from coalesce(old.numero,-1)        then mudou := mudou || 'numero'; end if;
  if coalesce(new.numero_fict,-1)   is distinct from coalesce(old.numero_fict,-1)   then mudou := mudou || 'numero_fict'; end if;
  if btrim(coalesce(new.fict_ref,''))       is distinct from btrim(coalesce(old.fict_ref,''))       then mudou := mudou || 'fict_ref'; end if;
  if new.emergencial                is distinct from old.emergencial                then mudou := mudou || 'emergencial'; end if;
  if btrim(coalesce(new.tipo,''))           is distinct from btrim(coalesce(old.tipo,''))           then mudou := mudou || 'tipo'; end if;
  if btrim(coalesce(new.unidade,''))        is distinct from btrim(coalesce(old.unidade,''))        then mudou := mudou || 'unidade'; end if;
  if btrim(coalesce(new.fiscal,''))         is distinct from btrim(coalesce(old.fiscal,''))         then mudou := mudou || 'fiscal'; end if;
  if btrim(coalesce(new.classificacao,''))  is distinct from btrim(coalesce(old.classificacao,''))  then mudou := mudou || 'classificacao'; end if;
  if new.entrada                    is distinct from old.entrada                    then mudou := mudou || 'entrada'; end if;
  if new.conclusao                  is distinct from old.conclusao                  then mudou := mudou || 'conclusao'; end if;
  if btrim(coalesce(new.executor,''))       is distinct from btrim(coalesce(old.executor,''))       then mudou := mudou || 'executor'; end if;
  if btrim(coalesce(new.status,''))         is distinct from btrim(coalesce(old.status,''))         then mudou := mudou || 'status'; end if;
  if btrim(coalesce(new.medicao,''))        is distinct from btrim(coalesce(old.medicao,''))        then mudou := mudou || 'medicao'; end if;
  if btrim(coalesce(new.area,''))           is distinct from btrim(coalesce(old.area,''))           then mudou := mudou || 'area'; end if;
  if btrim(coalesce(new.solicitado,''))     is distinct from btrim(coalesce(old.solicitado,''))     then mudou := mudou || 'solicitado'; end if;
  if btrim(coalesce(new.servico,''))        is distinct from btrim(coalesce(old.servico,''))        then mudou := mudou || 'servico'; end if;
  if btrim(coalesce(new.materiais,''))      is distinct from btrim(coalesce(old.materiais,''))      then mudou := mudou || 'materiais'; end if;
  if btrim(coalesce(new.memoria_calculo,'')) is distinct from btrim(coalesce(old.memoria_calculo,'')) then mudou := mudou || 'memoria_calculo'; end if;
  if coalesce(new.foto_urls,'{}')   is distinct from coalesce(old.foto_urls,'{}')   then mudou := mudou || 'foto_urls'; end if;
  if coalesce(new.assinado,false)   is distinct from coalesce(old.assinado,false)   then mudou := mudou || 'assinado'; end if;
  if coalesce(new.excluida,false)   is distinct from coalesce(old.excluida,false)   then mudou := mudou || 'excluida'; end if;
  if coalesce(new.prioridade,0)     is distinct from coalesce(old.prioridade,0)     then mudou := mudou || 'prioridade'; end if;
  if btrim(coalesce(new.par_sugerido,''))   is distinct from btrim(coalesce(old.par_sugerido,''))   then mudou := mudou || 'par_sugerido'; end if;
  if new.oficializada_em            is distinct from old.oficializada_em            then mudou := mudou || 'oficializada_em'; end if;
  if btrim(coalesce(new.geo,''))            is distinct from btrim(coalesce(old.geo,''))            then mudou := mudou || 'geo'; end if;
  if new.criado_por                 is distinct from old.criado_por                 then mudou := mudou || 'criado_por'; end if;
  if new.criado_em                  is distinct from old.criado_em                  then mudou := mudou || 'criado_em'; end if;

  if array_length(mudou,1) is null then return new; end if;   -- salvou sem mudar nada

  -- ---- o conjunto permitido para este perfil ----
  if p = 'almox' then
    -- o balcão: o João anota o que saiu e destrava a O.S., nada além
    permitidas := array['status','servico','materiais'];

  elsif p = 'cadastro' then
    -- a esteira da Brendah: corrige tudo, menos o que é decisão de gestão
    permitidas := array['numero','numero_fict','fict_ref','emergencial','tipo','unidade','fiscal',
                        'classificacao','entrada','conclusao','executor','status','medicao','area',
                        'solicitado','servico','materiais','memoria_calculo','foto_urls','assinado',
                        'geo','par_sugerido','oficializada_em'];

  else
    -- campo (e login sem papel cadastrado: entra no mais restrito)
    minha := fpv_os_minha(old.executor, old.fiscal, old.criado_por);
    -- oficialização = a fictícia recebeu o nº oficial e vira marca:
    -- é o único caminho em que o campo encosta em 'excluida'
    oficializando := btrim(coalesce(new.par_sugerido,'')) is distinct from btrim(coalesce(old.par_sugerido,''))
                     and coalesce(new.excluida,false);
    if minha then
      permitidas := array['numero','fict_ref','emergencial','tipo','unidade','fiscal','classificacao',
                          'entrada','conclusao','executor','status','medicao','area','solicitado',
                          'servico','materiais','memoria_calculo','foto_urls','assinado',
                          'geo','par_sugerido','oficializada_em'];
      if oficializando then permitidas := permitidas || 'excluida'; end if;
    else
      -- O.S. de outra equipe: só o que a FUSÃO fictícia→oficial precisa
      -- (ListaOS.tsx:256 — "chegou o nº oficial por e-mail"). A oficial
      -- herda memória, fotos e material; ninguém reescreve escola/nº.
      -- CORREÇÃO 28/07 (verificação adversarial): faltavam 'servico',
      -- 'geo', 'solicitado', 'assinado' e 'numero' — e sem elas a BUSCA
      -- ABERTA (decisão Renan 10/07) quebrava: o Gilson acha a O.S. de
      -- outra equipe, escreve o serviço executado e toma 42501. Pior:
      -- NovaOS.tsx:215 manda 'geo' em TODA gravação, então qualquer
      -- salvamento numa O.S. de outro seria barrado mesmo sem mexer em
      -- nada. Fica de fora o que ninguém de fora pode reescrever:
      -- unidade, fiscal, entrada, classificação, tipo, medição,
      -- excluída e prioridade.
      permitidas := array['memoria_calculo','foto_urls','materiais','executor','status','conclusao',
                          'par_sugerido','oficializada_em',
                          'servico','geo','solicitado','assinado','numero'];
    end if;
  end if;

  -- P1..P3 é despacho: Nicolas, Renan e Lucas (RV000)
  if app_pode_priorizar() then permitidas := permitidas || 'prioridade'; end if;

  -- ---- veredito ----
  select coalesce(array_agg(c), '{}'::text[]) into proibidas
  from unnest(mudou) c where not (c = any(permitidas));

  if array_length(proibidas,1) is null then return new; end if;

  msg := 'perfil ' || p || ' não altera: ' || array_to_string(proibidas, ', ');

  if fpv_modo() <> 'aplicar' then
    perform fpv_registra_bloqueio('os_campo','update', msg, ref, 'observado');
    return new;                                  -- MODO TRANSIÇÃO: passa
  end if;

  perform fpv_registra_bloqueio('os_campo','update', msg, ref, 'bloqueado');

  if fpv_erro_visivel() then
    raise exception 'FPV: você não pode alterar % da O.S. %.', array_to_string(proibidas, ', '), ref
      using errcode = '42501', hint = 'perfil ' || p || ' — fale com a gestão';
  end if;

  return old;   -- barra em silêncio: grava a linha como estava
end $$;

drop trigger if exists trg_fpv_guarda_os on os_campo;
create trigger trg_fpv_guarda_os
  before update on os_campo
  for each row execute function fpv_guarda_os_campo();
-- roda ANTES do trg_fpv_log_os (ordem alfabética: guarda < log), então
-- tentativa barrada não suja o livro-razão.

-- ---------------------------------------------------------------------
-- 4) LIVRO-RAZÃO: quem lê o histórico de edição é a gestão
--    (nenhuma tela do app lê os_campo_log hoje — conferido no código —
--     então fechar aqui não muda nada para o campo)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.os_campo_log') is not null then
    execute 'drop policy if exists "log_select" on os_campo_log';
    execute 'create policy "log_select" on os_campo_log for select to authenticated using ( (select app_eh_gestao()) )';
  else
    raise notice 'os_campo_log ainda não existe — rode o AUDITORIA-EDICOES.sql. O resto deste arquivo foi aplicado.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5) CONFERÊNCIA
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_policies where tablename='os_campo')                       as policies_os_campo,
  (select case when exists (select 1 from pg_policies
     where tablename='os_campo' and cmd='DELETE') then 'AINDA EXISTE' else 'OK (sem delete)' end) as delete_fisico,
  (select case when has_table_privilege('authenticated','os_campo','delete')
     then 'AINDA PODE' else 'OK (revogado)' end)                                      as grant_delete,
  (select case when exists (select 1 from pg_trigger where tgname='trg_fpv_guarda_os')
     then 'OK' else 'FALTOU' end)                                                     as gatilho_coluna,
  (select valor from app_seguranca where chave='modo')                                as modo;

-- =====================================================================
-- COMO TESTAR SEM ARRISCAR (token do João, o caso que a auditoria provou)
-- Com modo='observar' isto AINDA passa — e aparece na seguranca_bloqueio.
-- Com modo='aplicar' o PATCH volta 42501 e o DELETE volta 403.
--
--   curl -X PATCH "$URL/rest/v1/os_campo?id=eq.<ID_DE_TESTE>" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN_JOAO" \
--     -H "Content-Type: application/json" -d '{"unidade":"TESTE RLS"}'
--
--   select * from v_seguranca_ultimos3dias where tabela='os_campo';
-- =====================================================================

-- =====================================================================
-- ROLLBACK deste arquivo (volta ao comportamento de hoje, 100%):
-- =====================================================================
-- ANTES DE TUDO, no susto, tente só isto — resolve sem desfazer nada:
--     select fpv_seguranca_observar();
--
-- Desfazer de verdade:
-- drop trigger if exists trg_fpv_guarda_os on os_campo;
-- drop function if exists fpv_guarda_os_campo();
-- drop policy if exists "os_campo_select" on os_campo;
-- drop policy if exists "os_campo_insert" on os_campo;
-- drop policy if exists "os_campo_update" on os_campo;
-- create policy "fpv_autenticados_select" on os_campo for select to authenticated using (true);
-- create policy "fpv_autenticados_insert" on os_campo for insert to authenticated with check (true);
-- create policy "fpv_autenticados_update" on os_campo for update to authenticated using (true) with check (true);
-- grant delete on table os_campo to authenticated;
-- create policy "fpv_gestores_delete" on os_campo for delete to authenticated
--   using (auth.jwt() ->> 'email' in ('lucas@fpv.app','rafael@fpv.app','nicolas@fpv.app','renan@fpv.app','edmar@fpv.app'));
-- drop policy if exists "log_select" on os_campo_log;
-- create policy "log_select" on os_campo_log for select to authenticated using (true);
-- drop function if exists fpv_os_minha(text,text,uuid);
-- drop function if exists fpv_nome_bate(text,text[]);
-- =====================================================================
