// POST /api/admin/marketing/leads/importar — importação de CSV em 3 passos.
//   acao 'ler'      → devolve cabeçalho, mapeamento sugerido e 1ª linhas
//   acao 'previa'   → com o mapeamento escolhido, diz quantos entram/repetem
//   acao 'importar' → grava de fato (dedupe por WhatsApp/e-mail)
// O arquivo vai no corpo como texto — nada é salvo em disco.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  aplicarMapeamento,
  importarLeads,
  lerCsv,
  previaImportacao,
  sugerirMapeamento,
  type CampoLead,
} from '@/app/lib/leads-marketing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CAMPO = z.enum(['nome', 'empresa', 'telefone', 'email', 'cidade', 'uf', 'observacao', 'ignorar'])

const Body = z.discriminatedUnion('acao', [
  z.object({ acao: z.literal('ler'), csv: z.string().min(2).max(6_000_000) }),
  z.object({ acao: z.literal('previa'), csv: z.string().min(2).max(6_000_000), mapa: z.array(CAMPO) }),
  z.object({
    acao: z.literal('importar'),
    csv: z.string().min(2).max(6_000_000),
    mapa: z.array(CAMPO),
    etiqueta: z.string().trim().max(60).optional(),
    tags: z.array(z.string().trim().max(30)).max(5).optional(),
  }),
])

export async function POST(req: NextRequest) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  const d = parsed.data

  const { cabecalho, linhas } = lerCsv(d.csv)
  if (cabecalho.length === 0) return NextResponse.json({ erro: 'Arquivo sem cabeçalho' }, { status: 400 })

  if (d.acao === 'ler') {
    return NextResponse.json({
      ok: true,
      cabecalho,
      mapa: sugerirMapeamento(cabecalho),
      totalLinhas: linhas.length,
      exemplo: linhas.slice(0, 5),
    })
  }

  const mapa = d.mapa as CampoLead[]
  if (mapa.length !== cabecalho.length) {
    return NextResponse.json({ erro: 'Mapeamento não bate com as colunas do arquivo' }, { status: 400 })
  }
  const registros = aplicarMapeamento(linhas, mapa)

  if (d.acao === 'previa') {
    return NextResponse.json({ ok: true, previa: await previaImportacao(registros) })
  }
  return NextResponse.json({
    ok: true,
    resultado: await importarLeads(registros, { etiqueta: d.etiqueta, tags: d.tags }),
  })
}
