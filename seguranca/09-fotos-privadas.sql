-- =====================================================================
-- 09 — FOTOS PRIVADAS  (achado ALTO: bucket "fotos-os" PÚBLICO)
-- Confirmado empiricamente: foto de 3 MB abriu por URL, sem login.
--
-- CONTEXTO QUE MANDA NA ORDEM DAS COISAS:
--   as fotos são EVIDÊNCIA CONTRATUAL de medição já entregue.
--   Fechar o bucket ANTES do app saber gerar URL assinada = folha de
--   assinatura e Fechamento Semanal com imagem quebrada NO MEIO DA
--   MEDIÇÃO. Por isso este arquivo tem 3 ETAPAS e a etapa que fecha
--   o bucket é a ÚLTIMA — e só depois do deploy do frontend.
--
-- ORDEM OBRIGATÓRIA:
--   ETAPA 0 (aqui)  → inventário + backup da evidência já entregue
--   ETAPA 1 (aqui)  → coluna foto_paths + backfill  (ADITIVO, não quebra)
--   ---- DEPLOY DO FRONTEND (patches do 10-frontend-PATCHES.md) ----
--   ---- CONFERIR NO CELULAR que as fotos ainda abrem (assinadas) ----
--   ETAPA 2 (aqui)  → fecha o bucket + policy  (o único passo com risco)
--
-- Tudo idempotente. ROLLBACK de cada etapa no fim do arquivo.
-- =====================================================================


-- =====================================================================
-- ETAPA 0 — INVENTÁRIO E BACKUP (rodar HOJE, não muda nada)
-- =====================================================================

-- 0.1 Quantas O.S. dependem de foto e de quantas fotos estamos falando
select
  count(*)                                              as os_com_foto,
  sum(coalesce(array_length(foto_urls, 1), 0))          as total_fotos,
  count(*) filter (where medicao is not null and medicao <> '') as os_ja_medidas
from os_campo
where coalesce(array_length(foto_urls, 1), 0) > 0;

-- 0.2 As URLs são todas do nosso bucket? (se aparecer algo que não seja
--     .../object/public/fotos-os/..., é link de fora — Drive, WhatsApp,
--     n8n — e o resolver do frontend tem que devolver ESSA url intacta)
select
  case
    when u like '%/storage/v1/object/public/fotos-os/%' then 'BUCKET fotos-os'
    when u like 'http%'                                 then 'EXTERNA (deixar como está)'
    else 'CAMINHO CRU (já normalizada)'
  end as tipo,
  count(*)
from os_campo, unnest(foto_urls) as u
group by 1 order by 2 desc;

-- 0.3 !!! BACKUP DA EVIDÊNCIA JÁ ENTREGUE — FAÇA ANTES DA ETAPA 2 !!!
--     Isto NÃO é SQL: é a apólice de seguro. Evidência de medição
--     entregue não pode depender de ACL de bucket nem de token que
--     expira. Baixe as fotos das medições fechadas para uma pasta.
--
--     No Supabase Studio: Storage > fotos-os > selecionar > Download,
--     OU pela CLI (mais confiável, ~1.8k arquivos):
--       supabase storage download --recursive ss://fotos-os ./BACKUP-FOTOS
--     Guarde em: Documents\FP094-EVIDENCIA-FOTOS-<data>\
--     Confira o total de arquivos contra o count da consulta 0.1.


-- =====================================================================
-- ETAPA 1 — foto_paths: guardar o CAMINHO, não a URL   (ADITIVO)
--
-- POR QUE NÃO REESCREVER foto_urls COM URL ASSINADA:
--   URL assinada EXPIRA. Se você gravar a URL assinada na coluna, daqui
--   a X dias toda a evidência contratual do banco vira link morto — e
--   aí sim você perdeu a medição. O que é ESTÁVEL é o CAMINHO do objeto
--   ("os/1720000000_ab12cd.jpg"). A URL assinada é gerada na hora de
--   exibir e joga fora depois. Por isso: coluna nova com o caminho,
--   foto_urls FICA INTACTA como estava (histórico e rollback).
-- =====================================================================

