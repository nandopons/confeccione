// app/api/admin/whatsapp/conversas/[id]/contexto/route.ts
// ============================================================================
// GET → contexto do contato da conversa pro painel lateral do inbox:
// perfil de cliente/fornecedor vinculado + pedidos (vigentes e recentes).
//
// Vínculo dos pedidos, na ordem:
//   1. pedidos.conta_id = wa_contatos.cliente_id (conta logada)
//   2. fallback: pedidos.whatsapp terminando nos últimos 8 dígitos do wa_id
//      (pega pedido feito sem conta / com telefone digitado diferente)
//
// Vigente = status em ('buscando_fornecedor', 'em_negociacao').
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const dynamic = 'force-dynamic'

const STATUS_VIGENTES = ['buscando_fornecedor', 'em_negociacao']

type PedidoResumo = {
  id: string
  tipo: string | null
  quantidade: number | null
  estado: string | null
  status: string | null
  criado_em: string | null
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!ehTokenAdminValido(req.cookies.get(COOKIE_ADMIN)?.value)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }

  const { id } = await ctx.params

  const { data: conversa, error } = await supabaseAdmin
    .from('wa_conversas')
    .select('id, contato:wa_contatos!inner (id, wa_id, nome, cliente_id, fornecedor_id)')
    .eq('id', id)
    .maybeSingle()

  if (error || !conversa) {
    return NextResponse.json({ erro: 'Conversa não encontrada' }, { status: 404 })
  }

  const contatoRaw = conversa.contato as unknown
  const contato = (Array.isArray(contatoRaw) ? contatoRaw[0] : contatoRaw) as {
    id: string
    wa_id: string
    nome: string | null
    cliente_id: string | null
    fornecedor_id: string | null
  }

  // ------------------------------------------------------------- perfis
  const [clienteRes, fornecedorRes] = await Promise.all([
    contato.cliente_id
      ? supabaseAdmin
          .from('contas_clientes')
          .select('id, nome, email, cidade, uf, plano, criado_em')
          .eq('id', contato.cliente_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    contato.fornecedor_id
      ? supabaseAdmin
          .from('leads_fornecedores')
          .select('id, nome, cidade, estado, status, aprovacao_status, tipos_produto, plano')
          .eq('id', contato.fornecedor_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // ------------------------------------------------------------- pedidos
  // Busca por conta e por sufixo de telefone; junta e dedup por id.
  const ultimos8 = contato.wa_id.replace(/\D/g, '').slice(-8)
  const selecao = 'id, tipo, quantidade, estado, status, criado_em'

  const [porConta, porFone] = await Promise.all([
    contato.cliente_id
      ? supabaseAdmin
          .from('pedidos')
          .select(selecao)
          .eq('conta_id', contato.cliente_id)
          .order('criado_em', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as PedidoResumo[] }),
    ultimos8.length === 8
      ? supabaseAdmin
          .from('pedidos')
          .select(selecao)
          .like('whatsapp', `%${ultimos8}`)
          .order('criado_em', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as PedidoResumo[] }),
  ])

  const vistos = new Set<string>()
  const pedidos: PedidoResumo[] = []
  for (const p of [...(porConta.data ?? []), ...(porFone.data ?? [])] as PedidoResumo[]) {
    if (!vistos.has(p.id)) {
      vistos.add(p.id)
      pedidos.push(p)
    }
  }
  pedidos.sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? ''))

  const vigentes = pedidos.filter((p) => STATUS_VIGENTES.includes(p.status ?? ''))
  const anteriores = pedidos.filter((p) => !STATUS_VIGENTES.includes(p.status ?? '')).slice(0, 3)

  return NextResponse.json({
    contato: { id: contato.id, wa_id: contato.wa_id, nome: contato.nome },
    cliente: clienteRes.data ?? null,
    fornecedor: fornecedorRes.data ?? null,
    pedidosVigentes: vigentes,
    pedidosAnteriores: anteriores,
  })
}
