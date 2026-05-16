-- ============================================================================
-- MIGRAÇÃO: Tabela de observabilidade de execuções de cron
-- Data: 2026-05-16
-- ============================================================================
--
-- Registra uma linha por execução EFETIVA de cron (passou auth + tentou a
-- operação principal). Tentativas com auth inválida (401) ou config quebrada
-- (CRON_SECRET ausente, 500) NÃO geram linha — não são "execuções do cron",
-- são defesa de borda.
--
-- Consumida pelo dashboard /admin pra calcular o semáforo de saúde:
--   - "última execução há X minutos" → SELECT executado_em FROM cron_execucoes
--     WHERE nome_cron='detectar-gaps' ORDER BY executado_em DESC LIMIT 1
--   - "última execução falhou" → último registro com ok=false + mensagem_erro
--
-- Idempotente: roda múltiplas vezes sem quebrar.
-- ============================================================================


-- ============================================================================
-- PARTE 1 — Tabela cron_execucoes
-- ============================================================================

CREATE TABLE IF NOT EXISTS cron_execucoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificador do cron (ex: 'detectar-gaps', 'scheduler'). Permite múltiplos
  -- crons coexistirem com queries por nome.
  nome_cron     TEXT NOT NULL,

  executado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Duração total da execução em ms (do entrada na rota até a resposta).
  duracao_ms    INT NOT NULL,

  -- true = execução bem-sucedida; false = caiu no catch (e mensagem_erro tem o motivo).
  ok            BOOLEAN NOT NULL,

  -- Métrica primária do cron de órfãos: quantos foram detectados nesta execução.
  -- Pra outros crons no futuro, semântica fica livre (0 default).
  detectados    INT NOT NULL DEFAULT 0,

  -- Populado quando ok=false. NULL quando ok=true.
  mensagem_erro TEXT
);


-- ============================================================================
-- PARTE 2 — Índice
-- ============================================================================
-- Query mais comum: "última execução do cron X" → ORDER BY executado_em DESC
-- LIMIT 1 com filtro por nome_cron. Composto (nome, executado_em DESC).

CREATE INDEX IF NOT EXISTS idx_cron_execucoes_nome_executado
  ON cron_execucoes(nome_cron, executado_em DESC);


-- ============================================================================
-- PARTE 3 — RLS
-- ============================================================================
-- Habilita RLS sem policies. Service role bypassa (lib/supabase-server.ts).
-- anon/authenticated não têm acesso. REVOKE explícito como defesa em profundidade.

ALTER TABLE cron_execucoes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON cron_execucoes FROM anon;
REVOKE ALL ON cron_execucoes FROM authenticated;


-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
