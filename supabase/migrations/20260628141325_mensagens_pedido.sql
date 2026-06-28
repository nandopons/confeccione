-- Chat in-app entre cliente e fornecedor, por pedido.
-- O par só existe após o aceite (pedidos.fornecedor_aceito_id), então as mensagens
-- vivem coladas ao pedido. Escrita é feita pelos endpoints Bearer (service role);
-- leitura é liberada pro Realtime (anon), já que o app usa sessão OTP custom (sem
-- Supabase Auth / auth.uid()). A proteção da leitura é o pedido_id ser UUID.

create table if not exists public.mensagens_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  autor text not null check (autor in ('cliente', 'fornecedor')),
  conteudo text not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_mensagens_pedido_pedido_criado
  on public.mensagens_pedido (pedido_id, criado_em);

-- Realtime: o app assina INSERTs filtrando por pedido_id.
alter publication supabase_realtime add table public.mensagens_pedido;

-- RLS: leitura liberada (Realtime via anon); escrita só via service role (endpoints).
alter table public.mensagens_pedido enable row level security;

drop policy if exists "mensagens_pedido_select" on public.mensagens_pedido;
create policy "mensagens_pedido_select"
  on public.mensagens_pedido
  for select
  to anon, authenticated
  using (true);
-- Sem policy de insert/update/delete → bloqueado pro anon. O service role bypassa RLS.
