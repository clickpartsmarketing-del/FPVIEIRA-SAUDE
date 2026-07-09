-- =====================================================================
-- FPV CAMPO — banco no Supabase (rodar no SQL Editor, uma vez)
-- Segurança: diferente do app EMATER, aqui NADA é público.
-- Só usuários autenticados (os logins que você criar) acessam.
-- =====================================================================

create table if not exists os_campo (
  id bigint generated always as identity primary key,
  numero int,
  numero_fict int,   -- contagem FICTÍCIA (F-77, F-78…) até sair o nº oficial
  emergencial boolean not null default false,
  unidade text not null,
  fiscal text,
  classificacao text,
  entrada date,
  conclusao date,
  executor text,
  status text not null default 'Executando',
  medicao text,
  area text,
  solicitado text, -- pedido do fiscal/e-mail; serviço executado fica em servico
  servico text,
  materiais text,
  memoria_calculo text,
  foto_urls text[] not null default '{}',
  assinado boolean not null default false,
  tipo text,
  fict_ref text,
  excluida boolean not null default false,
  prioridade int check (prioridade is null or prioridade between 1 and 3),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);


-- Numeração fictícia segura: F-nn legado só entra quando não há número oficial
-- nem referência da equipe (L/M/G/C). O app também calcula, mas o banco fica
-- como trava final contra perda de numeração.
create sequence if not exists seq_fict start with 77;
create unique index if not exists ux_os_fict_ref on os_campo(fict_ref) where fict_ref is not null;

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

alter table os_campo enable row level security;

-- Apenas usuários LOGADOS podem ler/escrever (nada de USING true público!)
create policy "fpv_autenticados_select" on os_campo
  for select to authenticated using (true);
create policy "fpv_autenticados_insert" on os_campo
  for insert to authenticated with check (true);
create policy "fpv_autenticados_update" on os_campo
  for update to authenticated using (true) with check (true);
create policy "fpv_autenticados_delete" on os_campo
  for delete to authenticated using (true);

-- =====================================================================
-- STORAGE (fotos): no painel do Supabase
-- 1. Storage > New Bucket > nome: fotos-os > marcar "Public bucket"
--    (público apenas para LEITURA das imagens na folha de assinatura;
--     o upload continua exigindo login, garantido pelas policies abaixo)
-- 2. Rodar estas policies:
-- =====================================================================

create policy "fpv_fotos_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-os');

create policy "fpv_fotos_leitura" on storage.objects
  for select to public
  using (bucket_id = 'fotos-os');

-- =====================================================================
-- JÁ TINHA RODADO A VERSÃO ANTERIOR? Só rode esta linha:
-- alter table os_campo add column if not exists numero_fict int;
-- =====================================================================

-- =====================================================================
-- USUÁRIOS (criar no painel: Authentication > Users > Add user)
-- Sugestão dos 12 acessos — e-mails podem ser fictícios internos:
--   neilson@fpv.app / leandro@fpv.app / miqueias@fpv.app / queiroz@fpv.app  (encarregados)
--   almox1@fpv.app / almox2@fpv.app                                             (almoxarifado — fase 2)
--   eng1@fpv.app / eng2@fpv.app / eng3@fpv.app                                  (engenharia)
--   rh@fpv.app                                                                  (RH — fase 2)
--   lucas@fpv.app / rafael@fpv.app                                              (admin)
-- Marque "Auto Confirm User" ao criar cada um.
-- =====================================================================
