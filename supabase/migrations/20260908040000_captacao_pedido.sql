-- ============================================================================
-- CAPTAÇÃO PUXADA PELO PEDIDO (08/09/2026).
--
-- Pedido confirmado que passa de 24 h sem confecção (etapa sem_fornecedor,
-- D-8) deixa de esperar: o sistema procura, na web (Google, perfis do
-- Instagram indexados, Google Places quando houver chave), confecções que
-- possam produzir AQUELE pedido e manda uma sondagem pontual — "vocês fazem
-- X em lote de N?" — por e-mail (com o resumo em PDF sem os dados do
-- cliente) e por WhatsApp (template aprovado). Decisões do Fernando em 08/09:
-- aborda sozinho com teto (10 por pedido, 40 mensagens frias por dia); busca
-- primeiro no estado do cliente, depois no polo de PE, depois no Brasil.
--
-- Mudanças no banco:
--   captacao_fornecedores  → ganha origem/pedido e o que a busca descobriu
--                            (cidade, uf, instagram, site, fonte, evidência)
--                            e a resposta do candidato.
--   captacao_buscas        → uma linha por busca rodada pra um pedido
--                            (região, consultas, quantos achou, custo, erro).
--   agentes_config         → linha 'captacao' (modo + tetos e regiões em config).
-- ============================================================================

-- ─── captacao_fornecedores: de onde veio e o que a busca sabe ───────────────

alter table public.captacao_fornecedores
  add column if not exists origem            text not null default 'manual',
  add column if not exists pedido_id         uuid,
  add column if not exists cidade            text,
  add column if not exists uf                text,
  add column if not exists instagram         text,
  add column if not exists site              text,
  add column if not exists fonte             text,
  add column if not exists evidencia         text,
  add column if not exists resposta          text,
  add column if not exists resposta_obs      text,
  add column if not exists respondido_em     timestamptz,
  add column if not exists ultimo_contato_em timestamptz;

alter table public.captacao_fornecedores drop constraint if exists captacao_fornecedores_origem_check;
alter table public.captacao_fornecedores
  add constraint captacao_fornecedores_origem_check check (origem in ('manual', 'pedido', 'captador'));

alter table public.captacao_fornecedores drop constraint if exists captacao_fornecedores_resposta_check;
alter table public.captacao_fornecedores
  add constraint captacao_fornecedores_resposta_check
  check (resposta is null or resposta in ('interessado', 'recusou', 'depois', 'nao_produz', 'opt_out'));

comment on column public.captacao_fornecedores.origem is 'manual (admin) | pedido (busca automática puxada por um pedido sem fornecedor) | captador (freelancer)';
comment on column public.captacao_fornecedores.pedido_id is 'pedidos_assistente.id que motivou a abordagem (origem = pedido).';
comment on column public.captacao_fornecedores.fonte is 'URL onde a confecção foi encontrada (perfil do Instagram, site, ficha do Google).';
comment on column public.captacao_fornecedores.evidencia is 'Por que a busca acha que ela produz o pedido (uma frase).';
comment on column public.captacao_fornecedores.resposta is 'O que o candidato respondeu à sondagem: interessado | recusou | depois | nao_produz | opt_out (pediu pra não receber).';

create index if not exists captacao_fornecedores_pedido_idx on public.captacao_fornecedores (pedido_id) where pedido_id is not null;
create index if not exists captacao_fornecedores_whatsapp_idx on public.captacao_fornecedores (whatsapp) where whatsapp is not null;
create index if not exists captacao_fornecedores_contato_idx on public.captacao_fornecedores (ultimo_contato_em desc) where origem = 'pedido';

-- ─── captacao_buscas ────────────────────────────────────────────────────────

create table if not exists public.captacao_buscas (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  pedido_id     uuid not null,
  -- uf (estado do cliente) | pe (polo de Pernambuco) | brasil
  regiao        text not null check (regiao in ('uf', 'pe', 'brasil')),
  -- 'cron' | 'admin' | 'mcp'
  origem        text not null default 'cron',
  perfil        jsonb not null default '{}'::jsonb,
  consultas     jsonb not null default '[]'::jsonb,
  encontrados   int not null default 0,
  novos         int not null default 0,
  contatados    int not null default 0,
  descartados   jsonb not null default '[]'::jsonb,
  resumo        text,
  modelo        text,
  tokens_entrada int not null default 0,
  tokens_saida   int not null default 0,
  buscas_web     int not null default 0,
  duracao_ms     int,
  erro           text
);

comment on table public.captacao_buscas is
  'Cada rodada de busca de confecções pra um pedido sem fornecedor: região, consultas, quantos candidatos, quantos abordados, custo. Só service_role.';

create index if not exists captacao_buscas_pedido_idx on public.captacao_buscas (pedido_id, criado_em desc);
create index if not exists captacao_buscas_criado_idx on public.captacao_buscas (criado_em desc);

alter table public.captacao_buscas enable row level security;
revoke all on public.captacao_buscas from anon, authenticated;

-- ─── agentes_config: o agente de captação ───────────────────────────────────

insert into public.agentes_config (agente, modo, config)
values (
  'captacao',
  'responde',
  '{"max_por_pedido": 10, "max_por_dia": 40, "regioes": ["uf", "pe", "brasil"], "horas_entre_buscas": 48}'::jsonb
)
on conflict (agente) do nothing;
