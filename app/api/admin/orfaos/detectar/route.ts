// app/api/admin/orfaos/detectar/route.ts
// ============================================================================
// POST /api/admin/orfaos/detectar
//
// Trigger manual de detectarOrfaos() pelo painel admin. Útil pra teste
// end-to-end sem esperar o cron, e force-refresh após o admin cadastrar
// fornecedor novo manualmente.
//
// Sem body. Retorna { ok: true, detectados: N, lista: OrfaoDetectado[] }.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { detectarOrfaos } from '@/app/lib/orfaos'

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  try {
    const detectados = await detectarOrfaos()
    return NextResponse.json({
      ok: true,
      detectados: detectados.length,
      lista: detectados,
    })
  } catch (err) {
    console.error('[admin/orfaos/detectar] erro:', err)
    return NextResponse.json(
      { erro: 'Erro ao processar' },
      { status: 500 }
    )
  }
}
