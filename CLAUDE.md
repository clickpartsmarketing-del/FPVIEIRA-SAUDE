# FPV CAMPO SAÚDE — identidade do projeto (leia antes de mexer)

App de campo da F.P. Vieira Engenharia para o contrato **FP.096 (Saúde,
Rio das Ostras, contrato 005/2026, R$ 12.285.820,33, mar/26–fev/27,
~24 unidades)**: registro de O.S., almoxarifado, medição EMOP.
Réplica parametrizada do app da Educação (FP.094) feita em 09/07/2026
seguindo `EXPANSAO-5-CONTRATOS.md`. Stack: **React 19 + Vite + Tailwind
CDN + Supabase** (auth + postgres + storage + realtime). Deploy: Vercel
builda a cada push na `main`. NÃO há Node/npm nas máquinas locais —
validação de build acontece na Vercel.

- ⚠ **Supabase AINDA NÃO CRIADO** — bootstrap: rodar na ordem
  `supabase.sql` → `supabase_vps.sql` (+ `alter table os_campo add column
  if not exists solicitado text;`) → `almoxarifado.sql` → `ALMOX-V2.sql` →
  `PENDENTES-CONSOLIDADO.sql` → `REALTIME-E-TIPO.sql` →
  `AUDITORIA-EDICOES.sql`; bucket `fotos-os` público (2 policies do
  supabase.sql); usuários no Auth conforme `ACESSOS` em config.ts.
  Conferência: `CONFERENCIA-GERAL.sql` (só leitura).
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
(encarregado, E) · thiago (almoxarifado — usuário-âncora do onboarding) ·
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
