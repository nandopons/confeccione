-- 29/09/2026 — dois relógios novos.
--
-- pedidos_assistente.foto_referencia_pedida_em: o degrau 0 da escada do
-- fechamento (luigi.ts, avancarFechamento) e o fechador automático pedem UMA
-- vez a foto de referência ao cliente antes das prévias ("quando o cliente
-- não enviar foto, vale a pena provocar o cliente a enviar foto de
-- referência, pra gente se guiar" — Fernando). Esta coluna é o "uma vez".
alter table public.pedidos_assistente add column if not exists foto_referencia_pedida_em timestamptz;

-- luigi_whatsapp_log.historico_em: quando o turno montou o histórico. Toda
-- mensagem com wa_mensagens.recebido_em anterior a isto estava no histórico
-- daquele turno — é a régua do "já respondemos" antes de chamar o modelo
-- (a Gabi mandou 7 fotos em 4 s e dois turnos responderam a mesma coisa).
alter table public.luigi_whatsapp_log add column if not exists historico_em timestamptz;

create index if not exists luigi_whatsapp_log_historico_idx
  on public.luigi_whatsapp_log (conversa_id, historico_em desc)
  where historico_em is not null;

-- O desempate do debounce e da vez passou a ser por recebido_em (microssegundos),
-- não por criado_em (segundos da Meta): a consulta é "última entrada da conversa".
create index if not exists wa_mensagens_recebido_idx
  on public.wa_mensagens (conversa_id, recebido_em desc)
  where direcao = 'entrada';
