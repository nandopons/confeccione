// app/api/admin/orfaos/rematch/route.ts
// ============================================================================
// POST /api/admin/orfaos/rematch
//
// Re-roda matching pra todos os órfãos em `status_orfao='aberto'`. Útil
// quando fornecedores novos entraram na base e o matchingRetroativo
// automático (em after() do cadastro) falhou ou ficou desatualizado.
//
// Pra cada órfão:
//   - count ofertas antes
//   - criarEDispararOferta(pedido_id) — escolhe melhor fornecedor compatível,
//     INSERT em ofertas, envia WhatsApp/email
//   - count ofertas depois; se aumentou, atualiza status_orfao='em_captacao'
//
// Sequencial (não paralelo) pra evitar storm no Z-API.
// Failure-soft: erro em 1 órfão não para o varredor.
//
// IMPORTANTE: criarEDispararOferta envia WhatsApp REAL pra fornecedor.
// Roda só sob autorização explícita admin.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { criarEDispararOferta } from '@/app/lib/ofertas'

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const inicio = Date.now()

  // 1. Lista órfãos abertos
  const { data: orfaosRaw, error: oErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .select('id, pedido_id')
    .eq('status_orfao', 'aberto')

  if (oErr) {
    console.error('[admin/orfaos/rematch] SELECT órfãos falhou:', oErr)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  const orfaos = (orfaosRaw ?? []) as Array<{ id: string; pedido_id: string }>
  if (orfaos.length === 0) {
    return NextResponse.json({
      ok: true,
      varridos: 0,
      ofertas_disparadas: 0,
      sem_fornecedor: 0,
      duracao_ms: Date.now() - inicio,
    })
  }

  // 2. Pra cada órfão: dispara oferta, mede sucesso por delta de count
  let ofertasDisparadas = 0
  let semFornecedor = 0
  let erros = 0

  for (const o of orfaos) {
    try {
      const { count: countAntes } = await supabaseAdmin
        .from('ofertas')
        .select('*', { count: 'exact', head: true })
        .eq('pedido_id', o.pedido_id)

      await criarEDispararOferta(o.pedido_id)

      const { count: countDepois } = await supabaseAdmin
        .from('ofertas')
        .select('*', { count: 'exact', head: true })
        .eq('pedido_id', o.pedido_id)

      const criou = (countDepois ?? 0) > (countAntes ?? 0)

      if (criou) {
        const { error: updErr } = await supabaseAdmin
          .from('pedidos_orfaos')
          .update({ status_orfao: 'em_captacao' })
          .eq('id', o.id)

        if (updErr) {
          console.error(
            `[admin/orfaos/rematch] update órfão ${o.id} falhou:`,
            updErr
          )
        }
        ofertasDisparadas++
      } else {
        semFornecedor++
      }
    } catch (err) {
      erros++
      console.error(
        `[admin/orfaos/rematch] dispatch pedido ${o.pedido_id} falhou:`,
        err
      )
    }
  }

  const duracaoMs = Date.now() - inicio
  console.log(
    `[admin/orfaos/rematch] varridos=${orfaos.length} ` +
      `ofertas=${ofertasDisparadas} sem_fornecedor=${semFornecedor} ` +
      `erros=${erros} ${duracaoMs}ms`
  )

  return NextResponse.json({
    ok: true,
    varridos: orfaos.length,
    ofertas_disparadas: ofertasDisparadas,
    sem_fornecedor: semFornecedor,
    erros,
    duracao_ms: duracaoMs,
  })
}
