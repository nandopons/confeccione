// GET  /api/admin/marketing/automacoes — fluxos + estatísticas
// POST /api/admin/marketing/automacoes — cria fluxo, ou (acao 'previa') simula
//      quantos leads entrariam agora sem gravar nada.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  estatisticasAutomacoes,
  listarAutomacoes,
  previaAutomacao,
  salvarAutomacao,
} from '@/app/lib/automacoes-marketing'
import type { FiltroLeads } from '@/app/lib/leads-marketing'
import { AutomacaoSchema, CANAL_TEMPLATE, GATILHO, PUBLICO_SCHEMA } from '@/app/lib/marketing-schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PreviaSchema = z.object({
  gatilho: GATILHO,
  gatilhoDias: z.number().int().min(0).max(365),
  publico: PUBLICO_SCHEMA,
  canal: CANAL_TEMPLATE.optional(),
})

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const [automacoes, estatisticas] = await Promise.all([listarAutomacoes(), estatisticasAutomacoes()])
  return NextResponse.json({ automacoes, estatisticas })
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const corpo = (await req.json().catch(() => null)) as { acao?: string } | null
  if (!corpo || typeof corpo !== 'object') {
    return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  }

  // Prévia: simula quantos entrariam agora, sem gravar nada.
  if (corpo.acao === 'previa') {
    const p = PreviaSchema.safeParse(corpo)
    if (!p.success) {
      return NextResponse.json({ erro: p.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
    }
    return NextResponse.json({
      ok: true,
      previa: await previaAutomacao(p.data.gatilho, p.data.gatilhoDias, p.data.publico as FiltroLeads, p.data.canal),
    })
  }

  const parsed = AutomacaoSchema.safeParse(corpo)
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const d = parsed.data

  try {
    const id = await salvarAutomacao(null, { ...d, publico: d.publico as FiltroLeads })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar' }, { status: 400 })
  }
}
