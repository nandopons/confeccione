// POST /api/lista/[token]/inscrever — inscrição PÚBLICA numa lista de coleta.
// Qualquer pessoa com o link informa nome/tamanho (+ número/whatsapp/email/obs).
// Cada inscrição soma +1 no tamanho do modelo (a lista é a fonte das qtds).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recomputarLinhaDaLista } from '@/app/lib/listas-externas'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const Body = z.object({
  nome: z.string().min(1).max(120),
  tamanho: z.string().min(1).max(12),
  numero: z.string().max(12).nullable().optional(),
  observacao: z.string().max(300).nullable().optional(),
  whatsapp: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
})

type Ctx = { params: Promise<{ token: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ erro: 'token ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Confira os campos.' }, { status: 400 })

  const { data: lista } = await supabase
    .from('listas_externas')
    .select('id, pedido_id, linha_index, ativa, lid')
    .eq('token', token)
    .single()
  if (!lista) return NextResponse.json({ erro: 'Lista não encontrada.' }, { status: 404 })
  if (!lista.ativa) return NextResponse.json({ erro: 'Esta lista está fechada no momento.' }, { status: 409 })

  const email = (p.data.email || '').trim()
  const reg = {
    lista_id: lista.id,
    pedido_id: lista.pedido_id,
    nome: p.data.nome.trim(),
    tamanho: p.data.tamanho.toUpperCase().trim(),
    numero: p.data.numero?.trim() || null,
    observacao: p.data.observacao?.trim() || null,
    whatsapp: (p.data.whatsapp || '').replace(/\D/g, '') || null,
    email: email.includes('@') ? email : null,
  }

  const { error } = await supabase.from('inscricoes_externas').insert(reg)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  await recomputarLinhaDaLista(supabase, lista)
  return NextResponse.json({ ok: true })
}
