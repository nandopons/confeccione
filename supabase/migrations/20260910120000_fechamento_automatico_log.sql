-- ============================================================================
-- RASTRO DO FECHAMENTO AUTOMÁTICO — 10/09/2026.
--
-- POR QUE UMA TABELA E NÃO console.log
-- Os logs de runtime deste projeto só guardam a linha do request: nenhum
-- console.log aparece neles. Quando um pedido não fechava, o motivo existia
-- dentro da função e morria ali — a única forma de descobrir era pedir pro
-- Fernando rodar o curl do cron na mão e ler o JSON da resposta, o que só
-- funciona se alguém estiver olhando na hora exata. Depois do fato, silêncio.
--
-- Uma linha por rodada do cron resolve: pedido pulado tem motivo consultável
-- por SQL, no dia seguinte, sem depender de ninguém estar acordado.
--
-- A TABELA JÁ EXISTE NO BANCO (foi criada direto pelo SQL editor antes deste
-- arquivo). Esta migration é o registro dela no repo — daí o if not exists em
-- tudo: contra o banco de produção ela é no-op, contra um banco novo cria.
-- ============================================================================

create table if not exists public.fechamento_automatico_log (
  id          uuid        primary key default gen_random_uuid(),
  criado_em   timestamptz not null default now(),
  -- Quantos pedidos a varredura olhou nesta rodada.
  olhados     integer     not null default 0,
  -- [{ pedido, mockupsGerados }] — quem recebeu o resumo.
  fechados    jsonb       not null default '[]'::jsonb,
  -- [{ pedido, motivo }] — o campo que a gente realmente consulta.
  pulados     jsonb       not null default '[]'::jsonb,
  erro        text,
  duracao_ms  integer
);

comment on table  public.fechamento_automatico_log is
  'Uma linha por rodada de fecharPedidosProntos(). Existe porque console.log não sobrevive ao runtime da Vercel aqui.';
comment on column public.fechamento_automatico_log.pulados is
  '[{pedido, motivo}] do que não fechou. É por aqui que se descobre por que um pedido ficou sem resumo.';

-- Consulta típica: "o que rolou nas últimas rodadas?"
create index if not exists fechamento_automatico_log_recentes_idx
  on public.fechamento_automatico_log (criado_em desc);

-- RLS default-deny, como o resto do schema: o cron usa a service role, que
-- ignora RLS. Sem isto, a chave anônima (que vai no bundle do browser) lê
-- código de pedido e movimento operacional de quem nem cliente é.
alter table public.fechamento_automatico_log enable row level security;
