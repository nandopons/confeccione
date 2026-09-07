-- ============================================================================
-- MARKETING — base de leads própria + campanhas   (já aplicada em prod)
--
-- leads_marketing: o LEAD vira entidade independente do pedido. Recebe os
-- leads do chat (sync a partir de pedidos_assistente), quem criou conta, quem
-- foi cadastrado à mão e quem veio de CSV. Dedupe por telefone_norm/email_norm.
--
-- campanhas_marketing + campanha_envios: campanha manual/agendada (WhatsApp
-- template oficial, Z-API ou e-mail) com fila por lead — retomável e sem
-- envio duplicado.
--
-- segmentos_marketing: filtros salvos pra reusar em campanha.
--
-- Padrão do projeto: RLS habilitado + default-deny (acesso só via service_role).
-- ============================================================================

create table if not exists public.leads_marketing (
  id            uuid primary key default gen_random_uuid(),
  nome          text,
  empresa       text,
  telefone      text,
  telefone_norm text,
  email         text,
  email_norm    text,
  cidade        text,
  uf            text,
  origem        text not null default 'manual',   -- chat | conta | manual | importacao
  tags          text[] not null default '{}',
  observacao    text,
  status        text not null default 'lead',     -- lead | cliente | descadastrado
  opt_out       boolean not null default false,
  opt_out_em    timestamptz,
  pedido_id     uuid references public.pedidos_assistente(id) on delete set null,
  conta_id      uuid,
  importacao    text,
  ultimo_contato_em timestamptz,
  toques        integer not null default 0,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint leads_marketing_contato_ck check (telefone_norm is not null or email_norm is not null)
);

create unique index if not exists leads_marketing_telefone_uk
  on public.leads_marketing (telefone_norm) where telefone_norm is not null;
create unique index if not exists leads_marketing_email_uk
  on public.leads_marketing (email_norm) where email_norm is not null;
create unique index if not exists leads_marketing_pedido_uk
  on public.leads_marketing (pedido_id) where pedido_id is not null;
create index if not exists leads_marketing_criado_idx on public.leads_marketing (criado_em desc);
create index if not exists leads_marketing_status_idx on public.leads_marketing (status);
create index if not exists leads_marketing_uf_idx on public.leads_marketing (uf);

alter table public.leads_marketing enable row level security;
revoke all on public.leads_marketing from anon, authenticated;

create table if not exists public.campanhas_marketing (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  canal         text not null,                    -- whatsapp_template | whatsapp_zapi | email
  template      text,
  template_params jsonb not null default '[]',
  assunto       text,
  mensagem      text not null default '',
  filtro        jsonb not null default '{}',
  status        text not null default 'rascunho', -- rascunho | agendada | enviando | concluida | cancelada
  agendada_para timestamptz,
  total_alvo    integer not null default 0,
  enviados      integer not null default 0,
  erros         integer not null default 0,
  criado_em     timestamptz not null default now(),
  iniciada_em   timestamptz,
  concluida_em  timestamptz
);
create index if not exists campanhas_marketing_status_idx on public.campanhas_marketing (status, agendada_para);
alter table public.campanhas_marketing enable row level security;
revoke all on public.campanhas_marketing from anon, authenticated;

create table if not exists public.campanha_envios (
  id          uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_marketing(id) on delete cascade,
  lead_id     uuid not null references public.leads_marketing(id) on delete cascade,
  status      text not null default 'pendente',   -- pendente | enviado | erro | pulado
  erro        text,
  enviado_em  timestamptz,
  criado_em   timestamptz not null default now(),
  unique (campanha_id, lead_id)
);
create index if not exists campanha_envios_fila_idx on public.campanha_envios (campanha_id, status);
alter table public.campanha_envios enable row level security;
revoke all on public.campanha_envios from anon, authenticated;

create table if not exists public.segmentos_marketing (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique,
  filtro    jsonb not null default '{}',
  criado_em timestamptz not null default now()
);
alter table public.segmentos_marketing enable row level security;
revoke all on public.segmentos_marketing from anon, authenticated;

-- Um contato agora pode ser de um lead sem pedido (base importada) e pode
-- apontar pra campanha que o gerou.
alter table public.contatos_marketing alter column pedido_id drop not null;
alter table public.contatos_marketing
  add column if not exists lead_id uuid references public.leads_marketing(id) on delete cascade,
  add column if not exists campanha_id uuid references public.campanhas_marketing(id) on delete set null;
create index if not exists contatos_marketing_lead_idx on public.contatos_marketing (lead_id, enviado_em desc);
