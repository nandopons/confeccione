-- ============================================================================
-- "GENTE ESTÁ FALANDO AQUI" — 11/09/2026.
--
-- O INCIDENTE: 02:27–02:31, o Fernando e o Luigi escreveram na mesma conversa
-- ao mesmo tempo. Ele: "Pode ser amanhã?". 17 segundos depois, o Luigi:
-- "Ligação não consigo fazer por aqui". A cliente respondeu "Vc enrola demais"
-- e "Só pode ser golpe".
--
-- A CAUSA NÃO FOI UMA TRAVA FALTANDO, foi uma trava sendo DESARMADA: toda
-- mensagem enviada pelo inbox chamava `humanoRespondeu`, que limpa
-- `luigi_escalado_em`. Ou seja, cada frase que o Fernando digitava devolvia a
-- conversa pro Luigi — ele rearmava o bot a cada linha.
--
-- Limpar a escalada está certo: a escalada é "o Luigi pediu gente", e gente
-- chegou. O que faltava era a outra metade do mesmo fato — "gente está falando
-- agora" —, que não tinha onde ser gravada. São duas metades de um evento só e
-- é por isso que passam a ser escritas no mesmo update.
--
-- Não confundir com `wa_mensagens.autor`: aquilo é sobre QUEM escreveu cada
-- linha (e hoje é nulo em 629 delas). Isto é sobre a CONVERSA estar sob condução
-- humana, que é o que a trava do Luigi precisa consultar antes de escrever.
-- ============================================================================

alter table public.wa_conversas
  add column if not exists humano_falou_em timestamptz;

comment on column public.wa_conversas.humano_falou_em is
  'Última vez que uma PESSOA escreveu ao cliente por esta conversa (envio manual do inbox). O Luigi não escreve enquanto isto for recente. Limpo pelo "Devolver pro Luigi", que é ordem explícita.';

create index if not exists wa_conversas_humano_falou_idx
  on public.wa_conversas (humano_falou_em desc)
  where humano_falou_em is not null;
