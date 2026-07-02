// app/api/whatsapp/webhook/route.ts
// ============================================================================
// Webhook da WhatsApp Cloud API (Meta).
//
// GET  → verificação do endpoint (hub.mode/hub.verify_token/hub.challenge),
//        feita uma vez ao configurar o webhook no painel da Meta.
// POST → eventos: mensagens recebidas (todos os tipos) e recibos de status
//        das mensagens enviadas (sent/delivered/read/failed).
//
// Segurança:
// - GET valida WHATSAPP_VERIFY_TOKEN (string secreta que você define).
// - POST valida a assinatura X-Hub-Signature-256 (HMAC-SHA256 do raw body
//   com WHATSAPP_APP_SECRET). Se a env não estiver setada, loga warning e
//   aceita (útil em dev; setar SEMPRE em produção).
//
// Failure-soft: responde 200 mesmo em erro interno (exceto assinatura
// inválida → 401). A Meta re-tenta entregas com backoff; 200 evita a WABA
// ser marcada como problemática. Dedup por wamid (unique no banco).
// ============================================================================

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { baixarMidia } from '@/app/lib/whatsapp-cloud'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ---------------------------------------------------------------------------
// GET — verificação do endpoint
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ---------------------------------------------------------------------------
// Tipos do payload da Meta (subset que usamos)
// ---------------------------------------------------------------------------
type MetaMidia = { id: string; mime_type?: string; caption?: string; filename?: string }

type MetaMensagem = {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: MetaMidia
  video?: MetaMidia
  audio?: MetaMidia
  document?: MetaMidia
  sticker?: MetaMidia
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  contacts?: unknown[]
  reaction?: { message_id: string; emoji?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
}

type MetaStatus = {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  errors?: { code?: number; title?: string; message?: string }[]
}

type MetaChangeValue = {
  messaging_product?: string
  contacts?: { wa_id: string; profile?: { name?: string } }[]
  messages?: MetaMensagem[]
  statuses?: MetaStatus[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
}

function extPorMime(mime: string | undefined): string {
  if (!mime) return 'bin'
  return EXT_POR_MIME[mime.split(';')[0]] ?? 'bin'
}

function assinaturaValida(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) {
    console.warn('[wa-webhook] WHATSAPP_APP_SECRET ausente — assinatura NÃO validada')
    return true
  }
  if (!header?.startsWith('sha256=')) return false
  const esperada = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  const recebida = header.slice(7)
  if (esperada.length !== recebida.length) return false
  return crypto.timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(recebida, 'hex'))
}

/** Tenta vincular o wa_id a um cliente ou fornecedor existente (pelos dígitos). */
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

/** Garante contato + conversa pro wa_id; retorna o id da conversa. */
async function obterConversa(waId: string, nomePerfil: string | undefined): Promise<string | null> {
  const { data: contatoExistente } = await supabaseAdmin
    .from('wa_contatos')
    .select('id')
    .eq('wa_id', waId)
    .maybeSingle()

  let contatoId = contatoExistente?.id as string | undefined

  if (!contatoId) {
    const { clienteId, fornecedorId } = await vincularContato(waId)
    const { data: novo, error } = await supabaseAdmin
      .from('wa_contatos')
      .insert({ wa_id: waId, nome: nomePerfil ?? null, cliente_id: clienteId, fornecedor_id: fornecedorId })
      .select('id')
      .single()
    if (error) {
      // corrida entre dois eventos simultâneos — busca de novo
      const { data: retry } = await supabaseAdmin.from('wa_contatos').select('id').eq('wa_id', waId).maybeSingle()
      contatoId = retry?.id
    } else {
      contatoId = novo.id
    }
  } else if (nomePerfil) {
    await supabaseAdmin
      .from('wa_contatos')
      .update({ nome: nomePerfil, atualizado_em: new Date().toISOString() })
      .eq('id', contatoId)
  }

  if (!contatoId) return null

  const { data: conversaExistente } = await supabaseAdmin
    .from('wa_conversas')
    .select('id')
    .eq('contato_id', contatoId)
    .maybeSingle()

  if (conversaExistente?.id) return conversaExistente.id

  const { data: novaConversa, error: convErr } = await supabaseAdmin
    .from('wa_conversas')
    .insert({ contato_id: contatoId })
    .select('id')
    .single()

  if (convErr) {
    const { data: retry } = await supabaseAdmin.from('wa_conversas').select('id').eq('contato_id', contatoId).maybeSingle()
    return retry?.id ?? null
  }
  return novaConversa.id
}

/** Extrai corpo + referência de mídia de uma mensagem da Meta. */
function interpretarMensagem(msg: MetaMensagem): {
  tipo: string
  corpo: string | null
  midia: MetaMidia | null
} {
  switch (msg.type) {
    case 'text':
      return { tipo: 'text', corpo: msg.text?.body ?? '', midia: null }
    case 'image':
      return { tipo: 'image', corpo: msg.image?.caption ?? null, midia: msg.image ?? null }
    case 'video':
      return { tipo: 'video', corpo: msg.video?.caption ?? null, midia: msg.video ?? null }
    case 'audio':
      return { tipo: 'audio', corpo: null, midia: msg.audio ?? null }
    case 'document':
      return { tipo: 'document', corpo: msg.document?.caption ?? null, midia: msg.document ?? null }
    case 'sticker':
      return { tipo: 'sticker', corpo: null, midia: msg.sticker ?? null }
    case 'location': {
      const l = msg.location
      const rotulo = l?.name || l?.address || (l ? `${l.latitude},${l.longitude}` : '')
      return { tipo: 'location', corpo: `📍 Localização: ${rotulo}`, midia: null }
    }
    case 'contacts':
      return { tipo: 'contacts', corpo: '👤 Contato compartilhado', midia: null }
    case 'reaction':
      return { tipo: 'reaction', corpo: msg.reaction?.emoji ? `Reagiu ${msg.reaction.emoji}` : 'Reação removida', midia: null }
    case 'button':
      return { tipo: 'button', corpo: msg.button?.text ?? '[botão]', midia: null }
    case 'interactive': {
      const titulo = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '[interação]'
      return { tipo: 'interactive', corpo: titulo, midia: null }
    }
    default:
      return { tipo: msg.type || 'unknown', corpo: `[${msg.type}: tipo não suportado]`, midia: null }
  }
}

