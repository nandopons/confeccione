-- Perguntas mediadas fornecedor <-> cliente (sem troca de contato).
-- Cada linha é uma mensagem de um thread por oferta.
create table if not exists public.perguntas_oferta (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null,
  oferta_id uuid not null,
  autor text not null check (autor in ('fornecedor','cliente')),
  texto text not null,
  criado_em timestamptz not null default now()
);

create index if not exists perguntas_oferta_oferta_idx on public.perguntas_oferta (oferta_id, criado_em);
create index if not exists perguntas_oferta_pedido_idx on public.perguntas_oferta (pedido_id, criado_em);
