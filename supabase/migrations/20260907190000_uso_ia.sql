-- ============================================================================
-- CONSUMO DA API DA ANTHROPIC, medido pela própria aplicação (aplicada em prod).
--
-- Por que medir aqui e não perguntar pra Anthropic: a Usage & Cost API existe,
-- mas exige ADMIN KEY de organização (sk-ant-admin01-…), que enxerga o gasto
-- da org inteira — chave desse alcance não entra em app web. E mesmo com ela o
-- relatório é diário por workspace/modelo: não diz QUAL parte do site gastou.
--
-- Cada chamada grava os tokens que a própria resposta da SDK devolve
-- (response.usage) e o custo estimado pela tabela de preços vigente.
--
-- SALDO de crédito não tem API pública: só no Console (platform.claude.com).
-- ============================================================================

create table if not exists public.uso_ia (
  id             uuid primary key default gen_random_uuid(),
  rota           text not null,      -- 'pedido-chat', 'assistente', 'mockup-chat', …
  modelo         text not null,
  tokens_entrada integer not null default 0,
  tokens_saida   integer not null default 0,
  tokens_cache_leitura integer not null default 0,
  tokens_cache_escrita integer not null default 0,
  -- custo estimado em MILÉSIMOS de centavo de dólar (usd × 100000): chamada
  -- barata custa fração de centavo, então integer em centavos perderia tudo.
  custo_micro    bigint not null default 0,
  criado_em      timestamptz not null default now()
);

create index if not exists uso_ia_criado_idx on public.uso_ia (criado_em desc);
create index if not exists uso_ia_rota_idx on public.uso_ia (rota, criado_em desc);

alter table public.uso_ia enable row level security;
revoke all on public.uso_ia from anon, authenticated;
