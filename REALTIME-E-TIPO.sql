-- =====================================================================
-- TEMPO REAL + TIPO DE ATIVIDADE — colar TUDO no SQL Editor e RUN.
-- Idempotente (rodar 2x não quebra).
-- =====================================================================

-- 1) Coluna TIPO (Emergencial / Corretiva / Preventiva) na O.S.
alter table os_campo add column if not exists tipo text;

-- 2) LIGA O TEMPO REAL: as tabelas entram na publicação do Realtime —
--    é isso que faz a tela do João atualizar sozinha quando a equipe
--    pede material, e a Gestão ver a O.S. nova sem apertar ↻
do $$
declare t text;
begin
  foreach t in array array['os_campo','saida_material','solicitacao_material',
                           'estoque_item','entrada_material','ferramenta']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then
      null; -- já estava na publicação
    end;
  end loop;
end $$;

-- 3) CONFERÊNCIA — coluna tipo OK + 6 tabelas na publicação
select
  (select case when exists (select 1 from information_schema.columns
     where table_name = 'os_campo' and column_name = 'tipo')
     then 'OK' else 'FALTOU' end) as coluna_tipo,
  (select count(*) from pg_publication_tables
     where pubname = 'supabase_realtime'
       and tablename in ('os_campo','saida_material','solicitacao_material',
                         'estoque_item','entrada_material','ferramenta')) as tabelas_realtime_deve_ser_6;
