-- 29/09/2026 — OBSERVAÇÕES DA CONFECÇÃO NO ORÇAMENTO (Fernando: "vale a pena um
-- campo de observações pro fornecedor escrever e ir junto do orçamento").
-- Texto livre que a confecção escreve na tela de orçamento e o cliente lê no
-- e-mail, no WhatsApp e no visualizador, junto do valor. Versionado com o
-- orçamento (orcamento_versoes) porque preço e observação mudam juntos.
alter table public.pedidos_assistente add column if not exists orcamento_observacoes text;
alter table public.orcamento_versoes add column if not exists observacoes text;
