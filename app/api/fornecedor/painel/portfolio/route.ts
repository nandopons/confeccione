// app/api/fornecedor/painel/portfolio/route.ts
// ============================================================================
// Portfólio pela WEB (cookie de sessão do painel).
//
// Existe separado de /api/fornecedor/portfolio porque aquela rota autentica por
// `Authorization: Bearer` (app mobile) e a página do painel manda cookie. Mesma
// lib, porta de entrada diferente.
// ============================================================================

import { getFornecedorAtual } from '@/app/lib/auth-server'
import { getPortfolio, uploadPortfolio, MAX_PORTFOLIO_BYTES } from '@/app/lib/portfolio-fornecedor'

export async function GET() {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })
  return Response.json(await getPortfolio(fornecedor.id))
}

export async function POST(req: Request) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'envie multipart com o campo file' }, { status: 400 })
  }

  const form = await req.formData()
  const file = form.get('file')
  const legenda = form.get('legenda')
  if (!(file instanceof File)) return Response.json({ error: 'arquivo ausente' }, { status: 400 })
  if (!file.type.startsWith('image/')) {
    return Response.json({ error: 'só imagem por enquanto (JPG ou PNG)' }, { status: 400 })
  }
  if (file.size > MAX_PORTFOLIO_BYTES) {
    return Response.json({ error: 'imagem muito grande (máx 10MB)' }, { status: 400 })
  }

  try {
    const item = await uploadPortfolio(fornecedor.id, file, typeof legenda === 'string' ? legenda : null)
    return Response.json(item, { status: 201 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'falha no upload' }, { status: 400 })
  }
}
