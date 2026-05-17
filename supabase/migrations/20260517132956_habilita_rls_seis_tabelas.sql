-- ============================================================
-- Habilita RLS nas 6 tabelas que estavam expostas
-- Data: 2026-05-17
-- ============================================================
--
-- Defense-in-depth: todo acesso ao Supabase neste app passa por
-- service_role (server-side) — RLS é bypassado por design.
-- Esta migration garante que qualquer regressão futura (alguém
-- criar cliente com anon key, view sem security_invoker, etc)
-- bata em "default deny" em vez de vazar dados.
--
-- Sem policies criadas: RLS ligado SEM policies = default deny.
-- Mais limpo que policy USING(false) explícita.
--
-- REVOKE explícito pros roles públicos como reforço.
-- ============================================================

ALTER TABLE public.ofertas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gatilhos_upgrade     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamentos_asaas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otps_fornecedores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloqueios_login      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ofertas              FROM anon, authenticated;
REVOKE ALL ON public.gatilhos_upgrade     FROM anon, authenticated;
REVOKE ALL ON public.pagamentos_asaas     FROM anon, authenticated;
REVOKE ALL ON public.otps_fornecedores    FROM anon, authenticated;
REVOKE ALL ON public.sessoes_fornecedores FROM anon, authenticated;
REVOKE ALL ON public.bloqueios_login      FROM anon, authenticated;

COMMENT ON TABLE public.ofertas IS
  'Acesso apenas via service_role. RLS habilitado como defense-in-depth (default deny + REVOKE explícito).';
COMMENT ON TABLE public.gatilhos_upgrade IS
  'Acesso apenas via service_role. RLS defense-in-depth.';
COMMENT ON TABLE public.pagamentos_asaas IS
  'Acesso apenas via service_role. RLS defense-in-depth. Tabela financeira — não relaxar sem auditoria.';
COMMENT ON TABLE public.otps_fornecedores IS
  'Acesso apenas via service_role. RLS defense-in-depth. Códigos OTP — não relaxar.';
COMMENT ON TABLE public.sessoes_fornecedores IS
  'Acesso apenas via service_role. RLS defense-in-depth. Token hashes — não relaxar.';
COMMENT ON TABLE public.bloqueios_login IS
  'Acesso apenas via service_role. RLS defense-in-depth.';
