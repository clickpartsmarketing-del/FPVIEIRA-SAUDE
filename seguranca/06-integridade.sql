-- =====================================================================
-- FPV CAMPO — 06 · INTEGRIDADE DE DADOS  (Frente 3 / achado CRITICO 2)
-- Projeto: fpv-campo22 (lgdnuyreaknxjswrfbjw)
-- Data da investigacao: 28/07/2026 — banco de PRODUCAO, 2.069 O.S.
--
-- O QUE ESTE ARQUIVO FAZ
--   1. Diagnostico (SO LEITURA) das duas duplicatas reais.
--   2. Correcao das duplicatas — UPDATE **COMENTADO**, so o Renan aprova.
--   3. Indice UNICO parcial em os_campo.numero (com trava anti-tiro-no-pe).
--   4. CHECKs de dominio (status / medicao / ferramenta / solicitacao).
--   5. saida_material.os_ref: por que FK direta e IMPOSSIVEL + o que fazer.
--   6. Indices que faltam (criado_em, data, numero, log).
--   7. Coluna atualizado_em + trigger (hoje NAO existe updated_at).
--   8. ROLLBACK completo.
--   9. Conferencia final.
--
-- REGRA DE OURO (Renan): aditivo, reversivel, idempotente, sem derrubar
-- a operacao. TUDO que pode falhar em cima de dado velho entra como
-- NOT VALID — passa a valer para linha NOVA/EDITADA e NAO revalida as
-- 2.069 linhas antigas. O VALIDATE fica separado e comentado.
--
-- COMO RODAR: SQL Editor do Supabase. Rode BLOCO A BLOCO, na ordem.
-- Nao cole o arquivo inteiro de uma vez na primeira execucao.
-- =====================================================================


-- =====================================================================
-- BLOCO 0 — DIAGNOSTICO (SO LEITURA, pode rodar a qualquer hora)
-- =====================================================================

-- 0.1 Todas as duplicatas de numero entre O.S. VIVAS (excluida = false).
--     Em 28/07/2026 este SELECT devolve exatamente 2 linhas: 1218 e 1673.
select numero,
       count(*)                                as qtd,
       array_agg(id order by id)               as ids,
       array_agg(status order by id)           as status,
       array_agg(coalesce(medicao,'-') order by id) as medicao,
       array_agg(unidade order by id)          as unidades
from os_campo
where numero is not null
  and excluida = false
group by numero
having count(*) > 1
order by numero;

-- 0.2 Ficha completa das duas O.S. em conflito (para o Renan decidir).
select id, numero, unidade, fiscal, entrada, conclusao, executor,
       status, medicao, servico, criado_em, excluida
from os_campo
where numero in (1218, 1673)
order by numero, id;

-- 0.3 Quantas O.S. vivas ficariam de fora do indice unico (numero nulo).
--     Esperado: 80 — sao as emergenciais/ficticias (fict_ref L01/M01/C01/G05
--     ou numero_fict legado F-nn). Elas NAO podem entrar no indice de numero.
select count(*) filter (where numero is null)                          as sem_numero_oficial,
       count(*) filter (where numero is null and fict_ref  is not null) as com_ref_equipe,
       count(*) filter (where numero is null and numero_fict is not null) as com_f_legado,
       count(*) filter (where numero is null and fict_ref is null
                          and numero_fict is null)                      as orfas_sem_identidade
from os_campo
where excluida = false;


-- =====================================================================
-- BLOCO 1 — AS DUAS DUPLICATAS: DIAGNOSTICO E DECISAO
--
-- Consultei o banco de producao em 28/07/2026 (REST /rest/v1/os_campo).
-- As duas duplicatas NAO sao o mesmo problema. Leia com atencao:
--
-- ---------------------------------------------------------------------
-- CASO A — O.S. 1218  ==>  DUPLICATA VERDADEIRA (importacao 04/07)
-- ---------------------------------------------------------------------
--   id=1219 : unidade "CIEP Mestre Marcal Municipalizado" · fiscal Renato
--             entrada 2026-05-11 · status "Pendente" · medicao ""
--             executor "" · conclusao NULL
--             servico "Troca de descarga externa"
--   id=1220 : unidade "CIEP Mestre Marcal Municipalizado" · fiscal Renato
--             entrada 2026-05-11 · status "Concluido" · medicao "MED 8"
--             executor "Miqueias" · conclusao 2026-05-19
--             servico "Troca de descarga externa"
--
--   MESMA unidade, MESMO fiscal, MESMA entrada, MESMO servico, MESMO
--   texto de solicitacao, MESMO criado_em (2026-07-04T16:33:55.754085Z —
--   ou seja, as duas nasceram no mesmo lote de importacao, com microssegundo
--   identico). E a mesma O.S. gravada duas vezes.
--
--   >>> FICA: id=1220. Tem status Concluido, executor, data de conclusao e
--       ja esta apontada para MED 8 — ou seja, e a linha que virou DINHEIRO.
--   >>> VIRA excluida=true: id=1219 (casca vazia, "Pendente", sem executor).
--   Risco de perder informacao: ZERO. Nao ha nenhum campo preenchido em
--   1219 que nao esteja em 1220.
--
-- ---------------------------------------------------------------------
-- CASO B — O.S. 1673  ==>  **NAO E DUPLICATA. E COLISAO DE NUMERO.**
-- ---------------------------------------------------------------------
--   id=1673 : unidade "Escola M. Henrique Sarzedas" · fiscal Wellington
--             status "Concluido" · medicao "MED 8" · executor "Gilson"
--             prioridade 3
--             servico "CRIACAO DE QUADRO ELETRICO E INSTALACAO DE ARES
--                      CONDICIONADOS DE 12000 BTU'S"
--   id=1674 : unidade "Escola M. Jose de Oliveira Martins" · fiscal Wellington
--             status "Pendente" · medicao "" · executor "" · servico ""
--             solicitado "ARES CONDICIONADOS DE 12000 BTU'S - ELETRICA"
--
--   ATENCAO: as UNIDADES SAO DIFERENTES. Sao DUAS ESCOLAS. Isto nao e a
--   mesma O.S. gravada duas vezes — sao duas demandas reais que receberam
--   o mesmo numero 1673 na importacao de 04/07 (provavel arraste de celula
--   na planilha de origem: id=1674 ficou com o numero do vizinho).
--
--   >>> Marcar id=1674 como excluida=true APAGARIA UMA DEMANDA REAL da
--       Escola M. Jose de Oliveira Martins. NAO FACA ISSO no automatico.
--
--   DUAS SAIDAS, as duas deixadas prontas e comentadas abaixo:
--
--   OPCAO B1 (RECOMENDADA) — "desnumerar e devolver para a fila"
--       id=1673 fica com o numero 1673 (e a que esta Concluida, MED 8,
--       com executor Gilson e servico descrito = virou dinheiro).
--       id=1674 PERDE o numero (numero = NULL) e ganha um fict_ref, caindo
--       no filtro "Aguardando numero" do app ate o fiscal informar o numero
--       oficial correto. A demanda da Jose de Oliveira Martins CONTINUA VIVA.
--
--   OPCAO B2 — "corrigir o numero na mao"
--       Se o Renan/Wellington souber o numero oficial certo da O.S. da
--       Escola M. Jose de Oliveira Martins, e so trocar direto.
--       Esta e a melhor opcao SE o numero for conhecido.
--
--   OPCAO B3 (so se a gestao confirmar que a 1674 e lixo de importacao)
--       Marcar excluida=true, igual ao caso A. NAO recomendo sem confirmar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 CASO A — descomente as 4 linhas abaixo APOS aprovacao do Renan.
--     Observacao: o trigger trg_fpv_log_os grava o ANTES em os_campo_log
--     automaticamente. Este UPDATE fica auditado sem precisar de nada extra.
-- ---------------------------------------------------------------------
-- update os_campo
--    set excluida = true,
--        par_sugerido = '1220'   -- deixa registrado qual linha ficou boa
--  where id = 1219 and numero = 1218 and status = 'Pendente';
-- -- deve responder: UPDATE 1

