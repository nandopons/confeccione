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
  enviarMidiaPorId,
  enviarTemplate,
  enviarTexto,
  uploadMidia,
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
    .select('id, contato:wa_contatos!inner (wa_id)')
    .eq('id', conversaId)
    .maybeSingle()
  const contato = data?.contato as { wa_id: string } | { wa_id: string }[] | undefined
  const waId = Array.isArray(contato) ? contato[0]?.wa_id : contato?.wa_id
  return waId ? { waId } : null
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
    tipo === 'text' ? (corpo ?? '').slice(0, 120)
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
  let body: { conversaId?: string; texto?: string; template?: { nome?: string; idioma?: string } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }

  const conversaId = body.conversaId ?? ''
  if (!conversaId) return NextResponse.json({ erro: 'conversaId é obrigatório' }, { status: 400 })

  const conversa = await dadosConversa(conversaId)
  if (!conversa) return NextResponse.json({ erro: 'Conversa não encontrada' }, { status: 404 })

  if (body.template?.nome) {
    const resultado = await enviarTemplate(conversa.waId, body.template.nome, body.template.idioma ?? 'pt_BR')
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
