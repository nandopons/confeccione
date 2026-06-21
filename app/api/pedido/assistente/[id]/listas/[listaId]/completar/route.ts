// POST /api/pedido/assistente/[id]/listas/[listaId]/completar
// A própria cliente preenche os tamanhos FALTANTES pra fechar a lista antes de
// todo mundo responder. Recebe { faltantes: [{tamanho, qtd}] }, cuja soma DEVE
// ser exatamente (alvo − inscritos atuais). Cada unidade vira uma inscrição
// marcada como complemento; ao final a lista completa (= alvo) e fecha sozinha
// via recomputarLinhaDaLista. O total do modelo continua = alvo (nunca muda).
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recomputarLinhaDaLista, metaQtdLinha } from '@/app/lib/listas-externas'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Ctx = { params: Promise<{ id: string; listaId: string }> }

const Body = z.object({
  faltantes: z.array(z.object({
    tamanho: z.string().min(1).max(12),
    qtd: z.number().int().min(0).max(2000),
  })).min(1),
})

export async function POST(req: Request, ctx: Ctx) {
  const { id, listaId } = await ctx.params

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = Body.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const { data: lista } = await supabase
    .from('listas_externas')
    .select('id, pedido_id, linha_index, lid')
    .eq('id', listaId)
    .eq('pedido_id', id)
    .maybeSingle<{ id: string; pedido_id: string; linha_index: number; lid: string | null }>()
  if (!lista) return NextResponse.json({ erro: 'Lista não encontrada.' }, { status: 404 })

  // alvo da linha (resolve índice por lid)
  const { data: ped } = await supabase
    .from('pedidos_assistente').select('linhas').eq('id', id).single()
  const linhasPed = Array.isArray(ped?.linhas) ? (ped!.linhas as { lid?: string | null; total?: number | null }[]) : []
  let idx = lista.linha_index
  if (lista.lid) { const j = linhasPed.findIndex((x) => x && x.lid === lista.lid); if (j >= 0) idx = j }
  const meta = metaQtdLinha(linhasPed[idx])
  if (meta <= 0) return NextResponse.json({ erro: 'Este modelo não tem quantidade-alvo definida.' }, { status: 409 })

  const { count } = await supabase
    .from('inscricoes_externas').select('id', { count: 'exact', head: true }).eq('lista_id', lista.id)
  const atuais = count ?? 0
  const restante = meta - atuais
  if (restante <= 0) return NextResponse.json({ erro: 'Esta lista já está completa.' }, { status: 409 })

  const itens = p.data.faltantes.filter((f) => f.qtd > 0)
  const soma = itens.reduce((a, f) => a + f.qtd, 0)
  if (soma !== restante) {
    return NextResponse.json({ erro: `Faltam ${restante} peças — distribua exatamente esse total entre os tamanhos.`, restante }, { status: 400 })
  }

  const regs: Record<string, unknown>[] = []
  for (const f of itens) {
    for (let k = 0; k < f.qtd; k++) {
      regs.push({
        lista_id: lista.id,
        pedido_id: lista.pedido_id,
        nome: 'Complemento (organizador)',
        tamanho: f.tamanho.toUpperCase().trim(),
        numero: null,
        observacao: 'adicionado manualmente',
        whatsapp: null,
        email: null,
      })
    }
  }
  const { error } = await supabase.from('inscricoes_externas').insert(regs)
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 })

  // recompute: atinge o alvo → grava tamanhos e fecha a lista.
  await recomputarLinhaDaLista(supabase, lista)
  return NextResponse.json({ ok: true, total: meta })
}
