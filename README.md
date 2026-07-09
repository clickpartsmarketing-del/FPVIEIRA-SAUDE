# FPVIEIRA-SAUDE

Ferramentas de campo e acompanhamento do contrato **FP Vieira · Saúde 094 — Rio das Ostras (contrato 005/2026)**.

Esteira do dado: **grupo do WhatsApp → reporte padronizado → painel do engenheiro → dedução EMOP → medição**.

## Páginas

| Página | Quem usa | Status |
|---|---|---|
| `index.html` | hub — entrada por papel | ✅ ativo |
| `painel.html#painel` | **Engenheiro (Leony)**: cola o export do grupo → fechamento por unidade, pedidos pendentes, relatos incompletos, estimativa EMOP | ✅ ativo |
| `painel.html#reporte` | **Campo (eletricistas/equipes)**: registro de serviço em 1 min → mensagem padronizada p/ o grupo | ✅ ativo |
| `painel.html#regras` | todos — as 5 regras do reporte | ✅ ativo |
| `medicao.html` | **Medição (Edmar)**: 22 itens EMOP auditados p/ lançar, memória de cálculo filtrável, cenários do mês e as 16 perguntas que liberam medição | ✅ ativo |
| Gestão (diretoria) | ritmo do contrato, cenários | 🔜 spec com Leony |
| Almoxarifado | pedidos/estoque (padrão do contrato Educação) | 🔜 |

## Stack

**Vite** (multi-página) + HTML/CSS/JS. As páginas são autossuficientes (dados embutidos, funcionam offline); o Vite entra como esteira de build/deploy e prepara a fase de produção com **Supabase** como banco de dados.

```bash
npm install     # uma vez
npm run dev     # desenvolvimento (http://localhost:5173)
npm run build   # gera dist/ para produção
```

### Deploy (Vercel)

1. Vercel → **Add New → Project** → importar este repositório
2. Framework preset: **Vite** (detectado automaticamente) — build `vite build`, saída `dist/`
3. Deploy. As três páginas ficam em `/`, `/painel.html` e `/medicao.html`

### Supabase (produção)

- Esquema inicial proposto em [`supabase/schema.sql`](supabase/schema.sql) (relatos → itens de medição → perguntas), com RLS habilitado
- Cliente pronto em [`src/lib/supabase.js`](src/lib/supabase.js) — só liga quando as variáveis existirem:
  - local: copiar `.env.example` → `.env`
  - Vercel: Settings → Environment Variables → `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (usar somente a chave **anon**; nunca a service_role no front)
- Sem as variáveis, tudo continua funcionando standalone — nada quebra

## Como funciona o painel do engenheiro

1. WhatsApp → grupo → ⋮ → **Exportar conversa (sem mídia)**
2. Abrir `painel.html` → colar o conteúdo do `_chat.txt` → **Processar relatos**
3. O parser separa **EXECUTADO × PEDIDO × CONFERIR**, agrupa por unidade, conta fotos e estima R$ pelas regras EMOP do contrato (pontos compostos, fornecimento e colocação, miudezas absorvidas)
4. Botões geram as mensagens de cobrança e o **fechamento por unidade** prontos para colar no grupo

> ⚠️ A estimativa é para acompanhamento. A medição oficial passa pelo engenheiro e pela planilha de medição.

## Privacidade

**Não subir neste repositório**: planilhas de medição, exports do WhatsApp (`_chat.txt`), fotos de obra ou qualquer dado de contrato. O `.gitignore` bloqueia os formatos comuns. Recomendado manter o repositório **privado**.

## Roadmap

- [x] Painel de Medição (Edmar) — `medicao.html` (v1.1, 09/07)
- [x] Esteira Vite + scaffolding Supabase
- [ ] Definir com o Leony os painéis de Gestão e Almoxarifado
- [ ] Publicar na Vercel e distribuir o link `#reporte` para as equipes
- [ ] Criar o projeto Supabase e rodar `supabase/schema.sql` (aí as páginas passam a ler/escrever no banco)
- [ ] Dicionário de materiais → EMOP ampliado (hoje ~30 regras embutidas)
- [ ] Futuro: mesma esteira automatizada via n8n + Evolution (padrão do contrato Educação)
