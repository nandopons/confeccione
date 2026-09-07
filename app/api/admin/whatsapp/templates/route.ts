// app/api/admin/whatsapp/templates/route.ts
// ============================================================================
// GET  /api/admin/whatsapp/templates                → { templates } APROVADOS
//                                                     (o seletor do inbox usa)
// GET  /api/admin/whatsapp/templates?catalogo=1     → todos os status da WABA
//      (&nomes=a,b filtra)                            (pendentes, rejeitados…)
// POST /api/admin/whatsapp/templates                → submete um template novo
//
// Criação e consulta usam app/lib/whatsapp-templates.ts, a mesma lib do MCP.
// Substitui o padrão de rota one-shot por lote (criar-templates-retomada),
// que exigia deploy pra cada template novo.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { listarTemplates } from '@/app/lib/whatsapp-cloud'
import { consultarTemplatesWhatsApp, criarTemplateWhatsApp } from '@/app/lib/whatsapp-templates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function autorizado(req: NextRequest): boolean {
  return ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  if (sp.get('catalogo')) {
    const nomes = (sp.get('nomes') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const r = await consultarTemplatesWhatsApp(nomes.length ? nomes : undefined)
    return NextResponse.json(r, { status: r.ok ? 200 : 502 })
  }

  // Comportamento original: só os aprovados, no formato que o inbox espera.
  const templates = await listarTemplates()
  return NextResponse.json({ templates })
}

const Novo = z.object({
  nome: z.string().trim().min(3).max(512),
  categoria: z.enum(['UTILITY', 'MARKETING']),
  corpo: z.string().min(10).max(1024),
  exemplos: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  rodape: z.string().trim().max(60).optional(),
  idioma: z.string().trim().max(10).optional(),
  permitirTrocaCategoria: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const parsed = Novo.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const r = await criarTemplateWhatsApp(parsed.data)
  return NextResponse.json(r, { status: r.ok ? 200 : 400 })
}
