// app/lib/portfolio-fornecedor.ts
// ============================================================================
// Portfólio/vitrine do fornecedor. Bucket PÚBLICO 'portfolio-fornecedores'
// (showcase — URL pública direta). A tabela portfolio_fornecedores guarda só o
// `path`; a URL pública é derivada aqui.
// ============================================================================

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  comporSobreFundo,
  enquadramentoValido,
  normalizarFotoPortfolio,
  type Enquadramento,
} from '@/app/lib/portfolio-normalizar'
import { removerFundo } from '@/app/lib/remover-fundo'

export const BUCKET_PORTFOLIO = 'portfolio-fornecedores'
export const MAX_PORTFOLIO_BYTES = 10 * 1024 * 1024 // 10 MiB por foto (antes de normalizar)
/** Teto por fornecedor. Vitrine é seleção, não álbum: 12 já enche a página. */
export const MAX_FOTOS_POR_FORNECEDOR = 12

export type PortfolioItem = {
  id: string
  url: string
  legenda: string | null
  ordem: number
  destaque: boolean
  largura: number | null
  altura: number | null
  /** true quando a foto já passou pelo recorte de fundo (dá pra desfazer). */
  fundoRemovido: boolean
  /** De onde o corte 4:5 partiu. */
  enquadramento: Enquadramento
  /** false nas fotos antigas, que subiram antes de o upload cru ser guardado. */
  podeReenquadrar: boolean
}

const CAMPOS =
  'id, path, legenda, ordem, destaque, largura, altura, path_original, path_upload, enquadramento'

type LinhaPortfolio = {
  id: string
  path: string
  legenda: string | null
  ordem: number | null
  destaque: boolean | null
  largura: number | null
  altura: number | null
  path_original?: string | null
  path_upload?: string | null
  enquadramento?: string | null
}

function paraItem(r: LinhaPortfolio): PortfolioItem {
  return {
    id: r.id,
    url: urlPublica(r.path),
    legenda: r.legenda ?? null,
    ordem: r.ordem ?? 0,
    destaque: r.destaque ?? false,
    largura: r.largura,
    altura: r.altura,
    fundoRemovido: Boolean(r.path_original),
    enquadramento: enquadramentoValido(r.enquadramento),
    // Sem recorte de fundo pendurado: o reenquadramento parte do upload cru e
    // desfaria o recorte sem avisar. Melhor exigir "voltar foto original".
    podeReenquadrar: Boolean(r.path_upload) && !r.path_original,
  }
}

/** Extensão a partir do mime do upload; só pra dar nome ao objeto no bucket. */
function extensaoDoMime(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('heic') || mime.includes('heif')) return 'heic'
  return 'jpg'
}

function urlPublica(path: string): string {
  return supabaseAdmin.storage.from(BUCKET_PORTFOLIO).getPublicUrl(path).data.publicUrl
}

/** Lista o portfólio do fornecedor, já com URL pública de cada foto. */
export async function getPortfolio(fornecedorId: string): Promise<PortfolioItem[]> {
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select(CAMPOS)
    .eq('fornecedor_id', fornecedorId)
    .order('ordem', { ascending: true })

  return (data ?? []).map((r) => paraItem(r as LinhaPortfolio))
}

/**
 * Sobe uma foto pro bucket público e cria a linha do portfólio.
 *
 * A imagem é NORMALIZADA antes de subir (1080x1350, JPEG) — o fornecedor manda
 * do jeito que tem e a vitrine sai uniforme. O nome original do arquivo é
 * descartado de propósito: além de não servir pra nada, nomes de foto de
 * celular às vezes carregam dado do aparelho.
 */
