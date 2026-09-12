-- ============================================================================
-- PRÉVIA DE IA: SÓ A ÚLTIMA — 12/09/2026.
--
-- `gerarMockupDoModelo` dava PUSH no array `mockups[i].ia` a cada regeração, e
-- o array virou histórico. Prévia é RASCUNHO: quando o cliente corrige a peça, a
-- versão anterior não vira alternativa, vira errada.
--
-- O dano estava em cinco leitores com três regras diferentes — `pedido-visuais`
-- manda TODAS pra confecção (ela orça e costura vendo a aprovada e a rejeitada
-- juntas), `inscricao/[token]` mostra `ia[0]`, a mais velha, na página pública
-- onde o grupo do cliente escolhe tamanho, e o PDF e o Luigi pegam a última.
--
-- O código passou a gravar uma só. Isto limpa o que já estava empilhado: 4
-- modelos em 4 pedidos, 5 imagens obsoletas. Fica a ÚLTIMA de cada, que é a
-- correção que o cliente pediu — dá pra ver pelos prompts:
--
--   20260900253 modelo 0 (3)  (sem prompt) → "Seria assim" → "Seria assim"
--   20260900249 modelo 1 (2)  (sem prompt) → "Chat definitivo de mockup"
--   20260800196 modelo 0 (2)  (sem prompt) → "Aplicar a um modelo masculino…"  [cancelado]
--   20260800173 modelo 3 (2)  (sem prompt) → "Aplique o numero 7 vermelho na frente"
--
-- O 20260800173 é o caso que mostra o custo: `ia[0]` é a blusa SEM o número 7.
--
-- NÃO APAGA A IMAGEM DO BUCKET, só tira a referência — o arquivo continua lá se
-- alguém precisar auditar.
-- ============================================================================

update public.pedidos_assistente p
   set mockups = (
         select jsonb_object_agg(
                  k,
                  case
                    when jsonb_typeof(v->'ia') = 'array' and jsonb_array_length(v->'ia') > 1
                      then jsonb_set(v, '{ia}', jsonb_build_array(v->'ia'->-1))
                    else v
                  end
                )
           from jsonb_each(p.mockups) as t(k, v)
       ),
       atualizado_em = now()
 where jsonb_typeof(p.mockups) = 'object'
   and exists (
     select 1 from jsonb_each(p.mockups) as t(k, v)
      where jsonb_typeof(v->'ia') = 'array' and jsonb_array_length(v->'ia') > 1
   );
