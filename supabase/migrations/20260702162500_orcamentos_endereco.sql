-- ============================================================================
-- Email e endereço de entrega do cliente no orçamento avulso.
-- CEP resolve logradouro/bairro/cidade/UF via ViaCEP/BrasilAPI na rota
-- (app/lib/cep.ts); admin pode editar manualmente quando o CEP não resolve.
-- Email também vai pro customer do Asaas quando a cobrança é gerada.
-- ============================================================================

alter table orcamentos
  add column cliente_email text,
  add column cep text,
  add column logradouro text,
  add column endereco_numero text,
  add column endereco_complemento text,
  add column bairro text,
  add column cidade text,
  add column uf text;
