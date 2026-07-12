// app/api/pedido/assistente/verificar-contato/route.ts
// ============================================================================
// POST { email } → { existe: boolean }
//
// Usado pelo form da home (PedidoSteps): quando o cliente digita o e-mail,
// detecta se ele já tem conta ou pedidos anteriores e a UI sugere entrar no
// painel (evita pedido duplicado de quem acha que "não computou").
// Resposta mínima (só boolean) pra não virar oráculo de enumeração.
// ============================================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'payload inválido' }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ erro: 'email inválido' }, { status: 400 })
  }

  try {
    const [conta, pedidos] = await Promise.all([
      supabaseAdmin.from('contas_clientes').select('id').ilike('email', email).limit(1).maybeSingle(),
      supabaseAdmin.from('pedidos_assistente').select('id').ilike('email', email).limit(1).maybeSingle(),
    ])
    return NextResponse.json({ existe: Boolean(conta.data || pedidos.data) })
  } catch (err) {
    console.error('[verificar-contato] falhou:', err)
    // failure-soft: sem detecção, o fluxo segue normal
    return NextResponse.json({ existe: false })
  }
}
