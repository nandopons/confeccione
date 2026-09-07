// GET /api/admin/marketing/automacoes/[id]/detalhe — o que o fluxo faria na
// próxima rodada, sem mandar nada: regras em texto, quem entraria, quem
// receberia agora. É o detalhe que abre quando o Fernando clica no fluxo (D-10).
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { detalheAutomacao } from '@/app/lib/automacoes-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const { id } = await params
  try {
    const detalhe = await detalheAutomacao(id)
    if (!detalhe) return NextResponse.json({ erro: 'Fluxo não encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true, detalhe })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha na prévia' }, { status: 500 })
  }
}
