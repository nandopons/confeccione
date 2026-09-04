-- Portfólio vira catálogo de PRODUTO (04/09/2026).
--
-- Decisão do Fernando: a foto sozinha não fecha pedido. O fornecedor descreve o
-- que aquilo é (nome, tipo, ficha técnica, pedido mínimo, prazo, tamanhos) e o
-- cliente pode pedir aquele produto direto pra aquela confecção.
--
-- Preço NÃO entra: continua saindo só na oferta, como o resto do marketplace.

alter table public.portfolio_fornecedores
  add column if not exists nome text,
  add column if not exists tipo text,
  add column if not exists pedido_minimo integer,
  add column if not exists prazo_dias integer,
  add column if not exists tamanhos text,
  add column if not exists tecido text,
  add column if not exists cores text,
  add column if not exists tecnicas text,
  add column if not exists observacoes text;

comment on column public.portfolio_fornecedores.nome is
  'Nome do produto, ex.: "Baby look gola careca". Vira a legenda do card na home.';
comment on column public.portfolio_fornecedores.tipo is
  'Segmento, mesmos valores de pedidos.tipo (ofertas-labels.ts).';
comment on column public.portfolio_fornecedores.pedido_minimo is
  'Mínimo de peças para ESTE produto; pode diferir do mínimo geral do fornecedor.';
comment on column public.portfolio_fornecedores.tamanhos is
  'Grade disponível em texto livre, ex.: "P ao GG, plus size sob consulta".';

-- A home e o catálogo filtram por produto descrito; sem índice isso vira
-- varredura assim que houver algumas centenas de fotos.
create index if not exists idx_portfolio_destaque_nome
  on public.portfolio_fornecedores (destaque, criado_em desc)
  where nome is not null;
