// app/api/admin/pedidos-pagos/route.ts
// GET — lista pedidos pagos (pedidos_assistente, pagamento_status='pago') com
// suas ofertas + os fornecedores disponíveis pro seletor. Guardado por cookie
// admin. Enriquecido com finalizado_em (etapa final do fluxo — funil v8).
import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarPedidosPagos } from '@/app/lib/pedido-assistente-oferta'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { etapasDosPedidos } from '@/app/lib/etapas-pedido'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const dados = await listarPedidosPagos()

  // finalizado_em e a etapa (view pedidos_assistente_etapas, D-8) vêm por
  // fora pra não mexer na lib compartilhada.
  const ids = dados.pedidos.map((p) => p.id)
  const finalizadoPorId = new Map<string, string | null>()
  if (ids.length > 0) {
    const { data } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('id, finalizado_em')
      .in('id', ids)
    for (const r of (data ?? []) as { id: string; finalizado_em: string | null }[]) {
      finalizadoPorId.set(r.id, r.finalizado_em)
    }
  }
  const etapas = await etapasDosPedidos(ids).catch((err) => {
    console.error('[admin/pedidos-pagos] etapas falharam (lista segue sem elas)', { err })
    return new Map<string, never>()
  })

  return NextResponse.json({
    ok: true,
    ...dados,
    pedidos: dados.pedidos.map((p) => {
      const e = etapas.get(p.id)
      return {
        ...p,
        finalizado_em: finalizadoPorId.get(p.id) ?? null,
        etapa: e?.etapa ?? null,
        grupo: e?.grupo ?? null,
        alerta: e?.alerta ?? false,
        desde: e?.desde ?? null,
        encerrado_motivo: e?.encerrado_motivo ?? null,
        motivo_parada: e?.motivo_parada ?? null,
      }
    }),
  })
}
