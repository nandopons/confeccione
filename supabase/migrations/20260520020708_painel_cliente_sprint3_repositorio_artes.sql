-- ============================================================================
-- Painel do Cliente — Sprint 3: Repositório de arquivos + Compartilhar artes
-- Data: 2026-05-20
-- ============================================================================
--
-- 1. Tabela arquivos_cliente — repositório de arquivos do cliente (quota 50MB).
--    mime_type é NULLABLE: alguns tipos exóticos o SDK não detecta MIME.
-- 2. Tabela compartilhamentos_artes — link público temporário (7d) que expõe
--    os arquivos da conta pro fornecedor aceito de um pedido.
-- 3. Bucket privado 'artes-clientes' (sem limite por arquivo, sem whitelist de
--    MIME). Único limite é a quota total de 50MB/conta, validada na aplicação.
--
-- Acesso a ambas as tabelas e ao bucket é EXCLUSIVO via service_role:
-- RLS ligado + REVOKE em anon/authenticated (defesa em profundidade).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. arquivos_cliente
-- ----------------------------------------------------------------------------
CREATE TABLE public.arquivos_cliente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id      UUID NOT NULL REFERENCES public.contas_clientes(id) ON DELETE CASCADE,
  -- storage_path determinístico: {conta_id}/{uuid}_{filename_sanitizado}
  storage_path  TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,                      -- trim + max 200 chars (validado na app)
  mime_type     TEXT,                               -- NULLABLE: SDK pode não detectar
  tamanho_bytes BIGINT NOT NULL CHECK (tamanho_bytes >= 0),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_arquivos_cliente_conta
  ON public.arquivos_cliente (conta_id, criado_em DESC);

ALTER TABLE public.arquivos_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arquivos_cliente FROM anon, authenticated;

COMMENT ON TABLE public.arquivos_cliente IS
  'Repositório de arquivos do cliente (quota 50MB/conta). Acesso apenas via service_role.';

-- ----------------------------------------------------------------------------
-- 2. compartilhamentos_artes
-- ----------------------------------------------------------------------------
CREATE TABLE public.compartilhamentos_artes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id        UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  conta_id         UUID NOT NULL REFERENCES public.contas_clientes(id) ON DELETE CASCADE,
  -- fornecedor pra quem o link foi enviado. SET NULL se o lead for removido.
  fornecedor_id    UUID REFERENCES public.leads_fornecedores(id) ON DELETE SET NULL,
  link_token       TEXT NOT NULL UNIQUE,            -- 24 bytes base64url
  arquivos_count   INT NOT NULL DEFAULT 0,          -- snapshot na criação
  bytes_total      BIGINT NOT NULL DEFAULT 0,       -- snapshot na criação
  expira_em        TIMESTAMPTZ NOT NULL,            -- now() + 7 dias
  acessos_count    INT NOT NULL DEFAULT 0,
  ultimo_acesso_em TIMESTAMPTZ,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compartilhamentos_artes_pedido
  ON public.compartilhamentos_artes (pedido_id, criado_em DESC);

CREATE INDEX idx_compartilhamentos_artes_expira
  ON public.compartilhamentos_artes (expira_em);

ALTER TABLE public.compartilhamentos_artes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compartilhamentos_artes FROM anon, authenticated;

COMMENT ON TABLE public.compartilhamentos_artes IS
  'Link público temporário (7d) que expõe arquivos da conta pro fornecedor de um pedido. Acesso apenas via service_role.';

-- ----------------------------------------------------------------------------
-- 3. Bucket privado artes-clientes
--    public=false, sem limite por arquivo, sem whitelist de MIME.
--    Idempotente via ON CONFLICT.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('artes-clientes', 'artes-clientes', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