-- ---------------------------------------------------------------------
-- 1.2 CASO B — OPCAO B1 (recomendada): tira o numero da 1674, mantem viva.
-- ---------------------------------------------------------------------
-- update os_campo
--    set numero       = null,
--        fict_ref     = 'W01',        -- W = Wellington; ajuste p/ o padrao da equipe
--        par_sugerido = 'numero 1673 estava colidindo com id=1673 (Henrique Sarzedas)'
--  where id = 1674 and numero = 1673 and unidade = 'Escola M. Jose de Oliveira Martins';
-- -- deve responder: UPDATE 1
-- -- ATENCAO: o texto de unidade tem acento no banco ("Jose" = "José").
-- --          Copie o valor exato do SELECT 0.2 antes de rodar.

-- ---------------------------------------------------------------------
-- 1.3 CASO B — OPCAO B2 (se souberem o numero oficial correto):
-- ---------------------------------------------------------------------
-- update os_campo set numero = <NUMERO_CORRETO_AQUI>
--  where id = 1674 and numero = 1673;

-- ---------------------------------------------------------------------
-- 1.4 CASO B — OPCAO B3 (so com confirmacao expressa da gestao):
-- ---------------------------------------------------------------------
-- update os_campo set excluida = true, par_sugerido = '1673'
--  where id = 1674 and numero = 1673 and status = 'Pendente';

-- ---------------------------------------------------------------------
-- 1.5 CONFERENCIA pos-correcao: tem que voltar ZERO linha.
-- ---------------------------------------------------------------------
select numero, count(*) as qtd, array_agg(id) as ids
from os_campo
where numero is not null and excluida = false
group by numero having count(*) > 1;


