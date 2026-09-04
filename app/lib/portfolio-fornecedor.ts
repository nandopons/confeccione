// app/lib/portfolio-fornecedor.ts
// ============================================================================
// Portfólio/vitrine do fornecedor. Bucket PÚBLICO 'portfolio-fornecedores'
// (showcase — URL pública direta). A tabela portfolio_fornecedores guarda só o
// `path`; a URL pública é derivada aqui.
// ============================================================================

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { normalizarFotoPortfolio } from '@/app/lib/portfolio-normalizar'

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
}

const CAMPOS = 'id, path, legenda, ordem, destaque, largura, altura'

type LinhaPortfolio = {
  id: string
  path: string
  legenda: string | null
  ordem: number | null
  destaque: boolean | null
  largura: number | null
  altura: number | null
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
  }
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

  const { data, error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .insert({
      fornecedor_id: fornecedorId,
      path,
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
    .select('id, path')
    .eq('id', itemId)
    .eq('fornecedor_id', fornecedorId)
    .maybeSingle()
  if (!data) return false

  await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([data.path]).catch(() => {})
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
