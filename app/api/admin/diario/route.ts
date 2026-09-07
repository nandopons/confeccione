// app/api/admin/diario/route.ts
// ============================================================================
// GET  /api/admin/diario          → tudo que a tela /admin/diario mostra
//                                   (placar agora, fotos, decisões, atas, filas)
// POST /api/admin/diario          → { acao: 'gravar_placar' | 'nova_decisao' |
//                                   'atualizar_decisao' | 'nova_reuniao', ... }
//
// Mesma lib do servidor MCP (app/lib/diario.ts): o que o Fernando vê na tela e
// o que o Claude lê pela ferramenta são o mesmo número, vindo da mesma função.
// Auth: cookie admin (middleware + ehTokenAdminValido), como as outras rotas.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  atualizarDecisao,
  calcularPlacar,
  conversasSemResposta,
  filaCobranca,
  gravarPlacar,
  listarDecisoes,
  listarPlacares,
  listarReunioes,
  pedidosSemFornecedor,
  registrarDecisao,
  registrarReuniao,
  STATUS_DECISAO,
  TIPOS_REUNIAO,
  type StatusDecisao,
} from '@/app/lib/diario'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function autorizado(req: NextRequest): boolean {
  return ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const statusParam = req.nextUrl.searchParams.get('status')
  const status: StatusDecisao | 'todas' =
    statusParam && (STATUS_DECISAO as readonly string[]).includes(statusParam) ? (statusParam as StatusDecisao) : 'todas'

  const [placar, placares, decisoes, reunioes, cobranca, semResposta, semFornecedor] = await Promise.all([
    calcularPlacar(),
    listarPlacares(12),
    listarDecisoes({ status, limite: 100 }),
    listarReunioes({ limite: 30 }),
    filaCobranca(),
    conversasSemResposta(2),
    pedidosSemFornecedor(24),
  ])

  return NextResponse.json({ placar, placares, decisoes, reunioes, filas: { cobranca, semResposta, semFornecedor } })
}

const DataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD')

const Acao = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('gravar_placar'),
    observacoes: z.string().trim().max(2000).optional(),
  }),
  z.object({
    acao: z.literal('nova_decisao'),
    tema: z.string().trim().min(2).max(40),
    titulo: z.string().trim().min(3).max(140),
    decisao: z.string().trim().min(3).max(2000),
    contexto: z.string().trim().max(3000).optional(),
    alternativas: z.string().trim().max(3000).optional(),
    motivo: z.string().trim().max(3000).optional(),
    revisar_em: z.union([DataISO, z.literal('')]).optional(),
    documento: z.string().trim().max(300).optional(),
    reuniao_id: z.string().uuid().optional(),
    decidido_em: z.union([DataISO, z.literal('')]).optional(),
  }),
  z.object({
    acao: z.literal('atualizar_decisao'),
    id: z.string().uuid(),
    status: z.enum(STATUS_DECISAO).optional(),
    revisar_em: z.union([DataISO, z.literal('')]).nullable().optional(),
    motivo: z.string().trim().max(3000).optional(),
  }),
  z.object({
    acao: z.literal('nova_reuniao'),
    tipo: z.enum(TIPOS_REUNIAO),
    titulo: z.string().trim().min(3).max(140),
    resumo: z.string().trim().min(10).max(12000),
    pauta: z.string().trim().max(3000).optional(),
    pendencias: z
      .array(
        z.object({
          descricao: z.string().trim().min(2).max(300),
          dono: z.string().trim().max(60).optional(),
          prazo: z.union([DataISO, z.literal('')]).optional(),
          feita: z.boolean().optional(),
        })
      )
      .max(30)
      .optional(),
    placar_id: z.string().uuid().optional(),
  }),
])

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  const parsed = Acao.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const a = parsed.data

  try {
    if (a.acao === 'gravar_placar') {
      return NextResponse.json({ ok: true, placar: await gravarPlacar('admin', a.observacoes ?? null) })
    }
    if (a.acao === 'nova_decisao') {
      const decisao = await registrarDecisao({
        ...a,
        revisar_em: a.revisar_em || null,
        decidido_em: a.decidido_em || null,
        origem: 'admin',
      })
      return NextResponse.json({ ok: true, decisao })
    }
    if (a.acao === 'atualizar_decisao') {
      const decisao = await atualizarDecisao(a.id, {
        status: a.status,
        revisar_em: a.revisar_em === undefined ? undefined : a.revisar_em || null,
        motivo: a.motivo,
      })
      return NextResponse.json({ ok: true, decisao })
    }
    const reuniao = await registrarReuniao({
      ...a,
      pendencias: a.pendencias?.map((p) => ({ ...p, prazo: p.prazo || null })),
      origem: 'admin',
    })
    return NextResponse.json({ ok: true, reuniao })
  } catch (e) {
    console.error('[admin/diario] falhou', e)
    return NextResponse.json({ erro: e instanceof Error ? e.message : 'Falha inesperada' }, { status: 500 })
  }
}
