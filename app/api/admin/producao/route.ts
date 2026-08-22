// app/api/admin/producao/route.ts
// ============================================================================
// Quadro de produção do admin.
//
//   GET                  -> quadro inteiro (todos os pedidos pagos e abertos)
//   GET ?card=<uuid>     -> linha do tempo daquele card
//   GET ?arquivados=1    -> a gaveta: só os cards arquivados
//   GET ?carga=<uuid>    -> o que o card é (itens do PCP) e quanto custa por máquina
//   POST                 -> move um card de etapa
//   POST { acao: 'arquivar' | 'restaurar' } -> tira do quadro / traz de volta
//
// A regra toda mora em app/lib/producao.ts — aqui só entra autenticação e
// tradução HTTP. O painel do fornecedor chama a MESMA lib por outra rota, com
// o filtro de dono ligado.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  carregarQuadro,
  moverEtapa,
  arquivarCard,
  timelineProducao,
  ETAPAS,
  ehEtapa,
} from '@/app/lib/producao'
import { listarItensCard, salvarItensCard, cargaDoCard, listarProdutos } from '@/app/lib/pcp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function naoAutenticado(req: NextRequest): boolean {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (naoAutenticado(req)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  // O PCP do card: o que ele é, quanto custa por máquina, e o catálogo de
  // produtos pro seletor. Numa resposta só — a tela abre os três juntos.
  const carga = req.nextUrl.searchParams.get('carga')
  if (carga) {
    const [itens, resumo, produtos] = await Promise.all([
      listarItensCard(carga),
      cargaDoCard(carga),
      listarProdutos(),
    ])
    return NextResponse.json({ itens, carga: resumo, produtos })
  }

  const card = req.nextUrl.searchParams.get('card')
  if (card) {
    return NextResponse.json({ eventos: await timelineProducao(card) })
  }

  const arquivados = req.nextUrl.searchParams.get('arquivados') === '1'
  return NextResponse.json({
    etapas: ETAPAS,
    cards: await carregarQuadro(undefined, arquivados),
  })
}

// `acao` primeiro na união: sem isso o schema de mover — que não exige `acao` —
// casaria antes e engoliria o pedido de arquivamento.
const Corpo = z.union([
  z.object({
    acao: z.literal('arquivar'),
    cardId: z.string().uuid(),
    motivo: z.string().trim().max(280).nullish(),
  }),
  z.object({
    acao: z.literal('restaurar'),
    cardId: z.string().uuid(),
  }),
  z.object({
    acao: z.literal('salvar_itens_pcp'),
    cardId: z.string().uuid(),
    itens: z
      .array(
        z.object({
          produtoId: z.string().uuid(),
          cor: z.string().trim().max(60),
          tamanho: z.string().trim().max(12),
          quantidade: z.number().int().min(1).max(100_000),
          observacao: z.string().max(280).nullish(),
        }),
      )
      .max(200),
  }),
  z.object({
    acao: z.literal('mover').optional(),
    cardId: z.string().uuid(),
    etapa: z.string().refine(ehEtapa, 'Etapa desconhecida'),
    observacao: z.string().max(280).nullish(),
  }),
])

export async function POST(req: NextRequest) {
  if (naoAutenticado(req)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) {
    return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  }
  const d = corpo.data

  if (d.acao === 'salvar_itens_pcp') {
    const r = await salvarItensCard(
      d.cardId,
      d.itens.map((i) => ({
        produtoId: i.produtoId,
        cor: i.cor,
        tamanho: i.tamanho,
        quantidade: i.quantidade,
        observacao: i.observacao ?? null,
      })),
    )
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })
    // Devolve a carga recalculada: gravar item sem ver o efeito na máquina
    // seria digitar no escuro.
    return NextResponse.json({
      ok: true,
      itens: await listarItensCard(d.cardId),
      carga: await cargaDoCard(d.cardId),
    })
  }

  if (d.acao === 'arquivar' || d.acao === 'restaurar') {
    const r = await arquivarCard({
      cardId: d.cardId,
      arquivar: d.acao === 'arquivar',
      motivo: d.acao === 'arquivar' ? d.motivo ?? null : null,
    })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })
    return NextResponse.json({ ok: true, arquivado: d.acao === 'arquivar' })
  }

  const r = await moverEtapa({
    cardId: d.cardId,
    etapa: d.etapa,
    autor: 'admin',
    autorNome: 'Admin',
    observacao: d.observacao ?? undefined,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })
  return NextResponse.json({ ok: true, etapa: r.etapa })
}
