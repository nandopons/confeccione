-- 26/08/2026 — encerra o trial Pro que ainda estava agendado no banco.
--
-- O plano Pro foi descontinuado em 25/08 (a monetização virou % no orçamento)
-- e a mensagem de aprovação parou de prometê-lo. Mas o cadastro continuava
-- gravando `plano_expira_em = hoje + 90 dias`, e havia 20 fornecedores com
-- trial ativo — o primeiro vencendo em 29/08/2026.
--
-- Duas coisas aconteceriam nessa data, e a segunda é a pior:
--
--   1. o cron mandaria no WhatsApp "Seu trial de 90 dias do plano *Pro*
--      terminou... quer continuar recebendo mais pedidos?" — primeira
--      cobrança que a base veria, por um produto que não existe;
--   2. `planoEfetivo()` (app/lib/planos.ts) devolve 'free' assim que a data
--      passa, INDEPENDENTE do cron. O fornecedor cairia de 30 para 3 pedidos
--      por mês, em silêncio.
--
-- Limpar a data resolve as duas: sem prazo, `planoEfetivo` devolve o plano
-- gravado ('pro'), e a tarefa do cron (já desligada) não teria o que buscar.
--
-- Reversível: a data original era `criado_em + 90 dias`.
-- Não mexe em `plano`, `plano_ativado_em` (âncora da janela de cota) nem em
-- créditos avulsos.

update public.leads_fornecedores
set plano_expira_em = null
where plano_expira_em is not null;

-- O DEFAULT da coluna já é NULL; o do `plano` já é 'pro'. Nada a alterar no
-- schema — o que gravava a data era o código do cadastro, corrigido junto.
