-- CRM de produção + histórico de orçamento (20/08/2026)
--
-- POR QUE ESTAS TABELAS EXISTEM
-- Entre `pedidos_assistente.pagamento_status = 'pago'` e `finalizado_em` não
-- havia NENHUM estado no banco. "Em produção" era derivado em tempo de leitura
-- (app/lib/fornecedor-pedidos.ts:derivarEstado e app/api/admin/funil), então
-- não dava para saber em que ponto da fábrica um pedido está, nem há quanto
-- tempo parou ali. Estas tabelas preenchem exatamente esse vazio.
--
-- POR QUE NÃO ESTICAR `pedidos_assistente.status`
-- Aquela coluna já carrega o ciclo comercial (completo, em_visualizacao,
-- confirmado, em_alinhamento, orcado, cancelado), não tem CHECK e é escrita de
-- seis lugares diferentes. Misturar chão de fábrica ali dobraria a chance de
-- um caminho sobrescrever o outro. Produção vira tabela própria, 1:1.
--
-- QUEM ESCREVE
-- Admin e fornecedor, os dois (decisão do Fernando, 20/08/2026). Por isso o
-- evento guarda `autor` — sem isso, em duas semanas ninguém sabe quem moveu.
--
-- APLICADA em produção em 20/08/2026 via MCP.

-- ---------------------------------------------------------------------------
-- Estado atual da produção de um pedido. Uma linha por pedido pago.
-- ---------------------------------------------------------------------------
create table if not exists public.producao_pedido (
  pedido_id     uuid primary key references public.pedidos_assistente(id) on delete cascade,
  etapa         text not null default 'planejamento'
                check (etapa in ('planejamento','compras','design','corte',
                                 'estamparia','costura','expedicao','pronto')),
  entrou_etapa_em timestamptz not null default now(),
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.producao_pedido is
  'Etapa de fábrica de cada pedido pago. Criada sob demanda quando o quadro carrega — pedido pago sem linha aqui entra em planejamento.';
comment on column public.producao_pedido.entrou_etapa_em is
  'Quando o card chegou na etapa ATUAL. Serve para mostrar "parado há N dias" sem varrer o histórico.';
comment on column public.producao_pedido.observacao is
  'Recado curto preso ao card (ex.: "malha chega quinta"). Não é histórico — sobrescreve.';

create index if not exists producao_pedido_etapa_idx on public.producao_pedido (etapa);

alter table public.producao_pedido enable row level security;
revoke all on public.producao_pedido from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Histórico de movimentação. Append-only: é o que responde "quem mudou o quê".
-- ---------------------------------------------------------------------------
create table if not exists public.producao_eventos (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references public.pedidos_assistente(id) on delete cascade,
  de_etapa    text,
  para_etapa  text not null,
  autor       text not null check (autor in ('admin','fornecedor','sistema')),
  autor_id    text,
  autor_nome  text,
  observacao  text,
  criado_em   timestamptz not null default now()
);

comment on table public.producao_eventos is
  'Linha do tempo da produção. Append-only — nunca sofre UPDATE nem DELETE.';
comment on column public.producao_eventos.de_etapa is
  'null quando é a entrada do pedido no quadro.';

create index if not exists producao_eventos_pedido_idx on public.producao_eventos (pedido_id, criado_em desc);

alter table public.producao_eventos enable row level security;
revoke all on public.producao_eventos from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Versões do orçamento.
--
-- Até hoje cada reenvio do fornecedor sobrescrevia valor_centavos,
-- repasse_centavos e orcamento_definido_em no próprio pedido — o valor anterior
-- simplesmente sumia. Não dá para recuperar o que já foi perdido; daqui pra
-- frente cada gravação deixa uma versão aqui.
-- ---------------------------------------------------------------------------
create table if not exists public.orcamento_versoes (
  id                uuid primary key default gen_random_uuid(),
  pedido_id         uuid not null references public.pedidos_assistente(id) on delete cascade,
  versao            integer not null,
  valor_centavos    integer,
  frete_centavos    integer,
  repasse_centavos  integer,
  linhas            jsonb,
  orcamento_itens   jsonb,
  frete_me          jsonb,
  autor             text not null check (autor in ('fornecedor','admin')),
  autor_id          text,
  autor_nome        text,
  motivo            text,
  criado_em         timestamptz not null default now(),
  constraint orcamento_versoes_pedido_versao_uk unique (pedido_id, versao)
);

comment on table public.orcamento_versoes is
  'Uma linha por gravação de orçamento. Append-only. O pedido continua guardando o valor corrente; aqui fica o rastro.';
comment on column public.orcamento_versoes.versao is
  'Sequencial por pedido, começando em 1. Calculado na aplicação, protegido pela unique.';
comment on column public.orcamento_versoes.motivo is
  'Preenchido quando o admin corrige um orçamento — por que mexeu.';

create index if not exists orcamento_versoes_pedido_idx on public.orcamento_versoes (pedido_id, versao desc);

alter table public.orcamento_versoes enable row level security;
revoke all on public.orcamento_versoes from anon, authenticated;
