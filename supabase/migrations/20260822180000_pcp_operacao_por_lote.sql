-- PCP — operação por lote, com rendimento (22/08/2026)
--
-- O PROBLEMA QUE O FERNANDO LEVANTOU
-- "Cortar viés leva uns 30 minutos, mas rende umas 50 peças. Como não
-- contabilizar 30 minutos por peça?"
--
-- POR QUE NÃO A MÉDIA FRACIONADA (1800 ÷ 50 = 36 s/peça)
-- A média acerta o total só quando o lote é exatamente 50. Fora disso mente
-- nas duas direções:
--   lote de 10  → média cobra 6 min, mas você gasta os 30 do mesmo jeito
--                 (a mesa é montada uma vez, não um quinto de vez)
--   lote de 120 → média cobra 72 min; a realidade são 3 cortes = 90 min
-- E, pior que o total errado, ela apaga o DEGRAU. Gargalo é ocupação numa
-- janela de tempo: 30 minutos contínuos travando a máquina é um fato de
-- planejamento que 36 segundos diluídos por peça escondem.
--
-- O MODELO
--   tipo = 'por_peca'  → tempo × quantidade                    (o normal)
--   tipo = 'por_lote'  → tempo × teto(quantidade ÷ rende_pecas)
--   tipo = 'por_lote' com rende_pecas NULL → tempo uma vez, qualquer tamanho
--     (montar enfesto, regular máquina — não escala com a quantidade)
--
-- APLICADA em produção em 22/08/2026 via MCP.

alter table public.pcp_operacoes
  add column if not exists tipo text not null default 'por_peca'
    check (tipo in ('por_peca', 'por_lote')),
  add column if not exists rende_pecas integer
    check (rende_pecas is null or rende_pecas > 0);

-- Rendimento sem lote não quer dizer nada — e deixar passar criaria linhas que
-- parecem configuradas e são ignoradas pelo cálculo.
alter table public.pcp_operacoes
  drop constraint if exists pcp_operacoes_rende_so_no_lote;
alter table public.pcp_operacoes
  add constraint pcp_operacoes_rende_so_no_lote
    check (tipo = 'por_lote' or rende_pecas is null);

comment on column public.pcp_operacoes.tipo is
  'por_peca = tempo vale para cada peça; por_lote = o tempo cobre um lote inteiro (corte de viés, enfesto).';
comment on column public.pcp_operacoes.rende_pecas is
  'Só no por_lote: quantas peças aquele tempo rende. Null = uma vez por lote, independente do tamanho.';
