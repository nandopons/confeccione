// app/lib/whatsapp-notify.ts
// ============================================================================
// Notificações transacionais pelo WhatsApp OFICIAL (Meta Cloud API).
//
// Primeira função migrada do Z-API: confirmação de pedido recebido.
// Envia o template `pedido_recebido` (utility) e registra a mensagem no
// inbox (/admin/whatsapp), criando contato+conversa se ainda não existem —
// assim, quando o cliente responder, a conversa já tem o histórico.
//
// Failure-soft: retorna false e loga; nunca lança (não pode quebrar o pedido).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarTemplate, normalizarWaId } from './whatsapp-cloud'

async function vincularContato(waId: string): Promise<{ clienteId: string | null; fornecedorId: string | null }> {
  const last8 = waId.slice(-8)
  const bate = (tel: string | null) => {
    if (!tel) return false
    const dig = tel.replace(/\D/g, '')
    return dig.endsWith(last8) || waId.endsWith(dig.slice(-8))
  }
  const [clientes, fornecedores] = await Promise.all([
    supabaseAdmin.from('contas_clientes').select('id, whatsapp').ilike('whatsapp', `%${last8}`).limit(2),
    supabaseAdmin.from('leads_fornecedores').select('id, whatsapp').ilike('whatsapp', `%${last8}`).limit(2),
  ])
  const cliente = (clientes.data ?? []).find((c) => bate(c.whatsapp))
  const fornecedor = (fornecedores.data ?? []).find((f) => bate(f.whatsapp))
  return { clienteId: cliente?.id ?? null, fornecedorId: fornecedor?.id ?? null }
}

/** Garante wa_contatos + wa_conversas pro telefone; retorna conversaId (ou null). */
async function garantirConversa(waId: string, nome: string | null): Promise<string | null> {
  const { data: contatoExistente } = await supabaseAdmin
    .from('wa_contatos')
    .select('id, nome')
    .eq('wa_id', waId)
    .maybeSingle()

  let contatoId = contatoExistente?.id as string | undefined
  if (!contatoId) {
    const { clienteId, fornecedorId } = await vincularContato(waId)
    const { data: novo, error } = await supabaseAdmin
      .from('wa_contatos')
      .insert({ wa_id: waId, nome, cliente_id: clienteId, fornecedor_id: fornecedorId })
      .select('id')
      .single()
    if (error) {
      const { data: retry } = await supabaseAdmin.from('wa_contatos').select('id').eq('wa_id', waId).maybeSingle()
      contatoId = retry?.id
    } else {
      contatoId = novo.id
    }
  } else if (nome && !contatoExistente?.nome) {
    await supabaseAdmin.from('wa_contatos').update({ nome }).eq('id', contatoId)
  }
  if (!contatoId) return null

  const { data: conversaExistente } = await supabaseAdmin
    .from('wa_conversas')
    .select('id')
    .eq('contato_id', contatoId)
    .maybeSingle()
  if (conversaExistente?.id) return conversaExistente.id

  const { data: nova, error: convErr } = await supabaseAdmin
    .from('wa_conversas')
    .insert({ contato_id: contatoId })
    .select('id')
    .single()
  if (convErr || !nova) {
    const { data: retry } = await supabaseAdmin.from('wa_conversas').select('id').eq('contato_id', contatoId).maybeSingle()
    return retry?.id ?? null
  }
  return nova.id
}

/**
 * Confirmação de pedido recebido via template oficial `pedido_recebido`.
 * @returns true se a Meta aceitou o envio (senão o caller pode usar fallback).
 */
export async function notificarPedidoRecebido(params: {
  telefone: string
  nome: string
  protocolo: string
}): Promise<boolean> {
  try {
    const waId = normalizarWaId(params.telefone)
    if (waId.replace(/\D/g, '').length < 10) return false

    const resultado = await enviarTemplate(waId, 'pedido_recebido', 'pt_BR', [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.nome },
          { type: 'text', text: params.protocolo },
        ],
      },
    ])
    if (!resultado.ok) {
      console.error('[wa-notify] pedido_recebido falhou', { erro: resultado.erro })
      return false
    }

    // Registra no inbox pro histórico (failure-soft; envio já aconteceu).
    try {
      const conversaId = await garantirConversa(waId, params.nome)
      if (conversaId) {
        const agora = new Date().toISOString()
        const corpo =
          `Oi, ${params.nome}! Recebemos seu pedido nº ${params.protocolo} aqui na Confeccione. ✅\n\n` +
          `Nossa equipe já está buscando o fornecedor ideal pra sua produção — assim que tiver novidade, você recebe o aviso por aqui.\n\n` +
          `Qualquer dúvida, é só responder esta mensagem.\n▸ Falar com atendente`
        await supabaseAdmin.from('wa_mensagens').insert({
          conversa_id: conversaId,
          wamid: resultado.wamid,
          direcao: 'saida',
          tipo: 'template',
          corpo,
          status: 'enviando',
          template_nome: 'pedido_recebido',
          criado_em: agora,
        })
        await supabaseAdmin
          .from('wa_conversas')
          .update({ preview: `Você: Pedido nº ${params.protocolo} confirmado ✅`, ultima_mensagem_em: agora })
          .eq('id', conversaId)
      }
    } catch (err) {
      console.error('[wa-notify] registro no inbox falhou', { err })
    }

    return true
  } catch (err) {
    console.error('[wa-notify] exception', { err })
    return false
  }
}