export async function uploadPortfolio(
  fornecedorId: string,
  file: File,
  legenda?: string | null,
): Promise<PortfolioItem> {
  const { count } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id', { count: 'exact', head: true })
    .eq('fornecedor_id', fornecedorId)

  const total = count ?? 0
  if (total >= MAX_FOTOS_POR_FORNECEDOR) {
    throw new Error(`limite de ${MAX_FOTOS_POR_FORNECEDOR} fotos atingido — apague alguma antes`)
  }

  const original = Buffer.from(await file.arrayBuffer())
  let normalizada
  try {
    normalizada = await normalizarFotoPortfolio(original)
  } catch {
    throw new Error('não consegui ler essa imagem — tente outra foto (JPG ou PNG)')
  }

  const path = `${fornecedorId}/${randomUUID()}.${normalizada.extensao}`
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .upload(path, normalizada.buffer, { contentType: normalizada.mime, upsert: false })
  if (upErr) throw upErr

  // A foto crua fica guardada num prefixo separado: é dela que sai qualquer
  // reenquadramento posterior. Cortar de novo o 1080x1350 já cortado não
  // devolveria o que foi descartado no primeiro corte.
  const mimeUpload = file.type || 'image/jpeg'
  const pathUpload = `${fornecedorId}/upload/${randomUUID()}.${extensaoDoMime(mimeUpload)}`
  const { error: errUpload } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .upload(pathUpload, original, { contentType: mimeUpload, upsert: false })
  // Falhar aqui não invalida o upload: a foto já está publicada, só perde a
  // opção de reenquadrar. Silenciar é melhor do que recusar a foto inteira.
  if (errUpload) console.error('[portfolio] não guardei o upload cru:', errUpload)

  const { data, error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .insert({
      fornecedor_id: fornecedorId,
      path,
      path_upload: errUpload ? null : pathUpload,
      enquadramento: 'topo',
      ordem: total,
      legenda: legenda?.trim() || null,
      largura: normalizada.largura,
      altura: normalizada.altura,
    })
    .select(CAMPOS)
    .single()

  if (error || !data) {
    await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([path]).catch(() => {})
    throw error ?? new Error('falha ao salvar a foto')
  }

  return paraItem(data as LinhaPortfolio)
}

/** Remove uma foto do portfólio (linha + objeto no bucket). False se não for dona. */
export async function removerPortfolio(fornecedorId: string, itemId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id, path, path_original, path_upload')
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle<{ id: string; path: string; path_original: string | null; path_upload: string | null }>()
  if (!data) return false

  // Apaga TODAS as versões: publicada, pré-recorte e upload cru. Deixar o cru
  // pra trás encheria o bucket com foto que ninguém mais consegue ver.
  const paths = [data.path, data.path_original, data.path_upload].filter(Boolean) as string[]
  await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove(paths).catch(() => {})
  await supabaseAdmin.from('portfolio_fornecedores').delete().eq('id', itemId).eq('fornecedor_id', fornecedorId)
  return true
}

// ─────────────────────── Curadoria (admin) ───────────────────────
// A home é curada: a foto do fornecedor nasce com destaque=false e só entra no
// carrossel quando o admin promove. Ver app/admin/(painel)/vitrine.

export type ItemCuradoria = PortfolioItem & {
  fornecedorId: string
  fornecedorNome: string | null
  fornecedorCidade: string | null
  fornecedorUf: string | null
  criadoEm: string
}

type LinhaCuradoria = LinhaPortfolio & {
  fornecedor_id: string
  criado_em: string
  leads_fornecedores: { nome: string | null; cidade: string | null; estado: string | null } | null
}

/** Fila do admin: `apenas` filtra por estado de curadoria. */
export async function listarParaCuradoria(
  apenas: 'todas' | 'destaque' | 'sem-destaque' = 'todas',
  limite = 120,
): Promise<ItemCuradoria[]> {
  let q = supabaseAdmin
    .from('portfolio_fornecedores')
    .select(`${CAMPOS}, fornecedor_id, criado_em, leads_fornecedores(nome, cidade, estado)`)
    .order('criado_em', { ascending: false })
    .limit(limite)

  if (apenas === 'destaque') q = q.eq('destaque', true)
  if (apenas === 'sem-destaque') q = q.eq('destaque', false)

  const { data } = await q
  return ((data ?? []) as unknown as LinhaCuradoria[]).map((r) => ({
    ...paraItem(r),
    fornecedorId: r.fornecedor_id,
    fornecedorNome: r.leads_fornecedores?.nome ?? null,
    fornecedorCidade: r.leads_fornecedores?.cidade ?? null,
    fornecedorUf: r.leads_fornecedores?.estado ?? null,
    criadoEm: r.criado_em,
  }))
}

/** Promove/tira uma foto do carrossel da home. */
export async function definirDestaque(itemId: string, destaque: boolean): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .update({ destaque, destaque_em: destaque ? new Date().toISOString() : null })
    .eq('id', itemId)
  return !error
}

