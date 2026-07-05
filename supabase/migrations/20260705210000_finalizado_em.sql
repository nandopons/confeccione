-- Etapa final do fluxo assistido: pedido entregue/finalizado.
-- Por enquanto marcado manualmente no admin; depois o cliente marcará no
-- painel dele (estilo Mercado Livre) + auto-finalização em 7 dias.
-- (Aplicada em produção via MCP em 05/07/2026.)
alter table public.pedidos_assistente
  add column if not exists finalizado_em timestamptz;
