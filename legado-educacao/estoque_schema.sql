-- =====================================================================
-- FP VIEIRA — Módulo Estoque (Almoxarifado)  | PostgreSQL
-- Multi-contrato (Educação FP.094 + Saúde). Rodar uma vez na VPS.
-- =====================================================================

-- ---------- TIPOS ----------
CREATE TYPE tipo_item        AS ENUM ('insumo','material','ferramenta');
CREATE TYPE tipo_movimento   AS ENUM ('entrada','saida','ajuste','devolucao','transferencia');
CREATE TYPE estado_ferramenta AS ENUM ('disponivel','emprestada','manutencao','baixada');
CREATE TYPE perfil_usuario   AS ENUM ('encarregado','almoxarifado','engenharia','rh','admin');

-- ---------- CADASTROS ----------
CREATE TABLE contrato (
  id      SERIAL PRIMARY KEY,
  nome    TEXT NOT NULL,            -- Educação / Saúde
  codigo  TEXT,                     -- FP.094 ...
  ativo   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE categoria (
  id    SERIAL PRIMARY KEY,
  nome  TEXT NOT NULL,              -- Elétrica, Hidráulica, Pintura, EPI...
  tipo  tipo_item
);

CREATE TABLE fornecedor (
  id       SERIAL PRIMARY KEY,
  nome     TEXT NOT NULL,
  cnpj     TEXT,
  contato  TEXT,
  ativo    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE item (                 -- catálogo único, compartilhado entre contratos
  id              SERIAL PRIMARY KEY,
  sku             TEXT UNIQUE,
  descricao       TEXT NOT NULL,
  tipo            tipo_item NOT NULL,
  categoria_id    INT REFERENCES categoria(id),
  unidade         TEXT NOT NULL DEFAULT 'un',   -- un, m, kg, L
  estoque_minimo  NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_ultimo    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
  id        SERIAL PRIMARY KEY,
  nome      TEXT NOT NULL,
  email     TEXT UNIQUE NOT NULL,
  perfil    perfil_usuario NOT NULL,
  ativo     BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- quais contratos cada usuário pode acessar (multi-contrato)
CREATE TABLE usuario_contrato (
  usuario_id  INT NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  contrato_id INT NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, contrato_id)
);

-- referência ao módulo O.S. (a tabela completa vive no módulo de Ordens de Serviço)
CREATE TABLE os (
  id          SERIAL PRIMARY KEY,
  numero      INT,
  contrato_id INT REFERENCES contrato(id),
  unidade     TEXT,
  status      TEXT
);

-- ---------- MOVIMENTO DE CONSUMÍVEIS (insumo + material) ----------
CREATE TABLE movimento (
  id            SERIAL PRIMARY KEY,
  item_id       INT NOT NULL REFERENCES item(id),
  contrato_id   INT NOT NULL REFERENCES contrato(id),
  tipo          tipo_movimento NOT NULL,
  quantidade    NUMERIC(12,2) NOT NULL,
  custo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total   NUMERIC(14,2) GENERATED ALWAYS AS (quantidade * custo_unitario) STORED,
  data          TIMESTAMPTZ NOT NULL DEFAULT now(),
  os_id         INT REFERENCES os(id),          -- obrigatório nas SAÍDAS (ver regra)
  fornecedor_id INT REFERENCES fornecedor(id),  -- usado nas ENTRADAS
  documento     TEXT,                           -- NF / recibo
  usuario_id    INT REFERENCES usuario(id),     -- auditoria: quem registrou
  observacao    TEXT,
  -- REGRA: toda saída precisa estar amarrada a uma O.S.
  CONSTRAINT saida_exige_os CHECK (tipo <> 'saida' OR os_id IS NOT NULL)
);
CREATE INDEX idx_mov_item     ON movimento(item_id);
CREATE INDEX idx_mov_contrato ON movimento(contrato_id);
CREATE INDEX idx_mov_os       ON movimento(os_id);
CREATE INDEX idx_mov_data     ON movimento(data);

-- ---------- FERRAMENTAL (controle por unidade física) ----------
CREATE TABLE ferramenta (
  id          SERIAL PRIMARY KEY,
  item_id     INT NOT NULL REFERENCES item(id),   -- item de tipo 'ferramenta'
  patrimonio  TEXT UNIQUE,
  contrato_id INT NOT NULL REFERENCES contrato(id),
  estado      estado_ferramenta NOT NULL DEFAULT 'disponivel',
  custo       NUMERIC(12,2) DEFAULT 0,
  aquisicao   DATE
);

CREATE TABLE emprestimo (
  id               SERIAL PRIMARY KEY,
  ferramenta_id    INT NOT NULL REFERENCES ferramenta(id),
  os_id            INT REFERENCES os(id),
  responsavel_id   INT REFERENCES usuario(id),
  data_saida       TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_devolucao   TIMESTAMPTZ,                   -- NULL = ainda em campo
  estado_devolucao TEXT,                          -- ok / danificada / perdida
  observacao       TEXT
);
CREATE INDEX idx_emp_ferramenta ON emprestimo(ferramenta_id);
CREATE INDEX idx_emp_os         ON emprestimo(os_id);

-- ---------- VIEWS (cálculos automáticos) ----------
-- Saldo atual por item e contrato
CREATE VIEW v_saldo AS
SELECT m.item_id, m.contrato_id,
       SUM(CASE m.tipo
             WHEN 'entrada'   THEN  m.quantidade
             WHEN 'devolucao' THEN  m.quantidade
             WHEN 'saida'     THEN -m.quantidade
             WHEN 'ajuste'    THEN  m.quantidade   -- ajuste aceita quantidade negativa
             ELSE 0 END) AS quantidade_atual,
       SUM(CASE WHEN m.tipo='entrada' THEN m.valor_total ELSE 0 END) AS valor_entradas
FROM movimento m
GROUP BY m.item_id, m.contrato_id;

-- Custo de MATERIAL por O.S. (alimenta a medição/cobrança)
CREATE VIEW v_custo_os AS
SELECT os_id, SUM(valor_total) AS custo_material
FROM movimento
WHERE tipo = 'saida' AND os_id IS NOT NULL
GROUP BY os_id;

-- Itens abaixo do estoque mínimo (gera alerta no n8n/painel)
CREATE VIEW v_estoque_baixo AS
SELECT i.id AS item_id, i.descricao, s.contrato_id,
       s.quantidade_atual, i.estoque_minimo
FROM v_saldo s
JOIN item i ON i.id = s.item_id
WHERE s.quantidade_atual < i.estoque_minimo;

-- ---------- SEED INICIAL ----------
INSERT INTO contrato (nome, codigo) VALUES
  ('Educação', 'FP.094'),
  ('Saúde',    NULL);

INSERT INTO categoria (nome, tipo) VALUES
  ('Elétrica','material'), ('Hidráulica','material'), ('Pintura','material'),
  ('EPI','insumo'), ('Ferramenta','ferramenta');

-- Admins (Lucas e Rafael) com acesso aos dois contratos
INSERT INTO usuario (nome, email, perfil) VALUES
  ('Lucas','lucas@fpvieira.com','admin'),
  ('Rafael','rafael@fpvieira.com','admin');
INSERT INTO usuario_contrato (usuario_id, contrato_id)
SELECT u.id, c.id FROM usuario u CROSS JOIN contrato c WHERE u.perfil='admin';
