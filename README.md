# FPV Campo Saúde (FP.096)

App de campo e ferramentas de medição do contrato **F.P. Vieira · Saúde —
Rio das Ostras (contrato 005/2026)**. Réplica parametrizada do app da
Educação (fpvieira.vercel.app), seguindo `EXPANSAO-5-CONTRATOS.md`.

Esteira do dado: **campo registra O.S. no app → foto + memória de cálculo
→ engenheiro confere → esteira de medição (5 selos) → export p/ planilha
oficial EMOP**. Enquanto o app não assume, as ferramentas da fase 1
continuam no ar (WhatsApp → painel → dedução).

## Páginas

| Página | Quem usa | Status |
|---|---|---|
| `/` (app React) | todos — login em 2 toques, tela por papel | 🔶 aguardando Supabase |
| — Painel pessoal | Neilson/Queiroz/Emiliano: designadas, prioridade, material | 🔶 |
| — Almoxarifado | Lorran Souza (usuário-âncora) | 🔶 |
| — Gestão | Leony (rota/conferência) · Edmar (5 selos/MED) · Renan/Lucas/Rafael (boletim) | 🔶 |
| `/painel.html` | Leony: cola o export do grupo WhatsApp → fechamentos, pendências, estimativa EMOP | ✅ ativo (fase 1) |
| `/medicao.html` | Edmar: pacote de junho — 22 itens auditados, memória, cenários, 16 perguntas | ✅ ativo (fase 1) |

## Stack

React 19 + Vite + Tailwind CDN + Supabase (auth, postgres, storage,
realtime) + Vercel. As páginas da fase 1 são HTML puro (dados embutidos,
funcionam offline) e entram como páginas extras do build Vite.

```bash
npm install     # uma vez
npm run dev     # desenvolvimento (http://localhost:5173)
npm run build   # gera dist/
```

## Subir produção (na ordem)

1. **Supabase** — criar projeto (grátis) e rodar no SQL Editor, na ordem:
   `supabase/migrations/0000_schema_version.sql` →
   `supabase/migrations/0001_baseline.sql` (edição Saúde: seq_fict=1,
   policies com lorran@). ⛔ NÃO usar `legado-educacao/` (3 arquivos
   regridem segurança — ver `seguranca/08-migrations-PLANO.md`). Bucket
   `fotos-os` público (2 policies insert/select p/ authenticated).
   Conferência: `CONFERENCIA-GERAL.sql` (só leitura). Fase 2:
   `seguranca/01→04→02→03` em modo observação. Roteiro completo:
   `DEPLOY-SAUDE.md`.
2. **Usuários** — Auth → Add user (Auto Confirm) para cada e-mail de
   `ACESSOS` (config.ts).
3. **Vercel** — importar o repo (preset **Vite** automático) + 2 env vars:
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (só a chave **anon**;
   env var nova exige Redeploy — lição #14). Sem as env vars o app abre
   com aviso de configuração e as páginas da fase 1 funcionam normalmente.
4. **Onboarding** (ordem que funcionou na Educação): 1º almoxarife →
   eletricistas → encarregado → engenheiro → medição → gestores.

## O que é parametrizado por contrato

| O quê | Onde |
|---|---|
| Papéis, equipes, login 2 toques, âncora da MED | `config.ts` |
| Fiscais/executores/medições válidos | `types.ts` |
| Unidades de saúde | `data/escolas.ts` |
| Catálogo de materiais | `data/materiais.ts` |
| Nº do contrato nos cabeçalhos | `App.tsx`, `LoginScreen.tsx`, `FechamentoSemanal.tsx`, `Financeiro.tsx` |

## Privacidade

**Não subir neste repositório**: planilhas de medição, exports do
WhatsApp (`_chat.txt`), fotos de obra ou qualquer dado de contrato — o
`.gitignore` bloqueia os formatos comuns. Recomendado manter o
repositório **privado**.

## Método

`CLAUDE.md` = identidade e regras duras · `ERROS-E-LICOES.md` = 22 lições
de produção herdadas da Educação (não regrida) · `DEPLOY.md` e
`COMANDOS.md` = referência operacional · `EXPANSAO-5-CONTRATOS.md` = a
receita desta replicação.
