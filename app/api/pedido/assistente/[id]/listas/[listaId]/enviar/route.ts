// POST /api/pedido/assistente/[id]/listas/[listaId]/enviar
// Envia o link de coleta + PDF (QR) pro e-mail informado (ou o do pedido).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { gerarListaColetaPdf } from '@/app/lib/lista-pdf'
import { emailLinkColeta } from '@/app/lib/email'
import { linkInscricaoUrl } from '@/app/lib/listas-externas'
import { primeiroNome } from '@/app/lib/nome'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function corLabel(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}

const Body = z.object({ email: z.string().email().optional() })
type Ctx = { params: Promise<{ id: string; listaId: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id, listaId } = await ctx.params
  let bruto: unknown = {}
  try { bruto = await req.json() } catch {}
  const p = Body.safeParse(bruto)
  const emailManual = p.success ? p.data.email : undefined

  const { data: lista } = await supabase
    .from('listas_externas')
    .select('token, modelo_nome, cor')
    .eq('id', listaId)
    .eq('pedido_id', id)
    .single()
  if (!lista) return NextResponse.json({ erro: 'Lista não encontrada' }, { status: 404 })

  const { data: ped } = await supabase
    .from('pedidos_assistente')
    .select('codigo, nome, email')
    .eq('id', id)
    .single()

  const destino = (emailManual || ped?.email || '').trim()
  if (!destino || !destino.includes('@')) {
    return NextResponse.json({ erro: 'Sem e-mail de destino. Informe um e-mail.' }, { status: 400 })
  }

  const modelo = [lista.modelo_nome, corLabel(lista.cor)].filter(Boolean).join(' · ') || null
  const pdf = await gerarListaColetaPdf({
    token: lista.token,
    organizador: primeiroNome(ped?.nome),
    modelo,
    codigo: ped?.codigo ?? null,
  })
  const pdfBase64 = Buffer.from(pdf).toString('base64')

  await emailLinkColeta({
    email: destino,
    organizador: primeiroNome(ped?.nome),
    modelo,
    link: linkInscricaoUrl(lista.token),
    pdfBase64,
  })

  return NextResponse.json({ ok: true, email: destino })
}
