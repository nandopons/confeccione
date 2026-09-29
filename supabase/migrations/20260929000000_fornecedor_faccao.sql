-- ============================================================================
-- FACÇÃO — 29/09/2026 (decisão do Fernando)
--
-- Confecção que só pega COSTURA: participa de uma etapa específica da
-- produção, não corta, não estampa, não fornece tecido. Preço baixo, mas casa
-- melhor com pedido da própria cidade — o cliente precisa levar o lote de
-- tecido (muitas vezes já cortado) e depois buscar as peças costuradas pra
-- fazer as outras etapas.
--
-- A Thannytt (Alto Horizonte/GO) aceitou o 20260900337 da Kely e desistiu:
-- "ela precisa que faça a estampa e corte as peças também". Sem a marca, a
-- fila e a tela tratavam facção como confecção completa.
--
-- Uma coluna no cadastro porque é de lá que o match lê (pedido_minimo,
-- prazo_minimo_dias moram aqui pelo mesmo motivo). O Luigi grava pelo
-- salvar_perfil_producao (faccao: true) quando ela diz "só costuro".
-- ============================================================================

alter table public.leads_fornecedores
  add column if not exists faccao boolean not null default false;

comment on column public.leads_fornecedores.faccao is
  'Só costura (facção): não corta, não estampa, não fornece tecido. A fila automática só oferta pedido da mesma cidade; a tela mostra a tag FACÇÃO.';
