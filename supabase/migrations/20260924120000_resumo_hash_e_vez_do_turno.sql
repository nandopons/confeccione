-- Miguel, 20260900317, 20/09/2026 01:32: três resumos idênticos em quatro minutos.
-- Duas causas, duas colunas (ver app/lib/pedido-fechamento.ts e app/lib/luigi.ts, 24/09/2026).

-- 1) "O pedido mudou desde o último resumo?" passa a ser decidido pelo CONTEÚDO
--    que vai no PDF (assinatura sha256 dos campos que o montam), não por
--    atualizado_em — que sobe com re-anexo de foto e retoque de descrição.
alter table public.pedidos_assistente add column if not exists resumo_enviado_hash text;
comment on column public.pedidos_assistente.resumo_enviado_hash is 'sha256 dos campos que montam o PDF do resumo, no momento do último envio. Igual = mesmo PDF = não reenvia.';

-- 2) Um turno do Luigi por conversa, em série: a vez é um UPDATE condicional
--    nesta linha (mutex no banco, porque cada instância da Vercel é um processo).
--    Expira sozinha em 120 s.
alter table public.wa_conversas add column if not exists luigi_turno_em timestamptz;
alter table public.wa_conversas add column if not exists luigi_turno_wamid text;
comment on column public.wa_conversas.luigi_turno_em is 'Quando o turno que está na vez desta conversa começou. Nulo = ninguém na vez. Expira em 120 s.';
comment on column public.wa_conversas.luigi_turno_wamid is 'wamid da mensagem cujo turno está na vez — só ele solta a vez.';
