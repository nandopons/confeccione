-- Confecção aceitou e não orçou — 29/09/2026 (decisão do Fernando).
-- Às 20 h do aceite sem orçamento a gente pergunta AO CLIENTE se a confecção
-- entrou em contato e se ele segue com ela ou prefere que a gente procure
-- outra. Marca única por aceite; reabertura pelo cliente zera a marca e conta
-- em reaberto_vezes (a "trava sutil": na segunda o Luigi pede pra olhar o
-- pedido antes). Ver app/lib/cobranca-orcamento.ts e reabrirBuscaPeloCliente.
alter table public.pedidos_assistente
  add column if not exists orcamento_cobrado_em timestamptz,
  add column if not exists reaberto_vezes integer not null default 0;
comment on column public.pedidos_assistente.orcamento_cobrado_em is
  'Quando perguntamos ao cliente se a confecção que aceitou (e não orçou em 20 h) entrou em contato. Null = ainda não / zerado na reabertura.';
comment on column public.pedidos_assistente.reaberto_vezes is
  'Quantas vezes o cliente pediu pra reabrir a busca depois de um aceite sem orçamento.';
