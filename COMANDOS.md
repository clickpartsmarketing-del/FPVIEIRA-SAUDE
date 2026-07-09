# COMANDOS — catálogo do FPV OS (rastreado 07/07/2026)

Todo comando, script e rotina do projeto num lugar só: o que faz, onde mora
e quando usar. Par do `CLAUDE.md` (identidade) e do `ERROS-E-LICOES.md`
(lições). Se criar um comando novo, registre aqui.

## 1) Rotinas do dia a dia

| Comando | O que faz | Como rodar |
|---|---|---|
| **Boletim operacional** | RECEBI pendentes por pessoa + pedidos parados + O.S. do app sem foto, com texto pronto p/ WhatsApp. Salva em `Downloads\BOLETIM-OPERACIONAL-<data>.txt` | `powershell -File C:\Users\nicol\.claude\boletim_operacional.ps1` (ou pedir ao Claude: "roda o boletim") |
| **Conferência geral do banco** | 66 verificações só-leitura (tabelas, colunas, RLS, realtime, storage, logins). FALTOU sobe pro topo | Colar `CONFERENCIA-GERAL.sql` no SQL Editor do Supabase. Rodar após QUALQUER mudança de schema |
| **Espelho p/ Edmar** | Gera xlsx da `os_campo` na pasta `_AUDITORIA E FERRAMENTAS FPV (Nicolas)` (Drive) | `powershell -File C:\Users\nicol\.claude\espelho_edmar.ps1` |
| **Subir versão nova** | Bump `VERSAO` no App.tsx → commit → push (Vercel deploya) → conferir o nº no bundle | Pedir ao Claude: "sobe a vXX" — regra: TODA release visível bumpa VERSAO |
| **Treinamento** | Trilhas por papel c/ progresso local | https://fpvieira.vercel.app/treinamento/ (fonte: `public/treinamento/`) |

## 2) SQLs do repo (banco de produção = 100% em 07/07/2026)

**Instalação NOVA (ordem do DEPLOY.md):**
`supabase.sql` → `almoxarifado.sql` → `ALMOX-V2.sql` → `PENDENTES-CONSOLIDADO.sql`
→ `AUDITORIA-EDICOES.sql` → `REALTIME-E-TIPO.sql` → `AUDITORIA-CORRECOES-2026-07-07.sql`
→ conferir com `CONFERENCIA-GERAL.sql`.

**Demais arquivos (não rodar de novo em produção sem motivo):**

| Arquivo | Situação |
|---|---|
| `AUDITORIA-RLS-FIX.sql` | Histórico (v16) — conteúdo já dentro do PENDENTES-CONSOLIDADO |
| `RODAR-NO-SQL-EDITOR.sql` | Kit antigo (almoxarifado + setval) — superado pela ordem acima |
| `TIPO-ATIVIDADE.sql` | 1 linha (coluna tipo) — já dentro do REALTIME-E-TIPO |
| `supabase_vps.sql` | P/ quando migrar ao Supabase self-hosted da VPS (n8n compartilha a sequência F) |
| `estoque_schema.sql` | Referência do módulo Estoque multi-contrato (futuro, DDL completo) |
| `FINANCEIRO.sql` | Módulo financeiro (v47): tabela `contrato_financeiro` c/ RLS **SÓ Lucas/Rafael** — rodar 1x; valores nunca vão pro código |

Regra: SQL novo = arquivo no repo + idempotente + SELECT de conferência no
fim + entrada na ordem do DEPLOY.md. SQL "colado no chat" não existe (lição #20).

## 3) Scripts locais (C:\Users\nicol\.claude) — históricos/one-off

⚠️ Já cumpriram a missão — **não re-rodar sem revisar** (alguns duplicam dados).
Convenção: script com acento/emoji precisa de cópia UTF-8 **BOM** (`*_bom.ps1`, lição #18).
Chaves em `fpv_supabase.env` (NUNCA no repo).

| Script | O que fez | Re-rodável? |
|---|---|---|
| `etl_planilhas.ps1` | Importou a planilha → banco (1.796 O.S. + 2.308 saídas, 04/07) | ❌ duplica (lição #7 do ETL) |
| `dedupe_os.ps1` | Limpou as 794 duplicatas do ETL | ❌ one-off, revisar antes |
| `build_painel.ps1` | Gerou o PAINEL AUDITOR xlsx (23/06) | ✔ com Excel fechado |
| `cruzamento.ps1` / `cruzamento_v2*.ps1` | Cruzamento OS×Materiais v1/v2 (xlsx na _AUDITORIA) | ✔ lê originais read-only |
| `escrever_original*.ps1` | Tentativa de gravar na REV001 (decisão: NÃO usar — original é read-only) | ❌ decisão Renan |
| `fila_fechamento*.ps1` | FILA DE FECHAMENTO POR ENCARREGADO xlsx (03/07) | ✔ |
| `inspect_fontes.ps1` / `inspect_materiais.ps1` | Inspeção read-only das planilhas-fonte | ✔ |
| `boletim_operacional.ps1` | Boletim diário (seção 1) | ✔ sempre |
| `espelho_edmar.ps1` | Espelho xlsx p/ Edmar (seção 1) | ✔ sempre |

## 4) Fluxos n8n (prontos no repo, ⚠️ AINDA NÃO INSTALADOS)

| Arquivo | O que faz | Pendência |
|---|---|---|
| `n8n/espelho-supabase-para-planilha.json` | A cada 15 min upserta na aba **APP CAMPO** da planilha Automação tudo que o app criou (match por REF, links de foto p/ RDO) | Criar a aba c/ cabeçalho + colar service key nos nós + importar em workflow NOVO |
| `n8n/patch-os-nova-nao-descarta.json` | Conserta o fluxo do e-mail: O.S. que não existe na planilha deixa de ser DESCARTADA em silêncio (ramo FALSE do If → Append + insert no Supabase) | Ligar o fio FALSE→Append no fluxo existente |
| `n8n/LEIA-ME-INSTALACAO.md` | Passo a passo dos dois acima | — |

## 5) Frases prontas para pedir ao Claude

- "**roda o boletim**" → boletim operacional + texto de WhatsApp
- "**roda a conferência geral**" → checa o banco e diz o que faltou
- "**gera o espelho do Edmar**" → xlsx na pasta _AUDITORIA
- "**sobe a vXX**" → bump VERSAO + commit + push + confirmação do bundle no ar
- "**audita o banco**" → leitura read-only via REST (service key local), sem tocar em nada

## 6) Pendências rastreadas (mesma lista do fechamento de produção)

1. Instalar os 2 fluxos n8n (seção 4)
2. Rotacionar as 3 apikeys Evolution expostas em chats
3. Repos GitHub `FPVIEIRA` e `FPVIEIRA-SIMPLES` → **Private**
4. Fork simples: arquivado (laboratório — não evoluir)
