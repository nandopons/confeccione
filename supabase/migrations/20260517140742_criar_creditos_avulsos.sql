-- ============================================================
-- Tabela creditos_avulsos — lotes de pedidos avulsos comprados
-- pelo fornecedor com validade de 3 meses.
-- Data: 2026-05-17
-- ============================================================
--
-- Substitui a coluna leads_fornecedores.creditos_extras (int
-- simples). Mantém aquela coluna por enquanto como deprecated
-- — drop após 2-3 sprints estáveis (TODO futuro).
--
-- Validação: zero rows com creditos_extras > 0 hoje, então
-- nenhuma migração de dados necessária.
--
-- Bug latente que esta sprint corrige: consumirCreditoExtra
-- (em planos.ts) era dead code — ninguém chamava — então hoje
-- créditos comprados nunca seriam decrementados ao serem usados.
-- A function consumir_credito_avulso abaixo + plugagem no aceite
-- (em app/api/fornecedor/ofertas/[id]/aceitar/route.ts) fecha o
-- ciclo.
-- ============================================================

CREATE TABLE public.creditos_avulsos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id         UUID NOT NULL REFERENCES leads_fornecedores(id) ON DELETE CASCADE,
  quantidade_inicial    INT NOT NULL CHECK (quantidade_inicial > 0),
  quantidade_disponivel INT NOT NULL CHECK (quantidade_disponivel >= 0),
  pagamento_id          UUID REFERENCES pagamentos_asaas(id) ON DELETE SET NULL,
  tipo_origem           TEXT NOT NULL DEFAULT 'compra_avulsa',
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em             TIMESTAMPTZ NOT NULL,
  esgotado_em           TIMESTAMPTZ,
  expirado_em           TIMESTAMPTZ,
  CHECK (quantidade_disponivel <= quantidade_inicial)
);

-- Índice quente: lotes ativos do fornecedor X, ordenados FIFO.
-- Cobre temCreditoDisponivel + listarLotesAtivos + consumir_credito_avulso.
CREATE INDEX idx_creditos_avulsos_fornecedor_ativo
  ON creditos_avulsos(fornecedor_id, criado_em ASC)
  WHERE quantidade_disponivel > 0
    AND esgotado_em IS NULL
    AND expirado_em IS NULL;

-- Índice pro cron de expiração — varre por expira_em entre lotes ainda ativos.
CREATE INDEX idx_creditos_avulsos_expira_em
  ON creditos_avulsos(expira_em)
  WHERE expirado_em IS NULL
    AND quantidade_disponivel > 0;

ALTER TABLE creditos_avulsos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON creditos_avulsos FROM anon, authenticated;

COMMENT ON TABLE creditos_avulsos IS
  'Lotes de pedidos avulsos comprados pelo fornecedor. Validade 3 meses desde criado_em. FIFO no consumo. Acesso apenas via service_role. RLS defense-in-depth.';

-- ============================================================
-- Function consumir_credito_avulso — decremento atômico FIFO
-- ============================================================
--
-- Trava (FOR UPDATE) o lote ativo mais antigo do fornecedor,
-- decrementa quantidade_disponivel em 1 e marca esgotado_em
-- se virou zero. Atômico no nível da row.
--
-- Necessário porque o SDK do Supabase JS não expõe BEGIN/
-- COMMIT/FOR UPDATE explícitos com semântica de transação
-- garantida. Função SQL resolve.
--
-- Retorna 1 row {lote_id, novo_disponivel} em caso de sucesso,
-- ou 0 rows se não há lote ativo (caller decide).
-- ============================================================

CREATE OR REPLACE FUNCTION consumir_credito_avulso(p_fornecedor_id UUID)
RETURNS TABLE(lote_id UUID, novo_disponivel INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lote_id UUID;
  v_novo INT;
BEGIN
  SELECT id INTO v_lote_id
  FROM creditos_avulsos
  WHERE fornecedor_id = p_fornecedor_id
    AND quantidade_disponivel > 0
    AND expira_em > NOW()
    AND esgotado_em IS NULL
    AND expirado_em IS NULL
  ORDER BY criado_em ASC
  LIMIT 1
  FOR UPDATE;

  IF v_lote_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE creditos_avulsos
  SET quantidade_disponivel = quantidade_disponivel - 1,
      esgotado_em = CASE
        WHEN quantidade_disponivel - 1 = 0 THEN NOW()
        ELSE NULL
      END
  WHERE id = v_lote_id
  RETURNING quantidade_disponivel INTO v_novo;

  RETURN QUERY SELECT v_lote_id, v_novo;
END;
$$;

REVOKE EXECUTE ON FUNCTION consumir_credito_avulso(UUID) FROM anon, authenticated;

COMMENT ON FUNCTION consumir_credito_avulso(UUID) IS
  'Consome 1 crédito do lote ativo mais antigo (FIFO) do fornecedor. Atômico via FOR UPDATE. Retorna {lote_id, novo_disponivel} ou 0 rows se não há lote ativo. Chamado pelo handler de aceite quando cota mensal estourou.';
