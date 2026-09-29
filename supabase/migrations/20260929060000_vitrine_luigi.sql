-- VITRINE → WHATSAPP COM O LUIGI — 29/09/2026 (decisão do Fernando).
-- "Ao clicar em fazer pedido, joga direto no WhatsApp com o Luigi e ele resolve
-- o resto; um track pra ele saber que tipo de produto e de qual fornecedor o
-- cliente clicou; dá preferência pro pedido ir pra aquele fornecedor."
-- E: "automação simples pro Luigi preencher a ficha técnica dos produtos da
-- vitrine, perguntando o valor de cada um ao fornecedor".

-- De onde o cliente veio (a mensagem traz "(vitrine 8hex)"; o Luigi grava aqui).
alter table public.wa_conversas
  add column if not exists vitrine_item_id uuid references public.portfolio_fornecedores(id) on delete set null,
  add column if not exists vitrine_visto_em timestamptz;

-- O pedido lembra o produto e a confecção de origem; a fila oferta pra ela primeiro.
alter table public.pedidos_assistente
  add column if not exists vitrine_item_id uuid references public.portfolio_fornecedores(id) on delete set null,
  add column if not exists fornecedor_preferido_id uuid references public.leads_fornecedores(id) on delete set null;

-- Ficha técnica: preço de referência + o rastro da pergunta ao fornecedor.
alter table public.portfolio_fornecedores
  add column if not exists preco_centavos integer,
  add column if not exists ficha_perguntada_em timestamptz,
  add column if not exists ficha_foto_enviada_em timestamptz;
comment on column public.portfolio_fornecedores.preco_centavos is
  'Valor unitário aproximado que a confecção deu pra esta peça (referência pro Luigi; o orçamento final é dela).';

-- Cliques nos cards da vitrine (sem dado pessoal: só o produto e a hora).
create table if not exists public.vitrine_cliques (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.portfolio_fornecedores(id) on delete cascade,
  fornecedor_id uuid references public.leads_fornecedores(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists vitrine_cliques_item_idx on public.vitrine_cliques (item_id, criado_em desc);
alter table public.vitrine_cliques enable row level security;
