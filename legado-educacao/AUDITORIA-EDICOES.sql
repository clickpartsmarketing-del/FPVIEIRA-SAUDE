-- =====================================================================
-- LIVRO-RAZÃO DAS O.S. (regra Renan 06/07): número FIXO na contagem
-- para sempre; exclusão vira MARCA (nunca apaga); toda edição/exclusão
-- gera linha de log imutável com quem/quando/o que era antes.
-- Colar TUDO no SQL Editor e RUN. Idempotente.
-- =====================================================================

-- 1) marca de exclusão (soft delete) — a linha fica, o número não volta
alter table os_campo add column if not exists excluida boolean not null default false;

-- 2) o LOG imutável
create table if not exists os_campo_log (
  id bigint generated always as identity primary key,
  os_id bigint,
  ref text,                         -- nº oficial, L/M/G/C-nº ou F-nº
  acao text not null,               -- EDITADA | EXCLUIDA | RESTAURADA | EXCLUIDA-FISICA
  por_email text,
  quando timestamptz not null default now(),
  antes jsonb                       -- a linha inteira como era ANTES
);
alter table os_campo_log enable row level security;
drop policy if exists "log_select" on os_campo_log;
create policy "log_select" on os_campo_log for select to authenticated using (true);
-- NENHUMA policy de insert/update/delete: pela API o log é só-leitura
-- para todo mundo (inclusive gestão). Só o trigger escreve.

-- 3) o escrivão: registra ANTES de qualquer update/delete em os_campo
create or replace function fpv_log_os() returns trigger
security definer set search_path = public as $$
declare em text;
begin
  begin
    em := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'sistema');
  exception when others then
    em := 'sistema';
  end;
  if tg_op = 'DELETE' then
    insert into os_campo_log(os_id, ref, acao, por_email, antes)
    values (old.id,
            coalesce(old.numero::text, old.fict_ref, 'F-'||old.numero_fict::text, 'S/N'),
            'EXCLUIDA-FISICA', em, to_jsonb(old));
    return old;
  else
    insert into os_campo_log(os_id, ref, acao, por_email, antes)
    values (old.id,
            coalesce(old.numero::text, old.fict_ref, 'F-'||old.numero_fict::text, 'S/N'),
            case when new.excluida and not old.excluida then 'EXCLUIDA'
                 when old.excluida and not new.excluida then 'RESTAURADA'
                 else 'EDITADA' end,
            em, to_jsonb(old));
    return new;
  end if;
end;
$$ language plpgsql;

drop trigger if exists trg_fpv_log_os on os_campo;
create trigger trg_fpv_log_os
  before update or delete on os_campo
  for each row execute function fpv_log_os();

-- 4) CONFERÊNCIA — deve sair: coluna_excluida OK · log OK · trigger OK
select
  (select case when exists (select 1 from information_schema.columns
     where table_name='os_campo' and column_name='excluida') then 'OK' else 'FALTOU' end) as coluna_excluida,
  (select case when exists (select 1 from information_schema.tables
     where table_name='os_campo_log') then 'OK' else 'FALTOU' end) as tabela_log,
  (select case when exists (select 1 from pg_trigger
     where tgname='trg_fpv_log_os') then 'OK' else 'FALTOU' end) as trigger_log;
