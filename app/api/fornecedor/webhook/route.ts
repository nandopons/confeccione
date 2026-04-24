import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()

  await supabase.from('webhook_debug').insert({ body })

  // Lógica de onboarding por etapas removida — cadastro agora acontece no site.
  // TODO: implementar lógica de ofertas (notificar fornecedor quando um pedido compatível chegar).

  return NextResponse.json({ ok: true })
}
