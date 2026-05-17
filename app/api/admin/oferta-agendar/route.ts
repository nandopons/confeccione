// app/api/admin/oferta-agendar/route.ts
// ============================================================================
// POST /api/admin/oferta-agendar
//
// Body JSON: { pedidoId: string, fornecedorId: string }
//
// Agenda um reenvio de oferta. Chamado pelo botão "↻ Agendar reenvio"
// no modal de detalhes de /admin/orfaos. Apenas insere na fila —
// disparo real fica pra B3 (trigger no aceite de oferta).
//
// Status codes:
//   200 — agendada criada
//   400 — body inválido
//   401 — sem cookie admin
//   404 — pedido ou fornecedor não encontrado
//   409 — já existe agendada pendente pro par (pedido, fornecedor)
//   500 — erro de banco
//
// Defesa em profundidade: middleware bloqueia /api/admin/* sem cookie
// (length≥32); revalidamos cookie === ADMIN_SESSION_TOKEN aqui.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { agendarReenvio } from '@/app/lib/fila'

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  let body: { pedidoId?: unknown; fornecedorId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })
  }

  if (
    typeof body.pedidoId !== 'string' ||
    typeof body.fornecedorId !== 'string' ||
    body.pedidoId.length === 0 ||
    body.fornecedorId.length === 0
  ) {
    return NextResponse.json(
      { erro: 'pedidoId e fornecedorId obrigatórios (string)' },
      { status: 400 }
    )
  }

  const r = await agendarReenvio({
    pedidoId: body.pedidoId,
    fornecedorId: body.fornecedorId,
  })

  if (r.ok) {
    return NextResponse.json({ ok: true, agendadaId: r.agendadaId })
  }

  // Mapeia erros conhecidos → HTTP status
  if (r.erro === 'já agendado') {
    return NextResponse.json({ ok: false, erro: r.erro }, { status: 409 })
  }
  if (
    r.erro === 'pedido não encontrado' ||
    r.erro === 'fornecedor não encontrado'
  ) {
    return NextResponse.json({ ok: false, erro: r.erro }, { status: 404 })
  }
  // Catch-all: 500
  return NextResponse.json({ ok: false, erro: r.erro }, { status: 500 })
}
