// POST /api/fornecedor/oferta/[id]/orcamento — o FORNECEDOR define/atualiza o
// orçamento final do pedido aceito. Acesso por uuid da oferta (não-adivinhável),
// mesmo padrão público da página da oferta. Só funciona com oferta ACEITA e
// pedido ainda não pago. Notifica o cliente (e-mail + WhatsApp) ao salvar.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { salvarOrcamentoFornecedor } from '@/app/lib/pedido-assistente-oferta'

export const runtime = 'nodejs'
export const maxDuration = 60

const FreteMeSchema = z.object({
  servicoId: z.number().int().positive(),
  servico: z.string().min(1).max(80),
  transportadora: z.string().min(1).max(80),
  precoCentavos: z.number().int().positive(),
  prazoDias: z.number().int().min(0).max(120),
  volumes: z
    .array(
      z.object({
        altura: z.number().positive(),
        largura: z.number().positive(),
        comprimento: z.number().positive(),
        peso: z.number().positive(),
      })
    )
    .min(1)
    .max(20),
  cepOrigem: z.string().regex(/^\d{8}$/),
  cepDestino: z.string().regex(/^\d{8}$/),
})

// OS ITENS PODEM VIR JUNTO — 25/09/2026. A tela de orçamento agora edita os
// produtos (tirar, acrescentar, mudar grade) e manda cada linha com o seu
// preço. `unitCentavos` continua valendo pra quem só muda preço (e pro app
// mobile, que está fora deste repositório). Um dos dois é obrigatório.
const TamanhoSchema = z.object({ tamanho: z.string().max(20).nullable().optional(), qtd: z.number().int().min(0).nullable().optional() })
// Fotos da linha: mesma forma do PATCH /linhas (ver lá).
const ImagensSchema = z.object({
  manter: z.array(z.string().regex(/^(f|ia):\d{1,2}$/)).max(20),
  novas: z.array(z.string().max(200)).max(6),
})
const LinhaSchema = z.object({
  lid: z.string().max(64).nullable().optional(),
  origIdx: z.number().int().min(0).nullable().optional(),
  modelo: z.string().max(120).nullable().optional(),
  cor: z.string().max(120).nullable().optional(),
  material: z.string().max(160).nullable().optional(),
  total: z.number().int().min(0).nullable().optional(),
  tamanhos: z.array(TamanhoSchema).max(40).nullable().optional(),
  descricao: z.string().max(1000).nullable().optional(),
  imagens: ImagensSchema.nullable().optional(),
  preco_unit_centavos: z.number().int().positive('Informe um valor por unidade em cada item.'),
})

const BodySchema = z.object({
  unitCentavos: z.array(z.number().int().positive()).min(1).max(50).optional(),
  linhas: z.array(LinhaSchema).min(1, 'O pedido precisa ter pelo menos um produto.').max(60).optional(),
  freteCentavos: z.number().int().min(0),
  // ORÇAMENTO SEM PRAZO NÃO É ORÇAMENTO, É PREÇO — 12/09/2026.
  //
  // A coluna nasceu ANULÁVEL no banco porque o app mobile também grava orçamento
  // e está fora deste repositório (ver DEBT.md). A obrigatoriedade mora aqui, no
  // caminho que a gente controla: a tela de orçamento do fornecedor.
  //
  // Faixa 1–180 igual à do banco e à do `prazo_minimo_dias` do cadastro: duas
  // réguas de prazo discordando no mesmo sistema é como uma confecção que
  // declara mínimo 120 não consegue gravar 120 aqui.
  prazoProducaoDias: z.number().int().min(1).max(180),
  freteMe: FreteMeSchema.nullable().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ erro: 'id ausente' }, { status: 400 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: p.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  if (!p.data.linhas && !p.data.unitCentavos) return NextResponse.json({ erro: 'Faltam os valores dos itens.' }, { status: 400 })

  const r = await salvarOrcamentoFornecedor(
    id,
    p.data.unitCentavos ?? [],
    p.data.freteCentavos,
    p.data.freteMe ?? null,
    p.data.prazoProducaoDias,
    { linhas: p.data.linhas ?? null }
  )
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao salvar' }, { status: 409 })

  return NextResponse.json({
    ok: true,
    valorClienteCentavos: r.valorClienteCentavos,
    repasseCentavos: r.repasseCentavos,
    itensAjustados: r.itensAjustados ?? false,
  })
}
