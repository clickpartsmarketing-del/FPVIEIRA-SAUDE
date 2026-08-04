-- Tipo da atividade (Emergencial / Corretiva / Preventiva) — 1 linha só.
-- Sem rodar, o app funciona igual (só não grava o tipo no banco).
alter table os_campo add column if not exists tipo text;
select case when exists (select 1 from information_schema.columns
  where table_name = 'os_campo' and column_name = 'tipo')
  then 'OK' else 'FALTOU' end as coluna_tipo;
