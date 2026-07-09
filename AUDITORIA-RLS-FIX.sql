-- =====================================================================
-- AUDITORIA — CORREÇÃO DE SEGURANÇA NO BANCO (rodar no SQL Editor)
--
-- PROBLEMA: a policy atual permite DELETE para QUALQUER usuário logado.
-- Esconder o botão no app NÃO resolve: qualquer login de encarregado
-- consegue chamar a REST API direto e apagar as ~1.8k O.S. (dado que
-- vira medição = dinheiro). A regra tem que morar no BANCO.
--
-- Idempotente — rodar 2x não quebra.
-- =====================================================================

-- 1) DELETE de O.S. só para a gestão (e-mails dos gestores)
drop policy if exists "fpv_autenticados_delete" on os_campo;
create policy "fpv_gestores_delete" on os_campo
  for delete to authenticated
  using (
    auth.jwt() ->> 'email' in (
      'lucas@fpv.app', 'rafael@fpv.app', 'leony@fpv.app', 'renan@fpv.app', 'edmar@fpv.app'
    )
  );

-- 2) DELETE de saída de material só gestão + almoxarife
drop policy if exists "almox_delete" on saida_material;
create policy "almox_delete_restrito" on saida_material
  for delete to authenticated
  using (
    auth.jwt() ->> 'email' in (
      'lucas@fpv.app', 'rafael@fpv.app', 'leony@fpv.app', 'renan@fpv.app', 'edmar@fpv.app',
      'thiago@fpv.app'
    )
  );

-- 3) CONFERÊNCIA — deve listar as duas policies novas
select policyname, tablename, cmd
from pg_policies
where tablename in ('os_campo', 'saida_material') and cmd = 'DELETE';

-- =====================================================================
-- IMPORTANTE: confirme que os e-mails acima batem com os logins REAIS
-- criados no Authentication > Users. Se usar outro domínio, ajuste.
--
-- PENDÊNCIA (recomendado, não urgente): a Edge Function 'transcrever'
-- deve estar com "Verify JWT" LIGADO no painel (é o padrão). Se estiver
-- desligado, qualquer pessoa na internet queima seu crédito Groq/OpenAI.
-- Confira em: Edge Functions > transcrever > Details > Verify JWT.
-- =====================================================================
