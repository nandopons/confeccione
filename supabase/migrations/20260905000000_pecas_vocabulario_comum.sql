-- Vocabulário comum de PEÇAS entre cliente e fornecedor (05/09/2026).
--
-- Por quê: o match por categoria ("Private Label", "Interclasse") não refinava.
-- Categoria é ocasião de compra, não capacidade de produção — marcar "Private
-- Label" não diz se a confecção faz polo. O fornecedor pensa em peça
-- ("produzimos vestidos, camisas, blusas, top, calças e saias") e é isso que o
-- cliente escolhe do outro lado.
--
-- `tipos_produto` e `categoria` continuam existindo: são a ponte enquanto os
-- cadastros antigos não têm peça. Ver app/lib/pecas.ts.

alter table public.leads_fornecedores
  add column if not exists pecas text[] not null default '{}';

alter table public.pedidos_assistente
  add column if not exists peca text;

alter table public.pedidos
  add column if not exists peca text;

comment on column public.leads_fornecedores.pecas is
  'Peças que a confecção produz (app/lib/pecas.ts). Substitui tipos_produto no matching.';
comment on column public.pedidos_assistente.peca is
  'Peça escolhida pelo cliente. categoria continua preenchida como legado.';

-- GIN: o matching filtra por "contém a peça", que é operador de array.
create index if not exists idx_fornecedores_pecas
  on public.leads_fornecedores using gin (pecas);
