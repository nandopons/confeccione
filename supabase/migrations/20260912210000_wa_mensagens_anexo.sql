-- A foto que o cliente manda passa a ser anexada no caminho de entrada, e a
-- mensagem guarda que já foi — 12/09/2026.
--
-- Até hoje anexar dependia de o modelo lembrar de chamar a ferramenta: em 30
-- dias, 68 imagens entraram e 11 de 19 pedidos ficaram com zero foto. O pedido
-- 20260900302 é o caso limpo: o Luigi LEU a foto e descreveu "logo Midi Jovens
-- no peito esquerdo", e o arquivo não foi gravado. Logo não se produz a partir
-- de texto.
--
-- Estas duas colunas existem por um motivo só: sem elas não dá pra saber se
-- uma foto pendente já foi consumida. O resto (por que não foi anexada, quantas
-- esperam pedido) é derivável por consulta e NÃO é gravado — cachear o que dá
-- pra derivar é o erro que a gente já pagou em outro lugar hoje.
--
-- `anexo_motivo` diz por QUAL caminho entrou, pra daqui a um mês dar pra medir
-- se o automático substituiu a ferramenta ou só somou com ela.
alter table wa_mensagens
  add column if not exists anexada_em timestamptz,
  add column if not exists anexo_motivo text;

comment on column wa_mensagens.anexada_em is
  'Quando esta mídia foi anexada a um pedido. Null = ainda não foi (pode ser fila pra quando o pedido nascer).';
comment on column wa_mensagens.anexo_motivo is
  'Caminho que anexou: entrada_peca_unica (automático no webhook) ou ferramenta (o agente chamou).';

create index if not exists wa_mensagens_anexo_pendente_idx
  on wa_mensagens (conversa_id, criado_em)
  where tipo = 'image' and direcao = 'entrada' and anexada_em is null;