// ─────────────────────── Vitrine pública (home) ───────────────────────

export type ItemVitrine = {
  id: string
  url: string
  legenda: string | null
  fornecedorNome: string | null
  fornecedorCidade: string | null
  fornecedorUf: string | null
  largura: number
  altura: number
}

/**
 * Fotos do carrossel da home. Só destaques, e só de fornecedor aprovado — se o
 * cadastro for recusado depois da foto entrar em destaque, ela sai da home
 * sozinha, sem precisar de faxina manual.
 */
export async function getVitrineHome(limite = 12): Promise<ItemVitrine[]> {
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select(`${CAMPOS}, criado_em, leads_fornecedores!inner(nome, cidade, estado, aprovacao_status)`)
    .eq('destaque', true)
    .eq('leads_fornecedores.aprovacao_status', 'aprovado')
    .order('destaque_em', { ascending: false })
    .limit(limite)

  type LinhaVitrine = LinhaPortfolio & {
    leads_fornecedores: {
      nome: string | null
      cidade: string | null
      estado: string | null
    } | null
  }

  return ((data ?? []) as unknown as LinhaVitrine[]).map((r) => ({
    id: r.id,
    url: urlPublica(r.path),
    legenda: r.legenda ?? null,
    fornecedorNome: r.leads_fornecedores?.nome ?? null,
    fornecedorCidade: r.leads_fornecedores?.cidade ?? null,
    fornecedorUf: r.leads_fornecedores?.estado ?? null,
    largura: r.largura ?? 1080,
    altura: r.altura ?? 1350,
  }))
}

// ─────────────────────── Reenquadramento ───────────────────────

/**
 * Recorta a foto de novo, a partir do upload cru, com outra âncora.
 *
 * Só funciona em foto que tem `path_upload` — as que subiram antes de 04/09/2026
 * não guardaram o cru e precisam de novo upload. O caminho publicado é sempre um
 * objeto NOVO: sobrescrever o path atual manteria a versão antiga no cache do
 * CDN e do next/image, e o fornecedor veria "não mudou nada".
 */