alter table os_campo        add column if not exists foto_paths text[] not null default '{}';
alter table entrada_material add column if not exists nf_path   text;

comment on column os_campo.foto_paths is
  'Caminho do objeto no bucket fotos-os (ex.: os/1720000000_ab12cd.jpg). '
  'Fonte da verdade da evidência. A URL de exibição é ASSINADA na hora. '
  'foto_urls fica congelada como histórico da fase de bucket público.';

-- 1.1 Função de normalização: URL pública -> caminho do objeto.
--     Devolve NULL para link externo (Drive/WhatsApp) — esse a gente
--     não toca, o frontend exibe direto.
create or replace function public.fpv_path_da_foto(u text)
returns text
language sql immutable as $$
  select case
    when u is null or btrim(u) = '' then null
    -- .../storage/v1/object/public/fotos-os/<CAMINHO>[?query]
    when u like '%/storage/v1/object/public/fotos-os/%'
      then split_part(split_part(u, '/storage/v1/object/public/fotos-os/', 2), '?', 1)
    -- .../storage/v1/object/sign/fotos-os/<CAMINHO>?token=...
    when u like '%/storage/v1/object/sign/fotos-os/%'
      then split_part(split_part(u, '/storage/v1/object/sign/fotos-os/', 2), '?', 1)
    when u like 'http%' then null            -- externa: preservar como veio
    else split_part(u, '?', 1)               -- já era caminho cru
  end
$$;

-- 1.2 Backfill. Idempotente: pode rodar quantas vezes quiser.
--     Só preenche quem ainda está vazio; NUNCA apaga foto_urls.
update os_campo o
set foto_paths = sub.paths
from (
  select o2.id,
         coalesce(array_agg(public.fpv_path_da_foto(u)
                            order by ord) filter (where public.fpv_path_da_foto(u) is not null),
                  '{}') as paths
  from os_campo o2, unnest(o2.foto_urls) with ordinality as t(u, ord)
  group by o2.id
) sub
where o.id = sub.id
  and coalesce(array_length(o.foto_paths, 1), 0) = 0
  and coalesce(array_length(sub.paths, 1), 0) > 0;

update entrada_material
set nf_path = public.fpv_path_da_foto(nf_url)
where nf_path is null and nf_url is not null
  and public.fpv_path_da_foto(nf_url) is not null;

-- 1.3 CONFERÊNCIA: nenhuma O.S. pode ter perdido evidência no caminho.
--     Esperado: ZERO linhas. Se voltar linha, é foto com URL em formato
--     inesperado — investigue ANTES da etapa 2 (a foto some da tela).
select id, numero, fict_ref, medicao,
       array_length(foto_urls, 1)  as qt_urls,
       array_length(foto_paths, 1) as qt_paths,
       foto_urls
from os_campo
where coalesce(array_length(foto_urls, 1), 0) > 0
  and coalesce(array_length(foto_paths, 1), 0)
      < (select count(*) from unnest(foto_urls) u where u like '%fotos-os%')
order by medicao nulls last, id;


-- =====================================================================
--  P A R E   A Q U I .
--  Faça o deploy do frontend (10-frontend-PATCHES.md), abra o app no
--  celular, abra uma O.S. antiga COM foto e o Fechamento Semanal.
--  Fotos aparecendo? Então siga para a ETAPA 2. Não apareceu? NÃO
--  rode a etapa 2 — o app ainda está lendo pela URL pública.
-- =====================================================================


