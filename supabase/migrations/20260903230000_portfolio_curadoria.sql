-- Curadoria da vitrine (03/09/2026). Já aplicada no banco via MCP; este arquivo
-- mantém o histórico do schema no repositório.
--
-- O fornecedor sobe a foto no painel dele; ela nasce SEM destaque e só aparece
-- no carrossel da home depois que o admin marca `destaque` em /admin/vitrine.
alter table public.portfolio_fornecedores
  add column if not exists destaque boolean not null default false,
  add column if not exists destaque_em timestamptz null,
  add column if not exists largura integer null,
  add column if not exists altura integer null;

-- Carrossel: só destaques, na ordem em que foram promovidos.
create index if not exists portfolio_fornecedores_destaque_idx
  on public.portfolio_fornecedores (destaque, destaque_em desc)
  where destaque;

-- Fila de curadoria no admin (mais novas primeiro).
create index if not exists portfolio_fornecedores_criado_idx
  on public.portfolio_fornecedores (criado_em desc);
