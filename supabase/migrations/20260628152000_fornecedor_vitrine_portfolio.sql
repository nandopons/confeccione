-- Vitrine do fornecedor: redes + portfólio (catálogo de fotos do trabalho).
alter table public.leads_fornecedores
  add column if not exists instagram text,
  add column if not exists site text;

create table if not exists public.portfolio_fornecedores (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.leads_fornecedores(id) on delete cascade,
  path text not null,           -- caminho no bucket portfolio-fornecedores
  legenda text,
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);

create index if not exists portfolio_fornecedor_idx
  on public.portfolio_fornecedores (fornecedor_id, ordem);

-- RLS travada: escrita/leitura via service_role (backend).
alter table public.portfolio_fornecedores enable row level security;

-- Bucket público (vitrine é pra mostrar; leitura por URL direta, escrita service_role).
insert into storage.buckets (id, name, public)
values ('portfolio-fornecedores', 'portfolio-fornecedores', true)
on conflict (id) do nothing;
