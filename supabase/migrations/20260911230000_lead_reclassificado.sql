-- ============================================================================
-- RECLASSIFICAÇÃO DE CONTATO — 11/09/2026.
--
-- Quem cadastrou como confecção e na verdade é cliente ficava preso: a única
-- definição de "é fornecedor" era ter `fornecedor_id`, e não havia caminho de
-- volta. O caso que abriu isto chamou `chamar_humano` SETE vezes num dia
-- dizendo "é cliente, não confecção" — sete diagnósticos certos, nenhum com
-- uma ferramenta capaz de agir.
--
-- POR QUE COLUNA NOVA E NÃO `aprovacao_status = 'reclassificado'`
-- Sobrescrever `aprovacao_status` apagaria o que a triagem já tinha decidido —
-- e no caso da Nany foi justamente o `reprovado` de lá que permitiu consertar o
-- prompt dela antes desta ferramenta existir. Os dois fatos são independentes
-- ("a triagem reprovou" e "alguém reclassificou como cliente") e cada um tem
-- que continuar legível depois do outro.
--
-- NÃO DELETA O LEAD. Se a pessoa um dia produzir de verdade, o histórico dela
-- (portfólio, perfil de produção, conversas) importa. Reclassificar é tirar do
-- fluxo de fornecedor, não apagar que ela passou por ele.
--
-- NOTA: `leads_fornecedores` é uma das 24 tabelas sem CREATE no repo. Este
-- arquivo é só o ALTER; o CREATE reconstruído fica pra quando a gente varrer
-- as 24 — misturar as duas coisas agora atrasaria um conserto que está com
-- cliente esperando do outro lado.
-- ============================================================================

alter table public.leads_fornecedores
  add column if not exists reclassificado_em     timestamptz,
  add column if not exists reclassificado_motivo text,
  add column if not exists reclassificado_por    text;

comment on column public.leads_fornecedores.reclassificado_em is
  'Quando este cadastro deixou de valer como fornecedor (a pessoa é cliente). Não apaga o lead: tira do fluxo.';
comment on column public.leads_fornecedores.reclassificado_motivo is
  'A evidência, nas palavras de quem reclassificou — o que a pessoa disse que mostrou que não é confecção.';
comment on column public.leads_fornecedores.reclassificado_por is
  'luigi | admin — quem fez a correção.';

create index if not exists leads_fornecedores_reclassificado_idx
  on public.leads_fornecedores (reclassificado_em)
  where reclassificado_em is not null;
