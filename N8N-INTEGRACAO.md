# 🔗 Integração n8n ↔ Supabase (VPS) ↔ Google Drive

Arquitetura final do dia a dia — **duas portas de entrada, UMA tabela central**:

```
🎙️ WhatsApp áudio ──▶ n8n (fluxo de voz existente) ──┐
                                                      ├──▶ os_campo (Supabase VPS) ──▶ n8n espelho ──▶ Google Sheets/Drive
📱 App FPV Campo (ChatOS / formulário) ───────────────┘         │                        (pasta _AUDITORIA E FERRAMENTAS FPV)
                                                                └──▶ Fechamento semanal (folhas p/ assinatura do fiscal)
```

## 1. Apontar o app para o Supabase da VPS

No `.env.local` (e nas env vars do Vercel):

```
VITE_SUPABASE_URL=https://SEU-DOMINIO-SUPABASE   (a URL do Kong, ex.: https://supabase.suaempresa.com)
VITE_SUPABASE_ANON_KEY=ANON_KEY do .env do docker do Supabase
```

⚠️ O app usa **apenas a anon key** (RLS protege). A **service_role fica SÓ no n8n**.
⚠️ Se o app roda no Vercel (https), o Supabase da VPS precisa estar atrás de
**https** (Traefik/Caddy/NGINX com certificado) — senão o navegador bloqueia.

## 2. Adaptar o fluxo de voz existente para gravar na os_campo

No lugar do nó que criava O.S. na API antiga (Parse/ClickParts), colocar:

**Opção A — nó Postgres** (mesma docker network):
- Credencial: host `db` · porta `5432` · database `postgres` · user `postgres` · senha = `POSTGRES_PASSWORD` do Supabase.
- Operação Insert na tabela `os_campo`.

**Opção B — HTTP Request (PostgREST)**:
- `POST http://kong:8000/rest/v1/os_campo` (ou a URL pública)
- Headers: `apikey: SERVICE_ROLE_KEY` · `Authorization: Bearer SERVICE_ROLE_KEY` · `Content-Type: application/json` · `Prefer: return=representation`

**Mapeamento do JSON do triador de voz → colunas:**

| Saída do LLM triador            | Coluna os_campo    |
|---------------------------------|--------------------|
| escola / unidade reconhecida    | `unidade`          |
| descrição do problema/serviço   | `servico`          |
| materiais citados (texto)       | `materiais`        |
| medidas ditadas                 | `memoria_calculo`  |
| —                               | `numero` = null    |
| —                               | `numero_fict` = null → **o trigger atribui o F-nº** |
| —                               | `emergencial` = true · `classificacao` = 'Emergencial' |
| nome do executor (remetente)    | `executor`         |
| —                               | `status` = 'Executando' · `entrada` = hoje |

Resposta em áudio ao apontador: usar o `numero_fict` retornado
(`Prefer: return=representation` devolve a linha) → "O.S. F-79 registrada!".

## 3. Espelho automático no Drive (mata a sincronização da pasta)

Workflow n8n (Schedule, ex.: a cada 30 min ou 18h diário):

1. **Postgres** → `SELECT * FROM os_campo ORDER BY coalesce(numero, numero_fict)`
2. **Google Sheets** → limpar e regravar a aba `OS CAMPO (app)` de uma planilha
   dentro de `_AUDITORIA E FERRAMENTAS FPV (Nicolas)` no Drive
3. O **Drive for Desktop** sincroniza sozinho para
   `G:\Meu Drive\...\_AUDITORIA E FERRAMENTAS FPV (Nicolas)` → a pasta que a
   engenharia e o medidor já usam fica atualizada sem ninguém tocar em nada.

Sexta-feira: o mesmo workflow pode filtrar `status='Concluído'` da semana e
mandar o resumo no WhatsApp do fiscal (Evolution API — nós que você já tem).

## 4. Storage de fotos no self-hosted

O bucket `fotos-os` funciona igual no Supabase da VPS (Storage no Studio).
Confirme que a URL pública das imagens é acessível externamente (passa pelo
Kong/proxy) para as fotos aparecerem na folha de assinatura.

## 5. Checklist de segurança

- [ ] `service_role` key **apenas** nas credenciais do n8n
- [ ] RLS ativo na `os_campo` (supabase.sql) — anon sem login não lê nada
- [ ] HTTPS no Supabase (exigência do Vercel/navegador)
- [ ] Chaves antigas expostas no chat (OpenAI/Parse/Evolution) **rotacionadas**
