-- ============================================================================
-- MIGRAÇÃO: Sistema de autenticação (OTP + sessões)
-- Data: 2026-05-08
-- ============================================================================
--
-- Adiciona infraestrutura para:
-- 1. Tabela otps_fornecedores (códigos de 6 dígitos, validade 10min, máx 5 tentativas)
-- 2. Tabela sessoes_fornecedores (sessão ativa, 30 dias, cookie httpOnly)
-- 3. Tabela bloqueios_login (anti-bruteforce: bloqueio de 30min após 5 erros)
-- ============================================================================

-- ============================================================================
-- PARTE 1 — Tabela de OTPs (códigos temporários)
-- ============================================================================
-- Um OTP é um código de 6 dígitos enviado por email + WhatsApp.
-- Armazenamos o HASH (SHA-256) do código, nunca o código em claro.
-- Após 10 minutos, o OTP expira. Após 5 tentativas erradas, fica bloqueado.

CREATE TABLE IF NOT EXISTS otps_fornecedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,

  codigo_hash TEXT NOT NULL,                   -- SHA-256 do código de 6 dígitos
  identificador TEXT NOT NULL,                 -- email ou whatsapp usado pra solicitar
  tipo_identificador TEXT NOT NULL CHECK (tipo_identificador IN ('email', 'whatsapp')),

  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,                        -- preenche quando OTP é validado com sucesso

  tentativas INT NOT NULL DEFAULT 0,           -- conta tentativas erradas
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para queries comuns
CREATE INDEX IF NOT EXISTS idx_otps_fornecedor_validos
  ON otps_fornecedores(fornecedor_id, expira_em DESC)
  WHERE usado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_otps_expira_em
  ON otps_fornecedores(expira_em);

-- ============================================================================
-- PARTE 2 — Tabela de sessões ativas
-- ============================================================================
-- Cada login bem-sucedido cria uma sessão. Token armazenado em cookie httpOnly.
-- Sessão dura 30 dias por default.

CREATE TABLE IF NOT EXISTS sessoes_fornecedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,

  token_hash TEXT UNIQUE NOT NULL,             -- SHA-256 do token (cookie value)
  expira_em TIMESTAMPTZ NOT NULL,

  -- Dados de auditoria (opcional, útil pra debugar)
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessoes_fornecedor
  ON sessoes_fornecedores(fornecedor_id, expira_em DESC);

CREATE INDEX IF NOT EXISTS idx_sessoes_expira_em
  ON sessoes_fornecedores(expira_em);

-- ============================================================================
-- PARTE 3 — Tabela de bloqueios anti-bruteforce
-- ============================================================================
-- Quando um fornecedor erra OTP 5 vezes seguidas, fica bloqueado por 30 min.
-- O bloqueio é por fornecedor, não por IP (mais simples e suficiente pro caso).

CREATE TABLE IF NOT EXISTS bloqueios_login (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,

  bloqueado_ate TIMESTAMPTZ NOT NULL,
  motivo TEXT NOT NULL DEFAULT 'tentativas_excedidas',

  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bloqueios_fornecedor_ativo
  ON bloqueios_login(fornecedor_id, bloqueado_ate DESC);

-- ============================================================================
-- FIM DA MIGRAÇÃO
-- ============================================================================
