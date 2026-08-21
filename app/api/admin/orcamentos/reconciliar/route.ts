// app/api/admin/orcamentos/reconciliar/route.ts
// ============================================================================
// GET — confere no Asaas, cobrança por cobrança, quais orçamentos avulsos
// foram pagos, e grava o resultado.
//
// POR QUE ISTO PRECISOU EXISTIR
// O gerador de orçamento avulso cria cobrança desde 02/07/2026, mas o webhook
// só olhava `pedidos_assistente`. Quem pagava um orçamento do admin pagava no
// silêncio: nem coluna de pagamento a tabela tinha. Em 21/08/2026 eram 17
// cobranças nessa situação, R$ 17.641,36. Esta rota é o resgate do passado —
// e a rede de segurança permanente para webhook perdido, igual à que já existe
// em /api/admin/asaas/reconciliar para os pedidos do marketplace.
//
// O orçamento marcado como pago passa a aparecer no quadro de produção: o
// quadro lê `orcamentos` com pagamento_status = 'pago' e cria o card sob
// demanda.
//
// ?somenteConferir=1 → só reporta o que encontrou, sem gravar nada. Use antes
// de aplicar quando quiser ver o estrago primeiro.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { buscarCobranca, mapearStatusAsaas } from '@/app/lib/asaas-payments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Resultado = {
  numero: string
  cliente: string | null
  totalCentavos: number | null
  statusAsaas: string
  acao: 'marcado_pago' | 'sem_mudanca' | 'erro'
  detalhe?: string
}

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const somenteConferir = req.nextUrl.searchParams.get('somenteConferir') === '1'

  const { data: pendentes, error } = await supabaseAdmin
    .from('orcamentos')
    .select('id, numero, cliente_nome, total_centavos, pagamento_status, asaas_payment_id')
    .not('asaas_payment_id', 'is', null)
    .or('pagamento_status.is.null,pagamento_status.neq.pago')
    .order('criado_em', { ascending: true })
    .limit(100)

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  const resultados: Resultado[] = []
  let marcados = 0
  let somaPagaCentavos = 0

  for (const o of pendentes ?? []) {
    const base = {
      numero: o.numero as string,
      cliente: (o.cliente_nome as string | null) ?? null,
      totalCentavos: (o.total_centavos as number | null) ?? null,
    }
    try {
      const cobranca = await buscarCobranca(o.asaas_payment_id as string)
      const interno = mapearStatusAsaas(cobranca.status)

      if (interno === 'pago') {
        if (!somenteConferir) {
          await supabaseAdmin
            .from('orcamentos')
            .update({ pagamento_status: 'pago', pago_em: new Date().toISOString() })
            .eq('id', o.id)
        }
        marcados++
        somaPagaCentavos += base.totalCentavos ?? 0
        resultados.push({
          ...base,
          statusAsaas: cobranca.status,
          acao: 'marcado_pago',
          detalhe: somenteConferir ? 'não gravado (somente conferir)' : 'entra no quadro de produção',
        })
      } else {
        resultados.push({ ...base, statusAsaas: cobranca.status, acao: 'sem_mudanca' })
      }
    } catch (e) {
      resultados.push({
        ...base,
        statusAsaas: '—',
        acao: 'erro',
        detalhe: e instanceof Error ? e.message : 'falha ao consultar o Asaas',
      })
    }
  }

  return NextResponse.json({
    conferidos: resultados.length,
    marcadosPagos: marcados,
    somaPagaCentavos,
    somenteConferir,
    resultados,
  })
}
