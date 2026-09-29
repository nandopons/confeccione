// app/api/admin/asaas/reconciliar/route.ts
// ============================================================================
// GET ?silencioso=1 — reconcilia pagamentos de pedidos_assistente com o Asaas.
//
// Rede de segurança contra webhook perdido (caso real 05/07/2026: Alefe e
// Rafael pagaram no Asaas e o sistema ficou em pagamento_status='gerado').
// Consulta GET /v3/payments/{id} pra cada pedido com cobrança não-paga e,
// se o Asaas disser RECEIVED/CONFIRMED, aplica a MESMA transição do webhook:
// pagamento_status='pago' + revelarContatosPedidoPago (mensagens de
// confirmação a cliente e fornecedor).
//
// ?silencioso=1 → só sincroniza o status, SEM disparar mensagens (útil pra
// regularizar casos antigos já tratados manualmente).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { reconciliarPagamentosAsaas } from '@/app/lib/asaas-reconciliar'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const silencioso = req.nextUrl.searchParams.get('silencioso') === '1'
  // A lógica mora em app/lib/asaas-reconciliar.ts e roda sozinha de hora em
  // hora pelo scheduler (29/09/2026). Aqui é só o botão manual.
  try {
    const r = await reconciliarPagamentosAsaas({ silencioso })
    return NextResponse.json({ ok: true, silencioso, ...r })
  } catch (err) {
    return NextResponse.json({ erro: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
