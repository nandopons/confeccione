-- ============================================================================
-- MIGRAÇÃO: Sistema de Pedidos Órfãos (Sprint 1)
-- Data: 2026-05-16
-- ============================================================================
--
-- Pedido órfão = pedido que esgotou a fila de fornecedores compatíveis.
-- Critério de detecção (ver lib/orfaos.ts):
--   1. criado há mais de 4h
--   2. status em (aguardando_contato, buscando_fornecedor)
--   3. sem fornecedor aceito
--   4. sem oferta em status 'enviada' ou 'aceita'
--   5. ofertas terminais ('recusada'/'expirada') OU zero ofertas
--   6. ainda não tem registro órfão ativo (aberto/em_captacao)
--
-- Esta migração:
--   • cria a tabela pedidos_orfaos com RLS habilitado
--   • índice parcial garante 1 órfão ativo por pedido (permite reabrir depois)
--   • view vw_pedidos_orfaos_admin junta dados do pedido + idade calculada
--   • trigger mantém atualizado_em em sincronia
--
-- IMPORTANTE: roda múltiplas vezes sem quebrar (idempotente).
-- ============================================================================


-- ============================================================================
-- PARTE 1 — Tabela pedidos_orfaos
-- ============================================================================
CREATE TABLE IF NOT EXISTS pedidos_orfaos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,

  -- Estado do trabalho de captação manual:
  --   aberto       → detectado, ninguém pegou ainda
  --   em_captacao  → admin está trabalhando ativamente em captar fornecedor
  --   resolvido    → fornecedor encontrado e atribuído ao pedido
  --   descartado   → não vamos atender (cliente desistiu, fora de escopo, etc.)
  status_orfao TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status_orfao IN ('aberto', 'em_captacao', 'resolvido', 'descartado')),

  -- 0-100, calculado pelo lib/orfaos.ts no momento da detecção.
  -- Regra: base 50 + (qtd>100: +30) + (idade>24h: +20) + (vertical popular: +10).
  prioridade INT NOT NULL DEFAULT 50
    CHECK (prioridade BETWEEN 0 AND 100),

  -- Descrição livre do porquê virou órfão (ex: "3 ofertas recusadas", "0 fornecedores compatíveis").
  motivo_orfao TEXT,

  -- Quantas vezes o time tentou captar fornecedor pra este pedido (admin incrementa).
  tentativas_captacao INT NOT NULL DEFAULT 0,

  -- Quem está cuidando da captação (email ou nome — campo livre).
  responsavel_captacao TEXT,

  -- Anotações livres do admin (histórico de tentativas, conversas, etc.).
  notas_admin TEXT,

  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- PARTE 2 — Índices
-- ============================================================================

-- Garante 1 órfão ATIVO por pedido. Resolvidos/descartados não bloqueiam
-- nova detecção, permitindo reabrir um órfão se o pedido voltar à fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_orfaos_pedido_ativo
  ON pedidos_orfaos(pedido_id)
  WHERE status_orfao IN ('aberto', 'em_captacao');

-- B-tree simples em pedido_id — cobre queries que NÃO casam o WHERE do
-- UNIQUE parcial: histórico de órfãos resolvidos/descartados, joins por
-- pedido_id sem filtro de status, matchingRetroativo, relatórios.
CREATE INDEX IF NOT EXISTS idx_pedidos_orfaos_pedido_id
  ON pedidos_orfaos(pedido_id);

-- Filtro mais comum do admin: listar abertos/em captação.
CREATE INDEX IF NOT EXISTS idx_pedidos_orfaos_status
  ON pedidos_orfaos(status_orfao);

-- Ordenação padrão do painel: prioridade desc, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS idx_pedidos_orfaos_prioridade
  ON pedidos_orfaos(prioridade DESC, criado_em DESC);


-- ============================================================================
-- PARTE 3 — Trigger atualizado_em
-- ============================================================================
-- Função genérica (nome neutro pra poder ser reusada em outras tabelas no futuro).

CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_orfaos_atualizado_em ON pedidos_orfaos;
CREATE TRIGGER trg_pedidos_orfaos_atualizado_em
  BEFORE UPDATE ON pedidos_orfaos
  FOR EACH ROW
  EXECUTE FUNCTION set_atualizado_em();


-- ============================================================================
-- PARTE 4 — RLS (Row-Level Security)
-- ============================================================================
-- Habilita RLS. Sem policies = anon e authenticated NÃO acessam nada.
-- service_role bypassa RLS automaticamente (Supabase docs).
-- Toda leitura/escrita acontece via lib/supabase-server.ts com service role.

ALTER TABLE pedidos_orfaos ENABLE ROW LEVEL SECURITY;

-- Revoga grants padrão (defesa em profundidade caso alguém crie uma policy permissiva no futuro).
REVOKE ALL ON pedidos_orfaos FROM anon;
REVOKE ALL ON pedidos_orfaos FROM authenticated;


-- ============================================================================
-- PARTE 5 — View vw_pedidos_orfaos_admin
-- ============================================================================
-- ⚠️  VIEW ADMIN-ONLY — contém contato do cliente (nome, whatsapp, email).
--    NÃO expor a fornecedores nem a endpoints públicos.
--    Princípio de privacidade: o contato do cliente só é liberado pro fornecedor
--    APÓS o aceite — é a porta de monetização. Vazar pré-aceite quebra o modelo.
--
-- Junta dados do órfão + pedido + idade em horas. Consumida apenas pelo painel
-- /admin/orfaos via service role (lib/supabase-server.ts).
--
-- A view executa com security_invoker=true: as queries rodam com os
-- privilégios de QUEM CHAMA, então o RLS da tabela pedidos_orfaos vale
-- (sem isso, views Postgres bypassam RLS por padrão — risco de vazamento
-- se alguém der GRANT SELECT por engano no futuro).

CREATE OR REPLACE VIEW vw_pedidos_orfaos_admin
WITH (security_invoker = true) AS
SELECT
  o.id                                                 AS orfao_id,
  o.status_orfao,
  o.prioridade,
  o.motivo_orfao,
  o.tentativas_captacao,
  o.responsavel_captacao,
  o.notas_admin,
  o.criado_em                                          AS detectado_em,
  o.atualizado_em                                      AS orfao_atualizado_em,
  p.id                                                 AS pedido_id,
  p.tipo,
  p.quantidade,
  p.prazo,
  p.estado,
  p.nome,
  p.whatsapp,
  p.email,
  p.descricao,
  p.status                                             AS pedido_status,
  p.criado_em                                          AS pedido_criado_em,
  EXTRACT(EPOCH FROM (NOW() - p.criado_em)) / 3600.0   AS idade_horas
FROM pedidos_orfaos o
JOIN pedidos p ON p.id = o.pedido_id;

REVOKE ALL ON vw_pedidos_orfaos_admin FROM anon;
REVOKE ALL ON vw_pedidos_orfaos_admin FROM authenticated;


-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
