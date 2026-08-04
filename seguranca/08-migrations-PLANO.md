# 08 · Plano de migrations versionadas — FPV Campo

**Achado atacado:** ALTO 6 (14 SQLs sobrepostos em vez de migrations versionadas)
**Data:** 28/07/2026 · **Banco:** `fpv-campo22` (lgdnuyreaknxjswrfbjw) · **2.069 O.S. em produção**

---

## 1. O problema em uma frase

Hoje ninguém — nem o Renan, nem eu, nem quem entrar depois — consegue responder
**"o que exatamente está aplicado neste banco?"** sem abrir o painel do Supabase e olhar.
Os 14 `.sql` na raiz do repo não são um histórico: são 14 fotografias parciais e
sobrepostas, com nomes que não dizem a ordem (`RODAR-NO-SQL-EDITOR.sql` roda antes ou
depois de `PENDENTES-CONSOLIDADO.sql`?), e **três deles regridem segurança se rodados
hoje**.

---

## 2. As três armadilhas reais (não são teoria)

Estas eu confirmei lendo os arquivos linha a linha. São o motivo de este plano ser
urgente e não cosmético.

### 2.1 `RODAR-NO-SQL-EDITOR.sql` reabre o DELETE do almoxarifado

```sql
-- linhas 22-27 do RODAR-NO-SQL-EDITOR.sql
drop policy if exists "almox_delete" on saida_material;
create policy "almox_delete" on saida_material for delete to authenticated using (true);
```

O `AUDITORIA-RLS-FIX.sql` criou a policy restrita `almox_delete_restrito`.
Rodar `RODAR-NO-SQL-EDITOR.sql` de novo **não remove a restrita** — ela tem outro nome.
Resultado: as duas policies passam a coexistir. Policies de RLS em PostgreSQL são
**permissivas e combinadas com OR**. A permissiva `using (true)` vence.

**Efeito prático:** qualquer login de encarregado volta a poder apagar saída de material
via REST. É exatamente o buraco que o `AUDITORIA-RLS-FIX.sql` tinha fechado.

### 2.2 `supabase.sql` faz o mesmo com a O.S.

```sql
create policy "fpv_autenticados_delete" on os_campo for delete to authenticated using (true);
```

Sem `drop policy if exists` antes, e sem `IF NOT EXISTS` (que não existe em
`CREATE POLICY` no PostgreSQL). Rodar duas vezes ou dá erro no meio do script — deixando
as policies de storage do final **não aplicadas** — ou, se a policy antiga já tiver sido
removida, recria a permissiva ao lado da `fpv_gestores_delete`.

### 2.3 `estoque_schema.sql` cria uma tabela `ferramenta` **diferente** da de produção

| | `estoque_schema.sql` | produção (via `ALMOX-V2.sql`) |
|---|---|---|
| `id` | `SERIAL` | `bigint generated always as identity` |
| colunas | `item_id`, `patrimonio`, `contrato_id`, `estado`, `custo`, `aquisicao` | `descricao`, `quantidade`, `status`, `com_quem`, `obra`, `desde`, `obs` |
| `CREATE` | `CREATE TABLE` (sem `IF NOT EXISTS`) | `create table if not exists` |

`estoque_schema.sql` é um schema **inteiro e paralelo** (`contrato`, `item`, `movimento`,
`usuario`, 4 ENUMs, `INSERT` de seed com e-mails `@fpvieira.com`). Confirmei via API:
**nenhuma dessas tabelas existe no Supabase de produção.** Foi escrito para uma VPS que
não foi por esse caminho. Está no repo dando a impressão de que é o modelo do estoque —
e não é. Se alguém rodar por engano, o `CREATE TYPE` falha, o script aborta no meio, e
quem estiver lendo acha que "rodou".

---

## 3. Deriva silenciosa: 3 colunas em produção que não existem em nenhum `.sql`

Comparei o schema real (OpenAPI do PostgREST) contra os 14 arquivos:

