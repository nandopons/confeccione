-- 29/09/2026 — PRÉVIAS EM LOTE (ver app/lib/previas-lote.ts).
-- previas_lote_em: o Luigi pediu o lote (gerar_previas_do_pedido) e ele ainda
-- não terminou; o cron de 1 min termina o que não coube no turno e zera.
-- previas_lote_rodando_em: a vez de quem está gerando agora (turno ou cron),
-- expira sozinha em 4 min.
alter table public.pedidos_assistente
  add column if not exists previas_lote_em timestamptz,
  add column if not exists previas_lote_rodando_em timestamptz;

create index if not exists pedidos_assistente_previas_lote_idx
  on public.pedidos_assistente (previas_lote_em)
  where previas_lote_em is not null;
