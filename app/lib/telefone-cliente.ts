// app/lib/telefone-cliente.ts
// ============================================================================
// O NÚMERO QUE VALE É O QUE A META ENTREGOU — 24/09/2026
//
// `pedidos_assistente.telefone` é o que o cliente DIGITOU no site, passado por
// `normalizarWhatsApp`. A Melissa (20260900316) digitou "387531589" — nove
// dígitos, o DDD 31 virou "3" — e o resultado, "55387531589", tem o tamanho
// de um número e nenhum DDD real. Foi esse que apareceu no aviso de aceite e
// no atalho wa.me da confecção: "número inválido". Enquanto isso o WhatsApp
// dela, o de verdade, trocava 39 mensagens com o Luigi — porque a Meta entrega
// o `wa_id` certo e `wa_contatos` guarda.
//
// Não dá pra consertar "387531589" por regra: falta um dígito e nada diz
// qual. Mas dá pra deixar de USAR o que ela digitou quando o sistema já
// conheceu o número real: mesmos 8 finais em `wa_contatos`, com mensagem
// RECEBIDA dela — porque só o que chegou prova que o número existe e é dela.
// Medido em 60 dias: 2 pedidos com número quebrado assim, 10 sem o nono
// dígito (a Meta entrega, mas o wa.me da confecção não abre), e 34 em que o
// wa_id da Meta difere do digitado só no 9 — todos resolvidos por este
// caminho, sem tocar no que ela escreveu.
//
// O casamento é pelos 8 finais, tolerando o nono dígito (regra do AGENTS.md),
// e exige mensagem de ENTRADA: contato criado pelo nosso envio (`vincularContato`
// grava o número do cadastro) não conta — seria o mesmo número errado
// carimbado em outra tabela.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { variantesWhatsApp } from './phone'

/** Os 8 dígitos finais, ou null se o texto não tem nem isso. */
function fim8(telefone: string | null | undefined): string | null {
  const d = (telefone ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d.slice(-8) : null
}

/**
 * O número em que o cliente de fato responde: o `wa_id` de um contato que já
 * MANDOU mensagem com estes 8 finais. Sem isso, o digitado — completado com o
 * nono dígito quando faltar (`variantesWhatsApp(...)[0]`).
 */
export async function telefoneCanonicoDoCliente(telefoneDigitado: string | null | undefined): Promise<string | null> {
  const f8 = fim8(telefoneDigitado)
  if (!f8) return telefoneDigitado ? variantesWhatsApp(telefoneDigitado)[0] : null

  const { data, error } = await supabaseAdmin
    .from('wa_contatos')
    .select('wa_id, wa_conversas!inner(id, ultima_msg_contato_em)')
    .like('wa_id', `%${f8}`)
    .not('wa_conversas.ultima_msg_contato_em', 'is', null)
    .limit(3)
  // Consulta que falha volta pro digitado: é o de ontem, não é pior.
  if (error || !data || data.length === 0) return variantesWhatsApp(telefoneDigitado as string)[0]

  const linhas = data as Array<{ wa_id: string; wa_conversas: Array<{ id: string; ultima_msg_contato_em: string | null }> | { id: string; ultima_msg_contato_em: string | null } }>
  // Com mais de um contato nos mesmos 8 finais (DDI/DDD diferentes de
  // verdade — 5581… e 5511…), prefere o que tem DDD igual ao digitado; se
  // nenhum, o que falou mais recentemente.
  const digitado = (telefoneDigitado ?? '').replace(/\D/g, '')
  const dddDigitado = digitado.length >= 12 ? digitado.slice(2, 4) : digitado.length >= 10 ? digitado.slice(0, 2) : null
  const ultimaFala = (l: (typeof linhas)[number]) => {
    const c = Array.isArray(l.wa_conversas) ? l.wa_conversas[0] : l.wa_conversas
    return c?.ultima_msg_contato_em ? new Date(c.ultima_msg_contato_em).getTime() : 0
  }
  const ordenadas = [...linhas].sort((a, b) => {
    const da = dddDigitado && a.wa_id.slice(2, 4) === dddDigitado ? 1 : 0
    const db = dddDigitado && b.wa_id.slice(2, 4) === dddDigitado ? 1 : 0
    if (da !== db) return db - da
    return ultimaFala(b) - ultimaFala(a)
  })
  return variantesWhatsApp(ordenadas[0].wa_id)[0]
}

/**
 * O telefone do pedido, já canônico. Um ponto só pra quem lê `pedidos_assistente.telefone`
 * pra MOSTRAR ou LINKAR a alguém (aviso de aceite, página da oferta, painel do
 * fornecedor). Quem manda mensagem pela Cloud API já tolera o nono dígito por
 * conta própria; quem gera wa.me pro fornecedor clicar, não.
 */
export async function telefoneDoPedidoParaContato(pedidoId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('pedidos_assistente').select('telefone').eq('id', pedidoId).maybeSingle<{ telefone: string | null }>()
  return telefoneCanonicoDoCliente(data?.telefone ?? null)
}

/**
 * Grava no pedido o número real quando ele difere do digitado — uma vez, no
 * momento em que o sistema descobre (o aceite é o primeiro lugar em que o
 * número vai pra fora). `telefone_digitado` guarda o original: o que a pessoa
 * escreveu não some, vira rastro.
 */
export async function corrigirTelefoneDoPedidoSePreciso(pedidoId: string): Promise<{ corrigiu: boolean; de: string | null; para: string | null }> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('telefone, telefone_digitado')
    .eq('id', pedidoId)
    .maybeSingle<{ telefone: string | null; telefone_digitado: string | null }>()
  const atual = data?.telefone ?? null
  const canonico = await telefoneCanonicoDoCliente(atual)
  if (!canonico || !atual || canonico === atual.replace(/\D/g, '')) return { corrigiu: false, de: atual, para: canonico }
  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ telefone: canonico, telefone_digitado: data?.telefone_digitado ?? atual })
    .eq('id', pedidoId)
  return { corrigiu: !error, de: atual, para: canonico }
}
