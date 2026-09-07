// GET  /api/admin/marketing/campanhas — histórico de campanhas
// POST /api/admin/marketing/campanhas — prévia (acao 'previa') ou criação.
// Criar NÃO dispara: a campanha nasce em rascunho/agendada e só sai quando
// você manda disparar em /campanhas/[id].
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { criarCampanha, listarCampanhas, previaCampanha } from '@/app/lib/campanhas-marketing'
import type { FiltroLeads } from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANAL = z.enum(['whatsapp_template', 'whatsapp_zapi', 'email'])

const FILTRO = z
  .object({
    busca: z.string().trim().max(120).optional(),
    uf: z.string().trim().max(2).optional(),
    origem: z.enum(['todas', 'chat', 'conta', 'manual', 'importacao']).optional(),
    status: z.enum(['todos', 'lead', 'cliente', 'descadastrado']).optional(),
    tag: z.string().trim().max(30).optional(),
    canal: z.enum(['todos', 'whatsapp', 'email']).optional(),
  })
  .default({})

const Body = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('previa'),
    canal: CANAL,
    mensagem: z.string().max(2000).default(''),
    filtro: FILTRO,
  }),
  z.object({
    acao: z.literal('criar'),
    nome: z.string().trim().min(3).max(80),
    canal: CANAL,
    template: z.string().trim().max(80).optional(),
    templateParams: z.object({ corpo: z.array(z.string().max(300)).max(5), botaoUrl: z.string().max(300).optional() }).optional(),
    assunto: z.string().trim().max(150).optional(),
    mensagem: z.string().trim().max(2000).default(''),
    filtro: FILTRO,
    agendadaPara: z.string().datetime().optional(),
  }),
])

export async function GET(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  return NextResponse.json({ campanhas: await listarCampanhas() })
}

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const d = parsed.data

  if (d.acao === 'previa') {
    return NextResponse.json({ ok: true, previa: await previaCampanha(d.filtro as FiltroLeads, d.canal, d.mensagem) })
  }

  if (d.canal === 'email' && !d.assunto) {
    return NextResponse.json({ erro: 'Campanha de e-mail precisa de assunto' }, { status: 400 })
  }
  if (d.canal === 'whatsapp_template' && !d.template) {
    return NextResponse.json({ erro: 'Escolha o template aprovado na Meta' }, { status: 400 })
  }
  if (d.canal !== 'whatsapp_template' && d.mensagem.trim().length < 10) {
    return NextResponse.json({ erro: 'Mensagem muito curta' }, { status: 400 })
  }

  const campanha = await criarCampanha({
    nome: d.nome,
    canal: d.canal,
    template: d.template,
    templateParams: d.templateParams,
    assunto: d.assunto,
    mensagem: d.mensagem,
    filtro: d.filtro as FiltroLeads,
    agendadaPara: d.agendadaPara,
  })
  return NextResponse.json({ ok: true, campanha })
}
