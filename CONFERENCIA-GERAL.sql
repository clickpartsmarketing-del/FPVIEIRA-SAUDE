-- =====================================================================
-- FPV CAMPO — CONFERÊNCIA GERAL DO BANCO (app v38 · 07/07/2026)
-- SÓ LEITURA: não cria, não altera e não apaga NADA. Rode quantas
-- vezes quiser. Cole inteiro no SQL Editor do Supabase e rode.
--
-- Resultado: uma linha por verificação. Se algo estiver faltando,
-- a linha "❌ FALTOU" aparece NO TOPO da lista — manda o print.
-- Cobre também tudo do AUDITORIA-CORRECOES-2026-07-07.sql.
--
-- Única coisa que SQL não enxerga: a Edge Function "transcrever"
-- (conferir no painel > Edge Functions) — voz desligada, sem pressa.
-- =====================================================================
with c(grupo, item, ok) as (

  -- ============ 1) TABELAS ============
  select '1 TABELAS', 'os_campo (O.S.)',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='os_campo')
  union all select '1 TABELAS', 'saida_material',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='saida_material')
  union all select '1 TABELAS', 'estoque_item',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='estoque_item')
  union all select '1 TABELAS', 'entrada_material',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='entrada_material')
  union all select '1 TABELAS', 'ferramenta',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='ferramenta')
  union all select '1 TABELAS', 'solicitacao_material',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='solicitacao_material')
  union all select '1 TABELAS', 'apelido_material (autocomplete REV002)',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='apelido_material')
  union all select '1 TABELAS', 'os_campo_log (livro-razão)',
    exists(select 1 from information_schema.tables where table_schema='public' and table_name='os_campo_log')

  -- ============ 2) COLUNAS DA O.S. (auditoria-correções) ============
  union all select '2 COLUNAS O.S.', 'area (disciplina EMOP)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='area')
  union all select '2 COLUNAS O.S.', 'solicitado (o que o fiscal pediu)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='solicitado')
  union all select '2 COLUNAS O.S.', 'tipo (Emergencial/Corretiva/Preventiva)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='tipo')
  union all select '2 COLUNAS O.S.', 'fict_ref (numeração L/M/G/C)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='fict_ref')
  union all select '2 COLUNAS O.S.', 'numero_fict (legado F-nn)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='numero_fict')
  union all select '2 COLUNAS O.S.', 'excluida (soft delete, número preservado)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='excluida')
  union all select '2 COLUNAS O.S.', 'prioridade (P1-P3 da gestão)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='os_campo' and column_name='prioridade')

  -- ============ 3) COLUNAS DO ALMOXARIFADO ============
  union all select '3 COLUNAS ALMOX', 'saída: vínculo O.S./escola/origem (3 colunas)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='saida_material' and column_name in ('os_ref','escola','origem')) = 3
  union all select '3 COLUNAS ALMOX', 'saída: confirmação de recebimento (obs/destinatario/recebido)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='saida_material' and column_name in ('obs','destinatario','recebido')) = 3
  union all select '3 COLUNAS ALMOX', 'estoque: categoria/unidade/qtd_minima/saldo_inicial (4 colunas)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='estoque_item' and column_name in ('categoria','unidade','qtd_minima','saldo_inicial')) = 4
  union all select '3 COLUNAS ALMOX', 'entrada: nf_url (foto da nota fiscal)',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='entrada_material' and column_name='nf_url')
  union all select '3 COLUNAS ALMOX', 'ferramenta: rastreio status/com_quem/obra/desde/obs (5 colunas)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='ferramenta' and column_name in ('status','com_quem','obra','desde','obs')) = 5
  union all select '3 COLUNAS ALMOX', 'pedido: solicitante/os_ref/itens/status (4 colunas)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='solicitacao_material' and column_name in ('solicitante','os_ref','itens','status')) = 4

  -- ============ 4) NUMERAÇÃO E GATILHOS ============
  union all select '4 NUMERAÇÃO', 'sequência seq_fict existe',
    exists(select 1 from pg_sequences where schemaname='public' and sequencename='seq_fict')
  union all select '4 NUMERAÇÃO', 'trigger trg_fict na os_campo (F-nn automático)',
    exists(select 1 from pg_trigger t join pg_class cl on cl.oid=t.tgrelid where t.tgname='trg_fict' and cl.relname='os_campo')
  union all select '4 NUMERAÇÃO', 'função respeita L/M/G/C (guarda fict_ref no fpv_atribui_fict)',
    exists(select 1 from pg_proc where proname='fpv_atribui_fict' and prosrc like '%fict_ref%')
  union all select '4 NUMERAÇÃO', 'índice único ux_os_fict_ref (L01 nunca duplica)',
    exists(select 1 from pg_indexes where schemaname='public' and indexname='ux_os_fict_ref')
  union all select '4 NUMERAÇÃO', 'trava prioridade 1..3 (constraint os_campo_prioridade_1_3)',
    exists(select 1 from pg_constraint where conname='os_campo_prioridade_1_3')
  union all select '4 NUMERAÇÃO', 'trigger trg_fpv_log_os (livro-razão grava edição/exclusão)',
    exists(select 1 from pg_trigger t join pg_class cl on cl.oid=t.tgrelid where t.tgname='trg_fpv_log_os' and cl.relname='os_campo')

  -- ============ 5) SEGURANÇA (RLS) ============
  union all select '5 SEGURANÇA', 'os_campo: RLS ligado',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='os_campo'), false)
  union all select '5 SEGURANÇA', 'os_campo: ler/criar/editar só logados (3 policies)',
    (select count(*) from pg_policies where schemaname='public' and tablename='os_campo' and policyname in ('fpv_autenticados_select','fpv_autenticados_insert','fpv_autenticados_update')) = 3
  union all select '5 SEGURANÇA', 'os_campo: DELETE só gestores (fpv_gestores_delete)',
    exists(select 1 from pg_policies where schemaname='public' and tablename='os_campo' and policyname='fpv_gestores_delete')
  union all select '5 SEGURANÇA', 'os_campo: delete ABERTO removido (fpv_autenticados_delete fora)',
    not exists(select 1 from pg_policies where schemaname='public' and tablename='os_campo' and policyname='fpv_autenticados_delete')
  union all select '5 SEGURANÇA', 'os_campo: renan@fpv.app entre os gestores do delete',
    exists(select 1 from pg_policies where schemaname='public' and tablename='os_campo' and policyname='fpv_gestores_delete' and qual like '%renan@fpv.app%')
  union all select '5 SEGURANÇA', 'saida_material: RLS ligado',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='saida_material'), false)
  union all select '5 SEGURANÇA', 'saida_material: ler/criar/editar só logados (3 policies)',
    (select count(*) from pg_policies where schemaname='public' and tablename='saida_material' and policyname in ('almox_select','almox_insert','almox_update')) = 3
  union all select '5 SEGURANÇA', 'saida_material: DELETE restrito (almox_delete_restrito)',
    exists(select 1 from pg_policies where schemaname='public' and tablename='saida_material' and policyname='almox_delete_restrito')
  union all select '5 SEGURANÇA', 'saida_material: delete ABERTO removido (almox_delete fora)',
    not exists(select 1 from pg_policies where schemaname='public' and tablename='saida_material' and policyname='almox_delete')
  union all select '5 SEGURANÇA', 'saida_material: renan@fpv.app no delete restrito',
    exists(select 1 from pg_policies where schemaname='public' and tablename='saida_material' and policyname='almox_delete_restrito' and qual like '%renan@fpv.app%')
  union all select '5 SEGURANÇA', 'estoque_item: RLS + 4 policies',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='estoque_item'), false)
    and (select count(*) from pg_policies where schemaname='public' and tablename='estoque_item') >= 4
  union all select '5 SEGURANÇA', 'entrada_material: RLS + 4 policies',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='entrada_material'), false)
    and (select count(*) from pg_policies where schemaname='public' and tablename='entrada_material') >= 4
  union all select '5 SEGURANÇA', 'ferramenta: RLS + 4 policies',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='ferramenta'), false)
    and (select count(*) from pg_policies where schemaname='public' and tablename='ferramenta') >= 4
  union all select '5 SEGURANÇA', 'solicitacao_material: RLS + 4 policies',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='solicitacao_material'), false)
    and (select count(*) from pg_policies where schemaname='public' and tablename='solicitacao_material') >= 4
  union all select '5 SEGURANÇA', 'apelido_material: RLS + 3 policies (auditoria-correções)',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='apelido_material'), false)
    and (select count(*) from pg_policies where schemaname='public' and tablename='apelido_material' and policyname in ('apelido_select','apelido_insert','apelido_update')) = 3
  union all select '5 SEGURANÇA', 'os_campo_log: só leitura pela API (nenhuma policy de escrita)',
    coalesce((select cl.relrowsecurity from pg_class cl join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and cl.relname='os_campo_log'), false)
    and exists(select 1 from pg_policies where schemaname='public' and tablename='os_campo_log' and policyname='log_select')
    and not exists(select 1 from pg_policies where schemaname='public' and tablename='os_campo_log' and cmd <> 'SELECT')

  -- ============ 6) TEMPO REAL (pinga na tela sem recarregar) ============
  union all select '6 TEMPO REAL', 'os_campo na publicação realtime',
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='os_campo')
  union all select '6 TEMPO REAL', 'saida_material na publicação realtime',
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='saida_material')
  union all select '6 TEMPO REAL', 'solicitacao_material na publicação realtime',
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='solicitacao_material')
  union all select '6 TEMPO REAL', 'estoque_item na publicação realtime',
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='estoque_item')
  union all select '6 TEMPO REAL', 'entrada_material na publicação realtime',
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='entrada_material')
  union all select '6 TEMPO REAL', 'ferramenta na publicação realtime',
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ferramenta')

  -- ============ 7) FOTOS (Storage) ============
  union all select '7 FOTOS', 'bucket fotos-os existe e é público (leitura das fotos)',
    exists(select 1 from storage.buckets where id='fotos-os' and public)
  union all select '7 FOTOS', 'upload só logado (fpv_fotos_upload)',
    exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='fpv_fotos_upload')
  union all select '7 FOTOS', 'leitura pública das fotos (fpv_fotos_leitura)',
    exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='fpv_fotos_leitura')

  -- ============ 8) LOGINS (10 usuários) ============
  union all select '8 LOGINS', 'renan@fpv.app (gestor — criado 07/07)',
    exists(select 1 from auth.users where email='renan@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'lucas@fpv.app (gestor geral)',
    exists(select 1 from auth.users where email='lucas@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'rafael@fpv.app (gestor)',
    exists(select 1 from auth.users where email='rafael@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'leony@fpv.app (engenheiro Saude)',
    exists(select 1 from auth.users where email='leony@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'edmar@fpv.app (medição)',
    exists(select 1 from auth.users where email='edmar@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'thiago@fpv.app (almoxarifado - Thiago Rafael)',
    exists(select 1 from auth.users where email='thiago@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'emiliano@fpv.app (encarregado E - Emiliano)',
    exists(select 1 from auth.users where email='emiliano@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'brendah@fpv.app (assistente - Brendah)',
    exists(select 1 from auth.users where email='brendah@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'neilson@fpv.app (eletricista N - Neilson)',
    exists(select 1 from auth.users where email='neilson@fpv.app' and email_confirmed_at is not null)
  union all select '8 LOGINS', 'queiroz@fpv.app (eletricista Q - Queiroz)',
    exists(select 1 from auth.users where email='queiroz@fpv.app' and email_confirmed_at is not null)

  -- ============ 9) DADOS VIVOS (sanidade) ============
  union all select '9 DADOS', 'os_campo: ' || (select count(*) from os_campo) || ' O.S. no banco',
    (select count(*) from os_campo) > 0
  union all select '9 DADOS', 'saida_material: ' || (select count(*) from saida_material) || ' saídas registradas',
    (select count(*) from saida_material) > 0
  union all select '9 DADOS', 'estoque_item: ' || (select count(*) from estoque_item) || ' itens no catálogo',
    (select count(*) from estoque_item) > 0
  union all select '9 DADOS', 'ferramenta: ' || (select count(*) from ferramenta) || ' ferramentas rastreadas',
    (select count(*) from ferramenta) > 0
)
select
  case when ok then '✅ OK' else '❌ FALTOU' end as situacao,
  grupo,
  item
from c
order by ok, grupo, item;
