-- "Esse produto não faço" vira dado do match — 29/09/2026 (decisão do Fernando):
-- "o Luigi entende qual é o produto pra não ficar ofertando novamente".
-- Antes o "não faço" ficava em perfil_producao.nao_faz (texto livre que ninguém lê).
-- Agora é lista de ids do catálogo (ver pecas.ts), gravada pelo recusar_oferta,
-- desistir_do_pedido e salvar_perfil_producao, e lida por pontuarFornecedor.
alter table public.leads_fornecedores add column if not exists pecas_nao_faz text[] not null default '{}';
comment on column public.leads_fornecedores.pecas_nao_faz is
  'Peças (ids do catálogo) que a confecção disse que NÃO faz. O match não oferta pedido dessas peças pra ela.';
