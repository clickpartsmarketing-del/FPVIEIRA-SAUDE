# Instalação dos 2 fluxos n8n (10 minutos)

## Antes de tudo (1x só)

A **service_role key** do Supabase fica em: painel Supabase → Settings →
API → `service_role` (secret). Ela SÓ vive dentro do n8n — nunca no app,
nunca em grupo de WhatsApp, nunca colada em chat.

---

## Fluxo 1 — ESPELHO: tudo que o app grava aparece na planilha do Drive

O medidor acompanha na planilha "Controle de O.S. - Educação RDO Automação",
numa **aba única nova** com todas as informações + **links das fotos** (p/ o RDO).

1. Na planilha Automação (Google Sheets), crie uma aba chamada **APP CAMPO**
   e cole esta linha de cabeçalho na linha 1:
   `REF | OS | Unidade | Fiscal | Classificacao | Emergencial | Entrada | Conclusao | Executor | Status | Medicao | Area | Fiscal pediu | Servico executado | Materiais | Memoria de calculo | Fotos (RDO) | Assinado | Criado em`
2. n8n → Workflows → **Import from File** → `espelho-supabase-para-planilha.json`
3. Abra o nó "Busca O.S. do app (Supabase)" e troque os 2
   `COLE_AQUI_A_SERVICE_ROLE_KEY` pela key.
4. Ative o workflow. A cada 15 min ele upserta (pela coluna REF — nº oficial
   ou F-nn) tudo que foi **criado pelo app**: emergenciais das equipes,
   O.S. do formulário, com fotos, memória de cálculo e assinatura.

As 1.794 importadas não entram aí — elas JÁ vieram da planilha (evita duplicar).

## Fluxo 2 — PATCH: O.S. nova do e-mail nunca mais é descartada

Hoje o fluxo do e-mail só ATUALIZA linha que já existe na aba O.S 2026;
se o número não está lá, a O.S. morre em silêncio. O patch conserta e ainda
manda a O.S. para o APP (aparece na hora na zona do fiscal certo).

1. Abra o workflow do e-mail → selecione tudo do patch: **Import from File**
   `patch-os-nova-nao-descarta.json` importa como workflow separado; copie
   (Ctrl+A, Ctrl+C) os 3 nós de lá e cole (Ctrl+V) no canvas do fluxo do e-mail.
2. Troque os `COLE_AQUI_A_SERVICE_ROLE_KEY` no nó "Insere no APP (Supabase)".
3. **Ligue a saída FALSE do nó `If`** (o ramo que hoje não vai a lugar nenhum)
   → ao nó **"OS NOVA - Append na planilha"**. Pronto: achou linha = atualiza;
   não achou = cria a linha + insere no app.

## Bônus (deixar para depois)

Dá para ligar também a saída de "Update row in sheet" → "Prepara p/ o app"
para TODA O.S. de e-mail entrar no app. MAS: sem restrição única no banco
(a planilha importada tem números duplicados históricos), e-mail reprocessado
viraria O.S. duplicada no app. Fica para quando criarmos essa trava — por
ora ligue SÓ o ramo FALSE (O.S. nova), que é seguro.

## ⚠️ Segurança

As 3 apikeys da Evolution que estão no workflow do e-mail passaram pelo chat
de novo — **rotacionar no painel da Evolution** e atualizar os nós.
