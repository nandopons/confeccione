-- Big Shopp, 25/09/2026 18:23: o cliente perguntou "é necessário passar pra
-- confecção pra depois vir o orçamento?", o Luigi respondeu e, na mesma vez,
-- emendou "posso te mandar o resumo em PDF?". O Fernando: "era bom ele
-- esperar um pouco; se a conversa não avançar em uns 3 minutos, perguntar se
-- tem mais alguma dúvida; até ele dizer que não tem, e aí perguntar se pode
-- mandar o resumo". Ver `armarSeguir` / `seguirConversasParadas` em
-- app/lib/luigi.ts e o cron /api/cron/luigi-seguir (a cada minuto).
--
-- `luigi_seguir_em`: quando o Luigi deve voltar sozinho com "ficou alguma
-- dúvida?". Nulo = nada marcado. Qualquer mensagem do cliente, ou fala de
-- gente, desarma (o cron confere pelas marcas da conversa antes de mandar).
-- `luigi_seguir_marcado_em`: quando a marca foi posta — é contra isto que o
-- cron compara `ultima_msg_contato_em` e `humano_falou_em`.
alter table public.wa_conversas add column if not exists luigi_seguir_em timestamptz;
alter table public.wa_conversas add column if not exists luigi_seguir_marcado_em timestamptz;
comment on column public.wa_conversas.luigi_seguir_em is 'Quando o Luigi volta sozinho com "ficou alguma dúvida?" se ninguém falou até lá. Nulo = nada marcado.';
comment on column public.wa_conversas.luigi_seguir_marcado_em is 'Quando a marca de luigi_seguir_em foi posta; mensagem do cliente ou fala de gente depois disto desarma.';
create index if not exists wa_conversas_luigi_seguir_em_idx on public.wa_conversas (luigi_seguir_em) where luigi_seguir_em is not null;