| coluna em `os_campo` | aparece em algum `.sql`? |
|---|---|
| `oficializada_em` (timestamptz) | **não** |
| `par_sugerido` (text) | **não** |
| `geo` (text) | **não** |

Foram criadas direto no painel. O app **usa** as três (`ListaOS.tsx` grava
`par_sugerido` na fusão de fictícia). Ou seja: **hoje é impossível recriar o banco a
partir do repo.** Um ambiente de teste montado com os 14 arquivos quebraria o app.

Isso está corrigido em `supabase/migrations/0001_baseline.sql`.

---

## 4. Veredicto arquivo por arquivo

| # | arquivo | o que faz | veredicto |
|---|---|---|---|
| 1 | `supabase.sql` | cria `os_campo`, `seq_fict`, `trg_fict`, RLS inicial, policies do bucket | **absorvido** no baseline. Contém a armadilha 2.2 |
| 2 | `almoxarifado.sql` | cria `saida_material` + policies + 2 índices | **redundante** — subconjunto exato do `RODAR-NO-SQL-EDITOR.sql` §1 |
| 3 | `RODAR-NO-SQL-EDITOR.sql` | `saida_material` + colunas da O.S. + ajuste `seq_fict` | **absorvido**. Contém a armadilha 2.1 |
| 4 | `ALMOX-V2.sql` | `estoque_item`, `entrada_material`, `ferramenta`, `solicitacao_material`, `apelido_material`, colunas de recebimento | **absorvido**. É a fonte real do módulo estoque |
| 5 | `AUDITORIA-EDICOES.sql` | `os_campo_log` + `fpv_log_os` + `trg_fpv_log_os` + coluna `excluida` | **absorvido**. Peça central |
| 6 | `AUDITORIA-RLS-FIX.sql` | restringe DELETE de `os_campo` e `saida_material` | **redundante** — subconjunto do #8 |
| 7 | `PENDENTES-CONSOLIDADO.sql` | RLS de delete + colunas + numeração por equipe | **redundante** — subconjunto do #8 |
| 8 | `AUDITORIA-CORRECOES-2026-07-07.sql` | superset de #6 e #7 + `apelido_material` + `saida_material` | **absorvido**. É o mais completo dos três |
| 9 | `TIPO-ATIVIDADE.sql` | `alter table os_campo add column tipo` | **redundante** — 1 linha, contida em #10 |
| 10 | `REALTIME-E-TIPO.sql` | coluna `tipo` + publicação realtime das 6 tabelas | **absorvido** |
| 11 | `FINANCEIRO.sql` | `contrato_financeiro` + RLS régua fechada | **absorvido** |
| 12 | `supabase_vps.sql` | mesmo trigger de numeração, mas para Supabase self-hosted + notas do n8n | **descontinuado** — outro ambiente. Conflita no `setval` da `seq_fict` |
| 13 | `estoque_schema.sql` | schema paralelo (contrato/item/movimento/usuário) | **descontinuado e conflitante** — ver 2.3. Nunca foi aplicado |
| 14 | `CONFERENCIA-GERAL.sql` | 100% `SELECT`, não altera nada | **não é migration** — vira script de diagnóstico |

**Resumo:** 8 absorvidos, 4 redundantes, 2 descontinuados, 1 vira ferramenta.
Nenhum arquivo é apagado — todos vão para `sql-legado/` com o histórico do git intacto.

---

## 5. Estrutura proposta

```
supabase/
  migrations/
    0000_schema_version.sql        <- controle de versão (JÁ ESCRITO)
    0001_baseline.sql              <- esquema-base reproduzível (JÁ ESCRITO)
    0002_rls_por_papel.sql         <- seguranca/01..05 (Frente 1)
    0003_integridade.sql           <- seguranca/06-integridade.sql (Frente 3)
    0004_auditoria_estoque.sql     <- seguranca/07-auditoria-estoque.sql (Frente 3)
    0005_fotos_privadas.sql        <- seguranca/09-fotos-privadas.sql (Frente 2)
  scripts/
    conferencia.sql                <- ex-CONFERENCIA-GERAL.sql (só leitura)
    diff-schema.sql                <- compara banco real x baseline
sql-legado/
  README.md                        <- "NÃO RODE NADA AQUI" + porquê de cada um
  supabase.sql · almoxarifado.sql · ... (os 14 originais, intocados)
```

