-- O cliente escolhe MAIS DE UMA peça (05/09/2026).
--
-- Quem manda produzir raramente quer só uma coisa: a marca que pede camiseta
-- pede moletom junto, o uniforme vem com calça. Forçar uma escolha só fazia o
-- cliente abrir um pedido por peça — ou desistir e escrever tudo em observação,
-- onde o matching não enxerga.
--
-- `peca` (singular) continua existindo e guarda a PRIMEIRA escolhida: é a
-- coluna que todo o resto do sistema já lê. `pecas` é o conjunto completo, e é
-- por ele que o matching procura quem cobre mais itens do pedido.

alter table public.pedidos_assistente
  add column if not exists pecas text[] not null default '{}';

alter table public.pedidos
  add column if not exists pecas text[] not null default '{}';

comment on column public.pedidos_assistente.pecas is
  'Todas as peças escolhidas pelo cliente. `peca` guarda a primeira, por compatibilidade.';

-- O matching filtra por sobreposição de arrays (ov), que é operador GIN.
create index if not exists idx_pedidos_pecas
  on public.pedidos using gin (pecas);
