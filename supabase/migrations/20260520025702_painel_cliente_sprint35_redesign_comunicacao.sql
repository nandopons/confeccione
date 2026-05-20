-- ============================================================================
-- Sprint 3.5 — Redesign comunicação: rastreio de acesso ao painel pelo cliente
-- Data: 2026-05-20
-- ============================================================================
--
-- Adiciona pedidos.ultimo_acesso_painel: marca a última vez que o cliente
-- abriu /cliente/pedido/[id]. Vira sinal de engajamento e, no follow-up
-- redesenhado, o sinal de "pedido vivo" (cliente que acessou o painel não
-- precisa ser expirado por silêncio).
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS ultimo_acesso_painel TIMESTAMPTZ;

COMMENT ON COLUMN public.pedidos.ultimo_acesso_painel IS
  'Última vez que o cliente acessou /cliente/pedido/[id]. Atualizado no Server Component (Sprint 3.5).';

-- Index parcial: só pedidos que o cliente já acessou alguma vez
CREATE INDEX IF NOT EXISTS idx_pedidos_ultimo_acesso_painel
  ON public.pedidos (ultimo_acesso_painel DESC)
  WHERE ultimo_acesso_painel IS NOT NULL;