### As 4 regras

1. **Migration aplicada é imutável.** Nunca se edita um `NNNN_*.sql` já registrado em
   `schema_version`. Precisou mudar? Cria a próxima.
2. **Numeração sequencial de 4 dígitos**, nunca por data. Data não diz ordem quando duas
   pessoas escrevem no mesmo dia.
3. **Toda migration termina chamando `fpv_migracao('NNNN', ...)`.** É o que faz o banco
   saber o que já tem.
4. **Toda migration é idempotente e traz o `ROLLBACK` comentado no rodapé.** Sem exceção
   — regra de ouro do Renan.

### A tabela de controle

`0000_schema_version.sql` (já escrito) cria:

- `public.schema_version` — `versao` (PK), `descricao`, `arquivo`, `aplicado_em`,
  `aplicado_por`, `observacao`. RLS ligada **sem nenhuma policy**: invisível pela API do
  app, legível só pelo SQL Editor.
- `fpv_migracao(versao, descricao, arquivo, observacao)` → registra e devolve
  `true`/`false`. `ON CONFLICT DO NOTHING`, então rodar 2x não duplica.
- `fpv_migracao_pendente(versao)` → para abortar cedo em migration cara.
- `vw_schema_version` → leitura ordenada.

---

## 6. Como aplicar em produção sem derrubar a operação

O banco **já tem** o conteúdo das migrations 0000 e 0001 aplicado (foi aplicado à mão, aos
pedaços, ao longo de meses). Então a adoção é **só de registro** — nenhuma alteração de
dado. Isso é o que se chama de *baseline em banco existente*.

**Ordem, com janela sugerida:**

| passo | o que rodar | duração | risco |
|---|---|---|---|
| 1 | `0000_schema_version.sql` | < 1s | **nenhum** — só cria tabela nova e 2 funções |
| 2 | `scripts/conferencia.sql` (ex-CONFERENCIA-GERAL) | < 1s | nenhum, é `SELECT` |
| 3 | `0001_baseline.sql` **inteiro** | ~2s | **baixo** — tudo é `IF NOT EXISTS` / `drop policy` + `create policy`. Efeito colateral desejado: remove as policies permissivas órfãs (armadilhas 2.1 e 2.2) se existirem |
| 4 | `select * from vw_schema_version;` | — | deve listar 0000 e 0001 |
| 5 | `0003` (integridade) — **bloco a bloco**, com o Renan aprovando o BLOCO 1 | ~10 min | médio — ver `06-integridade.sql` |
| 6 | `0004` (auditoria estoque) — pode colar inteiro | ~2s | baixo, 100% aditivo |

**Janela recomendada:** passos 1–4 em qualquer horário (são segundos e não travam nada).
Passos 5–6 fora do horário de campo — sugestão: **depois das 18h ou no sábado de manhã**,
com a medição em curso, evite segunda de manhã.

**Antes do passo 3, tire o retrato:**

```sql
-- guarde o resultado destes 3 SELECTs num arquivo antes de mexer
select schemaname, tablename, policyname, cmd, qual, with_check
  from pg_policies where schemaname='public' order by tablename, policyname;
select tgname, relname from pg_trigger t
  join pg_class c on c.oid=t.tgrelid where not t.tgisinternal order by 2,1;
select table_name, column_name, data_type from information_schema.columns
  where table_schema='public' order by 1,2;
```

Se algo sair diferente do esperado, esses três resultados são o mapa de volta.

---

## 7. Os comandos da reorganização do repo

Rodar na raiz de `C:/Users/nicol/FPV-Campo`, **em branch separada**, e abrir PR:

