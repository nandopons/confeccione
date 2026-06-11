// app/api/pedido/assistente/[id]/confirmar/route.ts
// ============================================================================
// POST — confirma o pedido SEM pagamento e SEM preço (novo fluxo, jun/2026):
// salva linhas + imagens, marca confirmado_em e dispara o e-mail "pedido
// recebido" (sem valores) avisando que vamos encontrar o fornecedor ideal.
// O preço só aparece pro cliente depois que o fornecedor aceitar e definir o
// orçamento final (aí a rota /pagar gera a cobrança).
// Idempotente: reconfirmar atualiza linhas/imagens e NÃO reenvia o e-mail.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enviarEmailPedidoRecebido } from '@/app/lib/email-pedido'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_IMGS = 12
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

const EstampaSchema = z.object({ posicao: z.string(), tamanho: z.string() })
const TamanhoSchema = z.object({ tamanho: z.string(), qtd: z.number().int().positive().nullable() })
const LinhaSchema = z.object({
  modelo: z.string().nullable(),
  cor: z.string().nullable(),
  material: z.string().nullable(),
  total: z.number().int().positive().nullable(),
  tamanhos: z.array(TamanhoSchema).default([]),
  estampas: z.array(EstampaSchema).default([]),
  estampado: z.boolean().nullable().optional(),
  descricao: z.string().nullable().optional(),
})
const BodySchema = z.object({
  linhas: z.array(LinhaSchema).min(1),
  imagens: z.array(z.string()).max(MAX_IMGS).default([]),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const { data: pedido, error: errPedido } = await supabase
    .from('pedidos_assistente')
    .select('id, nome, email, confirmado_em, pagamento_status')
    .eq('id', id)
    .maybeSingle<{ id: string; nome: string | null; email: string | null; confirmado_em: string | null; pagamento_status: string | null }>()
  if (errPedido || !pedido) return NextResponse.json({ erro: 'Pedido não encontrado.' }, { status: 404 })

  // valida tamanho das imagens
  const totalBytes = p.data.imagens.reduce((acc, d) => {
    const m = /;base64,(.+)$/.exec(d)
    return acc + (m ? Math.floor((m[1].length * 3) / 4) : 0)
  }, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ erro: 'Imagens grandes demais.' }, { status: 400 })
  }

  const primeiraVez = !pedido.confirmado_em
  const agora = new Date().toISOString()

  const { error: errUpd } = await supabase
    .from('pedidos_assistente')
    .update({
      linhas: p.data.linhas,
      imagens: p.data.imagens,
      status: 'confirmado',
      confirmado_em: pedido.confirmado_em ?? agora,
      atualizado_em: agora,
    })
    .eq('id', id)
  if (errUpd) return NextResponse.json({ erro: 'Não foi possível confirmar agora.' }, { status: 500 })

  // e-mail "pedido recebido" — só na primeira confirmação; não bloqueia o sucesso
  let emailEnviado = false
  if (primeiraVez && pedido.email) {
    try {
      await enviarEmailPedidoRecebido({
        id,
        email: pedido.email,
        nome: pedido.nome,
        linhas: p.data.linhas,
        numImagens: p.data.imagens.length,
      })
      emailEnviado = true
    } catch (err) {
      console.error('[confirmar] email falhou:', err)
    }
  }

  return NextResponse.json({
    ok: true,
    jaConfirmado: !primeiraVez,
    confirmadoEm: pedido.confirmado_em ?? agora,
    emailEnviado,
  })
}
