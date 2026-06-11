// POST /api/fornecedor/oferta/[id]/orcamento — o FORNECEDOR define/atualiza o
// orçamento final do pedido aceito. Acesso por uuid da oferta (não-adivinhável),
// mesmo padrão público da página da oferta. Só funciona com oferta ACEITA e
// pedido ainda não pago. Notifica o cliente (e-mail + WhatsApp) ao salvar.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { salvarOrcamentoFornecedor } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
export const maxDuration = 60

const BodySchema = z.object({
  unitCentavos: z.array(z.number().int().positive()).min(1).max(50),
  freteCentavos: z.number().int().min(0),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const r = await salvarOrcamentoFornecedor(id, p.data.unitCentavos, p.data.freteCentavos)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao salvar' }, { status: 409 })

  return NextResponse.json({
    ok: true,
    valorClienteCentavos: r.valorClienteCentavos,
    repasseCentavos: r.repasseCentavos,
  })
}
