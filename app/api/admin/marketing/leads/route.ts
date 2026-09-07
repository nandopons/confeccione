// GET  /api/admin/marketing/leads  — lista paginada da base (filtros na query)
// POST /api/admin/marketing/leads  — cadastro manual de um lead
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { filtroLeadsDaQuery, listarLeads, upsertLead } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function autorizado(req: NextRequest): boolean {
  return ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const pagina = Math.max(0, Number(sp.get('pagina') ?? 0) || 0)
  const { leads, total } = await listarLeads(filtroLeadsDaQuery(sp), pagina, 50)
  return NextResponse.json({ leads, total, pagina })
}

const NovoLead = z.object({
  nome: z.string().trim().max(120).optional(),
  empresa: z.string().trim().max(120).optional(),
  telefone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(160).optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: z.string().trim().max(2).optional(),
  observacao: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().max(30)).max(10).optional(),
})

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const parsed = NovoLead.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const r = await upsertLead({ ...parsed.data, origem: 'manual' })
  if (r.acao === 'invalido') {
    return NextResponse.json({ erro: `Não deu pra salvar: ${r.motivo}` }, { status: 400 })
  }
  return NextResponse.json({ ok: true, acao: r.acao, id: r.id })
}
