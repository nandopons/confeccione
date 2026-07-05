// app/api/eventos/route.ts
// ============================================================================
// Coletor do tracker 1st-party (app/lib/rastreio.ts). Recebe eventos anônimos
// do site público e grava em eventos_site (service role; RLS deny pra anon).
//
// Failure-soft por completo: responde 204 sempre — analytics nunca pode
// virar erro pro visitante nem vazar detalhes.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const dynamic = 'force-dynamic'

const TIPOS = new Set(['pageview', 'assistente_iniciado', 'pedido_enviado', 'whatsapp_click'])

function corta(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export async function POST(req: NextRequest) {
  try {
    // sendBeacon envia Blob application/json — req.json() lê normalmente.
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const tipo = corta(b?.tipo, 40)
    const sessao = corta(b?.sessao_id, 64)
    if (!b || !tipo || !TIPOS.has(tipo) || !sessao) {
      return new NextResponse(null, { status: 204 })
    }

    await supabaseAdmin.from('eventos_site').insert({
      sessao_id: sessao,
      tipo,
      pagina: corta(b.pagina, 300),
      utm_source: corta(b.utm_source, 120),
      utm_medium: corta(b.utm_medium, 120),
      utm_campaign: corta(b.utm_campaign, 160),
      referrer: corta(b.referrer, 300),
      referencia_id: corta(b.referencia_id, 64),
    })
  } catch {
    // nunca propaga
  }
  return new NextResponse(null, { status: 204 })
}
