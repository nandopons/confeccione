// GET /api/admin/pedidos-assistente/[id]/img?linha=N&tipo=liso|arte
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { imagemMockup } from '@/app/lib/admin-pedidos-assistente'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await ctx.params
  const linha = parseInt(req.nextUrl.searchParams.get('linha') ?? '0', 10) || 0
  const tipo = req.nextUrl.searchParams.get('tipo') === 'arte' ? 'arte' : 'liso'
  const img = await imagemMockup(id, linha, tipo)
  if (!img) return NextResponse.json({ erro: 'Sem imagem' }, { status: 404 })
  return new NextResponse(new Uint8Array(img.bytes), { status: 200, headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=60' } })
}
