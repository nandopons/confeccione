// app/api/admin/orfaos/route.ts
// ============================================================================
// POST /api/admin/orfaos
//
// Body JSON: { orfao_id: string, novo_status: StatusOrfao }
//
// Atualiza status de um órfão com validação de transição.
//
// Defesa em profundidade: middleware já bloqueia /api/admin/* sem cookie
// válido (length≥32), mas revalidamos o valor real aqui via
// ehTokenAdminValido() (cookie === ADMIN_SESSION_TOKEN).
//
// Erros possíveis:
//   - 401: cookie ausente/inválido
//   - 400: body inválido, orfao_id/novo_status inválidos
//   - 404: órfão não encontrado
//   - 409: transição inválida (admin com 2 abas, estado desatualizado)
//   - 500: erro de banco
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  atualizarStatusOrfao,
  podeTransicionarOrfao,
  type StatusOrfao,
} from '@/app/lib/orfaos'

const STATUS_VALIDOS: readonly StatusOrfao[] = [
  'aberto',
  'em_captacao',
  'resolvido',
  'descartado',
]

export async function POST(req: NextRequest) {
  // Defesa em profundidade — middleware também valida cookie.
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  let body: { orfao_id?: unknown; novo_status?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })
  }

  const orfaoId = body.orfao_id
  const novoStatus = body.novo_status

  if (typeof orfaoId !== 'string' || orfaoId.length === 0) {
    return NextResponse.json(
      { erro: 'orfao_id ausente ou inválido' },
      { status: 400 }
    )
  }
  if (
    typeof novoStatus !== 'string' ||
    !STATUS_VALIDOS.includes(novoStatus as StatusOrfao)
  ) {
    return NextResponse.json(
      { erro: 'novo_status inválido' },
      { status: 400 }
    )
  }

  // Lê status atual pra validar a transição.
  const { data: atual, error: selErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .select('status_orfao')
    .eq('id', orfaoId)
    .maybeSingle()

  if (selErr) {
    console.error('[admin/orfaos] erro ao ler status atual:', selErr)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  if (!atual) {
    return NextResponse.json({ erro: 'Órfão não encontrado' }, { status: 404 })
  }

  const statusAtual = (atual as { status_orfao: StatusOrfao }).status_orfao
  const statusDestino = novoStatus as StatusOrfao

  if (!podeTransicionarOrfao(statusAtual, statusDestino)) {
    return NextResponse.json(
      {
        erro: 'Transição inválida',
        status_atual: statusAtual,
        tentou: statusDestino,
      },
      { status: 409 }
    )
  }

  try {
    await atualizarStatusOrfao(orfaoId, statusDestino)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/orfaos] erro ao atualizar:', err)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }
}
