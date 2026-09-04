-- Reenquadramento da foto do portfólio (04/09/2026).
--
-- Contexto: a normalização usava `sharp.strategy.attention`, que escolhe o
-- recorte pela região de maior "interesse visual". Numa foto de baby look isso
-- fixou no rosto da modelo e cortou a cabeça no topo — imprevisível justamente
-- na única foto onde não dá pra errar (a home).
--
-- Duas colunas:
--   path_upload   → a foto EXATAMENTE como o fornecedor mandou. Sem ela, mudar
--                   o enquadramento exigiria novo upload, porque recortar de
--                   novo um 1080x1350 já cortado não devolve o que foi perdido.
--   enquadramento → de onde o corte parte: topo (padrão), centro ou base.

alter table public.portfolio_fornecedores
  add column if not exists path_upload text,
  add column if not exists enquadramento text not null default 'topo';

alter table public.portfolio_fornecedores
  drop constraint if exists portfolio_enquadramento_valido;

alter table public.portfolio_fornecedores
  add constraint portfolio_enquadramento_valido
  check (enquadramento in ('topo', 'centro', 'base'));

comment on column public.portfolio_fornecedores.path_upload is
  'Foto crua enviada pelo fornecedor; base de todo reenquadramento.';
comment on column public.portfolio_fornecedores.enquadramento is
  'Origem do corte 4:5: topo | centro | base.';
