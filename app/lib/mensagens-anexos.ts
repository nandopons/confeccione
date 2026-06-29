// app/lib/mensagens-anexos.ts
// ============================================================================
// Helpers de anexo do chat do pedido (áudio / imagem / arquivo).
//
// Bucket PRIVADO 'mensagens-anexos'. A mídia só sai por URL assinada curta
// gerada aqui (service_role); os endpoints validam posse do pedido antes de
// assinar. A tabela mensagens_pedido guarda só `anexo_path` (caminho interno),
// nunca a URL assinada.
//
// Sem quota por conta (diferente de artes-clientes): único teto é MAX_ANEXO_BYTES
// por arquivo. Reusa sanitizeFilename/normalizarDisplayName de arquivos-cliente.
// ============================================================================

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { sanitizeFilename, normalizarDisplayName } from '@/app/lib/arquivos-cliente'

export const BUCKET_MENSAGENS = 'mensagens-anexos'
export const MAX_ANEXO_BYTES = 25 * 1024 * 1024 // 25 MiB por arquivo
const SIGNED_URL_TTL = 3600 // 1h — re-assinada a cada poll do app

export type MensagemTipo = 'texto' | 'audio' | 'imagem' | 'arquivo'

/** Linha crua de mensagens_pedido (com o caminho interno). */
export type MensagemRow = {
  id: string
  autor: 'cliente' | 'fornecedor'
  conteudo: string | null
  criado_em: string
  tipo: MensagemTipo
  anexo_path: string | null
  anexo_nome: string | null
  anexo_mime: string | null
  anexo_tamanho: number | null
  audio_duracao_ms: number | null
}

/** Mensagem como o app a recebe: sem anexo_path, com anexo_url assinada. */
export type MensagemPublica = Omit<MensagemRow, 'anexo_path'> & {
  anexo_url: string | null
}

/** Colunas a selecionar em todo GET/POST de mensagens. */
export const MENSAGEM_SELECT =
  'id, autor, conteudo, criado_em, tipo, anexo_path, anexo_nome, anexo_mime, anexo_tamanho, audio_duracao_ms'

/** Deriva o tipo de mídia a partir do MIME (áudio é sempre explícito). */
export function tipoPorMime(mime: string | null | undefined): 'imagem' | 'arquivo' {
  return mime && mime.startsWith('image/') ? 'imagem' : 'arquivo'
}

/**
 * Sobe o arquivo pro bucket privado num path determinístico
 * `${pedidoId}/${uuid}_${sanitized}`. Retorna os metadados pra persistir.
 * Lança em falha de storage (o caller trata como 500).
 */
export async function uploadAnexo(
  pedidoId: string,
  file: File,
): Promise<{ path: string; nome: string; mime: string | null; tamanho: number }> {
  const sanitized = sanitizeFilename(file.name || 'arquivo')
  const path = `${pedidoId}/${randomUUID()}_${sanitized}`
  const mime = file.type && file.type.length > 0 ? file.type : null
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_MENSAGENS)
    .upload(path, buffer, {
      contentType: mime ?? 'application/octet-stream',
      upsert: false,
    })
  if (error) throw error

  return {
    path,
    nome: normalizarDisplayName(file.name || 'arquivo'),
    mime,
    tamanho: file.size,
  }
}

/** Remove um objeto do bucket (rollback best-effort se o insert falhar). */
export async function removerAnexo(path: string): Promise<void> {
  await supabaseAdmin.storage.from(BUCKET_MENSAGENS).remove([path]).catch(() => {})
}

/** Gera URL assinada (TTL 1h) pro path. Null se não houver path ou falhar. */
export async function assinarAnexo(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_MENSAGENS)
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * Converte linhas cruas em mensagens públicas: tira anexo_path e injeta
 * anexo_url assinada. Assina em paralelo.
 */
export async function publicarMensagens(rows: MensagemRow[]): Promise<MensagemPublica[]> {
  return Promise.all(
    rows.map(async ({ anexo_path, ...m }) => ({
      ...m,
      anexo_url: await assinarAnexo(anexo_path),
    })),
  )
}

/**
 * Lê o multipart, sobe o arquivo, insere a mensagem de mídia e devolve a
 * Response já com `anexo_url` assinada. Compartilhado pelos endpoints de
 * cliente e fornecedor — só muda o `autor` e o `pedidoId` (a posse é validada
 * por quem chama, antes daqui).
 */
export async function enviarMidia(
  req: Request,
  pedidoId: string,
  autor: 'cliente' | 'fornecedor',
): Promise<Response> {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'payload inválido' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'Arquivo ausente' }, { status: 400 })
  }
  if (file.size > MAX_ANEXO_BYTES) {
    return Response.json({ error: 'Arquivo muito grande (máx. 25MB)' }, { status: 413 })
  }

  const tipoBruto = String(form.get('tipo') ?? '')
  const tipo: MensagemTipo = tipoBruto === 'audio' ? 'audio' : tipoPorMime(file.type)
  const conteudo = String(form.get('conteudo') ?? '').trim() || null
  const duracaoRaw = Number(form.get('duracao_ms'))
  const audioDuracaoMs =
    tipo === 'audio' && Number.isFinite(duracaoRaw) && duracaoRaw > 0
      ? Math.round(duracaoRaw)
      : null

  let anexo: { path: string; nome: string; mime: string | null; tamanho: number }
  try {
    anexo = await uploadAnexo(pedidoId, file)
  } catch (e) {
    console.error('[mensagens] upload storage falhou:', e)
    return Response.json({ error: 'Erro ao enviar anexo' }, { status: 500 })
  }

  const { data, error } = await supabaseAdmin
    .from('mensagens_pedido')
    .insert({
      pedido_id: pedidoId,
      autor,
      tipo,
      conteudo,
      anexo_path: anexo.path,
      anexo_nome: anexo.nome,
      anexo_mime: anexo.mime,
      anexo_tamanho: anexo.tamanho,
      audio_duracao_ms: audioDuracaoMs,
    })
    .select(MENSAGEM_SELECT)
    .single()

  if (error || !data) {
    await removerAnexo(anexo.path) // rollback best-effort
    console.error('[mensagens] insert falhou:', error)
    return Response.json({ error: 'Erro ao enviar anexo' }, { status: 500 })
  }

  const [msg] = await publicarMensagens([data as MensagemRow])
  return Response.json(msg, { status: 201 })
}
