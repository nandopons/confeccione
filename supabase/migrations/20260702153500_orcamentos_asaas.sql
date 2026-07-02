-- ============================================================================
-- Cobrança Asaas do orçamento avulso (/admin/orcamentos).
-- Colunas preenchidas quando o admin marca "gerar cobrança" ao criar o
-- orçamento: cobrança UNDEFINED (PIX ou cartão) com desconto 3% até o
-- vencimento; QR PIX (payload + PNG base64) vai embutido no PDF.
-- ============================================================================

alter table orcamentos
  add column asaas_customer_id text,
  add column asaas_payment_id text,
  add column asaas_invoice_url text,
  add column pix_copia_cola text,
  add column pix_qr_imagem text,
  add column cobranca_vencimento date;

comment on column orcamentos.pix_qr_imagem is
  'QR code PIX em PNG base64 (sem prefixo data:), retornado pelo Asaas em /payments/{id}/pixQrCode.';
