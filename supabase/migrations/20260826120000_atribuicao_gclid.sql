-- 26/08/2026 — atribuição do Google Ads no tracker próprio e no pedido.
--
-- O Ads usa MARCAÇÃO AUTOMÁTICA: o clique chega com ?gclid=..., sem utm_*.
-- Guardar só UTM era guardar nada — 346 pageviews desde que a campanha subiu,
-- zero rastreáveis até o anúncio. E pedidos_assistente não gravava origem
-- nenhuma, então não havia como responder quais pedidos o Ads trouxe.
--
-- Índices PARCIAIS (where gclid is not null): a esmagadora maioria das linhas
-- é orgânica/direta e não precisa ocupar índice.
--
-- JÁ APLICADA no Supabase de produção em 26/08 (migration `atribuicao_gclid`).
-- Este arquivo é o registro versionado. Colunas novas são ignoradas pelo
-- código antigo, então a ordem de deploy é livre e nada quebra.

alter table public.eventos_site
  add column if not exists gclid text;

alter table public.pedidos_assistente
  add column if not exists gclid text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists referrer text;

create index if not exists idx_pedidos_assistente_gclid
  on public.pedidos_assistente (gclid)
  where gclid is not null;

create index if not exists idx_eventos_site_gclid
  on public.eventos_site (gclid)
  where gclid is not null;
