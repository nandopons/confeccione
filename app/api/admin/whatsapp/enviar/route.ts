// app/api/admin/whatsapp/enviar/route.ts
// ============================================================================
// POST → envia mensagem pelo inbox admin.
//
// Aceita dois formatos:
// 1. JSON  { conversaId, texto }                 → texto livre (janela 24h)
//    JSON  { conversaId, template: { nome, idioma } } → template aprovado
// 2. multipart/form-data { conversaId, arquivo, caption? } → mídia
//    (imagem, áudio, vídeo, documento — sobe pra Meta e envia)
//
// Sempre registra em wa_mensagens com status 'enviando' → o webhook de
// statuses atualiza pra enviado/entregue/lido/falhou via wamid.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  enviarBotaoUrl,
  enviarBotoes,
  enviarMidiaPorId,
  enviarTemplate,
  enviarTexto,
  listarTemplates,
  sufixoVisualizadorPedido,
  uploadMidia,
  type BotaoResposta,
  type EnvioResultado,
  type MidiaTipo,
} from '@/app/lib/whatsapp-cloud'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function tipoPorMime(mime: string): MidiaTipo {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

async function dadosConversa(conversaId: string) {
  const { data } = await supabaseAdmin
    .from('wa_conversas')
    .select('id, contato:wa_contatos!inner (wa_id, cliente_id)')
    .eq('id', conversaId)
    .maybeSingle()
  type ContatoSel = { wa_id: string; cliente_id: string | null }
  const contato = data?.contato as ContatoSel | ContatoSel[] | undefined
  const c = Array.isArray(contato) ? contato[0] : contato
  return c?.wa_id ? { waId: c.wa_id, clienteId: c.cliente_id ?? null } : null
}

/**
 * Pedido do assistente vinculado ao contato — pro botão de URL dinâmica dos
 * templates de retomada (visualizador/{{1}}). Vínculo: telefone terminando
 * nos últimos 8 dígitos do wa_id e/ou conta do cliente. Prefere o pedido mais
 * recente ainda não pago (é o que faz sentido "retomar").
 */
async function pedidoAssistenteDoContato(waId: string, clienteId: string | null): Promise<string | null> {
  const ultimos8 = waId.replace(/\D/g, '').slice(-8)
  const filtros: string[] = []
  if (ultimos8.length === 8) filtros.push(`telefone.like.%${ultimos8}`)
  if (clienteId) filtros.push(`conta_id.eq.${clienteId}`)
  if (filtros.length === 0) return null

  const { data } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status, criado_em')
    .or(filtros.join(','))
    .order('criado_em', { ascending: false })
    .limit(10)
  const lista = (data ?? []) as Array<{ id: string; pagamento_status: string | null }>
  const aberto = lista.find((p) => p.pagamento_status !== 'pago')
  return (aberto ?? lista[0])?.id ?? null
}

async function registrarSaida(params: {
  conversaId: string
  resultado: EnvioResultado
  tipo: string
  corpo: string | null
  midiaPath?: string | null
  midiaMime?: string | null
  midiaNome?: string | null
  templateNome?: string | null
}) {
  const { conversaId, resultado, tipo, corpo } = params
  const agora = new Date().toISOString()

  const { data: msg } = await supabaseAdmin
    .from('wa_mensagens')
    .insert({
      conversa_id: conversaId,
      wamid: resultado.ok ? resultado.wamid : null,
      direcao: 'saida',
      tipo,
      corpo,
      midia_path: params.midiaPath ?? null,
      midia_mime: params.midiaMime ?? null,
      midia_nome: params.midiaNome ?? null,
      status: resultado.ok ? 'enviando' : 'falhou',
      erro: resultado.ok ? null : resultado.erro,
      template_nome: params.templateNome ?? null,
      criado_em: agora,
    })
    .select('id')
    .single()

  const preview =
    tipo === 'text' || tipo === 'interactive' ? (corpo ?? '').slice(0, 120)
    : tipo === 'image' ? '📷 Foto'
    : tipo === 'audio' ? '🎤 Áudio'
    : tipo === 'video' ? '🎬 Vídeo'
    : tipo === 'document' ? `📄 ${params.midiaNome ?? 'Documento'}`
    : tipo === 'template' ? `Template: ${params.templateNome}`
    : tipo

  await supabaseAdmin
    .from('wa_conversas')
    .update({ preview: `Você: ${preview}`, ultima_mensagem_em: agora })
    .eq('id', conversaId)

  return msg?.id as string | undefined
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  // -------------------------------------------------------------------------
  // Multipart → mídia
  // -------------------------------------------------------------------------
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const conversaId = String(form.get('conversaId') ?? '')
    const caption = form.get('caption') ? String(form.get('caption')) : undefined
    const arquivo = form.get('arquivo')

    if (!conversaId || !(arquivo instanceof File)) {
      return NextResponse.json({ erro: 'conversaId e arquivo são obrigatórios' }, { status: 400 })
    }
    if (arquivo.size > 16 * 1024 * 1024) {
      return NextResponse.json({ erro: 'Arquivo acima de 16MB (limite do WhatsApp)' }, { status: 400 })
    }

    const conversa = await dadosConversa(conversaId)
    if (!conversa) return NextResponse.json({ erro: 'Conversa não encontrada' }, { status: 404 })

    const mime = arquivo.type || 'application/octet-stream'
    const tipo = tipoPorMime(mime)
    const buffer = await arquivo.arrayBuffer()

    const up = await uploadMidia(buffer, mime, arquivo.name || `arquivo.${tipo}`)
    if (!up.ok) return NextResponse.json({ erro: up.erro }, { status: 502 })

    const resultado = await enviarMidiaPorId(conversa.waId, tipo, up.mediaId, {
      caption,
      filename: tipo === 'document' ? arquivo.name : undefined,
    })

    // Persiste cópia no Storage pro histórico do inbox
    let midiaPath: string | null = null
    const ext = (arquivo.name?.split('.').pop() || 'bin').toLowerCase().slice(0, 8)
    midiaPath = `${conversaId}/out_${Date.now()}.${ext}`
    const { error: upErr } = await supabaseAdmin.storage
      .from('wa-midia')
      .upload(midiaPath, buffer, { contentType: mime, upsert: true })
    if (upErr) {
      console.error('[wa-admin] cópia storage falhou', { upErr })
      midiaPath = null
    }

    const msgId = await registrarSaida({
      conversaId,
      resultado,
      tipo,
      corpo: caption ?? null,
      midiaPath,
      midiaMime: mime,
      midiaNome: arquivo.name ?? null,
    })

    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro, mensagemId: msgId }, { status: 502 })
    return NextResponse.json({ ok: true, mensagemId: msgId })
  }

  // -------------------------------------------------------------------------
  // JSON → texto ou template
  // -------------------------------------------------------------------------
  let body: {
    conversaId?: string
    texto?: string
    template?: { nome?: string; idioma?: string; variaveis?: string[] }
    botoes?: { corpo?: string; botoes?: BotaoResposta[] }
    botaoUrl?: { corpo?: string; texto?: string; url?: string }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }

  const conversaId = body.conversaId ?? ''
  if (!conversaId) return NextResponse.json({ erro: 'conversaId é obrigatório' }, { status: 400 })

  const conversa = await dadosConversa(conversaId)
  if (!conversa) return NextResponse.json({ erro: 'Conversa não encontrada' }, { status: 404 })

  // ---------------------------------------------------------------- botão de link (CTA URL)
  if (body.botaoUrl) {
    const corpo = (body.botaoUrl.corpo ?? '').trim()
    const textoBotao = (body.botaoUrl.texto ?? '').trim()
    const url = (body.botaoUrl.url ?? '').trim()
    if (!corpo || !textoBotao || !/^https:\/\//.test(url)) {
      return NextResponse.json({ erro: 'Botão de link precisa de corpo, texto e URL https' }, { status: 400 })
    }
    const resultado = await enviarBotaoUrl(conversa.waId, corpo, textoBotao, url)
    const corpoRegistro = `${corpo}\n▸ ${textoBotao}`
    const msgId = await registrarSaida({ conversaId, resultado, tipo: 'interactive', corpo: corpoRegistro })
    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro, mensagemId: msgId }, { status: 502 })
    return NextResponse.json({ ok: true, mensagemId: msgId })
  }

  // ---------------------------------------------------------------- botões
  if (body.botoes) {
    const corpo = (body.botoes.corpo ?? '').trim()
    const botoes = (body.botoes.botoes ?? []).filter((b) => b?.id && b?.titulo).slice(0, 3)
    if (!corpo || botoes.length === 0) {
      return NextResponse.json({ erro: 'Mensagem de botões precisa de corpo e 1–3 botões' }, { status: 400 })
    }
    const resultado = await enviarBotoes(conversa.waId, corpo, botoes)
    // Guarda os botões no corpo (linhas "▸ …") pro histórico do inbox renderizar como chips.
    const corpoRegistro = `${corpo}\n${botoes.map((b) => `▸ ${b.titulo}`).join('\n')}`
    const msgId = await registrarSaida({ conversaId, resultado, tipo: 'interactive', corpo: corpoRegistro })
    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro, mensagemId: msgId }, { status: 502 })
    return NextResponse.json({ ok: true, mensagemId: msgId })
  }

  if (body.template?.nome) {
    // Variáveis do corpo ({{1}}, {{2}}, …) → componente body da Cloud API.
    const variaveis = (body.template.variaveis ?? []).map((v) => String(v ?? '').trim()).filter(Boolean)
    const components: unknown[] = []
    if (variaveis.length > 0) {
      components.push({ type: 'body', parameters: variaveis.map((v) => ({ type: 'text', text: v })) })
    }

    // Botão de URL dinâmica (ex.: retomar_pedido_v3 → visualizador/{{1}}):
    // resolve o pedido do assistente DESTE contato e injeta o id no botão —
    // cada cliente cai direto no próprio pedido.
    const def = (await listarTemplates()).find((t) => t.name === body.template!.nome)
    if (def?.urlDinamica) {
      const pedidoId = await pedidoAssistenteDoContato(conversa.waId, conversa.clienteId)
      if (!pedidoId) {
        return NextResponse.json(
          { erro: 'Esse template leva ao pedido do cliente, mas não achei pedido do assistente vinculado a este contato.' },
          { status: 400 }
        )
      }
      components.push({
        type: 'button',
        sub_type: 'url',
        index: def.urlDinamica.index,
        parameters: [{ type: 'text', text: sufixoVisualizadorPedido(pedidoId) }],
      })
    }

    const resultado = await enviarTemplate(
      conversa.waId,
      body.template.nome,
      body.template.idioma ?? 'pt_BR',
      components.length > 0 ? components : undefined
    )
    const msgId = await registrarSaida({
      conversaId,
      resultado,
      tipo: 'template',
      corpo: `[template] ${body.template.nome}`,
      templateNome: body.template.nome,
    })
    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro, mensagemId: msgId }, { status: 502 })
    return NextResponse.json({ ok: true, mensagemId: msgId })
  }

  const texto = (body.texto ?? '').trim()
  if (!texto) return NextResponse.json({ erro: 'texto vazio' }, { status: 400 })

  const resultado = await enviarTexto(conversa.waId, texto)
  const msgId = await registrarSaida({ conversaId, resultado, tipo: 'text', corpo: texto })

  if (!resultado.ok) return NextResponse.json({ erro: resultado.erro, mensagemId: msgId }, { status: 502 })
  return NextResponse.json({ ok: true, mensagemId: msgId })
}
