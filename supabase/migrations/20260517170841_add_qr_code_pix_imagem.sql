-- Sprint 4 patch: separa payload (copia-cola) de imagem (PNG base64)
-- do QR Code Pix. Bug: qr_code_pix guardava só o payload, Modal
-- esperava renderizar como imagem.

ALTER TABLE pagamentos_asaas
  ADD COLUMN qr_code_pix_imagem TEXT;

COMMENT ON COLUMN pagamentos_asaas.qr_code_pix IS
  'Payload BRCode pra Pix copia-e-cola (começa com 00020101...). Texto, não imagem.';

COMMENT ON COLUMN pagamentos_asaas.qr_code_pix_imagem IS
  'PNG base64 do QR Code Pix pra renderizar como <img>. Sem prefixo data:image/png;base64, — frontend adiciona.';