function previewDe(tipo: string, corpo: string | null, filename?: string): string {
  switch (tipo) {
    case 'text':
      return (corpo ?? '').slice(0, 120)
    case 'image':
      return corpo ? `📷 ${corpo.slice(0, 100)}` : '📷 Foto'
    case 'video':
      return corpo ? `🎬 ${corpo.slice(0, 100)}` : '🎬 Vídeo'
    case 'audio':
      return '🎤 Áudio'
    case 'sticker':
      return 'Figurinha'
    case 'document':
      return `📄 ${filename ?? 'Documento'}`
    default:
      return (corpo ?? tipo).slice(0, 120)
  }
}

async function processarMensagem(msg: MetaMensagem, valor: MetaChangeValue): Promise<void> {
  const waId = msg.from
  const nomePerfil = valor.contacts?.find((c) => c.wa_id === waId)?.profile?.name

  const conversaId = await obterConversa(waId, nomePerfil)
  if (!conversaId) {
    console.error('[wa-webhook] não foi possível obter conversa', { waId })
    return
  }

  const { tipo, corpo, midia } = interpretarMensagem(msg)

  // Mídia: baixa da Meta (URL expira em ~5min) e persiste no Storage
  let midiaPath: string | null = null
  let midiaMime: string | null = null
  let midiaNome: string | null = null

  if (midia?.id) {
    const download = await baixarMidia(midia.id)
    if (download.ok) {
      midiaMime = midia.mime_type ?? download.mime
      midiaNome = midia.filename ?? null
      const ext = extPorMime(midiaMime)
      const sufixo = msg.id.replace(/[^a-zA-Z0-9]/g, '').slice(-24)
      midiaPath = `${conversaId}/${Date.now()}_${sufixo}.${ext}`
      const { error: upErr } = await supabaseAdmin.storage
        .from('wa-midia')
        .upload(midiaPath, download.buffer, { contentType: midiaMime, upsert: true })
      if (upErr) {
        console.error('[wa-webhook] upload storage falhou', { wamid: msg.id, upErr })
        midiaPath = null
      }
    } else {
      console.error('[wa-webhook] download de mídia falhou', { wamid: msg.id, erro: download.erro })
    }
  }

  const criadoEm = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString()

  const { error: insErr } = await supabaseAdmin.from('wa_mensagens').upsert(
    {
      conversa_id: conversaId,
      wamid: msg.id,
      direcao: 'entrada',
      tipo,
      corpo,
      midia_path: midiaPath,
      midia_mime: midiaMime,
      midia_nome: midiaNome,
      status: 'recebido',
      payload: msg as unknown as Record<string, unknown>,
      criado_em: criadoEm,
    },
    { onConflict: 'wamid', ignoreDuplicates: true }
  )
  if (insErr) {
    console.error('[wa-webhook] insert mensagem falhou', { wamid: msg.id, insErr })
    return
  }

  // Atualiza a conversa (preview, janela 24h, contador de não lidas)
  const { data: conv } = await supabaseAdmin.from('wa_conversas').select('nao_lidas').eq('id', conversaId).single()
  await supabaseAdmin
    .from('wa_conversas')
    .update({
      preview: previewDe(tipo, corpo, midia?.filename),
      ultima_mensagem_em: criadoEm,
      ultima_msg_contato_em: criadoEm,
      nao_lidas: (conv?.nao_lidas ?? 0) + 1,
      arquivada: false,
    })
    .eq('id', conversaId)
}

async function processarStatus(st: MetaStatus): Promise<void> {
  const mapa: Record<MetaStatus['status'], string> = {
    sent: 'enviado',
    delivered: 'entregue',
    read: 'lido',
    failed: 'falhou',
  }
  const novo = mapa[st.status]
  if (!novo) return

  // Não regride status (ex: 'read' chega antes de 'delivered' atrasado)
  const ordem = ['enviando', 'enviado', 'entregue', 'lido']
  const { data: atual } = await supabaseAdmin.from('wa_mensagens').select('id, status').eq('wamid', st.id).maybeSingle()
  if (!atual) return
  if (novo !== 'falhou' && ordem.indexOf(novo) <= ordem.indexOf(atual.status)) return

  const erro = st.status === 'failed' ? st.errors?.[0]?.message || st.errors?.[0]?.title || 'Falha no envio' : null
  await supabaseAdmin.from('wa_mensagens').update({ status: novo, erro }).eq('id', atual.id)
}

// ---------------------------------------------------------------------------
// POST — eventos
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text()

  if (!assinaturaValida(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  try {
    const payload = JSON.parse(raw)
    if (payload?.object !== 'whatsapp_business_account') {
      return NextResponse.json({ ok: true })
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue
        const valor: MetaChangeValue = change.value ?? {}

        for (const msg of valor.messages ?? []) {
          await processarMensagem(msg, valor)
        }
        for (const st of valor.statuses ?? []) {
          await processarStatus(st)
        }
      }
    }
  } catch (err) {
    console.error('[wa-webhook] erro ao processar payload', { err })
  }

  return NextResponse.json({ ok: true })
}
