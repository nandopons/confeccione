-- "Outros" em texto livre nas duas pontas (05/09/2026).
--
-- O catálogo de peças é uma aposta nossa sobre o que o mercado pede. Sem um
-- campo aberto, tudo que ficou de fora do catálogo desaparece em silêncio: o
-- cliente escolhe a peça mais ou menos parecida (e o match erra) ou fecha a
-- aba, e nos dois casos a gente nunca fica sabendo. Estes campos existem pra
-- transformar a lacuna em dado — ver /admin/pecas-faltando.

alter table public.pedidos_assistente
  add column if not exists peca_outro text;

alter table public.pedidos
  add column if not exists peca_outro text;

alter table public.leads_fornecedores
  add column if not exists pecas_outro text;

comment on column public.pedidos_assistente.peca_outro is
  'Peça descrita pelo cliente quando nenhuma do catálogo servia. Entrada pra novas peças.';
comment on column public.leads_fornecedores.pecas_outro is
  'O que a confecção produz e não está no catálogo. Entrada pra novas peças.';
