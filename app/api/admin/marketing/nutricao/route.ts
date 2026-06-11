// GET/POST /api/admin/marketing/nutricao — config + execução manual da nutrição.
// GET: devolve a config atual. POST {acao:'salvar',...}: salva config.
// POST {acao:'executar'}: roda uma rodada agora (forçada, mas com as travas
// anti-spam de sempre). Guardado por cookie admin.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  executarNutricao,
  obterConfigNutricao,
  salvarConfigNutricao,
} from '@/app/lib/marketing-contatos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function autorizado(req: NextRequest): boolean {
  return ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  return NextResponse.json({ config: await obterConfigNutricao() })
}

const BodySchema = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('salvar'),
    ativa: z.boolean(),
    diasParado: z.number().int().min(1).max(60),
    maxToques: z.number().int().min(1).max(5),
  }),
  z.object({ acao: z.literal('executar') }),
])

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  if (parsed.data.acao === 'salvar') {
    const { ativa, diasParado, maxToques } = parsed.data
    await salvarConfigNutricao({ ativa, diasParado, maxToques })
    return NextResponse.json({ ok: true, config: await obterConfigNutricao() })
  }

  const resultado = await executarNutricao({ forcar: true })
  return NextResponse.json({ ok: true, resultado })
}
