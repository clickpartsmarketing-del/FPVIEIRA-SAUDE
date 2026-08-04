# DEPLOY — FPV Campo SAÚDE (repo FPVIEIRA-SAUDE, do zero ao ar)

Roteiro da implantação (ago/2026). O repo é este mesmo
(`clickpartsmarketing-del/FPVIEIRA-SAUDE`) — app React na raiz +
páginas da fase 1 (`/painel.html`, `/medicao.html`) preservadas pelo
build multi-página do Vite. Senhas NUNCA entram no repo — combinar por
WhatsApp.

## 1. Vercel (navegador do Renan) — ATENÇÃO: projeto já existe

O projeto `fpvieira-saude` na Vercel foi criado como site ESTÁTICO
("Other"). O repo agora tem `vercel.json` com `buildCommand` +
`outputDirectory`, que força o build Vite mesmo no projeto antigo —
então o push já publica o app. Conferir/ajustar:

1. Settings → Environment Variables (Production):
   - `VITE_SUPABASE_URL` = Project URL (passo 2)
   - `VITE_SUPABASE_ANON_KEY` = anon key (passo 2)
2. Lição #14: env var nova só entra em BUILD novo → Redeploy.
3. Sem as env vars o app abre com aviso de configuração (não quebra);
   `/painel.html` e `/medicao.html` funcionam sempre (não usam Supabase).
4. Celular: abrir a URL → menu ⋮ → "Instalar aplicativo" (PWA azul).

## 2. Supabase (navegador do Renan)

1. supabase.com → New project (org da FPV) → nome `fpv-saude`,
   região `sa-east-1`, senha forte do banco (guardar no cofre).
2. SQL Editor → colar e rodar, NESTA ORDEM:
   - `supabase/migrations/0000_schema_version.sql`
   - `supabase/migrations/0001_baseline.sql` (edição Saúde: seq_fict=1,
     policies com lorran@)
   - conferir: o SELECT final deve dizer 9 tabelas · 2 triggers · realtime 6.
   ⛔ NÃO rodar nada de `legado-educacao/` (3 arquivos regridem
   segurança — auditoria 28/07, `seguranca/08-migrations-PLANO.md`).
3. (Fase 2, decisão conjunta) `seguranca/01 → 04 → 02 → 03` em modo
   observação. NÃO rodar o 05 nem a ETAPA 2 do 09.
4. Storage → Create bucket `fotos-os` → **Public** (paridade com a
   Educação; endurecer depois com seguranca/09) → 2 policies de
   insert/select para authenticated.
5. Authentication → Users → Add user (**Auto Confirm ON**), @fpv.app:
   - `lorran@fpv.app` (almoxarifado — Lorran Souza, usuário-âncora)
   - `neilson@fpv.app`, `queiroz@fpv.app`, `emiliano@fpv.app` (campo)
   - `leony@fpv.app`, `edmar@fpv.app`, `renan@fpv.app`, `lucas@fpv.app`,
     `rafael@fpv.app`, `brendah@fpv.app`
   - senha inicial: padrão pessoal combinado por WhatsApp; troca no app 🔑.
   - Alternativa: salvar as chaves admin em
     `C:\Users\nicol\.claude\fpv_saude_supabase.env` (SUPABASE_URL +
     SERVICE_ROLE_JWT, molde do fpv_supabase.env da Educação) e o Claude
     cria os usuários via admin API e testa cada login por token.
6. Settings → API: copiar Project URL e anon key → passo 1.

## 3. Conferências finais

- Login do Lorran no celular → cai direto na aba Almoxarifado.
- Saída de teste com "gerar O.S." → nasce **F-1** (ou N01/Q01/E01 se o
  retirante for Neilson/Queiroz/Emiliano).
- `CONFERENCIA-GERAL.sql` no SQL Editor (só leitura) — checks de e-mail
  citam nomes da Educação; divergência de NOMES é esperada, estrutura não.
- Cabeçalho do app mostra **v1** (bundle fresco) e o tema é AZUL.
- `/painel.html` (Leony) e `/medicao.html` (Edmar) seguem no ar.

## Ordem de onboarding (a que funcionou na Educação)

1º Lorran (almoxarife-âncora) → eletricistas (Neilson/Queiroz) →
Emiliano → Leony → Edmar → gestores.

## Pendências conhecidas (não bloqueiam o go-live)

- Zonas/fiscais reais (hoje tudo 'SEMUSA') e WhatsApp dos designados.
- Rótulo do contrato: FP.096 vs "Saúde 094" (portal) — confirmar com a
  diretoria qual vai nos cabeçalhos oficiais.
- Conteúdo de `public/treinamento/` ainda fala "escola" em alguns textos.
- Fase 2 de segurança (RLS por papel em observação + fotos privadas).
