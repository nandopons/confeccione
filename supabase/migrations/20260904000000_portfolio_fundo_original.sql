-- Recorte de fundo do portfólio (03/09/2026). Já aplicada via MCP; arquivo
-- mantém o histórico do schema no repositório.
--
-- `path_original` guarda a foto como o fornecedor mandou, pra ele poder desfazer
-- o recorte. Sem isso, um recorte ruim seria irreversível — e o recorte falha
-- justamente nas fotos de detalhe, onde a peça sangra pra fora do quadro.
alter table public.portfolio_fornecedores
  add column if not exists path_original text null,
  add column if not exists fundo_removido_em timestamptz null;
