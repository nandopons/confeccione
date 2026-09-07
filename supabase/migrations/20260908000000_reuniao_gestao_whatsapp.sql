-- ============================================================================
-- REUNIÃO DE GESTÃO PELO WHATSAPP, DUAS VEZES POR DIA (decisão D-7, 07/09/2026).
--
-- O ritual deixa de ser só a segunda-feira: às 07:00 e às 17:30 (Recife) o
-- agente manda a pauta pro WhatsApp do Fernando e a reunião acontece na
-- própria conversa. Duas mudanças no banco:
--
--   reunioes.tipo        → ganha 'manha' e 'tarde', pra ata diária ter lugar.
--   gestao_whatsapp_log  → auditoria de cada resposta do agente: o que o
--                          Fernando mandou, o que o agente respondeu, quais
--                          ferramentas do diário chamou, tokens e erro. É o
--                          que permite "treinar" o agente lendo onde errou.
-- ============================================================================

-- ─── reunioes.tipo: manhã e tarde ───────────────────────────────────────────

alter table public.reunioes drop constraint if exists reunioes_tipo_check;
alter table public.reunioes
  add constraint reunioes_tipo_check
  check (tipo in ('segunda', 'sexta', 'mensal', 'sessao', 'manha', 'tarde'));

comment on column public.reunioes.tipo is
  'segunda (placar + prioridades) | sexta (fechamento) | mensal (financeiro) | sessao (trabalho com o assistente) | manha (07:00, fila do dia) | tarde (17:30, fechamento do dia)';

-- ─── gestao_whatsapp_log ────────────────────────────────────────────────────

create table if not exists public.gestao_whatsapp_log (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),
  conversa_id    uuid references public.wa_conversas (id) on delete set null,
  wa_id          text not null,
  -- wamid da mensagem recebida que disparou a resposta (null quando foi o cron).
  wamid_entrada  text,
  -- 'resposta' (o Fernando escreveu e o agente respondeu) | 'pauta' (cron das
  -- 07:00 / 17:30 mandou a pauta).
  origem         text not null default 'resposta' check (origem in ('resposta', 'pauta')),
  mensagem       text,
  resposta       text,
  -- [{nome, argumentos, ok}] na ordem em que o agente chamou.
  ferramentas    jsonb not null default '[]'::jsonb,
  modelo         text,
  rodadas        int not null default 0,
  tokens_entrada int not null default 0,
  tokens_saida   int not null default 0,
  duracao_ms     int,
  enviado        boolean not null default false,
  erro           text
);

comment on table public.gestao_whatsapp_log is
  'Auditoria do agente de gestão no WhatsApp (reunião 07:00/17:30 com o Fernando). Uma linha por resposta ou pauta. Acesso apenas via service_role.';

create index if not exists gestao_whatsapp_log_criado_idx on public.gestao_whatsapp_log (criado_em desc);
create index if not exists gestao_whatsapp_log_conversa_idx on public.gestao_whatsapp_log (conversa_id, criado_em desc);

alter table public.gestao_whatsapp_log enable row level security;
revoke all on public.gestao_whatsapp_log from anon, authenticated;
