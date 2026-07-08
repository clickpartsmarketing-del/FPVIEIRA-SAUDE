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
| Medição (Edmar) | esteira da medição, itens EMOP, retidos, saldos | 🔜 spec com Leony |
| Gestão (diretoria) | ritmo do contrato, cenários | 🔜 spec com Leony |
| Almoxarifado | pedidos/estoque (padrão do contrato Educação) | 🔜 |

## Stack

HTML + CSS + JS puros, **zero build, zero dependência**. Funciona aberto do arquivo, no GitHub Pages ou na Vercel (importar o repo → framework "Other" → deploy).

## Como funciona o painel do engenheiro

1. WhatsApp → grupo → ⋮ → **Exportar conversa (sem mídia)**
2. Abrir `painel.html` → colar o conteúdo do `_chat.txt` → **Processar relatos**
3. O parser separa **EXECUTADO × PEDIDO × CONFERIR**, agrupa por unidade, conta fotos e estima R$ pelas regras EMOP do contrato (pontos compostos, fornecimento e colocação, miudezas absorvidas)
4. Botões geram as mensagens de cobrança e o **fechamento por unidade** prontos para colar no grupo

> ⚠️ A estimativa é para acompanhamento. A medição oficial passa pelo engenheiro e pela planilha de medição.

## Privacidade

**Não subir neste repositório**: planilhas de medição, exports do WhatsApp (`_chat.txt`), fotos de obra ou qualquer dado de contrato. O `.gitignore` bloqueia os formatos comuns. Recomendado manter o repositório **privado**.

## Roadmap

- [ ] Definir com o Leony os painéis de Medição, Gestão e Almoxarifado
- [ ] Publicar na Vercel e distribuir o link `#reporte` para as equipes
- [ ] Dicionário de materiais → EMOP ampliado (hoje ~30 regras embutidas)
- [ ] Futuro: mesma esteira automatizada via n8n + Evolution (padrão do contrato Educação)
