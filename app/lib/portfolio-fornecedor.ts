// app/lib/portfolio-fornecedor.ts
// ============================================================================
// Portfólio/vitrine do fornecedor. Bucket PÚBLICO 'portfolio-fornecedores'
// (showcase — URL pública direta). A tabela portfolio_fornecedores guarda só o
// `path`; a URL pública é derivada aqui.
// ============================================================================

import { supabaseAdmin } from '@/app/lib/supabase-server'

export const BUCKET_PORTFOLIO = 'portfolio-fornecedores'

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
