-- Histórico de edições das linhas do pedido (chat/assistente) feitas pelo
-- CLIENTE (visualizador) ou pelo FORNECEDOR que aceitou (página da oferta).
-- Um registro por salvamento, com o snapshot antes/depois — serve pra o admin
-- arbitrar ("mudou minha grade sem combinar") e pra reverter na mão.
create table if not exists public.pedidos_assistente_edicoes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_assistente(id) on delete cascade,
  autor text not null check (autor in ('cliente', 'fornecedor', 'admin')),
  fornecedor_id uuid null references public.leads_fornecedores(id) on delete set null,
  oferta_id uuid null,
  resumo text null,
  linhas_antes jsonb not null default '[]'::jsonb,
  linhas_depois jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists pedidos_assistente_edicoes_pedido_idx
  on public.pedidos_assistente_edicoes (pedido_id, criado_em desc);

alter table public.pedidos_assistente_edicoes enable row level security;
-- Só service_role (supabaseAdmin) lê/escreve; nenhuma policy pública.
