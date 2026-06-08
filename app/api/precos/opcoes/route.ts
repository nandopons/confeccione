// app/api/precos/opcoes/route.ts
// GET → opções de estampa cadastradas (posições/tamanhos), pros selects do
// visualizador. Público (só rótulos, sem preço).
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const { data } = await supabase.from('precos_estampas').select('posicao, tamanho')
  const posicoes = Array.from(new Set((data ?? []).map((r) => r.posicao).filter(Boolean))).sort()
  const tamanhos = Array.from(new Set((data ?? []).map((r) => r.tamanho).filter(Boolean))).sort()
  return NextResponse.json({ ok: true, posicoes, tamanhos })
}
