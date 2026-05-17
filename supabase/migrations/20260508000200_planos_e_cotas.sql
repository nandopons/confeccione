-- ============================================================================
-- MIGRAÇÃO: Sistema de planos e cota de leads
-- Data: 2026-05-08
-- ============================================================================
--
-- Adiciona infraestrutura para:
-- 1. Plano do fornecedor (free, starter, pro, enterprise)
-- 2. Trial Pro de 90 dias automático para todos os fornecedores
-- 3. Cota mensal de ofertas por plano
-- 4. Fluxo de oferta com gatilho de upgrade pra quem está sem crédito
-- ============================================================================

-- ============================================================================
-- PARTE 1 — Colunas de plano em leads_fornecedores
-- ============================================================================

ALTER TABLE leads_fornecedores
  ADD COLUMN IF NOT EXISTS plano TEXT NOT NULL DEFAULT 'pro'
    CHECK (plano IN ('free', 'starter', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS plano_ativado_em TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS plano_expira_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creditos_extras INT NOT NULL DEFAULT 0;

-- COMENTÁRIOS:
-- plano: tier atual do fornecedor. Default 'pro' porque todo novo cadastro
--   começa com 90 dias grátis de Pro.
-- plano_ativado_em: data em que o plano atual começou. Usado pra calcular
--   expiração do trial.
-- plano_expira_em: data em que o plano atual expira. Quando passa, vira free.
--   NULL para planos pagos sem expiração definida.
-- creditos_extras: leads avulsos que o fornecedor comprou (pacotes 5/10/25).
--   Consumidos antes da cota mensal do plano. Não expiram com o mês.

-- ============================================================================
-- PARTE 2 — Backfill: dar trial Pro de 90 dias pra TODOS os fornecedores
-- ============================================================================

-- Fornecedores existentes ganham 90 dias de Pro a partir de hoje.
-- Os que vão se cadastrar daqui pra frente recebem o mesmo via DEFAULT
-- na coluna plano_ativado_em + lógica do app.

UPDATE leads_fornecedores
SET
  plano = 'pro',
  plano_ativado_em = NOW(),
  plano_expira_em = NOW() + INTERVAL '90 days'
WHERE plano_expira_em IS NULL;

-- ============================================================================
-- PARTE 3 — Coluna em ofertas para distinguir tipo de oferta
-- ============================================================================

ALTER TABLE ofertas
  ADD COLUMN IF NOT EXISTS tipo_oferta TEXT NOT NULL DEFAULT 'normal'
    CHECK (tipo_oferta IN ('normal', 'sem_credito'));

-- COMENTÁRIOS:
-- tipo_oferta='normal': oferta padrão SIM/NAO pra fornecedor com crédito.
-- tipo_oferta='sem_credito': oferta com gatilho de upgrade pra fornecedor
--   que está sem crédito mensal. Tem janela de 3h e estados próprios.

-- ============================================================================
-- PARTE 4 — Status novos para ofertas sem crédito
-- ============================================================================

-- A coluna status já existe e suporta texto livre. Os novos valores possíveis
-- são gerenciados pelo app:
--   - 'expirada_sem_credito' (não comprou em 3h, mas pode receber este lead
--     de novo se comprar pacote/upgrade depois)
--   - 'recusada_sem_credito' (respondeu "não tenho interesse" — final)

-- ============================================================================
-- PARTE 5 — Tabela de log de gatilhos de upgrade (anti-spam)
-- ============================================================================
-- Limita a 1 oferta de upgrade por dia por fornecedor.

CREATE TABLE IF NOT EXISTS gatilhos_upgrade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  oferta_id UUID REFERENCES ofertas(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gatilhos_upgrade_fornecedor_data
  ON gatilhos_upgrade(fornecedor_id, enviado_em DESC);

-- ============================================================================
-- PARTE 6 — View útil: contador de ofertas no mês corrente por fornecedor
-- ============================================================================
-- Não é estritamente necessária (o app vai contar via query), mas útil pra
-- consultas manuais no painel do Supabase.

CREATE OR REPLACE VIEW vw_ofertas_mes_corrente AS
SELECT
  fornecedor_id,
  COUNT(*) AS total_ofertas_mes,
  COUNT(*) FILTER (WHERE status = 'aceita') AS aceitas,
  COUNT(*) FILTER (WHERE status = 'recusada') AS recusadas,
  COUNT(*) FILTER (WHERE status = 'enviada') AS pendentes,
  COUNT(*) FILTER (WHERE status = 'expirada') AS expiradas
FROM ofertas
WHERE enviada_em >= DATE_TRUNC('month', NOW())
  AND tipo_oferta = 'normal'  -- ofertas sem_credito não contam pra cota
GROUP BY fornecedor_id;

-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
