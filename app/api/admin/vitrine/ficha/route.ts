// PATCH /api/admin/vitrine/ficha — o ADMIN edita a ficha de um produto.
// ============================================================================
// Pedido do Fernando (05/09/2026): "às vezes preciso dar algum suporte ao
// fornecedor". A ficha é o que transforma uma foto solta em página de produto
// com pedido direto; confecção que não preenche fica com a foto parada na
// vitrine. Aqui o suporte destrava isso sem pedir a senha de ninguém.
//
// A edição é AUDITADA com ator 'admin': a ficha continua sendo do fornecedor, e
// quando ele estranhar um campo que não escreveu, tem que dar pra dizer quem
// escreveu.
// ============================================================================

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { salvarFichaProdutoAdmin } from '@/app/lib/portfolio-fornecedor'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { registrarAudit, diffMudancas } from '@/app/lib/audit'

export async function PATCH(req: Request) {
  if (!(await eAdminLogado())) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  }

  const id = body.id
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'informe o id da foto' }, { status: 400 })
  }
  if (typeof body.nome !== 'string' || !body.nome.trim()) {
    return NextResponse.json({ error: 'o nome do produto é obrigatório' }, { status: 400 })
  }

  const { data: antes } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('nome, tipo, pedido_minimo, prazo_dias, tamanhos, tecido, cores, tecnicas, observacoes')
    .eq('id', id)
    .maybeSingle()

  const item = await salvarFichaProdutoAdmin(id, {
    nome: body.nome,
    tipo: typeof body.tipo === 'string' ? body.tipo : null,
    pedidoMinimo: body.pedidoMinimo === null || body.pedidoMinimo === undefined || body.pedidoMinimo === ''
      ? null
      : Number(body.pedidoMinimo),
    prazoDias: body.prazoDias === null || body.prazoDias === undefined || body.prazoDias === ''
      ? null
      : Number(body.prazoDias),
    tamanhos: typeof body.tamanhos === 'string' ? body.tamanhos : null,
    tecido: typeof body.tecido === 'string' ? body.tecido : null,
    cores: typeof body.cores === 'string' ? body.cores : null,
    tecnicas: typeof body.tecnicas === 'string' ? body.tecnicas : null,
    observacoes: typeof body.observacoes === 'string' ? body.observacoes : null,
  })

  if (!item) {
    return NextResponse.json({ error: 'não consegui salvar a ficha' }, { status: 500 })
  }

  if (antes) {
    const mudancas = diffMudancas(antes as Record<string, unknown>, {
      nome: item.nome,
      tipo: item.tipo,
      pedido_minimo: item.pedidoMinimo,
      prazo_dias: item.prazoDias,
      tamanhos: item.tamanhos,
      tecido: item.tecido,
      cores: item.cores,
      tecnicas: item.tecnicas,
      observacoes: item.observacoes,
    })
    if (Object.keys(mudancas).length > 0) {
      await registrarAudit({
        ator: 'admin',
        acao: 'produto.ficha_editada_pelo_admin',
        entidade_tipo: 'portfolio_fornecedores',
        entidade_id: id,
        mudancas,
      })
    }
  }

  // O nome da ficha é a legenda do carrossel e o título da página do produto —
  // os dois são cacheados. Sem isto o admin salva, vai conferir no site e vê o
  // texto antigo.
  revalidatePath('/')
  revalidatePath(`/produto/${id}`)

  return NextResponse.json(item)
}
