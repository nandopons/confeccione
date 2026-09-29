-- Toda foto que a confecção manda no WhatsApp entra no portfólio — 29/09/2026
-- (decisão do Fernando: "aceita todas, na vitrine eu seleciono"). Pra não
-- guardar a mesma foto duas vezes, o item lembra de onde veio.
alter table public.portfolio_fornecedores add column if not exists midia_path text;
create unique index if not exists portfolio_fornecedores_midia_path_uq
  on public.portfolio_fornecedores (midia_path) where midia_path is not null;
comment on column public.portfolio_fornecedores.midia_path is
  'Caminho da mídia no bucket wa-midia quando a foto veio pelo WhatsApp. Único: a mesma mensagem não entra duas vezes.';
