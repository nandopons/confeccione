// app/api/admin/fornecedores-compativeis/route.ts
// ============================================================================
// GET /api/admin/fornecedores-compativeis?pedidoId=<uuid>&incluirTodos=<bool>
//
// Lista fornecedores ATIVOS sem oferta pendente pra esse pedido. Default:
// só os que casam em todos critérios (tipo, pedido_minimo, raio). Com
// incluirTodos=true, devolve todos com flag `compativel` indicando se
// casariam — usado pelo dropdown "Mostrar todos?" do painel admin.
//
// Reusa fornecedorAtendePedido (app/lib/matching.ts) — fonte única da
// regra de compatibilidade.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  STATUS_FORNECEDOR_ATIVO,
  fornecedorAtendePedido,
} from '@/app/lib/matching'

type FornecedorRow = {
  id: string
  nome: string
  estado: string
  status: string
  tipos_produto: string[]
  pedido_minimo: number
  raio_atendimento: string
}

type PedidoRow = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string
  status: string
}

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const pedidoId = req.nextUrl.searchParams.get('pedidoId')
  const incluirTodos = req.nextUrl.searchParams.get('incluirTodos') === 'true'

  if (!pedidoId) {
    return NextResponse.json({ erro: 'pedidoId obrigatório' }, { status: 400 })
  }

  // 1. Carrega pedido
  const { data: pedido } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, status')
    .eq('id', pedidoId)
    .maybeSingle<PedidoRow>()

  if (!pedido) {
    return NextResponse.json({ erro: 'pedido não encontrado' }, { status: 404 })
  }

  // 2. Carrega fornecedores ativos
  const { data: fornecedoresRaw, error: fErr } = await supabaseAdmin
    .from('leads_fornecedores')
    .select(
      'id, nome, estado, status, tipos_produto, pedido_minimo, raio_atendimento'
    )
    .eq('status', STATUS_FORNECEDOR_ATIVO)

  if (fErr) {
    console.error('[fornecedores-compativeis] SELECT fornecedores falhou:', fErr)
    return NextResponse.json({ erro: 'Erro ao processar' }, { status: 500 })
  }

  const fornecedores = (fornecedoresRaw ?? []) as FornecedorRow[]

  // 3. Carrega ofertas pendentes do pedido pra excluir esses fornecedores
  const { data: pendentesRaw } = await supabaseAdmin
    .from('ofertas')
    .select('fornecedor_id')
    .eq('pedido_id', pedidoId)
    .eq('status', 'enviada')

  const fornecedoresComOfertaPendente = new Set<string>(
    ((pendentesRaw ?? []) as Array<{ fornecedor_id: string }>).map(
      (o) => o.fornecedor_id
    )
  )

  // 4. Filtra + flag compativel
  const lista = fornecedores
    .filter((f) => !fornecedoresComOfertaPendente.has(f.id))
    .map((f) => ({
      id: f.id,
      nome: f.nome,
      estado: f.estado,
      tipos_produto: f.tipos_produto,
      pedido_minimo: f.pedido_minimo,
      raio_atendimento: f.raio_atendimento,
      compativel: fornecedorAtendePedido(f, pedido),
    }))
    .filter((f) => incluirTodos || f.compativel)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return NextResponse.json({
    ok: true,
    pedidoId,
    incluirTodos,
    fornecedores: lista,
  })
}
