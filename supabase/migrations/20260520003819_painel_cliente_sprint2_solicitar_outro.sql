-- ============================================================================
-- Painel do Cliente — Sprint 2: Solicitar outro fornecedor + WhatsApp/Nome
-- Data: 2026-05-20
-- ============================================================================
--
-- 3 mudanças mínimas:
--   1. Index parcial em contas_clientes.whatsapp pra busca eventual
--   2. Nova tabela solicitacoes_outro_fornecedor (auditoria de troca)
--   3. Nova coluna ofertas.motivo_cancelamento (text livre, nullable)
--
-- Pré-flight confirmou:
--   - ofertas.status NÃO tem CHECK constraint — 'cancelada_cliente' entra livre
--   - ofertas_agendadas.tipo_origem é TEXT aberto — sem ajuste
-- ============================================================================

-- 1. Index pra busca por whatsapp (Sprint 2 começa a popular esta coluna)
CREATE INDEX IF NOT EXISTS idx_contas_clientes_whatsapp
  ON public.contas_clientes (whatsapp)
  WHERE whatsapp IS NOT NULL;

-- 2. Tabela de auditoria do evento "cliente pediu trocar"
CREATE TABLE public.solicitacoes_outro_fornecedor (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id           UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  conta_id            UUID NOT NULL REFERENCES public.contas_clientes(id) ON DELETE CASCADE,
  -- oferta_cancelada_id: oferta que estava 'enviada' ou 'aceita' antes da troca.
  -- NULL se pedido já estava órfão / sem oferta ativa na hora da solicitação.
  oferta_cancelada_id UUID REFERENCES public.ofertas(id) ON DELETE SET NULL,
  motivo              TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_solicitacoes_pedido
  ON public.solicitacoes_outro_fornecedor (pedido_id, criado_em DESC);

CREATE INDEX idx_solicitacoes_conta
  ON public.solicitacoes_outro_fornecedor (conta_id, criado_em DESC);

ALTER TABLE public.solicitacoes_outro_fornecedor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.solicitacoes_outro_fornecedor FROM anon, authenticated;

COMMENT ON TABLE public.solicitacoes_outro_fornecedor IS
  'Evento: cliente pediu trocar de fornecedor. Acesso apenas via service_role. Auditoria.';

-- 3. ofertas.motivo_cancelamento — text livre, preenchido quando cliente cancela
ALTER TABLE public.ofertas
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

COMMENT ON COLUMN public.ofertas.motivo_cancelamento IS
  'Motivo livre preenchido pelo cliente quando solicita trocar de fornecedor (Sprint 2). NULL quando oferta seguiu fluxo normal.';
