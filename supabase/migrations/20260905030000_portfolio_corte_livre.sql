-- Enquadramento livre da foto da vitrine (05/09/2026).
--
-- Antes o corte 4:5 tinha três posições fixas (topo/centro/base). Resolve o
-- caso "cortou a cabeça", mas não resolve peça fora do eixo, foto tirada de
-- lado, ou peça pequena no meio de um quadro grande — e não havia zoom.
--
-- Agora a janela de corte é livre: foco_x/foco_y dizem ONDE ela fica (0..100,
-- 50 = centro) e zoom diz QUANTO ela aperta. `enquadramento` continua como
-- estava, pra fotos antigas: topo → foco_y 0, centro → 50, base → 100.

alter table public.portfolio_fornecedores
  add column if not exists foco_x smallint not null default 50,
  add column if not exists foco_y smallint not null default 0,
  add column if not exists zoom numeric(4,2) not null default 1;

-- Traz as fotos existentes pro modelo novo, preservando o corte que elas já
-- têm: quem estava em 'centro' não pode pular pro topo num deploy.
update public.portfolio_fornecedores
   set foco_y = case enquadramento
                  when 'centro' then 50
                  when 'base' then 100
                  else 0
                end
 where enquadramento is not null;

comment on column public.portfolio_fornecedores.foco_x is
  'Posição horizontal da janela de corte, 0..100 (50 = centro).';
comment on column public.portfolio_fornecedores.foco_y is
  'Posição vertical da janela de corte, 0..100 (0 = topo).';
comment on column public.portfolio_fornecedores.zoom is
  'Aproximação da janela de corte. 1 = corte 4:5 máximo que cabe na foto.';
