// app/lib/portfolio-fornecedor.ts
// ============================================================================
// Portfólio/vitrine do fornecedor. Bucket PÚBLICO 'portfolio-fornecedores'
// (showcase — URL pública direta). A tabela portfolio_fornecedores guarda só o
// `path`; a URL pública é derivada aqui.
// ============================================================================

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { sanitizeFilename } from '@/app/lib/arquivos-cliente'

export const BUCKET_PORTFOLIO = 'portfolio-fornecedores'
export const MAX_PORTFOLIO_BYTES = 10 * 1024 * 1024 // 10 MiB por foto

export type PortfolioItem = {
  id: string
  url: string
  legenda: string | null
  ordem: number
}

/** Lista o portfólio do fornecedor, já com URL pública de cada foto. */
export async function getPortfolio(fornecedorId: string): Promise<PortfolioItem[]> {
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id, path, legenda, ordem')
    .eq('fornecedor_id', fornecedorId)
    .order('ordem', { ascending: true })

  return (data ?? []).map((r: { id: string; path: string; legenda: string | null; ordem: number }) => ({
    id: r.id,
    url: supabaseAdmin.storage.from(BUCKET_PORTFOLIO).getPublicUrl(r.path).data.publicUrl,
    legenda: r.legenda ?? null,
    ordem: r.ordem ?? 0,
  }))
}

function urlPublica(path: string): string {
  return supabaseAdmin.storage.from(BUCKET_PORTFOLIO).getPublicUrl(path).data.publicUrl
}

/** Sobe uma foto pro bucket público e cria a linha do portfólio. */
export async function uploadPortfolio(fornecedorId: string, file: File): Promise<PortfolioItem> {
  const path = `${fornecedorId}/${randomUUID()}_${sanitizeFilename(file.name || 'foto.jpg')}`
  const mime = file.type && file.type.length > 0 ? file.type : 'image/jpeg'
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET_PORTFOLIO)
    .upload(path, buffer, { contentType: mime, upsert: false })
  if (upErr) throw upErr

  const { count } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id', { count: 'exact', head: true })
    .eq('fornecedor_id', fornecedorId)

  const { data, error } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .insert({ fornecedor_id: fornecedorId, path, ordem: count ?? 0 })
    .select('id, path, legenda, ordem')
    .single()

  if (error || !data) {
    await supabaseAdmin.storage.from(BUCKET_PORTFOLIO).remove([path]).catch(() => {})
    throw error ?? new Error('falha ao salvar a foto')
  }

  return { id: data.id, url: urlPublica(data.path), legenda: data.legenda ?? null, ordem: data.ordem ?? 0 }
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
