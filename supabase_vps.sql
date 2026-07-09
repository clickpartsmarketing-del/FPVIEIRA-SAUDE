-- =====================================================================
-- FPV CAMPO × VPS — rodar DEPOIS do supabase.sql, no SQL Editor do
-- Supabase self-hosted (Studio) ou psql direto no container db.
--
-- Move a contagem FICTÍCIA para o banco: app e n8n (fluxo de voz do
-- WhatsApp) compartilham a MESMA sequência F-77+ sem risco de colisão.
-- =====================================================================

-- garante as colunas (caso a tabela tenha sido criada na versão antiga)
alter table os_campo add column if not exists numero_fict int;
alter table os_campo add column if not exists fict_ref text;

-- sequência oficial da contagem fictícia (continua a do almoxarifado)
create sequence if not exists seq_fict start with 77;

-- se já existirem O.S. F-nn gravadas, alinhar a sequência:
select setval('seq_fict', greatest(coalesce((select max(numero_fict) from os_campo), 76), 76));

-- trigger: toda O.S. inserida SEM nº oficial e SEM nº fictício
-- recebe o próximo F automaticamente (vale p/ app E p/ n8n)
create or replace function fpv_atribui_fict() returns trigger as $$
begin
  if new.numero is null and new.numero_fict is null and new.fict_ref is null then
    new.numero_fict := nextval('seq_fict');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_fict on os_campo;
create trigger trg_fict before insert on os_campo
  for each row execute function fpv_atribui_fict();

-- =====================================================================
-- ACESSO DO N8N (mesma VPS) — duas opções, escolha UMA:
--
-- A) Postgres direto (mais simples se n8n e supabase estão no mesmo
--    docker network): credencial Postgres no n8n com
--    host: db (ou IP do container) · port: 5432 · db: postgres
--    user: postgres · senha: POSTGRES_PASSWORD do .env do Supabase
--    → nó "Postgres" com INSERT INTO os_campo (...)
--
-- B) REST (PostgREST via Kong): HTTP Request para
--    http://SEU-SUPABASE:8000/rest/v1/os_campo
--    headers: apikey + Authorization: Bearer SERVICE_ROLE_KEY
--    (service_role ignora RLS — manter essa chave SÓ no n8n, nunca no app)
-- =====================================================================
