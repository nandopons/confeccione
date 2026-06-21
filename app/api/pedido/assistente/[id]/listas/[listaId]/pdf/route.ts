// GET /api/pedido/assistente/[id]/listas/[listaId]/pdf → PDF de divulgação (download)
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { gerarListaColetaPdf } from '@/app/lib/lista-pdf'
import { primeiroNome } from '@/app/lib/nome'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function corLabel(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}

type Ctx = { params: Promise<{ id: string; listaId: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const { id, listaId } = await ctx.params
  const { data: lista } = await supabase
    .from('listas_externas')
    .select('token, modelo_nome, cor')
    .eq('id', listaId)
    .eq('pedido_id', id)
    .single()
  if (!lista) return NextResponse.json({ erro: 'Lista não encontrada' }, { status: 404 })

  const { data: ped } = await supabase
    .from('pedidos_assistente')
    .select('codigo, nome')
    .eq('id', id)
    .single()

  const modelo = [lista.modelo_nome, corLabel(lista.cor)].filter(Boolean).join(' · ') || null
  const pdf = await gerarListaColetaPdf({
    token: lista.token,
    organizador: primeiroNome(ped?.nome),
    modelo,
    codigo: ped?.codigo ?? null,
  })

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="coleta-tamanhos-confeccione.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
