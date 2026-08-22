// app/api/admin/pcp/route.ts
// ============================================================================
// Cadastro técnico do PCP — máquinas, produtos, roteiro e ficha de corte.
//
//   GET   -> { maquinas, produtos }  (o cadastro inteiro; a tela carrega tudo)
//   POST  -> { acao: ... }           (união discriminada)
//
// UMA ROTA SÓ, DE PROPÓSITO
// São cinco tabelas de um mesmo cadastro, sempre editado na mesma tela. Cinco
// rotas separadas dariam cinco arquivos, cinco autenticações repetidas e cinco
// pastas — e nada em troca: nenhuma delas seria chamada isolada das outras.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import {
  listarMaquinas,
  listarProdutos,
  salvarMaquina,
  desativarMaquina,
  salvarProduto,
  salvarRoteiro,
  salvarComponentes,
} from '@/app/lib/pcp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function naoAutenticado(req: NextRequest): boolean {
  return !ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)
}

export async function GET(req: NextRequest) {
  if (naoAutenticado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const [maquinas, produtos] = await Promise.all([
    listarMaquinas(req.nextUrl.searchParams.get('inativos') === '1'),
    listarProdutos(req.nextUrl.searchParams.get('inativos') === '1'),
  ])
  return NextResponse.json({ maquinas, produtos })
}

const Corpo = z.discriminatedUnion('acao', [
  z.object({
    acao: z.literal('salvar_maquina'),
    id: z.string().uuid().nullish(),
    codigo: z.string().trim().min(1).max(60),
    nome: z.string().trim().min(1).max(80),
    quantidade: z.number().int().min(0).max(999),
    horasDia: z.number().min(0).max(24),
    setupTrocaMin: z.number().min(0).max(999),
    observacao: z.string().max(280).nullish(),
    ordem: z.number().int().min(0).max(999).optional(),
    ativo: z.boolean().optional(),
  }),
  z.object({ acao: z.literal('desativar_maquina'), id: z.string().uuid() }),
  z.object({
    acao: z.literal('salvar_produto'),
    id: z.string().uuid().nullish(),
    codigo: z.string().trim().min(1).max(60),
    nome: z.string().trim().min(1).max(120),
    descricao: z.string().max(500).nullish(),
    ativo: z.boolean().optional(),
  }),
  z.object({
    acao: z.literal('salvar_roteiro'),
    produtoId: z.string().uuid(),
    operacoes: z
      .array(
        z.object({
          descricao: z.string().trim().max(160),
          maquinaId: z.string().uuid().nullable(),
          // 0 e null significam "ainda não cronometrado" — nunca "instantâneo".
          tempoSegundos: z.number().int().min(0).max(86_400).nullable(),
          observacao: z.string().max(280).nullish(),
        }),
      )
      .max(120),
  }),
  z.object({
    acao: z.literal('salvar_componentes'),
    produtoId: z.string().uuid(),
    componentes: z
      .array(
        z.object({
          nome: z.string().trim().max(120),
          larguraCm: z.number().min(0).max(999).nullable(),
          observacao: z.string().max(280).nullish(),
          medidas: z
            .array(
              z.object({
                tamanho: z.string().trim().max(12),
                comprimentoCm: z.number().min(0).max(9999).nullable(),
              }),
            )
            .max(40),
        }),
      )
      .max(40),
  }),
])

export async function POST(req: NextRequest) {
  if (naoAutenticado(req)) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })
  const d = corpo.data

  let r
  switch (d.acao) {
    case 'salvar_maquina':
      r = await salvarMaquina({
        id: d.id ?? null,
        codigo: d.codigo,
        nome: d.nome,
        quantidade: d.quantidade,
        horasDia: d.horasDia,
        setupTrocaMin: d.setupTrocaMin,
        observacao: d.observacao ?? null,
        ordem: d.ordem,
        ativo: d.ativo,
      })
      break
    case 'desativar_maquina':
      r = await desativarMaquina(d.id)
      break
    case 'salvar_produto':
      r = await salvarProduto({
        id: d.id ?? null,
        codigo: d.codigo,
        nome: d.nome,
        descricao: d.descricao ?? null,
        ativo: d.ativo,
      })
      break
    case 'salvar_roteiro':
      r = await salvarRoteiro(
        d.produtoId,
        d.operacoes.map((o) => ({
          descricao: o.descricao,
          maquinaId: o.maquinaId,
          tempoSegundos: o.tempoSegundos && o.tempoSegundos > 0 ? o.tempoSegundos : null,
          observacao: o.observacao ?? null,
        })),
      )
      break
    case 'salvar_componentes':
      r = await salvarComponentes(
        d.produtoId,
        d.componentes.map((c) => ({
          nome: c.nome,
          larguraCm: c.larguraCm && c.larguraCm > 0 ? c.larguraCm : null,
          observacao: c.observacao ?? null,
          medidas: c.medidas.map((m) => ({
            tamanho: m.tamanho,
            comprimentoCm: m.comprimentoCm && m.comprimentoCm > 0 ? m.comprimentoCm : null,
          })),
        })),
      )
      break
  }

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 })

  // Devolve o cadastro recarregado: toda ação aqui mexe em relações que a tela
  // mostra junto (mudar uma máquina muda o nome dela em N operações).
  const [maquinas, produtos] = await Promise.all([listarMaquinas(), listarProdutos()])
  return NextResponse.json({ ok: true, maquinas, produtos })
}
