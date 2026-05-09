-- ============================================================================
-- MIGRAÇÃO: Integração com Asaas (CPF/CNPJ + customer + pagamentos)
-- Data: 2026-05-08
-- ============================================================================
--
-- Adiciona infraestrutura para:
-- 1. Coluna cpf_cnpj em leads_fornecedores (obrigatório a partir de hoje pra
--    novos cadastros; existentes ficam NULL e completam ao tentar pagar)
-- 2. Coluna asaas_customer_id em leads_fornecedores (1:1 com customer no Asaas)
-- 3. Tabela pagamentos_asaas (histórico de cobranças e assinaturas)
-- ============================================================================

-- ============================================================================
-- PARTE 1 — Colunas em leads_fornecedores
-- ============================================================================

ALTER TABLE leads_fornecedores
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- COMENTÁRIOS:
-- cpf_cnpj: armazena APENAS números (sem máscara). 11 dígitos = CPF, 14 = CNPJ.
--   Pode ser NULL para fornecedores existentes pré-migração; obrigatório pra
--   novos cadastros (validação no app).
-- asaas_customer_id: ID do customer correspondente no Asaas (formato cus_xxx).
--   NULL até o primeiro pagamento. Criado lazy (só quando vai pagar).

-- Índice para deduplicação rápida por documento
CREATE INDEX IF NOT EXISTS idx_leads_fornecedores_cpf_cnpj
  ON leads_fornecedores(cpf_cnpj)
  WHERE cpf_cnpj IS NOT NULL;

-- ============================================================================
-- PARTE 2 — Tabela de histórico de pagamentos
-- ============================================================================
-- Armazena tanto cobranças avulsas (pacotes de leads) quanto faturas de
-- assinatura recorrente. Asaas é a fonte de verdade; aqui guardamos o
-- suficiente para queries cruzadas e UI.

CREATE TABLE IF NOT EXISTS pagamentos_asaas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,

  -- Referências Asaas
  asaas_payment_id TEXT UNIQUE NOT NULL,    -- pay_xxxxxxxxxxxx
  asaas_subscription_id TEXT,               -- sub_xxxxxxxxxxxx (NULL se cobrança avulsa)

  -- Tipo da cobrança
  tipo TEXT NOT NULL CHECK (tipo IN (
    'pacote_leads_5',
    'pacote_leads_10',
    'pacote_leads_25',
    'assinatura_starter',
    'assinatura_pro',
    'assinatura_enterprise'
  )),

  -- Valor (em centavos para evitar problemas de float)
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),

  -- Método de pagamento
  metodo TEXT NOT NULL CHECK (metodo IN ('pix', 'boleto', 'cartao')),

  -- Status (espelha eventos do Asaas)
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN (
    'pendente',     -- cobrança criada, aguardando pagamento
    'pago',         -- pagamento confirmado/recebido
    'vencido',      -- passou da data sem pagar
    'estornado',    -- foi estornado depois de pago
    'cancelado'     -- cobrança cancelada antes do pagamento
  )),

  -- URLs e dados pra exibir pro fornecedor
  link_pagamento TEXT,                      -- URL do checkout Asaas
  qr_code_pix TEXT,                         -- payload Pix (só se metodo='pix')

  -- Datas
  vencimento DATE,
  pago_em TIMESTAMPTZ,                      -- só preenche quando status='pago'
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries comuns
CREATE INDEX IF NOT EXISTS idx_pagamentos_asaas_fornecedor
  ON pagamentos_asaas(fornecedor_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_pagamentos_asaas_subscription
  ON pagamentos_asaas(asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pagamentos_asaas_status
  ON pagamentos_asaas(status)
  WHERE status IN ('pendente', 'vencido');

-- Trigger pra atualizar atualizado_em automaticamente
CREATE OR REPLACE FUNCTION trigger_set_atualizado_em_pagamentos()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_atualizado_em_pagamentos ON pagamentos_asaas;
CREATE TRIGGER set_atualizado_em_pagamentos
  BEFORE UPDATE ON pagamentos_asaas
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_atualizado_em_pagamentos();

-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
