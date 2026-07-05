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
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { buscarCobranca, mapearStatusAsaas } from '@/app/lib/asaas-payments'
import { revelarContatosPedidoPago } from '@/app/lib/pedido-assistente-oferta'

export const dynamic = 'force-dynamic'

type Resultado = {
  codigo: string | null
  nome: string | null
  valorCentavos: number | null
  statusAsaas: string
  acao: 'marcado_pago' | 'sem_mudanca' | 'erro'
  detalhe?: string
}

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const silencioso = req.nextUrl.searchParams.get('silencioso') === '1'

  const { data: pendentes, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, nome, valor_centavos, pagamento_status, asaas_payment_id')
    .not('asaas_payment_id', 'is', null)
    .or('pagamento_status.is.null,pagamento_status.neq.pago')
    .limit(50)

  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  const resultados: Resultado[] = []
  let marcados = 0

  for (const p of pendentes ?? []) {
    try {
      const cobranca = await buscarCobranca(p.asaas_payment_id as string)
      const interno = mapearStatusAsaas(cobranca.status)

      if (interno === 'pago') {
        await supabaseAdmin
          .from('pedidos_assistente')
          .update({ pagamento_status: 'pago', atualizado_em: new Date().toISOString() })
          .eq('id', p.id)

        if (!silencioso) {
          await revelarContatosPedidoPago(p.id)
        }
        marcados++
        resultados.push({
          codigo: p.codigo,
          nome: p.nome,
          valorCentavos: p.valor_centavos,
          statusAsaas: cobranca.status,
          acao: 'marcado_pago',
          detalhe: silencioso ? 'sem mensagens (silencioso)' : 'mensagens de confirmação enviadas',
        })
      } else {
        resultados.push({
          codigo: p.codigo,
          nome: p.nome,
          valorCentavos: p.valor_centavos,
          statusAsaas: cobranca.status,
          acao: 'sem_mudanca',
        })
      }
    } catch (err) {
      resultados.push({
        codigo: p.codigo,
        nome: p.nome,
        valorCentavos: p.valor_centavos,
        statusAsaas: 'desconhecido',
        acao: 'erro',
        detalhe: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    silencioso,
    verificados: (pendentes ?? []).length,
    marcadosPago: marcados,
    resultados,
  })
}
