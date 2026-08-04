# FPV CAMPO SAÚDE — identidade do projeto (leia antes de mexer)

App de campo da F.P. Vieira Engenharia para o contrato **FP.096 (Saúde,
Rio das Ostras, contrato 005/2026, R$ 12.285.820,33, mar/26–fev/27,
~24 unidades)**: registro de O.S., almoxarifado, medição EMOP.
Réplica parametrizada do app da Educação (FP.094) feita em 09/07/2026
seguindo `EXPANSAO-5-CONTRATOS.md`; **tema AZUL (#185FA5) + almoxarife
Lorran + numeração F-1 + migrations auditadas aplicados em 03/08/2026**.
Stack: **React 19 + Vite + Tailwind CDN + Supabase** (auth + postgres +
storage + realtime). Deploy: Vercel builda a cada push na `main`. A
máquina do Renan (nicol) tem Node v24 — dev server local funciona;
validação final de build continua na Vercel.

- ⚠ **Supabase AINDA NÃO CRIADO** — bootstrap: rodar
  `supabase/migrations/0000_schema_version.sql` + `0001_baseline.sql`
  (edição Saúde: seq_fict=1, policies com lorran@) e depois, quando a
  operação estabilizar, `seguranca/01→04→02→03` em modo observação
  (método validado na Educação). ⛔ NÃO usar os SQLs de
  `legado-educacao/` — 3 deles regridem segurança (auditoria 28/07,
  `seguranca/08-migrations-PLANO.md`). Bucket `fotos-os` público (2
  policies — paridade com a Educação; endurecer com seguranca/09);
  usuários no Auth conforme `ACESSOS` em config.ts. Conferência:
  `CONFERENCIA-GERAL.sql` (só leitura). Roteiro completo:
  `DEPLOY-SAUDE.md`.
- **Páginas standalone da fase 1 continuam publicadas**: `/painel.html`
  (painel do engenheiro — cola export do WhatsApp) e `/medicao.html`
  (pacote de junho do Edmar). Não dependem de Supabase. Entradas extras
  no `vite.config.ts`.
- **Numeração dos contratos:** Educação = FP.094 · Saúde = FP.096. O
  pacote de continuidade local chegou rotulado "SAUDE_094" — é o mesmo
  contrato 005/2026; confirmar rótulo com o Renan.
- Contexto de medição (dedução EMOP, regras material→serviço, consolidado
  de junho): pasta local `C:\Users\meleo\Documents\FP_VIEIRA_SAUDE_094\`
  (LEIA-ME-PRIMEIRO.md) e a memória do Claude desta máquina.
- Antes de entregar: consulte `ERROS-E-LICOES.md` (herdado da Educação —
  não regrida) e, se mexeu em banco, rode `CONFERENCIA-GERAL.sql`.

## Regras DURAS (herdadas da Educação — não reverter sem o Renan)

1. **Número de O.S. é ETERNO.** Nunca delete físico: `osService.excluir`
   marca `excluida=true`; livro-razão `os_campo_log` grava tudo.
2. **Toda release visível bumpa `VERSAO` em `App.tsx`** (diagnóstico de
   cache de bundle no celular do campo).
3. **Datas sempre com `hojeLocal()`** (config.ts). `toISOString()` para
   data é proibido.
4. **Referência única da O.S.: `refDaOS()`** em types.ts (oficial >
   N/Q/E > F-nn). Nenhuma tela monta a ref na mão.
5. **Status são strings** — fonte única `STATUS_OPTIONS` em types.ts.
6. **Quem sai da operação sai das LISTAS** (EXECUTOR_OPTIONS, ACESSOS,
   CORRETIVA) — o histórico mora só no banco.
7. **RLS:** nada de `USING (true)` em delete. Financeiro restrito por
   RLS a Lucas/Rafael.
8. **Chaves:** anon key só em env da Vercel. Service role NUNCA no repo.
9. **Planilhas originais do contrato são read-only** — entregáveis sempre
   em arquivo novo.
10. Botões de salvar: travar com ref/state ANTES do 1º `await`; realtime
    sempre com debounce ~1,2s; match de texto humano normalizado.

## Papéis e logins (@fpv.app — criar no Auth quando o Supabase nascer)

neilson · queiroz (eletricistas, painel pessoal N/Q) · emiliano
(encarregado, E) · lorran (almoxarifado — Lorran Souza, usuário-âncora do
onboarding; trocou o Thiago Rafael em 03/08/2026) ·
leony (engenheiro → TelaEngenheiro) · edmar (medição → TelaMedicao) ·
renan / lucas / rafael (gestão → boletim; financeiro só lucas/rafael) ·
brendah (assistente). Fonte: `ACESSOS` em config.ts.

## Pendências da parametrização (confirmar com Leony/Renan)

- Zonas/fiscais reais do contrato (hoje tudo 'SEMUSA'; `EQUIPES` vazio —
  eletricistas entraram como CORRETIVA por executor)
- WhatsApp dos designados (`DESIGNADOS.zap` vazio esconde o 📲 Avisar)
- Lista de unidades (`data/escolas.ts` — nome do arquivo mantido do
  padrão; aqui "escola" = unidade de saúde) veio do diário de junho
- `ChatOS.tsx` (voz, desligada) e `public/treinamento/` ainda falam
  "escola" — ajustar texto quando forem ativados
- Ordem de onboarding que funcionou na Educação: 1º almoxarife → equipes
  → encarregado → engenheiro → medição → gestores
