// GET /api/fornecedor/melhorenvio/callback?code=…&state=…
// Retorno do OAuth do Melhor Envio: valida o state assinado, troca o code por
// tokens e salva na conta do fornecedor. Redireciona de volta com ?me=ok|erro.
import { NextRequest, NextResponse } from 'next/server'
import { SITE_URL } from '@/app/lib/url'
import { salvarTokens, trocarCodePorTokens, validarState } from '@/app/lib/melhorenvio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  const payload = state ? validarState(state) : null
  const destinoBase = payload?.voltar ?? '/fornecedor/painel/envio'
  const redir = (q: string) =>
    NextResponse.redirect(`${SITE_URL}${destinoBase}${destinoBase.includes('?') ? '&' : '?'}me=${q}`)

  if (!code || !payload) return redir('erro')

  const tokens = await trocarCodePorTokens(code)
  if (!tokens) return redir('erro')

  const salvou = await salvarTokens(payload.f, tokens)
  return salvou ? redir('ok') : redir('erro')
}
