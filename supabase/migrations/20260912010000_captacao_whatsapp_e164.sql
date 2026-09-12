-- ============================================================================
-- OS FIXOS SEM CÓDIGO DE PAÍS — 12/09/2026.
--
-- 12 dos 40 leads com whatsapp (30%) estavam gravados com 10 dígitos, sem o 55.
-- Todos são fixo comercial (DDD + 8 dígitos começando em 2–5), o primeiro de
-- 31/05/2026. A Meta recusa esses números, então a sondagem nunca saiu — e
-- template recusado é exatamente o que derruba o quality rating da WABA.
--
-- A CAUSA: `telefoneParaWaId` classificava certo (fixo ia pra coluna `telefone`
-- e `whatsapp` ficava NULL, de propósito), e a gravação em `abordarCandidato`
-- desfazia com `const numero = c.whatsapp ?? c.telefone` — o `??` ressuscitava o
-- fixo pra coluna errada, sem normalizar. Duas funções dizendo coisas
-- contraditórias sobre a mesma regra; a de baixo venceu.
--
-- E A PREMISSA DAQUELA CLASSIFICAÇÃO ERA FALSA: `8132247097` é fixo, tem 10
-- dígitos, e FOI ENTREGUE quando saiu com o 55. Fixo comercial tem WhatsApp
-- Business. Nunca foi caso de filtrar fixo — era caso de normalizar.
--
-- O CRITÉRIO É COMPRIMENTO, NUNCA PREFIXO. Parece detalhe e não é:
-- `5591342110` é a Fatto Confecções, de Caxias do Sul — DDD **55**, 10 dígitos.
-- Um backfill escrito como "se não começa com 55, prefixa" pularia essa linha e
-- a deixaria quebrada. Escrito por comprimento, ela vira `555591342110`, que é
-- DDI 55 + DDD 55 + 9134-2110, e está certo. Mesma família da armadilha do nono
-- dígito que o AGENTS.md registra.
--
-- ZERA `ultimo_contato_em` JUNTO, e isso não é reabordagem: aquelas confecções
-- nunca receberam nada. A Meta recusou a entrega; do outro lado não chegou
-- mensagem nenhuma. É a PRIMEIRA abordagem, que só agora tem número válido.
--
-- E manda pra `sugerido` (o banco de reserva) em vez de deixar em `ativo`:
-- zerar a data sozinha não devolveria ninguém pra fila — as duas filas que
-- consomem candidato (`bancoDeReserva` e `reabordarPendentes`) filtram por
-- status, e `ativo` não casa com nenhuma. Pelo banco de reserva elas saem no
-- ritmo normal: no máximo `lote` (2) por onda, respeitando `max_por_dia`.
-- Estão espalhadas por 9 pedidos, no máximo 2 por pedido — ninguém dispara em
-- rajada.
-- ============================================================================

update public.captacao_fornecedores
   set whatsapp = '55' || regexp_replace(whatsapp, '\D', '', 'g'),
       status = case when status = 'ativo' then 'sugerido' else status end,
       ultimo_contato_em = null,
       atualizado_em = now()
 where whatsapp is not null
   and length(regexp_replace(whatsapp, '\D', '', 'g')) = 10;

-- ─── CORREÇÃO DA CORREÇÃO, mesma data ───────────────────────────────────────
--
-- O update acima prefixou 55 por COMPRIMENTO, e isso está certo pro DDI — mas
-- pulou a etapa anterior: decidir se falta o NONO DÍGITO. Uma das 12 linhas não
-- era fixo.
--
-- `5591342110` (Fatto Confecções, RS) é DDD 55 (Santa Maria) + `91342110`:
-- oito dígitos começando em 9, que é CELULAR no formato antigo. Fixo começa em
-- 2–5. O certo é `55` + `55` + `9` + `91342110` = 5555991342110, não
-- 555591342110 — que tem 12 dígitos e cara de fixo, e ou não entrega ou entrega
-- no número errado.
--
-- A ordem é: nono dígito primeiro, DDI depois. É o que `telefoneParaWaId` faz
-- em app/lib/captacao-pedido.ts, e foi comparando o backfill com ela que o erro
-- apareceu — 11 das 12 batiam, esta não.
update public.captacao_fornecedores
   set whatsapp = '5555991342110', atualizado_em = now()
 where whatsapp = '555591342110';
