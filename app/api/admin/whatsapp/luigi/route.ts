// app/api/admin/whatsapp/luigi/route.ts
// ============================================================================
// O controle do Luigi no inbox.
//
// GET  → { modo, modos: [{valor, label, ajuda}], hoje: {respondidas, sugeridas, escaladas} }
// PUT  { modo }                                   → troca o modo (desligado | sugere | responde)
// POST { sugestaoId, conversaId, acao: 'usar' | 'descartar' } → fecha uma sugestão
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { definirModoLuigi, ehModoLuigi, modoLuigi, MODO_LUIGI_AJUDA, MODO_LUIGI_LABEL, MODOS_LUIGI, resolverSugestoes } from '@/app/lib/luigi'

export const dynamic = 'force-dynamic'

function naoAutorizado() {
  return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
}

async function contagemDeHoje(): Promise<{ respondidas: number; sugeridas: number; escaladas: number }> {
  const inicio = new Date()
  inicio.setHours(inicio.getHours() - 24)
  const { data } = await supabaseAdmin
    .from('luigi_whatsapp_log')
    .select('status, escalado')
    .gte('criado_em', inicio.toISOString())
    .limit(2000)
  let respondidas = 0
  let sugeridas = 0
  let escaladas = 0
  for (const r of (data ?? []) as Array<{ status: string; escalado: boolean }>) {
    if (r.status === 'enviada') respondidas++
    if (['sugerida', 'usada', 'descartada'].includes(r.status)) sugeridas++
    if (r.escalado) escaladas++
  }
  return { respondidas, sugeridas, escaladas }
}

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) return naoAutorizado()
  try {
    const [modo, hoje] = await Promise.all([modoLuigi(), contagemDeHoje()])
    return NextResponse.json({
      modo,
      modos: MODOS_LUIGI.map((valor) => ({ valor, label: MODO_LUIGI_LABEL[valor], ajuda: MODO_LUIGI_AJUDA[valor] })),
      hoje,
    })
  } catch (err) {
    console.error('[luigi-admin] GET falhou', { err })
    return NextResponse.json({ erro: 'Falha ao ler o modo do Luigi' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) return naoAutorizado()
  const body = (await req.json().catch(() => null)) as { modo?: unknown } | null
  if (!ehModoLuigi(body?.modo)) {
    return NextResponse.json({ erro: 'modo inválido (desligado | sugere | responde)' }, { status: 400 })
  }
  try {
    await definirModoLuigi(body.modo)
    return NextResponse.json({ ok: true, modo: body.modo })
  } catch (err) {
    console.error('[luigi-admin] PUT falhou', { err })
    return NextResponse.json({ erro: 'Falha ao trocar o modo' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) return naoAutorizado()
  const body = (await req.json().catch(() => null)) as { sugestaoId?: unknown; conversaId?: unknown; acao?: unknown } | null
  const sugestaoId = typeof body?.sugestaoId === 'string' ? body.sugestaoId : ''
  const conversaId = typeof body?.conversaId === 'string' ? body.conversaId : ''
  const acao = body?.acao
  if (!sugestaoId || !conversaId || (acao !== 'usar' && acao !== 'descartar')) {
    return NextResponse.json({ erro: 'sugestaoId, conversaId e acao (usar | descartar) são obrigatórios' }, { status: 400 })
  }
  try {
    await resolverSugestoes(conversaId, acao === 'usar' ? 'usada' : 'descartada', sugestaoId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[luigi-admin] POST falhou', { err })
    return NextResponse.json({ erro: 'Falha ao fechar a sugestão' }, { status: 500 })
  }
}
