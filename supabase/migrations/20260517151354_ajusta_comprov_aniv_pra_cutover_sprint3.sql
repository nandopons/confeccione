-- ============================================================
-- Customização do plano_ativado_em do Comprov Confecção
-- Sprint 3 — Renovação por aniversário do plano
-- Data: 2026-05-17
-- ============================================================
--
-- Contexto: Sprint 3 muda o modelo de contagem de cota de
-- "mês calendário" pra "aniversário do plano_ativado_em".
--
-- Validação via MCP antes do deploy mostrou que 12 dos 13
-- fornecedores tinham count_antigo == count_novo. Comprov
-- Confecção era a única exceção:
--   - count_antigo (mês calendário) = 13 ofertas aceitas
--   - count_novo (janela aniversário, dia 8) = 7 ofertas aceitas
--   - Diff: 6 ofertas aceitas entre 01/05 e 08/05 estariam
--     "perdidas"
--
-- Solução: ajustar plano_ativado_em do Comprov pra dia 1 do
-- mesmo mês, preservando o ano/mês/timezone. Janela aniversário
-- vira idêntica à janela calendário antiga; count_antigo =
-- count_novo. Histórico de aceites preservado.
--
-- plano_expira_em fica intocado (trial é janela separada — não
-- depende de plano_ativado_em pra cálculo).
--
-- ESTA MIGRATION JÁ FOI APLICADA EM PROD VIA MCP. Este arquivo
-- serve como documentação versionada + idempotência (filtros
-- WHERE garantem que reaplicar é no-op).
-- ============================================================

UPDATE leads_fornecedores
SET plano_ativado_em = date_trunc('month', plano_ativado_em)
WHERE id = '22420707-d954-4f58-9d88-3e2bd8640012'
  AND nome ILIKE 'Comprov%'  -- defesa contra ID errado
  AND EXTRACT(DAY FROM plano_ativado_em) = 8;  -- defesa contra reaplicação

COMMENT ON COLUMN leads_fornecedores.plano_ativado_em IS
  'Data de ativação do plano. Define o aniversário usado pra renovar a cota mensal (Sprint 3, PR #10). Hard cutover em 2026-05-17 ajustou Comprov Confecção pra dia 1 do mês a fim de preservar histórico de ofertas aceitas entre 01/05 e 08/05.';
