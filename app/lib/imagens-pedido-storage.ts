// app/lib/imagens-pedido-storage.ts
// ============================================================================
// As imagens do pedido saem do banco e vão pro Storage — 31/08/2026.
//
// POR QUE ISTO EXISTE
// `mockups` e `imagens` guardavam a foto inteira como data URI dentro do JSONB.
// Com 178 pedidos isso virou 107 MB de base64 no TOAST de `pedidos_assistente`
// — 80% do banco, num total de 157 MB. Cada leitura de pedido puxava centenas
// de kB do disco e cada gravação reescrevia o bloco. O orçamento de Disk IO do
// Supabase acabou e o Postgres passou a cancelar consultas por timeout (17 na
// madrugada de 31/08, com um checkpoint levando 32 segundos).
//
// O tráfego era baixo — ~1.300 requisições em 24h. Não era volume de acesso,
// era peso por acesso. E piorava sozinho: 178 pedidos já derrubavam a
// instância, 1.000 seriam ~600 MB.
//
// Daqui pra frente a foto vai pro bucket privado 'artes-clientes' e o banco
// guarda só uma referência curta: `storage:pedidos/<id>/<sha>.<ext>`.
//
// COMPATIBILIDADE — não existe big-bang aqui
// Os data URIs já gravados continuam funcionando: quem lê passa por
// `lerImagem`, que entende os dois formatos. Pedido antigo abre igual; pedido
// novo já nasce leve. A migração das 178 linhas existentes é um passo
// separado, e o site não depende dela pra parar de crescer.
// ============================================================================

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { BUCKET_ARTES } from '@/app/lib/arquivos-cliente'

const PREFIXO = 'storage:'

const EXT_POR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

export function ehDataUrl(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('data:')
}

export function ehRefStorage(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(PREFIXO)
}

function partesDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  try {
    const bytes = Buffer.from(m[2], 'base64')
    return bytes.length > 0 ? { mime: m[1], bytes } : null
  } catch {
    return null
  }
}

/**
 * Sobe um data URI pro bucket e devolve a referência curta.
 *
 * Idempotente de propósito: qualquer outra coisa (referência já migrada, URL
 * http, string vazia) volta intacta. As rotas de mockup reescrevem o mapa
 * INTEIRO a cada alteração, então esta função roda de novo sobre valores que
 * já foram migrados — e precisa deixá-los quietos.
 *
 * O nome do arquivo é o hash do conteúdo: reenviar a mesma foto não cria
 * arquivo novo, e o `upsert` torna o reprocessamento inofensivo.
 *
 * Falha de upload NÃO derruba o pedido — devolve o data URI original e segue.
 * Um pedido pesado salvo é melhor que um pedido perdido.
 */
export async function guardarImagem(valor: string, pedidoId: string): Promise<string> {
  if (!ehDataUrl(valor)) return valor
  const p = partesDataUrl(valor)
  if (!p) return valor

  const sha = createHash('sha256').update(p.bytes).digest('hex').slice(0, 32)
  const ext = EXT_POR_MIME[p.mime.toLowerCase()] ?? 'bin'
  const caminho = `pedidos/${pedidoId}/${sha}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_ARTES)
    .upload(caminho, p.bytes, { contentType: p.mime, upsert: true })

  if (error) {
    console.error('[imagens-pedido-storage] upload falhou, mantendo data URI:', error.message)
    return valor
  }
  return `${PREFIXO}${caminho}`
}

export async function guardarImagens(lista: string[], pedidoId: string): Promise<string[]> {
  return Promise.all(lista.map((v) => guardarImagem(v, pedidoId)))
}

/**
 * Devolve os bytes de uma imagem, venha ela do banco (data URI legado) ou do
 * bucket (referência nova). É o ponto único onde os dois formatos convivem.
 */
export async function lerImagem(valor: string): Promise<{ bytes: Buffer; mime: string } | null> {
  if (ehDataUrl(valor)) {
    const p = partesDataUrl(valor)
    return p ? { bytes: p.bytes, mime: p.mime } : null
  }
  if (!ehRefStorage(valor)) return null

  const caminho = valor.slice(PREFIXO.length)
  const { data, error } = await supabaseAdmin.storage.from(BUCKET_ARTES).download(caminho)
  if (error || !data) {
    console.error('[imagens-pedido-storage] download falhou:', caminho, error?.message)
    return null
  }

  const bytes = Buffer.from(await data.arrayBuffer())
  const ext = caminho.split('.').pop()?.toLowerCase() ?? ''
  const mimePorExt = Object.entries(EXT_POR_MIME).find(([, e]) => e === ext)?.[0]
  return { bytes, mime: mimePorExt ?? data.type ?? 'application/octet-stream' }
}
