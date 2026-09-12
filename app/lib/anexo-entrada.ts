// app/lib/anexo-entrada.ts
// ============================================================================
// A FOTO DO CLIENTE ENTRA NO PEDIDO PELO CAMINHO, NÃO PELO PROMPT — 12/09/2026.
//
// Em 30 dias, 68 imagens de entrada e 11 de 19 pedidos com ZERO foto anexada.
// A causa não era arquivo perdido: anexar dependia de o modelo lembrar de
// chamar `anexar_foto_ao_modelo`. É a regra do repo invertida — efeito que mora
// só no prompt não acontece. O 20260900302 é o caso limpo: o Luigi LEU a foto e
// escreveu "logo Midi Jovens no peito esquerdo" na descrição, e o arquivo não
// foi gravado. O PDF lê `mockups`, então a confecção receberia "logo Midi
// Jovens" em texto. Ninguém produz um logo a partir de texto.
//
// ATÉ ONDE ISTO VAI, E POR QUÊ NÃO VAI ALÉM
//
// `mockups` é indexado por POSIÇÃO da peça: anexar exige dizer a qual peça a
// foto pertence. O webhook não sabe. Medido nas 33 imagens que chegaram com
// pedido aberto, com a contagem de peças reconstruída NA HORA da foto (não
// hoje, que infla — pedido ganha peça durante a conversa):
//
//     1 peça no pedido ....  5 imagens   ← posição óbvia, é o que esta função faz
//     2 ou mais peças ..... 28 imagens   ← o webhook não tem como saber qual
//
// E não tem sinal pra desempatar: das 33, só 6 vieram com legenda e NENHUMA
// respondendo a uma mensagem específica. Chutar a posição 1 acertaria 5 de 33 e
// mandaria 28 fotos pra peça errada — que vai pra confecção produzir. Foto na
// peça errada é pior que foto faltando: a que falta alguém percebe.
//
// Então esta função é deliberadamente estreita. Quando a peça é ambígua ela não
// grava nada e não marca a mensagem: a foto fica pendente em `wa_mensagens`, que
// já é a fila, e a atribuição fica pra quem sabe — o agente, que tem a conversa.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { anexarFotoDaConversaAoModelo } from './pedido-fechamento'

export type ResultadoAnexoEntrada =
  | { anexou: true; pedidoId: string; codigo: string | null }
  | { anexou: false; motivo: 'sem_pedido_aberto' | 'varias_pecas' | 'sem_peca' | 'falhou' }

/**
 * Anexa a imagem que acabou de chegar ao pedido aberto do contato, quando dá
 * pra saber a peça sem chutar.
 *
 * Failure-soft de propósito: isto roda depois do 200 pra Meta e não pode
 * derrubar o turno do agente. Quem chama ignora o retorno — ele existe pro log
 * e pros testes.
 */
export async function anexarImagemNaEntrada(params: {
  mensagemId: string
  telefone: string
  midiaPath: string
}): Promise<ResultadoAnexoEntrada> {
  const tel8 = params.telefone.replace(/\D/g, '').slice(-8)
  if (tel8.length < 8) return { anexou: false, motivo: 'sem_pedido_aberto' }

  // Mesma definição de "aberto" da trava do criar_pedido: nem confirmado nem
  // encerrado. Se as duas discordarem, uma delas está anexando no pedido errado.
  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, linhas')
    .like('telefone', `%${tel8}`)
    .is('confirmado_em', null)
    .is('encerrado_em', null)
    .neq('status', 'cancelado')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; codigo: string | null; linhas: unknown }>()
  if (!pedido) return { anexou: false, motivo: 'sem_pedido_aberto' }

  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  if (linhas.length === 0) return { anexou: false, motivo: 'sem_peca' }
  if (linhas.length > 1) return { anexou: false, motivo: 'varias_pecas' }

  const r = await anexarFotoDaConversaAoModelo({ pedidoId: pedido.id, posicao: 1, midiaPath: params.midiaPath })
  if (!r.ok) return { anexou: false, motivo: 'falhou' }

  // Só marca depois de gravar. Marcar antes transformaria uma falha de anexo em
  // foto que a fila de amanhã considera resolvida — o sumiço silencioso de novo.
  await supabaseAdmin
    .from('wa_mensagens')
    .update({ anexada_em: new Date().toISOString(), anexo_motivo: 'entrada_peca_unica' })
    .eq('id', params.mensagemId)

  return { anexou: true, pedidoId: pedido.id, codigo: pedido.codigo }
}
