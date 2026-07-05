-- Eventos anônimos do site público (tracker 1st-party do painel Funil).
-- pageview / assistente_iniciado / pedido_enviado / whatsapp_click.
-- APLICADA em produção em 05/07/2026 via MCP (migration eventos_site_funil).
create table public.eventos_site (
  id uuid primary key default gen_random_uuid(),
  sessao_id text not null,
  tipo text not null,
  pagina text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  referencia_id text,
  criado_em timestamptz not null default now()
);

comment on table public.eventos_site is 'Eventos anônimos do site público (pageview, assistente_iniciado, pedido_enviado, whatsapp_click). Alimenta o painel /admin/funil. Acesso apenas via service_role. RLS defense-in-depth.';

create index eventos_site_criado_em_idx on public.eventos_site (criado_em desc);
create index eventos_site_sessao_idx on public.eventos_site (sessao_id, criado_em);
create index eventos_site_tipo_idx on public.eventos_site (tipo, criado_em desc);

alter table public.eventos_site enable row level security;
revoke all on public.eventos_site from anon, authenticated;
