alter table public.ofertas_pedido_assistente
  add column if not exists portfolio_midias jsonb not null default '[]'::jsonb;
