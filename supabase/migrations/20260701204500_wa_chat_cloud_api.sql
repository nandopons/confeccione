-- ============================================================================
-- Chat WhatsApp oficial (Meta Cloud API)
-- wa_contatos: um registro por número (wa_id = telefone sem '+', formato Meta)
-- wa_conversas: 1:1 com contato; controla janela 24h, não-lidas e preview
-- wa_mensagens: todas as mensagens (entrada/saída), mídia no bucket wa-midia
-- RLS ligada SEM policies: acesso apenas via service role (server) — anon nega
-- Aplicada em produção via MCP em 01/07/2026 (name: wa_chat_cloud_api).
-- ============================================================================

create table wa_contatos (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,
  nome text,
  cliente_id uuid references contas_clientes(id) on delete set null,
  fornecedor_id uuid references leads_fornecedores(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table wa_conversas (
  id uuid primary key default gen_random_uuid(),
  contato_id uuid not null unique references wa_contatos(id) on delete cascade,
  ultima_mensagem_em timestamptz,
  ultima_msg_contato_em timestamptz,
  preview text,
  nao_lidas integer not null default 0,
  arquivada boolean not null default false,
  criado_em timestamptz not null default now()
);

create table wa_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references wa_conversas(id) on delete cascade,
  wamid text unique,
  direcao text not null check (direcao in ('entrada','saida')),
  tipo text not null default 'text',
  corpo text,
  midia_path text,
  midia_mime text,
  midia_nome text,
  status text not null default 'recebido',
  erro text,
  template_nome text,
  payload jsonb,
  criado_em timestamptz not null default now()
);

create index wa_mensagens_conversa_idx on wa_mensagens (conversa_id, criado_em desc);
create index wa_conversas_ultima_idx on wa_conversas (ultima_mensagem_em desc);
create index wa_contatos_wa_id_idx on wa_contatos (wa_id);

insert into storage.buckets (id, name, public)
values ('wa-midia', 'wa-midia', false)
on conflict (id) do nothing;

alter table wa_contatos enable row level security;
alter table wa_conversas enable row level security;
alter table wa_mensagens enable row level security;
