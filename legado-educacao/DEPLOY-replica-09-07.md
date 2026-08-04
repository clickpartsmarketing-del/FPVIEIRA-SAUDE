# 🚀 FPV Campo — Deploy (mesmo caminho do seu app EMATER)

App de campo do contrato FP.094: registrar O.S. emergenciais com foto e memória
de cálculo, banco central compartilhado entre as equipes, e fechamento semanal
em PDF para assinatura do fiscal.

## 1. Supabase (~5 min)

1. [supabase.com](https://supabase.com) → **New Project** (nome: `fpv-campo`).
2. **SQL Editor** → New Query → cole e execute, nessa ordem:
   1. **`supabase.sql`**
   2. **`almoxarifado.sql`**
   3. **`ALMOX-V2.sql`**
   4. **`PENDENTES-CONSOLIDADO.sql`**
   5. **`AUDITORIA-EDICOES.sql`**
   6. **`REALTIME-E-TIPO.sql`**
   7. **`AUDITORIA-CORRECOES-2026-07-07.sql`**

   O último arquivo é seguro e idempotente: ele alinha colunas/tabelas usadas pelo app atual sem apagar dados.
3. **Storage** → New Bucket → nome exato **`fotos-os`** → marcar **Public bucket**.
4. **Authentication → Users → Add user** → crie os logins (lista sugerida no
   fim do `supabase.sql`). Marque **Auto Confirm User** em cada um.
5. **Settings → API**: copie a **Project URL** e a **anon/public key**.

## 2. Rodar local (teste rápido)

```bash
cd FPV-Campo
npm install
```

Crie o arquivo **`.env.local`** na raiz:

```
VITE_SUPABASE_URL=https://SEUPROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key
```

```bash
npm run dev
```

Abra http://localhost:5173, entre com um dos logins criados e registre uma O.S. de teste.

## 3. Vercel (produção)

1. Suba a pasta para um repositório GitHub (**o `.env.local` não vai junto** — já está no `.gitignore`).
2. Vercel → **Add New → Project** → importe o repo.
3. **Environment Variables**: adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**. Pronto: mande o link pros 4 encarregados — no Chrome do celular,
   menu ⋮ → **"Adicionar à tela inicial"** = vira ícone de app, sem loja.

## 4. Fluxo da semana (o teste D1)

1. Encarregado vive a emergência → registra a O.S. na hora (foto + **ditado por
   voz** da memória de cálculo — botão de microfone).
2. Engenharia acompanha em "Lançadas" (banco central, todos veem o mesmo).
3. Sexta-feira: aba **Fechamento** → seleciona a semana → **Imprimir/PDF** →
   uma folha por O.S. com serviço, materiais, memória de cálculo, fotos e
   campos de assinatura (encarregado + fiscal) → leva ao fiscal → medição.

## 5. Segurança (lições do agro-v7 aplicadas)

- ✅ Login **real** (Supabase Auth) — sem senha no código-fonte.
- ✅ RLS: só autenticados leem/escrevem (nada de acesso público aos dados).
- ✅ Exclusão física de O.S. e saídas restrita por policy; no app, O.S. vira marca de exclusão para preservar a numeração.
- ✅ Chaves só em variável de ambiente — nunca no repositório.
- ⚠️ A **anon key** do Supabase pode aparecer no bundle do navegador — isso é
  esperado e seguro **desde que o RLS esteja ativo** (está, pelo `supabase.sql`).

## 6. Próximas fases (já desenhadas no projeto)

- **n8n**: rotina de fechamento automática (consulta o Supabase na sexta,
  gera o resumo da semana e dispara no WhatsApp do fiscal via Evolution API).
- **Módulo Estoque**: schema pronto em `estoque_schema.sql` (multi-contrato
  Educação + Saúde) — pluga neste mesmo Supabase.
- **Sincronização com a planilha**: n8n lê o `os_campo` e espelha no
  Google Sheets de controle até a migração completa.
