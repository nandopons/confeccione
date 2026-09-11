-- ============================================================================
-- 'sugerido' ENTRA NO VOCABULÁRIO DE STATUS — 11/09/2026.
--
-- O BUG
-- O banco de reserva da captação (captacao-pedido.ts) grava candidato achado
-- na busca mas ainda não abordado com `status = 'sugerido'`: é a confecção que
-- a onda não coube, guardada pra próxima onda usar sem pagar busca nova. O
-- check constraint da tabela nunca aceitou esse valor — ele permitia ativo,
-- convertido, pausado, esgotado e erro. Toda escrita de reserva era um 23514.
--
-- Descoberto quando um backfill tentou mover cinco candidatos de 'erro' pra
-- 'sugerido' e levou o 23514 na cara. O código dizia uma coisa, a tabela outra,
-- e as duas versões moravam em lugares diferentes — a tabela sequer tinha
-- CREATE no repo (ver 20260521000000_captacao_fornecedores.sql).
--
-- POR QUE CRESCER O VOCABULÁRIO E NÃO COLAPSAR EM 'ativo'
-- Decisão do Fernando, e é a certa: colapsar destruiria justamente a distinção
-- de que o banco de reserva depende — "achada, nunca contatada, esperando
-- vaga" não é "em conversa". Sem ela, `bancoDeReserva()` não tem como
-- distinguir quem ainda não recebeu mensagem de quem já está sendo trabalhado,
-- e a captação passaria a reabordar gente que já está em conversa.
-- ============================================================================

alter table public.captacao_fornecedores drop constraint if exists captacao_fornecedores_status_check;
alter table public.captacao_fornecedores
  add constraint captacao_fornecedores_status_check
  check (status in ('ativo', 'sugerido', 'convertido', 'pausado', 'esgotado', 'erro'));

comment on column public.captacao_fornecedores.status is
  'ativo (em cadência/conversa) | sugerido (achada pela busca, ainda não abordada — banco de reserva) | convertido | pausado | esgotado (cadência terminou) | erro (abordagem falhou)';

-- O banco de reserva de hoje: cinco confecções que a busca achou, gravou com
-- telefone, e que nunca foram abordadas porque `canal_whatsapp` ficou false
-- (corrigido em 87f44ce). Elas estão em 'erro' com `ultimo_erro` vazio; aqui
-- viram reserva de verdade e a próxima onda do pedido delas as consome.
update public.captacao_fornecedores
   set canal_whatsapp = true,
       status = 'sugerido'
 where origem = 'pedido'
   and status = 'erro'
   and whatsapp is not null
   and ultimo_contato_em is null
   and resposta is null;
