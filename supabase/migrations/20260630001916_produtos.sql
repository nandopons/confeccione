-- Catálogo de produtos do fornecedor (vira o feed do cliente). NÃO é post livre:
-- dados estruturados (nome, preço, mínimo). Substitui a 1ª versão 'posts'.
drop table if exists public.posts;

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.leads_fornecedores(id) on delete cascade,
  path text not null,                 -- imagem no bucket 'produtos'
  nome text not null,
  categoria text,
  preco_centavos integer,             -- preço unitário "a partir de" (opcional)
  qtd_minima integer,                 -- pedido mínimo (opcional)
  descricao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create index if not exists produtos_recentes_idx on public.produtos (ativo, criado_em desc);
create index if not exists produtos_fornecedor_idx on public.produtos (fornecedor_id, criado_em desc);

alter table public.produtos enable row level security; -- acesso via service_role

insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do nothing;
