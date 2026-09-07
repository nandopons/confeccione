-- ============================================================================
-- LUIGI NO WHATSAPP — o agente de atendimento que responde cliente (08/09/2026).
--
-- Até aqui só o agente de gestão respondia sozinho, e só ao número do Fernando.
-- Mensagem de cliente caía no inbox e esperava gente. O Luigi passa a atender
-- os contatos que NÃO são gestão nem fornecedor, com o contexto do pedido
-- (etapa, fornecedor, orçamento), em três modos escolhidos no inbox
-- (o controle é do Fernando, como nas automações — D-10):
--
--   desligado  → nada acontece.
--   sugere     → N1: a resposta fica pronta no composer, o Fernando manda.
--   responde   → N2: manda sozinho dentro da janela de 24 h, com log.
--                Nasce assim, por decisão do Fernando em 08/09 ("sempre pro
--                WhatsApp ser respondido automaticamente, eu vou observando").
--
-- Quatro mudanças no banco:
--   agentes_config              → o modo de cada agente (linha 'luigi').
--   luigi_whatsapp_log          → uma linha por mensagem tratada: sugestão,
--                                 resposta enviada, escalada pra humano, erro.
--   wa_mensagens.autor          → quem escreveu a saída (null = gente no inbox).
--   wa_conversas.luigi_escalado_em → o Luigi chamou humano e ninguém respondeu.
-- ============================================================================

-- ─── agentes_config ─────────────────────────────────────────────────────────

create table if not exists public.agentes_config (
  agente        text primary key,
  modo          text not null default 'desligado' check (modo in ('desligado', 'sugere', 'responde')),
  config        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

comment on table public.agentes_config is
  'Nível de autonomia ligado por agente (seção 3 do sistema operacional). desligado | sugere (N1) | responde (N2). Só service_role.';

insert into public.agentes_config (agente, modo)
values ('luigi', 'responde')
on conflict (agente) do nothing;

alter table public.agentes_config enable row level security;
revoke all on public.agentes_config from anon, authenticated;

-- ─── wa_mensagens.autor ─────────────────────────────────────────────────────

alter table public.wa_mensagens add column if not exists autor text;

comment on column public.wa_mensagens.autor is
  'Quem escreveu a mensagem de saída: null (gente, pelo inbox ou pelo sistema) | luigi | gestao.';

-- ─── wa_conversas.luigi_escalado_em ─────────────────────────────────────────

alter table public.wa_conversas add column if not exists luigi_escalado_em timestamptz;

comment on column public.wa_conversas.luigi_escalado_em is
  'Quando o Luigi chamou humano nesta conversa. Limpa quando alguém responde pelo inbox.';

-- ─── luigi_whatsapp_log ─────────────────────────────────────────────────────

create table if not exists public.luigi_whatsapp_log (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),
  conversa_id    uuid references public.wa_conversas (id) on delete set null,
  wa_id          text not null,
  wamid_entrada  text,
  -- Modo em que rodou: sugere (rascunho pro inbox) | responde (mandou sozinho).
  modo           text not null check (modo in ('sugere', 'responde')),
  mensagem       text,
  resposta       text,
  -- Pedido em foco na hora da resposta (pedidos_assistente), se havia.
  pedido_id      uuid,
  -- [{nome, argumentos, ok}] na ordem em que o agente chamou.
  ferramentas    jsonb not null default '[]'::jsonb,
  escalado       boolean not null default false,
  motivo_escalada text,
  -- sugerida → usada | descartada (modo sugere); enviada | falhou (modo responde);
  -- ignorada (mídia sem texto, botão já tratado, contato fora do escopo).
  status         text not null check (status in ('sugerida', 'usada', 'descartada', 'enviada', 'falhou', 'ignorada')),
  modelo         text,
  rodadas        int not null default 0,
  tokens_entrada int not null default 0,
  tokens_saida   int not null default 0,
  duracao_ms     int,
  erro           text,
  resolvido_em   timestamptz
);

comment on table public.luigi_whatsapp_log is
  'Auditoria do Luigi no WhatsApp: uma linha por mensagem de cliente tratada (sugestão, resposta, escalada, erro). Só service_role.';

create index if not exists luigi_whatsapp_log_criado_idx on public.luigi_whatsapp_log (criado_em desc);
create index if not exists luigi_whatsapp_log_conversa_idx on public.luigi_whatsapp_log (conversa_id, criado_em desc);
create index if not exists luigi_whatsapp_log_sugeridas_idx on public.luigi_whatsapp_log (conversa_id) where status = 'sugerida';

alter table public.luigi_whatsapp_log enable row level security;
revoke all on public.luigi_whatsapp_log from anon, authenticated;
