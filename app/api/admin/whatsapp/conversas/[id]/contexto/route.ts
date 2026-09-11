// app/api/admin/whatsapp/conversas/[id]/contexto/route.ts
// ============================================================================
// GET → contexto do contato da conversa pro painel lateral do inbox:
// perfil de cliente/fornecedor vinculado + pedidos (vigentes e recentes).
//
// A ERA ERRADA — corrigido em 10/09/2026.
//
// Este painel lia a tabela `pedidos`, morta desde 28/06. O resultado é que ele
// dizia "Nenhum pedido em andamento" com o pedido do cliente aberto na conversa
// ao lado — e "Sem cadastro vinculado" pra quem tinha nome, e-mail e endereço
// gravados. Quem manda hoje é `pedidos_assistente` (view `_etapas`).
//
// Vínculo dos pedidos, na ordem:
//   1. telefone terminando nos últimos 8 dígitos do wa_id — cobre o nono dígito,
//      que faz o mesmo número aparecer com 12 e com 13 dígitos
//   2. e-mail da conta logada, quando o contato tem cliente_id
//
// DADOS DO CLIENTE: a maioria não tem conta (`cliente_id` nulo) e mesmo assim
// deu nome, e-mail, CEP e CNPJ no pedido. O painel monta a ficha a partir do
// pedido mais recente que tiver cada campo — é o que o Fernando precisa ver sem
// abrir outra aba, e é a mesma fonte que o Luigi usa pra não pedir de novo.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const dynamic = 'force-dynamic'

/** Etapas em que o pedido ainda está vivo — o resto vira "anteriores". */
const ETAPAS_VIGENTES = [
  'captado',
  'pedido_completo',
  'buscando_fornecedor',
  'sem_fornecedor',
  'em_negociacao',
  'sem_resposta',
  'orcamento_vencido',
  'pago',
  'em_producao',
  'pronto',
]

type PedidoResumo = {
  id: string
  codigo: string | null
  etapa: string | null
  pecas: number | null
  criado_em: string | null
  nome: string | null
  email: string | null
  telefone: string | null
  cep: string | null
  numero: string | null
  complemento: string | null
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cpf_cnpj: string | null
}

/** A ficha do cliente montada do pedido mais recente que tiver cada campo. */
function fichaDoCliente(pedidos: PedidoResumo[]) {
  const primeiro = <K extends keyof PedidoResumo>(campo: K): PedidoResumo[K] | null => {
    for (const p of pedidos) {
      const v = p[campo]
      if (typeof v === 'string' && v.trim()) return v
    }
    return null
  }
  const cep = primeiro('cep')
  const endereco = cep
    ? [primeiro('logradouro'), primeiro('numero'), primeiro('complemento'), primeiro('bairro'),
       [primeiro('cidade'), primeiro('uf')].filter(Boolean).join('/')]
        .filter(Boolean)
        .join(', ')
    : null

  return {
    nome: primeiro('nome'),
    email: primeiro('email'),
    telefone: primeiro('telefone'),
    cpfCnpj: primeiro('cpf_cnpj'),
    cep,
    endereco,
  }
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
  const selecao =
    'id, codigo, etapa, pecas, criado_em, nome, email, telefone, cep, numero, complemento, logradouro, bairro, cidade, uf, cpf_cnpj'
  const emailConta = (clienteRes.data as { email?: string | null } | null)?.email?.trim() ?? null

  const [porFone, porEmail] = await Promise.all([
    ultimos8.length === 8
      ? supabaseAdmin
          .from('pedidos_assistente_etapas')
          .select(selecao)
          .like('telefone', `%${ultimos8}`)
          .order('criado_em', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as PedidoResumo[] }),
    emailConta
      ? supabaseAdmin
          .from('pedidos_assistente_etapas')
          .select(selecao)
          .ilike('email', emailConta)
          .order('criado_em', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as PedidoResumo[] }),
  ])

  const vistos = new Set<string>()
  const pedidos: PedidoResumo[] = []
  for (const p of [...(porFone.data ?? []), ...(porEmail.data ?? [])] as PedidoResumo[]) {
    if (!vistos.has(p.id)) {
      vistos.add(p.id)
      pedidos.push(p)
    }
  }
  pedidos.sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? ''))

  const vigentes = pedidos.filter((p) => ETAPAS_VIGENTES.includes(p.etapa ?? ''))
  const anteriores = pedidos.filter((p) => !ETAPAS_VIGENTES.includes(p.etapa ?? '')).slice(0, 3)

  return NextResponse.json({
    contato: { id: contato.id, wa_id: contato.wa_id, nome: contato.nome },
    cliente: clienteRes.data ?? null,
    fornecedor: fornecedorRes.data ?? null,
    // A ficha vale mesmo sem conta: sai dos pedidos, que é onde o dado está.
    dadosCliente: pedidos.length > 0 ? fichaDoCliente(pedidos) : null,
    pedidosVigentes: vigentes,
    pedidosAnteriores: anteriores,
  })
}
