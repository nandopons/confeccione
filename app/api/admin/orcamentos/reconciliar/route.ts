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
import { marcarParcelaPagaPorAsaas } from '@/app/lib/orcamento-parcelas'

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

  // Varre PARCELAS, nao orcamentos: no 50/50 cada uma tem cobranca propria e
  // pode ter sido paga sem que a outra tenha.
  const { data: pendentes, error } = await supabaseAdmin
    .from('orcamento_cobrancas')
    .select('id, parcela, rotulo, valor_centavos, asaas_payment_id, orcamentos(numero, cliente_nome)')
    .not('asaas_payment_id', 'is', null)
    .eq('status', 'gerada')
    .order('criado_em', { ascending: true })
    .limit(100)

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  const resultados: Resultado[] = []
  let marcados = 0
  let somaPagaCentavos = 0

  for (const o of (pendentes ?? []) as unknown as {
    id: string
    parcela: number
    rotulo: string
    valor_centavos: number
    asaas_payment_id: string
    orcamentos: { numero: string; cliente_nome: string | null } | null
  }[]) {
    const base = {
      numero: `${o.orcamentos?.numero ?? '—'}${o.rotulo === 'integral' ? '' : ` · ${o.rotulo}`}`,
      cliente: o.orcamentos?.cliente_nome ?? null,
      totalCentavos: o.valor_centavos,
    }
    try {
      const cobranca = await buscarCobranca(o.asaas_payment_id)
      const interno = mapearStatusAsaas(cobranca.status)

      if (interno === 'pago') {
        if (!somenteConferir) {
          await marcarParcelaPagaPorAsaas(o.asaas_payment_id)
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
