-- Remove enterprise dos check constraints de plano e tipo de pagamento.
--
-- Contexto: simplificação pra 3 tiers (free/starter/pro). Enterprise
-- eliminado como produto. Operação segura porque:
--   - 0 fornecedores em plano='enterprise' (confirmado via MCP)
--   - 0 registros em pagamentos_asaas (confirmado via MCP)
--
-- Constraints novas são subconjuntos das antigas — quem está em
-- plano='free'/'starter'/'pro' continua válido.

ALTER TABLE leads_fornecedores
  DROP CONSTRAINT IF EXISTS leads_fornecedores_plano_check;

ALTER TABLE leads_fornecedores
  ADD CONSTRAINT leads_fornecedores_plano_check
  CHECK (plano = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text]));

ALTER TABLE pagamentos_asaas
  DROP CONSTRAINT IF EXISTS pagamentos_asaas_tipo_check;

ALTER TABLE pagamentos_asaas
  ADD CONSTRAINT pagamentos_asaas_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'pacote_leads_5'::text,
    'pacote_leads_10'::text,
    'pacote_leads_25'::text,
    'assinatura_starter'::text,
    'assinatura_pro'::text
  ]));
