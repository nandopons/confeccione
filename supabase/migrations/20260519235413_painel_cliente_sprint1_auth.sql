-- ============================================================================
-- Painel do Cliente — Sprint 1: Auth + Acompanhar Pedidos
-- Data: 2026-05-19
-- ============================================================================
--
-- Cria 4 tabelas novas (espelham otps_fornecedores / sessoes_fornecedores /
-- bloqueios_login do padrão maduro do projeto) + 1 coluna em pedidos pra
-- vincular pedido ao cliente final.
--
-- Backfill é lazy: no primeiro login bem-sucedido, pedidos com email igual
-- são vinculados via UPDATE em batch.
--
-- Todas as tabelas com RLS + REVOKE explícito (defense-in-depth padrão).
-- ============================================================================

-- ============================================================================
-- contas_clientes — uma conta por email único
-- ============================================================================
CREATE TABLE public.contas_clientes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  nome            TEXT,
  whatsapp        TEXT,
  plano           TEXT NOT NULL DEFAULT 'free',
  plano_ativado_em TIMESTAMPTZ DEFAULT NOW(),
  plano_expira_em  TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_login_em TIMESTAMPTZ,
  CONSTRAINT contas_clientes_plano_check CHECK (plano IN ('free','pro'))
);
CREATE INDEX idx_contas_clientes_email ON public.contas_clientes (LOWER(email));

ALTER TABLE public.contas_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contas_clientes FROM anon, authenticated;
COMMENT ON TABLE public.contas_clientes IS
  'Conta do cliente final no painel /cliente/*. Acesso apenas via service_role.';

-- ============================================================================
-- otps_clientes — códigos OTP de login do cliente
-- Hash-only (SHA-256). Validade 10min. Bloqueio após 5 tentativas erradas.
-- ============================================================================
CREATE TABLE public.otps_clientes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id            UUID NOT NULL REFERENCES public.contas_clientes(id) ON DELETE CASCADE,
  codigo_hash         TEXT NOT NULL,
  identificador       TEXT NOT NULL,
  tipo_identificador  TEXT NOT NULL,
  expira_em           TIMESTAMPTZ NOT NULL,
  usado_em            TIMESTAMPTZ,
  tentativas          INT NOT NULL DEFAULT 0,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT otps_clientes_tipo_check
    CHECK (tipo_identificador IN ('email','whatsapp'))
);
CREATE INDEX idx_otps_clientes_conta ON public.otps_clientes (conta_id, criado_em DESC);
CREATE INDEX idx_otps_clientes_expira ON public.otps_clientes (expira_em);

ALTER TABLE public.otps_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otps_clientes FROM anon, authenticated;
COMMENT ON TABLE public.otps_clientes IS
  'Códigos OTP. Acesso apenas via service_role. Códigos hasheados — não relaxar.';

-- ============================================================================
-- sessoes_clientes — token de sessão (hash-only)
-- ============================================================================
CREATE TABLE public.sessoes_clientes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id          UUID NOT NULL REFERENCES public.contas_clientes(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  expira_em         TIMESTAMPTZ NOT NULL,
  user_agent        TEXT,
  ip                TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessoes_clientes_conta ON public.sessoes_clientes (conta_id);
CREATE INDEX idx_sessoes_clientes_expira ON public.sessoes_clientes (expira_em);

ALTER TABLE public.sessoes_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sessoes_clientes FROM anon, authenticated;
COMMENT ON TABLE public.sessoes_clientes IS
  'Token hashes. Acesso apenas via service_role. Não relaxar.';

-- ============================================================================
-- bloqueios_login_cliente — anti-brute-force
-- ============================================================================
CREATE TABLE public.bloqueios_login_cliente (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id        UUID NOT NULL REFERENCES public.contas_clientes(id) ON DELETE CASCADE,
  bloqueado_ate   TIMESTAMPTZ NOT NULL,
  motivo          TEXT NOT NULL DEFAULT 'tentativas_excedidas',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bloqueios_cliente_conta
  ON public.bloqueios_login_cliente (conta_id, bloqueado_ate DESC);

ALTER TABLE public.bloqueios_login_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bloqueios_login_cliente FROM anon, authenticated;
COMMENT ON TABLE public.bloqueios_login_cliente IS
  'Acesso apenas via service_role.';

-- ============================================================================
-- pedidos.conta_id — vínculo lazy com cliente
-- Nullable: pedidos pré-existentes não têm conta; backfill lazy no primeiro
-- login do cliente vincula todos os pedidos do email dele.
-- ON DELETE SET NULL: deletar conta não apaga histórico de pedidos.
-- ============================================================================
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS conta_id UUID
    REFERENCES public.contas_clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_conta ON public.pedidos (conta_id);
