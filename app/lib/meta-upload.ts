// app/lib/meta-upload.ts
// ============================================================================
// Upload "resumable" da Meta — o único jeito de dar EXEMPLO de imagem a um
// template com cabeçalho IMAGE (o `header_handle`). Não é o upload de mídia
// de mensagem (/media): é o da Graph API de apps, em três passos:
//   1. GET /app → id do app dono do token
//   2. POST /{app}/uploads?file_length&file_type → sessão "upload:XYZ"
//   3. POST /upload:XYZ com os bytes e Authorization: OAuth <token> → { h }
// Criado em 29/09/2026 pro template sondagem_foto_v1 (captação com foto).
// ============================================================================

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'
const GRAPH_BASE = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com'

export async function uploadHeaderHandle(bytes: Buffer, mime: string, nome = 'exemplo.jpg'): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) throw new Error('WHATSAPP_TOKEN ausente')

  const app = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/app?access_token=${encodeURIComponent(token)}`)
  const appJson = (await app.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null
  if (!app.ok || !appJson?.id) throw new Error(`não achei o app do token: ${appJson?.error?.message ?? `HTTP ${app.status}`}`)

  const sessao = await fetch(
    `${GRAPH_BASE}/${GRAPH_VERSION}/${appJson.id}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(mime)}&file_name=${encodeURIComponent(nome)}&access_token=${encodeURIComponent(token)}`,
    { method: 'POST' }
  )
  const sessaoJson = (await sessao.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null
  if (!sessao.ok || !sessaoJson?.id) throw new Error(`sessão de upload falhou: ${sessaoJson?.error?.message ?? `HTTP ${sessao.status}`}`)

  const up = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${sessaoJson.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': mime },
    body: new Uint8Array(bytes),
  })
  const upJson = (await up.json().catch(() => null)) as { h?: string; error?: { message?: string } } | null
  if (!up.ok || !upJson?.h) throw new Error(`upload falhou: ${upJson?.error?.message ?? `HTTP ${up.status}`}`)
  return upJson.h
}
