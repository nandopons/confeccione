-- Chat cliente<->fornecedor do PEDIDO RICO (pedidos_assistente).
-- Espelha mensagens_pedido (com anexo/áudio). service_role only (RLS travada).
create table if not exists public.mensagens_pedido_assistente (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_assistente(id) on delete cascade,
  autor text not null check (autor in ('cliente','fornecedor')),
  conteudo text,
  tipo text not null default 'texto' check (tipo in ('texto','audio','imagem','arquivo')),
  anexo_path text,
  anexo_nome text,
  anexo_mime text,
  anexo_tamanho bigint,
  audio_duracao_ms integer,
  criado_em timestamptz not null default now(),
  constraint mpa_conteudo_ou_anexo_check check (
    (tipo = 'texto' and conteudo is not null)
    or (tipo in ('audio','imagem','arquivo') and anexo_path is not null)
  )
);

create index if not exists mpa_pedido_criado_idx
  on public.mensagens_pedido_assistente (pedido_id, criado_em);

alter table public.mensagens_pedido_assistente enable row level security;