-- =====================================================================
-- ETAPA 2 — FECHAR O BUCKET  (o passo com risco; rollback em 1 linha)
-- =====================================================================
--
-- ⛔ PARE (correção 28/07 — verificação adversarial):
--    NÃO RODE ESTA ETAPA COM MEDIÇÃO EM CURSO.
--
--    As fotos das medições JÁ ENTREGUES estão na planilha do RDO e nos
--    e-mails do fiscal como URL PÚBLICA. No segundo em que este UPDATE
--    rodar, todos esses links viram 404 — inclusive os da MED 7, que já
--    foi paga, e os da MED 8, que está sendo fechada agora. Foto de O.S.
--    é EVIDÊNCIA CONTRATUAL: link morto na mão do fiscal é problema
--    maior do que bucket aberto.
--
--    SEQUÊNCIA OBRIGATÓRIA ANTES DE DESCOMENTAR:
--      1. rodar o backup do bloco 0.3 e conferir o total com o 0.1;
--      2. gerar URL assinada de 1 ano (createSignedUrl expiresIn=31536000)
--         para TODA foto de O.S. com medicao <> '' e regravar esses links
--         na planilha do RDO;
--      3. trocar no n8n o getPublicUrl por foto_paths / URL assinada;
--      4. conferir 3 links da MED 7 e 3 da MED 8 abrindo pela planilha;
--      5. só então descomentar a linha abaixo.
--
--    Teste de aceite tem que provar OS DOIS LADOS: que a URL pública
--    antiga parou de abrir E que o fiscal continua abrindo o que já
--    recebeu.
-- =====================================================================

-- 2.1 Bucket deixa de servir /object/public/ para o mundo
-- update storage.buckets set public = false where id = 'fotos-os';

-- 2.2 Leitura só para quem está logado.
--     ISTO É O QUE PERMITE O createSignedUrl DO NAVEGADOR: assinar um
--     objeto exige SELECT nele com o JWT do usuário. Sem esta policy,
--     nem os nossos usuários veem foto.
drop policy if exists "fpv_fotos_leitura"           on storage.objects;
drop policy if exists "fpv_fotos_leitura_auth"      on storage.objects;
create policy "fpv_fotos_leitura_auth" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos-os');

-- 2.3 Upload continua igual (já era só autenticado) — reafirmado aqui
--     para o arquivo ser auto-suficiente.
drop policy if exists "fpv_fotos_upload" on storage.objects;
create policy "fpv_fotos_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-os');

-- 2.4 Ninguém apaga/sobrescreve foto pelo app. Foto é evidência: some
--     por engano = glosa. Correção de foto errada é pelo Studio.
drop policy if exists "fpv_fotos_sem_update" on storage.objects;
drop policy if exists "fpv_fotos_sem_delete" on storage.objects;
--    (a ausência de policy de update/delete JÁ bloqueia — RLS é
--     deny-by-default. Nada a criar. Confira que não existe nenhuma:)
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- 2.5 TESTE DE ACEITE — o mesmo teste que provou o furo, agora ao contrário.
--     No terminal, com uma URL pública de foto que você sabe que existia:
--       curl -s -o /dev/null -w "%{http_code}\n" "<URL_PUBLICA_ANTIGA>"
--     ANTES: 200  ·  DEPOIS (esperado): 400 ou 404.
--     E no app logado a mesma foto tem que abrir normalmente.


-- =====================================================================
-- ROLLBACK  (cada etapa isolada, de baixo para cima)
-- =====================================================================
-- ETAPA 2 (volta a foto a abrir sem login — use se o campo travar):
--   update storage.buckets set public = true where id = 'fotos-os';
--   drop policy if exists "fpv_fotos_leitura_auth" on storage.objects;
--   create policy "fpv_fotos_leitura" on storage.objects
--     for select to public using (bucket_id = 'fotos-os');
--
-- ETAPA 1 (não precisa: é aditivo e foto_urls nunca foi tocada. Se
--          quiser mesmo limpar):
--   alter table os_campo         drop column if exists foto_paths;
--   alter table entrada_material drop column if exists nf_path;
--   drop function if exists public.fpv_path_da_foto(text);
--
-- OBSERVAÇÃO SOBRE O n8n:
--   n8n/espelho-supabase-para-planilha.json copia "links de foto p/ RDO"
--   para a planilha. Depois da ETAPA 2 esses links MORREM na planilha.
--   Antes de rodar a etapa 2, decida uma das duas:
--     (a) o n8n passa a rodar com SERVICE_ROLE e gravar URL assinada de
--         validade longa (createSignedUrl expiresIn: 31536000 = 1 ano); ou
--     (b) a planilha passa a levar o CAMINHO (foto_paths) e quem precisa
--         ver abre pelo app. Mais simples e não expira.
--   Em qualquer caso o BACKUP da consulta 0.3 é o que garante a
--   evidência das medições já entregues.
-- =====================================================================
