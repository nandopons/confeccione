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
  // O navegador devolve a URL de exibição que nós mesmos geramos; ela vira
  // referência de novo antes de encostar no banco.
  const deVolta = urlParaRef(valor, pedidoId)
  if (deVolta) return deVolta
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

// ============================================================================
// EXIBIÇÃO NO NAVEGADOR — 31/08/2026
//
// O `storage:` acima é ótimo pro banco e péssimo pro <img src>: o navegador
// não sabe resolver esse esquema. O visualizador do cliente põe a string do
// mockup direto no src, então logo depois da migração as fotos apareceram
// quebradas na tela — o dado estava certo, a apresentação é que não era.
//
// A tradução acontece na saída (servidor → navegador) e o caminho de volta
// (navegador → servidor) desfaz. O banco nunca vê uma URL de exibição:
// `guardarImagem` reconhece a nossa e converte de volta pra referência antes
// de gravar. Sem isso, o cliente devolveria a URL no próximo save e a linha
// ficaria apontando pra um endereço em vez do arquivo.
// ============================================================================

/** Só o nome do arquivo é aceito na URL — sem barra, sem "..", sem subir pasta. */
const NOME_ARQUIVO = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/

export function refParaUrl(valor: string, pedidoId: string): string {
  if (!ehRefStorage(valor)) return valor
  const arquivo = valor.slice(PREFIXO.length).split('/').pop() ?? ''
  if (!NOME_ARQUIVO.test(arquivo)) return valor
  return `/api/pedido/assistente/${pedidoId}/arquivo?f=${arquivo}`
}

/** Caminho de volta: desfaz refParaUrl. Devolve null se não for uma URL nossa. */
export function urlParaRef(valor: string, pedidoId: string): string | null {
  const esperado = `/api/pedido/assistente/${pedidoId}/arquivo?f=`
  if (typeof valor !== 'string' || !valor.startsWith(esperado)) return null
  const arquivo = valor.slice(esperado.length)
  return NOME_ARQUIVO.test(arquivo) ? `${PREFIXO}pedidos/${pedidoId}/${arquivo}` : null
}

/** Monta o caminho no bucket a partir do nome de arquivo validado. */
export function caminhoDoArquivo(pedidoId: string, arquivo: string): string | null {
  return NOME_ARQUIVO.test(arquivo) ? `pedidos/${pedidoId}/${arquivo}` : null
}

type MapaVisual = Record<string, { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] }>

/** Traduz o mapa inteiro de mockups pra exibição. Data URIs legados passam batido. */
export function mockupsParaExibicao<T extends MapaVisual | null | undefined>(mapa: T, pedidoId: string): T {
  if (!mapa || typeof mapa !== 'object') return mapa
  const saida: MapaVisual = {}
  for (const [k, v] of Object.entries(mapa as MapaVisual)) {
    const novo = { ...v }
    if (typeof v?.liso === 'string') novo.liso = refParaUrl(v.liso, pedidoId)
    if (typeof v?.arte === 'string') novo.arte = refParaUrl(v.arte, pedidoId)
    if (Array.isArray(v?.fotos)) novo.fotos = v.fotos.map((f) => (typeof f === 'string' ? refParaUrl(f, pedidoId) : f))
    if (Array.isArray(v?.ia)) novo.ia = v.ia.map((it) => (typeof it?.url === 'string' ? { ...it, url: refParaUrl(it.url, pedidoId) } : it))
    saida[k] = novo
  }
  return saida as T
}
