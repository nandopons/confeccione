-- Rede social / feed: confecções e atacadistas postam; cliente consome.

-- Tipo do perfil que posta (confecção ou atacado).
alter table public.leads_fornecedores
  add column if not exists tipo_perfil text not null default 'confeccao';

-- Posts do feed (1 imagem + legenda por post no V1).
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.leads_fornecedores(id) on delete cascade,
  path text not null,            -- imagem no bucket 'posts'
  legenda text,
  criado_em timestamptz not null default now()
);

create index if not exists posts_recentes_idx on public.posts (criado_em desc);
create index if not exists posts_fornecedor_idx on public.posts (fornecedor_id, criado_em desc);

-- RLS travada: leitura/escrita via service_role (backend). Imagem é pública por URL.
alter table public.posts enable row level security;

insert into storage.buckets (id, name, public)
values ('posts', 'posts', true)
on conflict (id) do nothing;
