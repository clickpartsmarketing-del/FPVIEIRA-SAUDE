-- Esquema inicial proposto — FP Vieira · Saúde 094 (contrato 005/2026)
-- Rodar no SQL Editor do Supabase quando o projeto for criado.
-- Espelha a esteira: grupo WhatsApp → diário estruturado → dedução EMOP → medição.

-- Relatos estruturados do grupo (hoje embutidos no diário xlsx)
create table if not exists relatos (
  id bigint generated always as identity primary key,
  data_servico date,
  unidade text not null,
  local_detalhe text,
  descricao text not null,
  quantidade numeric,
  unidade_medida text,
  status text not null check (status in ('EXECUTADO','PEDIDO','ATENDIMENTO','CONFERIR')),
  autor text,
  fonte text default 'grupo',            -- grupo | brendah | planilha-leony
  criado_em timestamptz default now()
);

-- Itens da dedução EMOP por período (espelho da aba SERVICOS do consolidado)
create table if not exists medicao_itens (
  id bigint generated always as identity primary key,
  periodo text not null,                 -- ex.: '2026-06'
  secao text not null check (secao in ('MEDIR','RETIDO','PLEITO','SATELITE')),
  data_servico text,
  unidade text,
  servico text not null,
  item_emop text,
  codigo_emop text,
  un text,
  qtde numeric,
  preco_bdi numeric,
  valor numeric,
  observacao text,
  relato_id bigint references relatos(id),
  criado_em timestamptz default now()
);

-- Perguntas ao grupo e o R$ que cada resposta libera
create table if not exists perguntas (
  id bigint generated always as identity primary key,
  numero int not null,
  periodo text not null,
  texto text not null,
  libera text,
  respondida boolean default false,
  resposta text,
  respondida_em timestamptz,
  criado_em timestamptz default now()
);

-- RLS: habilitar antes de expor a chave anon em produção.
-- Leitura pública (equipe), escrita só autenticada — ajustar conforme o fluxo.
alter table relatos enable row level security;
alter table medicao_itens enable row level security;
alter table perguntas enable row level security;

create policy "leitura equipe" on relatos for select using (true);
create policy "leitura equipe" on medicao_itens for select using (true);
create policy "leitura equipe" on perguntas for select using (true);
