-- Arquivar card de produção (21/08/2026)
--
-- O PROBLEMA
-- O card só saía do quadro chegando em 'pronto'. Quem já estava pago antes do
-- CRM existir entrou todo em 'planejamento' — pedido de meses atrás, entregue
-- há muito tempo, ocupando a primeira coluna e envenenando o "parado há N
-- dias", que é o sinal mais útil do quadro. Arrastar oito colunas pra limpar
-- lixo histórico ainda dispararia aviso ao cliente em cada etapa.
--
-- POR QUE ARQUIVAR E NÃO DELETAR
-- DELETE levaria junto o histórico (producao_eventos tem cascade) e, pior, o
-- card voltaria sozinho: `garantirCards` recria a linha de qualquer pedido pago
-- que não tenha uma. A linha PRECISA continuar existindo — arquivada — pra ser
-- a lápide que impede a ressurreição. Some do quadro, não some do banco, e
-- desarquivar é um clique.
--
-- APLICADA em produção em 21/08/2026 via MCP.

alter table public.producao_pedido
  add column if not exists arquivado_em timestamptz,
  add column if not exists arquivado_motivo text;

comment on column public.producao_pedido.arquivado_em is
  'Quando saiu do quadro sem passar pelas etapas. Preenchido = invisível no quadro, mas a linha continua aqui de propósito: é ela que impede garantirCards de recriar o card.';
comment on column public.producao_pedido.arquivado_motivo is
  'Por que saiu (ex.: "entregue em junho, antes do CRM"). Opcional — arquivar precisa ser barato, senão ninguém limpa o quadro.';

-- Índice parcial: o quadro pergunta "arquivado_em is null" em toda carga, e o
-- caso arquivado é a minoria permanente.
create index if not exists producao_pedido_ativos_idx
  on public.producao_pedido (etapa)
  where arquivado_em is null;
