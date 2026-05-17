-- ============================================================================
-- MIGRAÇÃO: Tabela ofertas_agendadas (fila de reenvio)
-- Data: 2026-05-17
-- ============================================================================
--
-- Fila de ofertas a serem disparadas. B1 (esta migração) só schema + funções
-- puras em app/lib/fila.ts. Próximos passos:
--   B2: rota POST admin agenda reenvio (chama agendarReenvio)
--   B3: trigger no aceite consome próxima da fila do fornecedor que aceitou
--       (chama proximaAgendadaDeFornecedor + marcarAgendadaProcessada após
--       gerar a oferta real)
--
-- Semântica:
--   - processada_em NULL  → ainda pendente na fila
--   - oferta_id NULL      → não foi disparada ainda; preenchido quando vira
--                           uma linha real em ofertas
--   - tipo_origem         → de onde veio o agendamento ('reenvio_admin'
--                           default; outros tipos podem vir no futuro)
--
-- Idempotente: roda múltiplas vezes sem quebrar.
-- ============================================================================


-- ============================================================================
-- PARTE 1 — Tabela ofertas_agendadas
-- ============================================================================

CREATE TABLE IF NOT EXISTS ofertas_agendadas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  fornecedor_id   UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,

  agendada_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Quando NULL, ainda está na fila esperando processar.
  processada_em   TIMESTAMPTZ,

  -- FK pra ofertas, preenchido quando a agendada gera uma oferta real.
  -- ON DELETE SET NULL preserva o histórico do agendamento mesmo se a
  -- oferta for purgada por algum motivo futuro.
  oferta_id       UUID REFERENCES ofertas(id) ON DELETE SET NULL,

  -- 'reenvio_admin' default. Outros valores podem aparecer no futuro
  -- (ex: 'reenvio_automatico'); tipo TEXT aberto, sem CHECK constraint
  -- pra não enrijecer.
  tipo_origem     TEXT NOT NULL DEFAULT 'reenvio_admin'
);


-- ============================================================================
-- PARTE 2 — Índice parcial (só pendentes)
-- ============================================================================
-- Query mais quente: "próxima pendente do fornecedor X". Índice parcial
-- só nas pendentes mantém o índice pequeno (registros processados saem).

CREATE INDEX IF NOT EXISTS idx_ofertas_agendadas_fornecedor_pendente
  ON ofertas_agendadas(fornecedor_id, agendada_em)
  WHERE processada_em IS NULL;


-- ============================================================================
-- PARTE 3 — RLS
-- ============================================================================
-- Mesmo padrão das outras tabelas admin: RLS sem policies + REVOKE.
-- Service role bypassa via app/lib/supabase-server.ts.

ALTER TABLE ofertas_agendadas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ofertas_agendadas FROM anon;
REVOKE ALL ON ofertas_agendadas FROM authenticated;


-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