```bash
git switch -c chore/migrations-versionadas

mkdir -p supabase/migrations supabase/scripts sql-legado

# o que vira ferramenta de diagnóstico
git mv CONFERENCIA-GERAL.sql supabase/scripts/conferencia.sql

# os 13 restantes viram histórico (git mv preserva o log de cada um)
git mv supabase.sql almoxarifado.sql RODAR-NO-SQL-EDITOR.sql ALMOX-V2.sql \
       AUDITORIA-EDICOES.sql AUDITORIA-RLS-FIX.sql AUDITORIA-CORRECOES-2026-07-07.sql \
       PENDENTES-CONSOLIDADO.sql TIPO-ATIVIDADE.sql REALTIME-E-TIPO.sql \
       FINANCEIRO.sql supabase_vps.sql estoque_schema.sql \
       sql-legado/

# 0000 e 0001 já estão escritos em supabase/migrations/
git add supabase/ sql-legado/
git commit -m "chore(db): migrations versionadas + baseline reproduzível

Consolida os 14 SQLs soltos da raiz em supabase/migrations/ numeradas e
imutáveis, com tabela schema_version. Corrige três regressões de segurança
latentes (policies permissivas recriadas sem drop) e três colunas de
os_campo que existiam em produção sem estar em nenhum .sql."
```

**`sql-legado/README.md` precisa começar com:**

> ## NÃO RODE NADA DESTA PASTA
> Estes arquivos são o histórico de como o banco foi construído entre jun e jul/2026.
> Vários deles **regridem segurança** se rodados hoje (ver `seguranca/08-migrations-PLANO.md` §2).
> O schema oficial vive em `supabase/migrations/`.

---

## 8. Como provar que o baseline realmente reproduz produção

Sem esta prova, o baseline é só uma promessa. O teste custa ~10 minutos:

1. Crie um projeto Supabase novo e vazio (plano free serve, é descartável).
2. Rode, nesta ordem: `0000_schema_version.sql`, `0001_baseline.sql`.
3. Rode `supabase/scripts/conferencia.sql` nos **dois** bancos (novo e produção).
4. Compare as saídas. Devem ser idênticas exceto storage/bucket.
5. Rode este diff de colunas nos dois e compare linha a linha:

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('os_campo','saida_material','entrada_material','estoque_item',
                     'ferramenta','solicitacao_material','apelido_material',
                     'contrato_financeiro','os_campo_log')
order by table_name, column_name;
```

6. Apague o projeto de teste.

Se der diferença, a diferença **é** o próximo achado — e vira a migration `0006`.

---

## 9. Depois disto (fora do escopo desta frente, mas é a sequência natural)

- Instalar o Supabase CLI (`supabase link` + `supabase db push`) para as próximas
  migrations rodarem por comando e não por copiar-e-colar no painel. O formato de
  `supabase/migrations/` que propus **já é o que o CLI espera** — só o nome dos arquivos
  precisaria virar `<timestamp>_nome.sql` no dia que adotarem.
- Ligar isso no CI junto com o lint/teste do achado ALTO 5 — o mesmo PR que trava
  `npm run build` também deve travar migration sem `fpv_migracao(...)` no final.
- Commitar o lockfile (achado ALTO 5): sem ele, o build do Vercel pode instalar uma
  versão diferente de `@supabase/supabase-js` da que está testada aqui.

---

## 10. Checklist de conclusão

- [ ] `0000_schema_version.sql` aplicado em produção
- [ ] `0001_baseline.sql` aplicado; `vw_schema_version` mostra 0000 e 0001
- [ ] Retrato de policies/triggers/colunas salvo antes do passo 3
- [ ] Conferência do §8 rodada num projeto descartável e batendo
- [ ] Repo reorganizado, `sql-legado/README.md` com o aviso em vermelho
- [ ] Duplicatas 1218 e 1673 decididas pelo Renan (`06-integridade.sql` BLOCO 1)
- [ ] `0003` e `0004` aplicados fora do horário de campo
