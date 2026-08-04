# ⛔ SQLs LEGADOS DA EDUCAÇÃO — NÃO RODAR NA SAÚDE

Estes arquivos vieram do repo da Educação (FPV-Campo) e estão aqui **só
como referência histórica**. A instalação do banco da Saúde usa
EXCLUSIVAMENTE `supabase/migrations/0000_schema_version.sql` +
`0001_baseline.sql` (ver `DEPLOY-SAUDE.md`).

Por que não rodar (auditoria 28/07/2026, `seguranca/08-migrations-PLANO.md`):

- `supabase.sql` e `RODAR-NO-SQL-EDITOR.sql` **regridem segurança**
  (recriam policies `using(true)` por cima de RLS endurecida);
- `estoque_schema.sql` é um desenho multi-contrato **descontinuado e
  conflitante** (tabela `ferramenta` incompatível — nunca foi aplicado);
- os demais estão **consolidados** no `0001_baseline.sql` — rodar de novo
  só reintroduz as diferenças que o baseline corrigiu (seq_fict em 77,
  e-mails da Educação nas policies etc.).
