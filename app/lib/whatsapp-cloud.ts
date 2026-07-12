// app/lib/whatsapp-cloud.ts
// ============================================================================
// Cliente da WhatsApp Cloud API oficial (Meta Graph API).
//
// Substitui gradualmente o Z-API (app/lib/zapi.ts). Cobrança direta na Meta,
// sem BSP intermediário.
//
// Env vars (Vercel + .env.local):
//   WHATSAPP_TOKEN            → token permanente do System User (ou temporário em dev)
//   WHATSAPP_PHONE_NUMBER_ID  → ID do número na Cloud API (não é o telefone)
//   WHATSAPP_WABA_ID          → ID da WABA (necessário só pra listar templates)
//   WHATSAPP_GRAPH_VERSION    → opcional, default v23.0
//
// Convenções:
// - Números no formato wa_id da Meta: só dígitos, com DDI, sem '+'
//   (ex: 5581982659521). Ver normalizarWaId().
// - Failure-soft: funções logam e retornam { ok: false } — nunca lançam.
// - Sempre await antes de retornar (regra Vercel serverless).
// ============================================================================

import { visualizadorPedidoUrl } from './url'

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'

function credenciais() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    wabaId: process.env.WHATSAPP_WABA_ID,
  }
}

function urlGraph(path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${path}`
}

/** Normaliza telefone pro formato wa_id da Meta: só dígitos, com DDI 55. */
export function normalizarWaId(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '')
  if (digitos.length <= 11 && !digitos.startsWith('55')) return `55${digitos}`
  return digitos
}

export type EnvioResultado = { ok: true; wamid: string } | { ok: false; erro: string }

export type MidiaTipo = 'image' | 'audio' | 'video' | 'document' | 'sticker'

async function postMessages(body: Record<string, unknown>): Promise<EnvioResultado> {
  const { token, phoneId } = credenciais()
  if (!token || !phoneId) {
    console.error('[wa-cloud] WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID ausentes')
    return { ok: false, erro: 'Credenciais da Cloud API não configuradas' }
  }
  try {
    const res = await fetch(urlGraph(`${phoneId}/messages`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...body,
      }),
    })
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      const erro: string = data?.error?.message || `HTTP ${res.status}`
      console.error('[wa-cloud] envio falhou', { tipo: body.type, status: res.status, erro })
      return { ok: false, erro }
    }

    const wamid: string | undefined = data?.messages?.[0]?.id
    if (!wamid) {
      console.error('[wa-cloud] resposta sem wamid', { data })
      return { ok: false, erro: 'Resposta da Meta sem id de mensagem' }
    }
    return { ok: true, wamid }
  } catch (err) {
    console.error('[wa-cloud] envio exception', { tipo: body.type, err })
    return { ok: false, erro: 'Falha de rede ao chamar a Meta' }
  }
}

/** Mensagem de texto livre (só funciona dentro da janela de 24h). */
export async function enviarTexto(waId: string, texto: string): Promise<EnvioResultado> {
  return await postMessages({
    to: waId,
    type: 'text',
    text: { body: texto, preview_url: true },
  })
}

export type BotaoResposta = { id: string; titulo: string }

/**
 * Mensagem interativa com botões de resposta rápida (máx. 3 — limite da Meta).
 * Só funciona dentro da janela de 24h. O clique do cliente volta pelo webhook
 * como mensagem `interactive.button_reply` (título vira o corpo).
 */
export async function enviarBotoes(
  waId: string,
  corpo: string,
  botoes: BotaoResposta[]
): Promise<EnvioResultado> {
  const buttons = botoes.slice(0, 3).map((b) => ({
    type: 'reply' as const,
    // Limites da Meta: id ≤ 256 chars, title ≤ 20 chars.
    reply: { id: b.id.slice(0, 256), title: b.titulo.slice(0, 20) },
  }))
  if (buttons.length === 0) return { ok: false, erro: 'Nenhum botão informado' }
  return await postMessages({
    to: waId,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: corpo.slice(0, 1024) },
      action: { buttons },
    },
  })
}

/**
 * Mensagem interativa com botão de LINK (CTA URL) — abre o site ao tocar.
 * Só funciona dentro da janela de 24h. display_text ≤ 20 chars.
 */
export async function enviarBotaoUrl(
  waId: string,
  corpo: string,
  textoBotao: string,
  url: string
): Promise<EnvioResultado> {
  return await postMessages({
    to: waId,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: corpo.slice(0, 1024) },
      action: {
        name: 'cta_url',
        parameters: { display_text: textoBotao.slice(0, 20), url },
      },
    },
  })
}

/** Mídia já upada na Meta (via uploadMidia) — imagem, áudio, vídeo, documento. */
export async function enviarMidiaPorId(
  waId: string,
  tipo: MidiaTipo,
  mediaId: string,
  opts?: { caption?: string; filename?: string }
): Promise<EnvioResultado> {
  const objeto: Record<string, unknown> = { id: mediaId }
  if (opts?.caption && (tipo === 'image' || tipo === 'video' || tipo === 'document')) {
    objeto.caption = opts.caption
  }
  if (opts?.filename && tipo === 'document') objeto.filename = opts.filename
  return await postMessages({ to: waId, type: tipo, [tipo]: objeto })
}

/** Template aprovado (obrigatório fora da janela de 24h). */
export async function enviarTemplate(
  waId: string,
  nome: string,
  idioma: string = 'pt_BR',
  components?: unknown[]
): Promise<EnvioResultado> {
  const template: Record<string, unknown> = {
    name: nome,
    language: { code: idioma },
  }
  if (components && components.length > 0) template.components = components
  return await postMessages({ to: waId, type: 'template', template })
}

// ─────────────────────────────────────────────────────────────
// Retomada de pedido (marketing oficial)
// Template retomar_pedido_v3: corpo com {{1}} = primeiro nome e botão
// "Continuar meu pedido" com URL dinâmica visualizador/{{1}} — cada
// cliente cai direto no PRÓPRIO pedido. Criado pela rota one-shot
// /api/admin/whatsapp/criar-templates-retomada.
// ─────────────────────────────────────────────────────────────

export const TEMPLATE_RETOMADA_PEDIDO = 'retomar_pedido_v3'

/** Sufixo que a Meta cola na URL base do botão (id do pedido + UTMs). */
export function sufixoVisualizadorPedido(pedidoId: string): string {
  return `${pedidoId}?utm_source=whatsapp&utm_medium=template&utm_campaign=retomar_pedido`
}

/** Corpo renderizado do template — pro histórico (contatos_marketing/inbox). */
export function corpoRetomadaPedido(nome: string | null, pedidoId: string): string {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0] || 'cliente'
  return (
    `Oi, ${primeiro}! 👋 Vi que você começou um pedido aqui na Confeccione e ele ficou salvo no meio do caminho. ` +
    `Toca no botão pra abrir o seu pedido e continuar de onde parou — leva menos de 2 minutos. 🧵\n` +
    `▸ Continuar meu pedido → ${visualizadorPedidoUrl(pedidoId)}`
  )
}

/**
 * Envia a retomada de pedido pelo número OFICIAL (Meta), fora da janela de
 * 24h — é template de marketing pago (~R$0,31/msg). Botão de URL dinâmica
 * fica no índice 0 do template (ver criar-templates-retomada).
 */
export async function enviarTemplateRetomadaPedido(
  telefone: string,
  nome: string | null,
  pedidoId: string
): Promise<EnvioResultado> {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0] || 'cliente'
  return await enviarTemplate(normalizarWaId(telefone), TEMPLATE_RETOMADA_PEDIDO, 'pt_BR', [
    { type: 'body', parameters: [{ type: 'text', text: primeiro }] },
    {
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: sufixoVisualizadorPedido(pedidoId) }],
    },
  ])
}

/** Marca mensagem recebida como lida (✓✓ azul pro cliente). Fire-safe. */
export async function marcarComoLida(wamid: string): Promise<boolean> {
  const { token, phoneId } = credenciais()
  if (!token || !phoneId) return false
  try {
    const res = await fetch(urlGraph(`${phoneId}/messages`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: wamid,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Sobe um arquivo pra Meta e retorna o media id (pra depois enviarMidiaPorId). */
export async function uploadMidia(
  buffer: ArrayBuffer,
  mime: string,
  filename: string
): Promise<{ ok: true; mediaId: string } | { ok: false; erro: string }> {
  const { token, phoneId } = credenciais()
  if (!token || !phoneId) return { ok: false, erro: 'Credenciais da Cloud API não configuradas' }
  try {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('file', new Blob([buffer], { type: mime }), filename)

    const res = await fetch(urlGraph(`${phoneId}/media`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.id) {
      const erro: string = data?.error?.message || `HTTP ${res.status}`
      console.error('[wa-cloud] uploadMidia falhou', { mime, erro })
      return { ok: false, erro }
    }
    return { ok: true, mediaId: data.id }
  } catch (err) {
    console.error('[wa-cloud] uploadMidia exception', { err })
    return { ok: false, erro: 'Falha de rede no upload de mídia' }
  }
}

/** Baixa mídia recebida: resolve a URL efêmera e busca o binário com o token. */
export async function baixarMidia(
  mediaId: string
): Promise<{ ok: true; buffer: ArrayBuffer; mime: string } | { ok: false; erro: string }> {
  const { token } = credenciais()
  if (!token) return { ok: false, erro: 'WHATSAPP_TOKEN ausente' }
  try {
    const metaRes = await fetch(urlGraph(mediaId), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const meta = await metaRes.json().catch(() => null)
    if (!metaRes.ok || !meta?.url) {
      return { ok: false, erro: meta?.error?.message || `HTTP ${metaRes.status} ao resolver mídia` }
    }
    const binRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!binRes.ok) return { ok: false, erro: `HTTP ${binRes.status} ao baixar mídia` }
    const buffer = await binRes.arrayBuffer()
    return { ok: true, buffer, mime: meta.mime_type || 'application/octet-stream' }
  } catch (err) {
    console.error('[wa-cloud] baixarMidia exception', { mediaId, err })
    return { ok: false, erro: 'Falha de rede ao baixar mídia' }
  }
}

export type TemplateAprovado = {
  name: string
  language: string
  category: string
  bodyPreview: string
  /** Maior índice {{n}} no corpo (0 = sem variáveis). */
  bodyVars: number
  /** Botão de URL com sufixo dinâmico {{1}} (ex.: visualizador/{{1}}) — índice do botão + URL base. */
  urlDinamica: { index: number; base: string } | null
}

/** Maior índice de variável {{n}} num texto de template. */
function contarVariaveis(texto: string): number {
  let max = 0
  for (const m of texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]))
  return max
}

/** Lista templates APROVADOS da WABA (pra UI oferecer fora da janela de 24h). */
export async function listarTemplates(): Promise<TemplateAprovado[]> {
  const { token, wabaId } = credenciais()
  if (!token || !wabaId) return []
  try {
    const res = await fetch(
      urlGraph(`${wabaId}/message_templates?status=APPROVED&limit=100&fields=name,language,category,components`),
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const data = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(data?.data)) return []
    type BotaoRaw = { type?: string; text?: string; url?: string }
    type ComponenteRaw = { type?: string; text?: string; buttons?: BotaoRaw[] }
    type TemplateRaw = { name: string; language: string; category: string; components?: ComponenteRaw[] }
    return (data.data as TemplateRaw[]).map((t) => {
      const corpo = t.components?.find((c) => c.type === 'BODY')?.text || ''
      const botoes = t.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []
      const iUrl = botoes.findIndex((b) => b.type === 'URL' && /\{\{\s*1\s*\}\}/.test(b.url ?? ''))
      return {
        name: t.name,
        language: t.language,
        category: t.category,
        bodyPreview: corpo,
        bodyVars: contarVariaveis(corpo),
        urlDinamica: iUrl >= 0 ? { index: iUrl, base: botoes[iUrl].url ?? '' } : null,
      }
    })
  } catch (err) {
    console.error('[wa-cloud] listarTemplates exception', { err })
    return []
  }
}