export async function reenquadrar(
  fornecedorId: string,
  itemId: string,
  posicao: Enquadramento,
): Promise<{ ok: true; item: PortfolioItem } | { ok: false; motivo: string }> {
  const { data: linha } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id, path, path_original, path_upload')
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle<{ id: string; path: string; path_original: string | null; path_upload: string | null }>()
  if (!linha) return { ok: false, motivo: 'foto não encontrada' }
  if (linha.path_original) {
    return { ok: false, motivo: 'volte a foto original antes de mudar o enquadramento' }
  }
  if (!linha.path_upload) {
    return { ok: false, motivo: 'essa foto é anterior ao reenquadramento — envie ela de novo' }
  }

  const { data: baixado, error: errDown } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .download(linha.path_upload)
  if (errDown || !baixado) return { ok: false, motivo: 'não consegui ler a foto enviada' }

  let normalizada
  try {
    normalizada = await normalizarFotoPortfolio(Buffer.from(await baixado.arrayBuffer()), posicao)
  } catch {
    return { ok: false, motivo: 'não consegui reprocessar essa foto' }
  }

  const novoPath = `${fornecedorId}/${randomUUID()}.${normalizada.extensao}`
  const { error: errUp } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .upload(novoPath, normalizada.buffer, { contentType: normalizada.mime, upsert: false })
  if (errUp) return { ok: false, motivo: 'não consegui salvar a foto nova' }

  const { data, error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .update({
      path: novoPath,
      enquadramento: posicao,
      largura: normalizada.largura,
      altura: normalizada.altura,
    })
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .select(CAMPOS)
    .single()

  if (error || !data) {
    await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([novoPath]).catch(() => {})
    return { ok: false, motivo: 'não consegui atualizar a foto' }
  }

  await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([linha.path]).catch(() => {})
  return { ok: true, item: paraItem(data as LinhaPortfolio) }
}

// ─────────────────── Recorte de fundo (opt-in do fornecedor) ───────────────────

/**
 * Recorta o fundo da foto e recompõe sobre o cinza da vitrine.
 *
 * A foto original é PRESERVADA em `path_original` — o recorte falha justamente
 * nas fotos de detalhe, onde a peça sangra pra fora do quadro, e sem o original
 * o fornecedor ficaria preso a um resultado ruim.
 */
export async function aplicarFundoPadrao(
  fornecedorId: string,
  itemId: string,
): Promise<{ ok: true; item: PortfolioItem } | { ok: false; motivo: string }> {
  const { data: linha } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id, path, path_original')
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle<{ id: string; path: string; path_original: string | null }>()
  if (!linha) return { ok: false, motivo: 'foto não encontrada' }

  // Sempre parte da foto ORIGINAL, nunca de um recorte anterior: reaplicar sobre
  // uma imagem já achatada no cinza degrada o recorte a cada rodada. Assim,
  // clicar de novo simplesmente refaz — não precisa desfazer antes.
  const base = linha.path_original ?? linha.path
  const { data: baixado, error: errDown } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .download(base)
  if (errDown || !baixado) return { ok: false, motivo: 'não consegui ler a foto' }

  const entrada = Buffer.from(await baixado.arrayBuffer())
  const recorte = await removerFundo(entrada, 'image/jpeg')
  if (!recorte.ok) return { ok: false, motivo: recorte.motivo }

  let composta
  try {
    composta = await comporSobreFundo(recorte.png)
  } catch {
    return { ok: false, motivo: 'não consegui montar a foto no fundo padrão' }
  }

  const novoPath = `${fornecedorId}/${randomUUID()}.${composta.extensao}`
  const { error: errUp } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .upload(novoPath, composta.buffer, { contentType: composta.mime, upsert: false })
  if (errUp) return { ok: false, motivo: 'não consegui salvar a foto nova' }

  // Só grava path_original na PRIMEIRA vez: se o fornecedor recortar duas vezes,
  // o original continua sendo a foto que ele mandou, não o recorte anterior.
  const original = linha.path_original ?? linha.path
  const { data, error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .update({
      path: novoPath,
      path_original: original,
      fundo_removido_em: new Date().toISOString(),
      largura: composta.largura,
      altura: composta.altura,
    })
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .select(CAMPOS)
    .single()

  if (error || !data) {
    await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([novoPath]).catch(() => {})
    return { ok: false, motivo: 'não consegui atualizar a foto' }
  }

  // O recorte antigo (se houve um) vira lixo; o original nunca é apagado.
  if (linha.path !== original) {
    await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([linha.path]).catch(() => {})
  }

  return { ok: true, item: paraItem(data as LinhaPortfolio) }
}

/** Desfaz o recorte: volta a foto como o fornecedor mandou. */
export async function desfazerFundoPadrao(
  fornecedorId: string,
  itemId: string,
): Promise<{ ok: true; item: PortfolioItem } | { ok: false; motivo: string }> {
  const { data: linha } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id, path, path_original')
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle<{ id: string; path: string; path_original: string | null }>()
  if (!linha?.path_original) return { ok: false, motivo: 'essa foto não tem versão original' }

  const recortado = linha.path
  const { data, error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .update({ path: linha.path_original, path_original: null, fundo_removido_em: null })
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .select(CAMPOS)
    .single()

  if (error || !data) return { ok: false, motivo: 'não consegui desfazer' }

  if (recortado !== linha.path_original) {
    await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([recortado]).catch(() => {})
  }
  return { ok: true, item: paraItem(data as LinhaPortfolio) }
}
