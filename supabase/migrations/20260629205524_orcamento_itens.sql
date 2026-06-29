-- Detalhamento do orçamento do pedido rico (produção por modelo + extras +
-- Seguro Confeccione 3% + frete), em preço de cliente, somando exatamente ao
-- valor_centavos cobrado. NULL = orçamento antigo (sem detalhamento).
alter table public.pedidos_assistente
  add column if not exists orcamento_itens jsonb;

comment on column public.pedidos_assistente.orcamento_itens is
  'Detalhamento do orçamento {producao:[{modelo,qtd,unit_centavos,subtotal_centavos}], extras:[{descricao,valor_centavos}], frete_centavos, seguro_centavos, total_centavos} — valores líquidos exceto seguro_centavos/total_centavos (cliente). Fonte de exibição; valor_centavos da tabela = total cobrado.';
