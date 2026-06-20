// Portfólio de mídias que o FORNECEDOR anexa ao orçamento (fotos/vídeos de
// trabalhos pertinentes ao pedido) — fica visível ao cliente no visualizador.
// Arquivos no bucket privado 'artes-clientes' sob orcamento-portfolio/{ofertaId}/,
// servidos por signed URL via /api/oferta/[id]/portfolio/[i].
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { BUCKET_ARTES } from '@/app/lib/arquivos-cliente'

export { BUCKET_ARTES }
export const PORTFOLIO_PREFIX = 'orcamento-portfolio'
export const PORTFOLIO_MAX_ITENS = 8
export const PORTFOLIO_MAX_BYTES = 30 * 1024 * 1024 // 30MB por arquivo

export type PortfolioMidia = {
  path: string
  mime: string | null
  tipo: 'imagem' | 'video'
  nome: string
}

export function tipoDaMime(mime: string | null | undefined): 'imagem' | 'video' | null {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'imagem'
  if (mime.startsWith('video/')) return 'video'
  return null
}

export function sanitizeNome(nome: string): string {
  const limpo = (nome || '').replace(/[^a-zA-Z0-9._-]/g, '_')
  return limpo.length > 0 ? limpo.slice(0, 120) : 'arquivo'
}

// Carrega a oferta + estado do pedido pra validar/servir o portfólio.
export async function carregarOfertaPortfolio(ofertaId: string): Promise<{
  ofertaId: string
  pedidoPago: boolean
  status: string
  midias: PortfolioMidia[]
} | null> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, status, portfolio_midias')
    .eq('id', ofertaId)
    .maybeSingle<{ id: string; pedido_id: string; status: string; portfolio_midias: PortfolioMidia[] | null }>()
  if (!oferta) return null

  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('pagamento_status')
    .eq('id', oferta.pedido_id)
    .maybeSingle<{ pagamento_status: string | null }>()

  return {
    ofertaId: oferta.id,
    pedidoPago: pedido?.pagamento_status === 'pago',
    status: oferta.status,
    midias: Array.isArray(oferta.portfolio_midias) ? oferta.portfolio_midias : [],
  }
}