-- =====================================================================
-- BLOCO 2 — UNICIDADE DO NUMERO DA O.S.
--
-- Indice UNICO PARCIAL: so vale para O.S. VIVA e COM numero oficial.
--   · numero IS NOT NULL  -> as 80 emergenciais/ficticias ficam de fora
--   · excluida = false    -> a regra do Renan ("numero fixo pra sempre,
--                            exclusao vira marca") continua valendo: a
--                            linha excluida guarda o numero, e o numero
--                            pode ser reemitido uma unica vez para a
--                            linha viva. Sem isso, o soft delete travaria.
--
-- A TRAVA: o DO block abaixo se recusa a criar o indice se ainda houver
-- duplicata. Prefiro falhar alto aqui do que descobrir o problema quando
-- o app do Gilson der erro no meio da rua.
-- =====================================================================

do $$
declare
  dups int;
  detalhe text;
begin
  select count(*), coalesce(string_agg(numero::text, ', '), '')
    into dups, detalhe
  from (
    select numero from os_campo
    where numero is not null and excluida = false
    group by numero having count(*) > 1
  ) d;

  if dups > 0 then
    raise exception
      'ABORTADO: ainda existem % numero(s) duplicado(s) [%]. Resolva o BLOCO 1 primeiro.',
      dups, detalhe;
  end if;

  if not exists (select 1 from pg_indexes
                 where schemaname = 'public' and indexname = 'ux_os_campo_numero_ativo') then
    execute $ix$
      create unique index ux_os_campo_numero_ativo
        on public.os_campo (numero)
        where numero is not null and excluida = false
    $ix$;
    raise notice 'ux_os_campo_numero_ativo CRIADO.';
  else
    raise notice 'ux_os_campo_numero_ativo ja existia — nada a fazer.';
  end if;
end $$;

-- Observacao de operacao: a criacao acima pega um lock curto (ShareLock)
-- na os_campo. Com 2.069 linhas isso dura milissegundos. Se um dia a
-- tabela passar de ~500k linhas, troque por:
--   create unique index concurrently ux_os_campo_numero_ativo ...
-- (CONCURRENTLY nao roda dentro de bloco transacional / DO block.)

-- 2.2 Mesma protecao para a numeracao legado F-nn.
--     fict_ref (L01/M01/G05/C01) ja tem ux_os_fict_ref desde o supabase.sql.
create unique index if not exists ux_os_campo_numero_fict_ativo
  on public.os_campo (numero_fict)
  where numero_fict is not null and excluida = false;

-- 2.3 Toda O.S. viva precisa ter ALGUMA identidade (numero, F-nn ou L/M/G/C).
--     Hoje o banco aceita uma O.S. sem nenhuma das tres.
--     NOT VALID: nao revalida as 2.069 linhas antigas, so as novas/editadas.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_os_campo_tem_identidade') then
    alter table public.os_campo
      add constraint ck_os_campo_tem_identidade
      check (numero is not null or numero_fict is not null or fict_ref is not null)
      not valid;
  end if;
end $$;

-- Quantas linhas antigas violam? (esperado em 28/07: 0)
select count(*) as os_sem_identidade
from os_campo
where numero is null and numero_fict is null and fict_ref is null;

-- Se o SELECT acima der 0, promova a constraint a VALID (descomente):
-- alter table public.os_campo validate constraint ck_os_campo_tem_identidade;


-- =====================================================================
-- BLOCO 3 — CHECKS DE DOMINIO
--
-- Todos conferidos contra os valores REAIS de producao (28/07/2026).
-- Onde o dado atual ja passa 100%, entra NOT VALID + VALIDATE na sequencia.
-- Onde o dado atual VIOLA, entra NOT VALID e o VALIDATE fica comentado
-- com o relatorio de limpeza do lado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1 os_campo.status — 7 valores do types.ts (STATUS_OPTIONS).
--     Producao hoje: Concluido 1235 · Pendente 594 · Executando 129 ·
--     Assinatura 84 · Cancelada 25 · Material 2. Zero fora da lista.
--     ('Avaliando' existe no app e ainda nao foi usado — entra na lista.)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_os_campo_status') then
    alter table public.os_campo
      add constraint ck_os_campo_status
      check (status in ('Pendente','Executando','Assinatura','Avaliando',
                        'Concluído','Material','Cancelada'))
      not valid;
  end if;
end $$;

-- Relatorio: status fora da lista (esperado: 0 linhas)
select status, count(*) from os_campo
where status not in ('Pendente','Executando','Assinatura','Avaliando',
                     'Concluído','Material','Cancelada')
group by status;

-- PASSO SEPARADO (correcao 28/07 - verificacao adversarial):
--   NAO rode junto com o resto do arquivo. Descomente SO depois de
--   rodar o SELECT de relatorio acima e ele voltar 0 linhas. Se uma
--   linha antiga violar, este comando falha e DERRUBA O ARQUIVO
--   INTEIRO (o SQL Editor roda tudo numa transacao) - inclusive o
--   indice unico e as colunas que ja tinham passado.
-- alter table public.os_campo validate constraint ck_os_campo_status;

-- ---------------------------------------------------------------------
-- 3.2 os_campo.medicao — '' , NULL ou 'MED <n>'.
--     DE PROPOSITO nao uso lista fixa ('MED 8','MED 9'...): a MED avanca
--     por calendario (config.ts calcula MED = 8 + meses desde jul/2026).
--     Lista fixa quebraria sozinha em 2027. Producao hoje: '' 742, NULL 74,
--     MED 3 a MED 8. Tudo passa no regex.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_os_campo_medicao') then
    alter table public.os_campo
      add constraint ck_os_campo_medicao
      check (medicao is null or btrim(medicao) = '' or btrim(medicao) ~ '^MED [0-9]{1,3}$')
      not valid;
  end if;
end $$;

-- Relatorio: medicao fora do padrao (esperado: 0 linhas)
select medicao, count(*) from os_campo
where medicao is not null and btrim(medicao) <> ''
  and btrim(medicao) !~ '^MED [0-9]{1,3}$'
group by medicao;

-- PASSO SEPARADO (correcao 28/07 - verificacao adversarial):
--   NAO rode junto com o resto do arquivo. Descomente SO depois de
--   rodar o SELECT de relatorio acima e ele voltar 0 linhas. Se uma
--   linha antiga violar, este comando falha e DERRUBA O ARQUIVO
--   INTEIRO (o SQL Editor roda tudo numa transacao) - inclusive o
--   indice unico e as colunas que ja tinham passado.
-- alter table public.os_campo validate constraint ck_os_campo_medicao;

-- ---------------------------------------------------------------------
-- 3.3 os_campo.classificacao — NAO vou criar CHECK aqui, e explico:
--     producao tem 9 valores misturando duas escalas diferentes:
--       II 556 · I 550 · Normal 440 · III 337 · Emergencial 80 ·
--       (vazio) 73 · Urgente 14 · IV 8 · IIII 6 · NULL 5
--     'IIII' e claramente erro de digitacao de 'IV'/'III'. Um CHECK aqui
--     travaria 6 linhas historicas e nao resolve a bagunca de escala.
--     >>> ACAO CORRETA: normalizar PRIMEIRO (decisao do Renan sobre qual
--         escala vale), depois criar o CHECK. Relatorio abaixo.
-- ---------------------------------------------------------------------
select coalesce(nullif(btrim(classificacao),''), '(vazio)') as classificacao,
       count(*) as qtd,
       min(entrada) as primeira, max(entrada) as ultima
from os_campo
group by 1 order by 2 desc;

-- Sugestao de normalizacao (COMENTADA — so apos decisao):
-- update os_campo set classificacao = 'IV' where classificacao = 'IIII';
-- -- deve responder: UPDATE 6

-- ---------------------------------------------------------------------
-- 3.4 os_campo — data de conclusao nao pode ser anterior a de entrada.
--     NOT VALID + relatorio. NAO valide sem ver o relatorio antes.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_os_campo_datas_coerentes') then
    alter table public.os_campo
      add constraint ck_os_campo_datas_coerentes
      check (conclusao is null or entrada is null or conclusao >= entrada)
      not valid;
  end if;
end $$;

select id, numero, unidade, entrada, conclusao
from os_campo
where conclusao is not null and entrada is not null and conclusao < entrada
order by entrada;
-- Se o SELECT acima voltar vazio:
-- alter table public.os_campo validate constraint ck_os_campo_datas_coerentes;

-- ---------------------------------------------------------------------
-- 3.5 saida_material.quantidade > 0
--     >>> PRODUCAO VIOLA: 43 linhas com quantidade = 0,00 (importacao
--         historica de fev–mai/2026, ex.: id 1478 "FIO PARA EXTENSAO",
--         id 1357/1358/1359 barra roscada + arruela + porca).
--     Por isso: NOT VALID e NADA de VALIDATE agora. A constraint ja
--     protege TODA saida nova do Joao a partir de hoje.
-- ---------------------------------------------------------------------
do $$
begin
  -- CORRECAO 28/07 (verificacao adversarial): era check (quantidade > 0)
  -- e ISSO QUEBRARIA A DEVOLUCAO. AlmoxOS.tsx:558-565 (botao "devolver
  -- ao estoque") grava a devolucao como uma saida com quantidade
  -- NEGATIVA e origem 'DEVOLUCAO' — e o saldo do almox depende disso.
  -- O que a regra quer barrar de verdade e a linha com quantidade ZERO.
  if not exists (select 1 from pg_constraint where conname = 'ck_saida_qtd_positiva') then
    alter table public.saida_material
      add constraint ck_saida_qtd_positiva
      check (quantidade <> 0)
      not valid;
  end if;
end $$;

-- As 43 linhas historicas a limpar (para o Joao conferir na planilha):
select id, data, descricao, unidade, os_ref, origem, escola
from saida_material
where quantidade is null or quantidade <= 0
order by data;

-- Depois de o Joao corrigir as 43 (ou marcar como baixa historica):
-- alter table public.saida_material validate constraint ck_saida_qtd_positiva;

-- ---------------------------------------------------------------------
-- 3.6 entrada_material.quantidade > 0  (producao: 2 linhas, ambas OK)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_entrada_qtd_positiva') then
    alter table public.entrada_material
      add constraint ck_entrada_qtd_positiva check (quantidade > 0) not valid;
  end if;
end $$;
-- PASSO SEPARADO (correcao 28/07 - verificacao adversarial):
--   NAO rode junto com o resto do arquivo. Descomente SO depois de
--   rodar o SELECT de relatorio acima e ele voltar 0 linhas. Se uma
--   linha antiga violar, este comando falha e DERRUBA O ARQUIVO
--   INTEIRO (o SQL Editor roda tudo numa transacao) - inclusive o
--   indice unico e as colunas que ja tinham passado.
-- alter table public.entrada_material validate constraint ck_entrada_qtd_positiva;

-- ---------------------------------------------------------------------
-- 3.7 ferramenta.status  (producao: 8 linhas, todas 'ESTOQUE')
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ferramenta_status') then
    alter table public.ferramenta
      add constraint ck_ferramenta_status
      check (status in ('ESTOQUE','EM CAMPO','MANUTENCAO','BAIXADA','PERDIDA'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_ferramenta_qtd_positiva') then
    alter table public.ferramenta
      add constraint ck_ferramenta_qtd_positiva check (quantidade > 0) not valid;
  end if;
end $$;
-- PASSO SEPARADO (correcao 28/07 - verificacao adversarial):
--   NAO rode junto com o resto do arquivo. Descomente SO depois de
--   rodar o SELECT de relatorio acima e ele voltar 0 linhas. Se uma
--   linha antiga violar, este comando falha e DERRUBA O ARQUIVO
--   INTEIRO (o SQL Editor roda tudo numa transacao) - inclusive o
--   indice unico e as colunas que ja tinham passado.
-- alter table public.ferramenta validate constraint ck_ferramenta_status;
-- PASSO SEPARADO (correcao 28/07 - verificacao adversarial):
--   NAO rode junto com o resto do arquivo. Descomente SO depois de
--   rodar o SELECT de relatorio acima e ele voltar 0 linhas. Se uma
--   linha antiga violar, este comando falha e DERRUBA O ARQUIVO
--   INTEIRO (o SQL Editor roda tudo numa transacao) - inclusive o
--   indice unico e as colunas que ja tinham passado.
-- alter table public.ferramenta validate constraint ck_ferramenta_qtd_positiva;

-- Coerencia: se esta EM CAMPO, tem que ter com_quem e desde.
-- NOT VALID e SEM validate — nao sei o historico futuro; protege o novo.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ferramenta_em_campo_tem_dono') then
    alter table public.ferramenta
      add constraint ck_ferramenta_em_campo_tem_dono
      check (status <> 'EM CAMPO'
             or (com_quem is not null and btrim(com_quem) <> '' and desde is not null))
      not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3.8 solicitacao_material.status
--     Fluxo do ALMOX-V2: PEDIDO (equipe) -> SEPARADO (Joao) -> RECEBIDO.
--     Producao: RECEBIDO 16 · SEPARADO 4. Tudo dentro da lista.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_solicitacao_status') then
    alter table public.solicitacao_material
      add constraint ck_solicitacao_status
      check (status in ('PEDIDO','SEPARADO','RECEBIDO','CANCELADO'))
      not valid;
  end if;
end $$;
-- PASSO SEPARADO (correcao 28/07 - verificacao adversarial):
--   NAO rode junto com o resto do arquivo. Descomente SO depois de
--   rodar o SELECT de relatorio acima e ele voltar 0 linhas. Se uma
--   linha antiga violar, este comando falha e DERRUBA O ARQUIVO
--   INTEIRO (o SQL Editor roda tudo numa transacao) - inclusive o
--   indice unico e as colunas que ja tinham passado.
-- alter table public.solicitacao_material validate constraint ck_solicitacao_status;

-- ---------------------------------------------------------------------
-- 3.9 estoque_item — descricao ja e UNIQUE (ALMOX-V2), mas so
--     case-sensitive. Producao TEM colisao logica:
--       id=10  "Alisar peça"    /  id=216 "ALISAR PEÇA"
--       id=14  "ALISAR (JOGO)"  /  id=84  "Prego alisar"   (itens distintos)
--     Um unique case-insensitive quebraria HOJE (par 10/216).
--     Entrego so o RELATORIO + o indice comentado.
-- ---------------------------------------------------------------------
select upper(btrim(descricao)) as chave,
       count(*) as qtd,
       array_agg(id order by id) as ids,
       array_agg(descricao order by id) as textos
from estoque_item
group by 1 having count(*) > 1 order by 1;

-- Apos o Joao fundir os duplicados (manter o id mais antigo):
-- create unique index if not exists ux_estoque_item_descricao_ci
--   on public.estoque_item (upper(btrim(descricao)));


-- =====================================================================
-- BLOCO 4 — saida_material.os_ref: POR QUE FK DIRETA E IMPOSSIVEL
--
-- INVESTIGUEI as 3.133 linhas de saida_material. os_ref NAO e um numero
-- de O.S. — sao TRES espacos de nomes convivendo na mesma coluna texto:
--
--   (a) numero oficial   : '916', '1500'…  -> 455 valores distintos.
--       Cruzei 100% deles contra os_campo.numero: **so 1 nao existe**,
--       e e o literal '0' (id=2848, "BOMBA SUBMERSA HB 400 127V", SEMEDE).
--   (b) ficticia legado  : 'F-12', 'F-57', 'F-90'  -> mapeia numero_fict.
--   (c) ref de equipe    : 'L01','M18','G05','C04' -> mapeia fict_ref.
--   (d) vazio            : 1.107 linhas '' + 5 NULL = reposicao de estoque,
--                          nao pertence a nenhuma O.S. (comportamento correto).
--
-- Um FOREIGN KEY exige UMA coluna apontando para UMA coluna unica. Nao da
-- para escrever FK sobre uma coluna que as vezes e numero, as vezes e
-- 'F-'||numero_fict e as vezes e fict_ref. Forcar isso quebraria a
-- operacao do Joao HOJE.
--
-- SOLUCAO ADITIVA EM 3 CAMADAS (nenhuma bloqueia gravacao):
--   4.1 funcao resolvedora  fpv_resolve_os_ref(text) -> os_campo.id
--   4.2 coluna os_id nullable + FK **NOT VALID** + indice  (o vinculo real)
--   4.3 trigger que preenche os_id sozinho, sem NUNCA rejeitar a linha
--   4.4 view de orfas, para a gestao caçar erro de digitacao
-- =====================================================================

-- 4.1 Resolvedor. STABLE (le tabela) — nao pode ser IMMUTABLE.
--     Escrito em plpgsql (nao em SQL puro) por dois motivos:
--       · o cast ::int so acontece DEPOIS de conferir o tamanho — um
--         os_ref digitado errado com 12 digitos causaria "integer out of
--         range" e derrubaria a gravacao do Joao;
--       · o cast e feito UMA vez, nao uma vez por linha varrida.
create or replace function public.fpv_resolve_os_ref(p_ref text)
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  r    text := btrim(coalesce(p_ref, ''));
  n    int;
  v_id bigint;
begin
  if r = '' then
    return null;
  end if;

  -- (a) numero oficial: '916', '1500'   (ate 9 digitos, cabe em int)
  if r ~ '^[0-9]{1,9}$' then
    n := r::int;
    select o.id into v_id from os_campo o
     where o.numero = n
     order by o.excluida asc, o.id asc   -- prefere a O.S. VIVA se colidir
     limit 1;
    return v_id;
  end if;

  -- (b) ficticia legado: 'F-12', 'F-90'
  if r ~ '^[Ff]-[0-9]{1,9}$' then
    n := substring(r from 3)::int;
    select o.id into v_id from os_campo o
     where o.numero_fict = n
     order by o.excluida asc, o.id asc
     limit 1;
    return v_id;
  end if;

  -- (c) ref de equipe: 'L01', 'M18', 'G05', 'C04'
  select o.id into v_id from os_campo o
   where o.fict_ref = r
   order by o.excluida asc, o.id asc
   limit 1;
  return v_id;
end $$;

comment on function public.fpv_resolve_os_ref(text) is
  'Traduz saida_material.os_ref / solicitacao_material.os_ref para os_campo.id. '
  'Aceita numero oficial, F-nn (numero_fict) e L/M/G/C-nn (fict_ref). '
  'Devolve NULL quando o ref e vazio (reposicao) ou nao encontrado.';

-- 4.2 Coluna de vinculo real + FK NOT VALID.
--     ON DELETE SET NULL: se um dia uma O.S. for apagada FISICAMENTE
--     (so gestao consegue, ver 01/02), a saida de material NAO some junto.
--     Material dado e fato consumado — nunca cascatear delete aqui.
alter table public.saida_material add column if not exists os_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_saida_material_os') then
    alter table public.saida_material
      add constraint fk_saida_material_os
      foreign key (os_id) references public.os_campo(id)
      on delete set null
      not valid;
  end if;
end $$;

create index if not exists idx_saida_os_id on public.saida_material(os_id);

-- Backfill (SEGURO: so preenche o que estava NULL, nao altera mais nada).
-- Rode fora do horario de pico — 3.133 linhas, ~1s. Descomente para aplicar:
-- update public.saida_material s
--    set os_id = public.fpv_resolve_os_ref(s.os_ref)
--  where s.os_id is null
--    and s.os_ref is not null and btrim(s.os_ref) <> '';

-- Depois do backfill, como todo os_id preenchido veio de os_campo.id:
-- alter table public.saida_material validate constraint fk_saida_material_os;

-- 4.3 Trigger que mantem os_id em dia SEM NUNCA rejeitar a gravacao.
--     Se o ref nao resolver, os_id fica NULL e a linha grava do mesmo jeito.
--     Isto e deliberado: o Joao lanca material as vezes ANTES de a O.S.
--     existir no sistema. Travar aqui pararia o almoxarifado.
create or replace function public.fpv_saida_vincula_os()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.os_ref is distinct from old.os_ref then
    new.os_id := public.fpv_resolve_os_ref(new.os_ref);
  end if;
  return new;
end $$;

drop trigger if exists trg_saida_vincula_os on public.saida_material;
create trigger trg_saida_vincula_os
  before insert or update of os_ref on public.saida_material
  for each row execute function public.fpv_saida_vincula_os();

-- 4.4 Formato do os_ref: aceita vazio, numero, F-nn, ou LETRA+digitos.
--     NOT VALID — protege digitacao nova sem mexer no historico.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_saida_os_ref_formato') then
    alter table public.saida_material
      add constraint ck_saida_os_ref_formato
      check (os_ref is null
             or btrim(os_ref) = ''
             or btrim(os_ref) ~ '^[0-9]+$'
             or btrim(os_ref) ~ '^[Ff]-[0-9]+$'
             or btrim(os_ref) ~ '^[A-Za-z]{1,2}[0-9]{1,4}$')
      not valid;
  end if;
end $$;

-- Relatorio: refs fora do formato (esperado hoje: 0 linhas)
select os_ref, count(*) from saida_material
where os_ref is not null and btrim(os_ref) <> ''
  and btrim(os_ref) !~ '^[0-9]+$'
  and btrim(os_ref) !~ '^[Ff]-[0-9]+$'
  and btrim(os_ref) !~ '^[A-Za-z]{1,2}[0-9]{1,4}$'
group by os_ref;
-- Se vazio:
-- alter table public.saida_material validate constraint ck_saida_os_ref_formato;

-- 4.5 View das ORFAS — material lancado com ref que nao acha O.S. nenhuma.
--     Hoje devolve 1 linha (o os_ref='0' do id=2848). E o painel de
--     qualidade permanente do almoxarifado.
create or replace view public.vw_saida_material_orfa as
select s.id, s.data, s.descricao, s.quantidade, s.unidade,
       s.os_ref, s.escola, s.origem, s.criado_por
from public.saida_material s
where s.os_ref is not null
  and btrim(s.os_ref) <> ''
  and public.fpv_resolve_os_ref(s.os_ref) is null;

comment on view public.vw_saida_material_orfa is
  'Saidas de material cujo os_ref nao casa com nenhuma O.S. — erro de digitacao '
  'ou O.S. ainda nao cadastrada. Conferir antes de fechar a medicao.';

select * from public.vw_saida_material_orfa;

-- 4.6 Mesmo tratamento (leve) para solicitacao_material.os_ref: so indice.
--     20 linhas hoje; nao justifica coluna+trigger. Fica o indice.
create index if not exists idx_solic_os_ref on public.solicitacao_material(os_ref);


-- =====================================================================
-- BLOCO 5 — NOT NULL
--
-- Levantamento honesto do que ja esta protegido (nao repetir trabalho):
--   os_campo.unidade      -> ja NOT NULL (supabase.sql)
--   os_campo.status       -> ja NOT NULL default 'Executando'
--   os_campo.excluida     -> ja NOT NULL default false
--   os_campo.emergencial  -> ja NOT NULL default false
--   os_campo.assinado     -> ja NOT NULL default false
--   os_campo.foto_urls    -> ja NOT NULL default '{}'
--   saida/entrada.descricao, .quantidade, .unidade -> ja NOT NULL
--   estoque_item.*        -> ja NOT NULL
--
-- O que FALTA e da para fazer sem risco:
-- =====================================================================

-- 5.1 os_campo.entrada — 2 linhas com NULL em producao. NAO forco NOT NULL
--     (derrubaria o import). Coloco default e mostro as 2 para corrigir.
alter table public.os_campo alter column entrada set default current_date;

select id, numero, fict_ref, unidade, status, criado_em
from os_campo where entrada is null;
-- Apos corrigir as 2 na tela:
-- alter table public.os_campo alter column entrada set not null;

-- 5.2 saida_material.data / entrada_material.data — ja tem default, mas nao
--     tem NOT NULL declarado em toda linha do historico. Confere primeiro:
select 'saida'   as tabela, count(*) as sem_data from saida_material   where data is null
union all
select 'entrada', count(*) from entrada_material where data is null;
-- Se ambos = 0 (esperado), pode travar:
-- alter table public.saida_material   alter column data set not null;
-- alter table public.entrada_material alter column data set not null;

-- 5.3 saida_material.origem — default existe, mas aceita NULL.
alter table public.saida_material alter column origem set default 'ALMOXARIFADO';

-- 5.4 NOTA sobre origem (nao viro CHECK de proposito): producao tem 12
--     variantes, incluindo o MESMO deposito escrito de 2 jeitos —
--     'DEPOSITO CAMPISTA' (352) e 'DEPÓSITO CAMPISTA' (31). O app
--     (data/materiais.ts ORIGENS) so oferece a versao COM acento; as 352
--     sem acento vieram do import. Normalizar ANTES de qualquer CHECK:
select origem, count(*) from saida_material group by origem order by 2 desc;
-- update saida_material set origem = 'DEPÓSITO CAMPISTA' where origem = 'DEPOSITO CAMPISTA';
-- -- deve responder: UPDATE 352


-- =====================================================================
-- BLOCO 6 — INDICES QUE FALTAM
-- Todos IF NOT EXISTS. Custo de escrita irrelevante nesta escala;
-- ganho grande nas telas de Gestao/Almox que hoje varrem a tabela toda.
-- =====================================================================

-- 6.1 os_campo — filtros reais das telas
create index if not exists idx_os_campo_criado_em     on public.os_campo(criado_em desc);
create index if not exists idx_os_campo_numero        on public.os_campo(numero) where numero is not null;
create index if not exists idx_os_campo_status_med    on public.os_campo(status, medicao) where excluida = false;
create index if not exists idx_os_campo_medicao       on public.os_campo(medicao) where excluida = false;
create index if not exists idx_os_campo_entrada       on public.os_campo(entrada desc);
create index if not exists idx_os_campo_executor      on public.os_campo(executor) where excluida = false;
create index if not exists idx_os_campo_ativas        on public.os_campo(id) where excluida = false;

-- 6.2 almoxarifado
create index if not exists idx_saida_criado_em        on public.saida_material(criado_em desc);
create index if not exists idx_saida_escola           on public.saida_material(escola);
create index if not exists idx_saida_origem           on public.saida_material(origem);
create index if not exists idx_entrada_criado_em      on public.entrada_material(criado_em desc);
create index if not exists idx_entrada_data           on public.entrada_material(data desc);
create index if not exists idx_estoque_criado_em      on public.estoque_item(criado_em desc);
create index if not exists idx_ferramenta_status      on public.ferramenta(status);
create index if not exists idx_solic_criado_em        on public.solicitacao_material(criado_em desc);

-- 6.3 livro-razao (hoje 3.177 linhas e so cresce; a tela da gestao
--     busca por os_id e ordena por quando)
create index if not exists idx_os_log_os_id           on public.os_campo_log(os_id);
create index if not exists idx_os_log_quando          on public.os_campo_log(quando desc);
create index if not exists idx_os_log_por_email       on public.os_campo_log(por_email);
create index if not exists idx_os_log_ref             on public.os_campo_log(ref);


-- =====================================================================
-- BLOCO 7 — atualizado_em (o "updated_at" que HOJE NAO EXISTE)
--
-- Confirmei via OpenAPI do PostgREST: nenhuma tabela tem updated_at.
-- Sem isso e impossivel responder "o que mudou desde ontem?" — nem para
-- sincronizacao offline do PWA, nem para conferencia de medicao.
-- 100% aditivo: coluna nova, nullable, com trigger. Nada quebra.
-- =====================================================================

alter table public.os_campo             add column if not exists atualizado_em timestamptz;
alter table public.saida_material       add column if not exists atualizado_em timestamptz;
alter table public.entrada_material     add column if not exists atualizado_em timestamptz;
alter table public.estoque_item         add column if not exists atualizado_em timestamptz;
alter table public.ferramenta           add column if not exists atualizado_em timestamptz;
alter table public.solicitacao_material add column if not exists atualizado_em timestamptz;
-- apelido_material JA tem atualizado_em (ALMOX-V2) — nao mexer.

-- ---------------------------------------------------------------------
-- 7.1 SEMENTE — TEM que vir ANTES de criar o trigger.
--     Se rodar depois, o proprio trigger sobrescreve criado_em por now()
--     e todas as 2.069 O.S. ficariam "atualizadas hoje". Ordem importa.
--
--     AVISO 1: o UPDATE em os_campo dispara trg_fpv_log_os e geraria
--     ~2.069 linhas 'EDITADA' por 'sistema' no livro-razao — ruido puro.
--     Por isso o log fica desligado durante a semente, e so durante ela.
--     AVISO 2: nesses segundos, edicao concorrente de O.S. nao seria
--     logada. Rode fora do horario de campo.
-- ---------------------------------------------------------------------
-- Bloco unico: se algo falhar no meio, o escrivao volta a ligar junto
-- com o rollback da transacao. Nunca fica desligado por acidente.
do $$
declare tem_log boolean;
begin
  select exists (select 1 from pg_trigger where tgname = 'trg_fpv_log_os')
    into tem_log;

  if tem_log then
    alter table public.os_campo disable trigger trg_fpv_log_os;
  else
    raise warning 'trg_fpv_log_os NAO encontrado — confira o nome do trigger de log da O.S.';
  end if;

  update public.os_campo             set atualizado_em = criado_em where atualizado_em is null;
  update public.saida_material       set atualizado_em = criado_em where atualizado_em is null;
  update public.entrada_material     set atualizado_em = criado_em where atualizado_em is null;
  update public.estoque_item         set atualizado_em = criado_em where atualizado_em is null;
  update public.ferramenta           set atualizado_em = criado_em where atualizado_em is null;
  update public.solicitacao_material set atualizado_em = criado_em where atualizado_em is null;

  if tem_log then
    alter table public.os_campo enable trigger trg_fpv_log_os;
  end if;
end $$;

-- Conferencia obrigatoria: o escrivao TEM que estar ligado de novo.
select case when tgenabled = 'D' then '>>> PERIGO: TRIGGER DE LOG DESLIGADO'
            else 'OK — escrivao da O.S. ligado' end as estado_do_log
from pg_trigger where tgname = 'trg_fpv_log_os';

-- ---------------------------------------------------------------------
-- 7.2 Agora sim: a funcao e os gatilhos.
-- ---------------------------------------------------------------------
create or replace function public.fpv_marca_atualizacao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['os_campo','saida_material','entrada_material',
                           'estoque_item','ferramenta','solicitacao_material',
                           'apelido_material']
  loop
    execute format('drop trigger if exists trg_atualizado_em on public.%I', t);
    execute format(
      'create trigger trg_atualizado_em before update on public.%I
       for each row execute function public.fpv_marca_atualizacao()', t);
  end loop;
end $$;

create index if not exists idx_os_campo_atualizado_em  on public.os_campo(atualizado_em desc);
create index if not exists idx_saida_atualizado_em     on public.saida_material(atualizado_em desc);
create index if not exists idx_estoque_atualizado_em   on public.estoque_item(atualizado_em desc);


-- =====================================================================
-- BLOCO 8 — ROLLBACK COMPLETO
-- Cole este bloco inteiro para desfazer TUDO do arquivo 06.
-- Nao desfaz os UPDATEs do BLOCO 1 (dado) — para isso use os_campo_log.
-- =====================================================================
/*
-- 8.1 triggers e funcoes
do $$
declare t text;
begin
  foreach t in array array['os_campo','saida_material','entrada_material',
                           'estoque_item','ferramenta','solicitacao_material',
                           'apelido_material']
  loop
    execute format('drop trigger if exists trg_atualizado_em on public.%I', t);
  end loop;
end $$;
drop trigger  if exists trg_saida_vincula_os on public.saida_material;
drop function if exists public.fpv_saida_vincula_os();
drop function if exists public.fpv_marca_atualizacao();
drop view     if exists public.vw_saida_material_orfa;
drop function if exists public.fpv_resolve_os_ref(text);

-- 8.2 constraints
alter table public.os_campo             drop constraint if exists ck_os_campo_status;
alter table public.os_campo             drop constraint if exists ck_os_campo_medicao;
alter table public.os_campo             drop constraint if exists ck_os_campo_datas_coerentes;
alter table public.os_campo             drop constraint if exists ck_os_campo_tem_identidade;
alter table public.saida_material       drop constraint if exists ck_saida_qtd_positiva;
alter table public.saida_material       drop constraint if exists ck_saida_os_ref_formato;
alter table public.saida_material       drop constraint if exists fk_saida_material_os;
alter table public.entrada_material     drop constraint if exists ck_entrada_qtd_positiva;
alter table public.ferramenta           drop constraint if exists ck_ferramenta_status;
alter table public.ferramenta           drop constraint if exists ck_ferramenta_qtd_positiva;
alter table public.ferramenta           drop constraint if exists ck_ferramenta_em_campo_tem_dono;
alter table public.solicitacao_material drop constraint if exists ck_solicitacao_status;

-- 8.3 indices
drop index if exists public.ux_os_campo_numero_ativo;
drop index if exists public.ux_os_campo_numero_fict_ativo;
drop index if exists public.ux_estoque_item_descricao_ci;
drop index if exists public.idx_os_campo_criado_em;
drop index if exists public.idx_os_campo_numero;
drop index if exists public.idx_os_campo_status_med;
drop index if exists public.idx_os_campo_medicao;
drop index if exists public.idx_os_campo_entrada;
drop index if exists public.idx_os_campo_executor;
drop index if exists public.idx_os_campo_ativas;
drop index if exists public.idx_os_campo_atualizado_em;
drop index if exists public.idx_saida_criado_em;
drop index if exists public.idx_saida_escola;
drop index if exists public.idx_saida_origem;
drop index if exists public.idx_saida_os_id;
drop index if exists public.idx_saida_atualizado_em;
drop index if exists public.idx_entrada_criado_em;
drop index if exists public.idx_entrada_data;
drop index if exists public.idx_estoque_criado_em;
drop index if exists public.idx_estoque_atualizado_em;
drop index if exists public.idx_ferramenta_status;
drop index if exists public.idx_solic_criado_em;
drop index if exists public.idx_solic_os_ref;
drop index if exists public.idx_os_log_os_id;
drop index if exists public.idx_os_log_quando;
drop index if exists public.idx_os_log_por_email;
drop index if exists public.idx_os_log_ref;

-- 8.4 colunas aditivas (SO se quiser mesmo apagar o dado acumulado)
alter table public.saida_material       drop column if exists os_id;
alter table public.os_campo             drop column if exists atualizado_em;
alter table public.saida_material       drop column if exists atualizado_em;
alter table public.entrada_material     drop column if exists atualizado_em;
alter table public.estoque_item         drop column if exists atualizado_em;
alter table public.ferramenta           drop column if exists atualizado_em;
alter table public.solicitacao_material drop column if exists atualizado_em;

-- 8.5 defaults
alter table public.os_campo       alter column entrada drop default;
alter table public.saida_material alter column origem  drop default;
*/


-- =====================================================================
-- BLOCO 9 — CONFERENCIA FINAL (so leitura). Tudo tem que sair 'OK'.
-- =====================================================================
with c(grupo, item, ok) as (
  select '1 UNICIDADE', 'ux_os_campo_numero_ativo (numero unico p/ O.S. viva)',
    exists(select 1 from pg_indexes where schemaname='public' and indexname='ux_os_campo_numero_ativo')
  union all select '1 UNICIDADE', 'ux_os_campo_numero_fict_ativo',
    exists(select 1 from pg_indexes where schemaname='public' and indexname='ux_os_campo_numero_fict_ativo')
  union all select '1 UNICIDADE', 'ZERO duplicata de numero entre O.S. vivas',
    not exists(select 1 from os_campo where numero is not null and excluida=false
               group by numero having count(*)>1)

  union all select '2 CHECKS', 'ck_os_campo_status',
    exists(select 1 from pg_constraint where conname='ck_os_campo_status')
  union all select '2 CHECKS', 'ck_os_campo_medicao',
    exists(select 1 from pg_constraint where conname='ck_os_campo_medicao')
  union all select '2 CHECKS', 'ck_os_campo_tem_identidade',
    exists(select 1 from pg_constraint where conname='ck_os_campo_tem_identidade')
  union all select '2 CHECKS', 'ck_os_campo_datas_coerentes',
    exists(select 1 from pg_constraint where conname='ck_os_campo_datas_coerentes')
  union all select '2 CHECKS', 'ck_saida_qtd_positiva',
    exists(select 1 from pg_constraint where conname='ck_saida_qtd_positiva')
  union all select '2 CHECKS', 'ck_saida_os_ref_formato',
    exists(select 1 from pg_constraint where conname='ck_saida_os_ref_formato')
  union all select '2 CHECKS', 'ck_entrada_qtd_positiva',
    exists(select 1 from pg_constraint where conname='ck_entrada_qtd_positiva')
  union all select '2 CHECKS', 'ck_ferramenta_status',
    exists(select 1 from pg_constraint where conname='ck_ferramenta_status')
  union all select '2 CHECKS', 'ck_solicitacao_status',
    exists(select 1 from pg_constraint where conname='ck_solicitacao_status')

  union all select '3 VINCULO O.S.', 'funcao fpv_resolve_os_ref',
    exists(select 1 from pg_proc where proname='fpv_resolve_os_ref')
  union all select '3 VINCULO O.S.', 'coluna saida_material.os_id',
    exists(select 1 from information_schema.columns
           where table_schema='public' and table_name='saida_material' and column_name='os_id')
  union all select '3 VINCULO O.S.', 'FK fk_saida_material_os',
    exists(select 1 from pg_constraint where conname='fk_saida_material_os')
  union all select '3 VINCULO O.S.', 'trigger trg_saida_vincula_os',
    exists(select 1 from pg_trigger where tgname='trg_saida_vincula_os')
  union all select '3 VINCULO O.S.', 'view vw_saida_material_orfa',
    exists(select 1 from information_schema.views
           where table_schema='public' and table_name='vw_saida_material_orfa')

  union all select '4 ATUALIZADO_EM', 'coluna em os_campo',
    exists(select 1 from information_schema.columns
           where table_schema='public' and table_name='os_campo' and column_name='atualizado_em')
  union all select '4 ATUALIZADO_EM', 'trigger nas 7 tabelas',
    (select count(*) from pg_trigger where tgname='trg_atualizado_em' and not tgisinternal) = 7

  union all select '5 INDICES', 'os_campo: 7 indices novos',
    (select count(*) from pg_indexes where schemaname='public' and indexname in
      ('idx_os_campo_criado_em','idx_os_campo_numero','idx_os_campo_status_med',
       'idx_os_campo_medicao','idx_os_campo_entrada','idx_os_campo_executor',
       'idx_os_campo_ativas')) = 7
  union all select '5 INDICES', 'log: 4 indices novos',
    (select count(*) from pg_indexes where schemaname='public' and indexname in
      ('idx_os_log_os_id','idx_os_log_quando','idx_os_log_por_email','idx_os_log_ref')) = 4
)
select case when ok then 'OK' else '>>> FALTOU' end as res, grupo, item
from c order by ok asc, grupo, item;

-- Quadro de saude do dado (nao e OK/FALTOU, e numero para acompanhar):
select
  (select count(*) from os_campo where excluida = false)                     as os_vivas,
  (select count(*) from os_campo where numero is null and excluida = false)  as os_sem_numero,
  (select count(*) from public.vw_saida_material_orfa)                       as saidas_orfas,
  (select count(*) from saida_material where quantidade is null or quantidade <= 0) as saidas_qtd_zero,
  (select count(*) from saida_material where os_id is not null)              as saidas_vinculadas,
  (select count(*) from os_campo where classificacao = 'IIII')               as classif_digitada_errado;

-- =====================================================================
-- FIM DO 06-integridade.sql
-- =====================================================================
