// PATCH  /api/admin/marketing/automacoes/[id] — salva o fluxo inteiro
// POST   /api/admin/marketing/automacoes/[id] — ativar | pausar | rodar agora
// DELETE /api/admin/marketing/automacoes/[id]
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  definirStatusAutomacao,
  excluirAutomacao,
  obterAutomacao,
  rodarAutomacao,
  salvarAutomacao,
} from '@/app/lib/automacoes-marketing'
import type { FiltroLeads } from '@/app/lib/leads-marketing'
import { AutomacaoSchema } from '@/app/lib/marketing-schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function autorizado(req: NextRequest): boolean {
  return ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const { id } = await params
  const parsed = AutomacaoSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  try {
    await salvarAutomacao(id, { ...parsed.data, publico: parsed.data.publico as FiltroLeads })
    return NextResponse.json({ ok: true, automacao: await obterAutomacao(id) })
  } catch (e) {
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar' }, { status: 400 })
  }
}

const Acao = z.object({ acao: z.enum(['ativar', 'pausar', 'rodar']) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const { id } = await params
  const parsed = Acao.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 })

  if (parsed.data.acao === 'rodar') {
    try {
      return NextResponse.json({ ok: true, resultado: await rodarAutomacao(id, { forcar: true }) })
    } catch (e) {
      return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha ao rodar' }, { status: 400 })
    }
  }

  const automacao = await obterAutomacao(id)
  if (!automacao) return NextResponse.json({ erro: 'Fluxo não encontrado' }, { status: 404 })

  if (parsed.data.acao === 'ativar') {
    const semTemplate = automacao.passos.filter((p) => p.ativo && !p.templateId).length
    if (automacao.passos.length === 0 || semTemplate > 0) {
      return NextResponse.json(
        { erro: 'Antes de ativar, todo passo do fluxo precisa de um template escolhido.' },
        { status: 400 }
      )
    }
  }

  await definirStatusAutomacao(id, parsed.data.acao === 'ativar' ? 'ativa' : 'pausada')
  return NextResponse.json({ ok: true, automacao: await obterAutomacao(id) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const { id } = await params
  await excluirAutomacao(id)
  return NextResponse.json({ ok: true })
}
