-- ============================================================================
-- A BUSCA DE CONFECÇÃO TEM PRAZO — 25/09/2026 (decisão do Fernando)
--
-- Pedido liberado vale 7 dias na fila de oferta. Passou disso sem confecção,
-- o sistema pergunta ao cliente se ele quer que a gente continue procurando:
--   • responde qualquer coisa → renova por mais 7 dias
--   • não responde em 2 dias → pergunta de novo
--   • não responde em mais 2 → encerra (motivo `sumiu`, por `regua`)
--
-- Antes disto a fila tinha um corte fixo de 30 dias (MAX_DIAS_PARADO) e o
-- pedido parado ficava no funil pra sempre, sem ninguém perguntar nada ao
-- cliente. Ver app/lib/busca-fornecedor-validade.ts.
-- ============================================================================

alter table public.pedidos_assistente
  add column if not exists busca_valida_ate timestamptz,
  add column if not exists busca_perguntada_em timestamptz,
  add column if not exists busca_perguntada_vezes integer not null default 0;

comment on column public.pedidos_assistente.busca_valida_ate is
  'Até quando a fila automática oferta este pedido. 7 dias a partir da liberação; renova com qualquer resposta do cliente à pergunta da régua.';
comment on column public.pedidos_assistente.busca_perguntada_em is
  'Última vez que a régua perguntou ao cliente se continua a busca. NULL = não perguntou (ou renovou).';
comment on column public.pedidos_assistente.busca_perguntada_vezes is
  'Quantas vezes perguntou nesta rodada de vencimento (1 = primeira, 2 = repetida). Zera na renovação.';

-- Represados: quem foi liberado antes desta migration ganha o mesmo prazo
-- contado da liberação. Os de mais de 7 dias já nascem vencidos e entram na
-- régua na primeira rodada — é o que o Fernando quer: perguntar, não ofertar.
update public.pedidos_assistente
   set busca_valida_ate = confirmado_em + interval '7 days'
 where confirmado_em is not null
   and busca_valida_ate is null;

create index if not exists pedidos_assistente_busca_valida_ate_idx
  on public.pedidos_assistente (busca_valida_ate)
  where confirmado_em is not null and encerrado_em is null;
