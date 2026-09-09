// app/api/admin/orcamentos/recuperar-qr/route.ts
// ============================================================================
// POST — busca de novo, no Asaas, o QR do Pix das cobranças que ficaram sem.
//
// POR QUE ISTO EXISTE (09/09/2026)
// O ORC-2026-0031 foi emitido com cobrança válida (pay_72fejmteqcw3kqp3) e sem
// QR nenhum: o PDF chegou ao cliente sem forma de pagar. A causa está corrigida
// em orcamento-cobranca.ts (a busca agora repete e não engole o erro), mas as
// cobranças já gravadas continuam sem QR — e refazer a cobrança criaria uma
// segunda cobrança do mesmo valor pro mesmo cliente, que é pior do que o
// problema.
//
// Esta rota conserta o que existe: o payment_id já está no banco, o QR é
// buscado outra vez e gravado. Idempotente — quem já tem QR é pulado.
//
// ?orcamento=<uuid|numero>  conserta um só. Sem parâmetro, varre as pendentes.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { buscarQrPix } from '@/app/lib/orcamento-cobranca'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Cobranca = { id: string; orcamento_id: string; asaas_payment_id: string | null; parcela: number }

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const ref = req.nextUrl.searchParams.get('orcamento')?.trim() || null

  let orcamentoIds: string[] | null = null
  if (ref) {
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)
    const { data } = await supabaseAdmin
      .from('orcamentos')
      .select('id')
      .eq(ehUuid ? 'id' : 'numero', ref)
      .limit(1)
    orcamentoIds = ((data ?? []) as Array<{ id: string }>).map((o) => o.id)
    if (orcamentoIds.length === 0) {
      return NextResponse.json({ erro: `Orçamento "${ref}" não encontrado` }, { status: 404 })
    }
  }

  // Só as que têm cobrança no Asaas e não têm QR: sem payment_id não há o que
  // buscar, e com QR não há o que consertar.
  let q = supabaseAdmin
    .from('orcamento_cobrancas')
    .select('id, orcamento_id, asaas_payment_id, parcela')
    .not('asaas_payment_id', 'is', null)
    .is('pix_qr_imagem', null)
    .limit(50)
  if (orcamentoIds) q = q.in('orcamento_id', orcamentoIds)

  const { data, error } = await q
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  const pendentes = (data ?? []) as Cobranca[]
  const resultado: Array<{ cobrancaId: string; ok: boolean; erro?: string }> = []

  for (const c of pendentes) {
    if (!c.asaas_payment_id) continue
    const qr = await buscarQrPix(c.asaas_payment_id)
    if (!qr.qrImagem) {
      resultado.push({ cobrancaId: c.id, ok: false, erro: qr.erro ?? 'QR não veio' })
      continue
    }
    const { error: upErr } = await supabaseAdmin
      .from('orcamento_cobrancas')
      .update({ pix_copia_cola: qr.copiaCola, pix_qr_imagem: qr.qrImagem })
      .eq('id', c.id)

    // O PDF e o e-mail leem das colunas do ORÇAMENTO, que são espelho da
    // primeira parcela. Consertar só a cobrança deixaria o banco certo e o PDF
    // continuaria saindo sem QR — que é exatamente o problema que trouxe a
    // gente aqui.
    if (!upErr && c.parcela === 1) {
      await supabaseAdmin
        .from('orcamentos')
        .update({ pix_copia_cola: qr.copiaCola, pix_qr_imagem: qr.qrImagem })
        .eq('id', c.orcamento_id)
    }
    resultado.push({ cobrancaId: c.id, ok: !upErr, erro: upErr?.message })
  }

  return NextResponse.json({
    ok: true,
    pendentes: pendentes.length,
    recuperadas: resultado.filter((r) => r.ok).length,
    resultado,
  })
}
