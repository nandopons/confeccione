// app/api/admin/ofertar/route.ts
// ============================================================================
// POST /api/admin/ofertar
//
// Body: { pedidoId: uuid, fornecedorId: uuid, forcar?: boolean }
//
// Dispara oferta MANUAL pra um par (pedido, fornecedor). Usado quando o
// matching automático falhou ou quando o admin quer empurrar um órfão pra
// fornecedor específico.
//
// Reusa dispararOfertaParaFornecedor (app/lib/ofertas.ts) — fonte única do
// fluxo "criar oferta + WhatsApp + email + ultimo_lead_em". NÃO duplica
// lógica de comunicação.
//
// Pré-condições validadas pelo endpoint (extras ao que a lib genérica
// faz):
//   - fornecedor.status='ativo'  (lib não checa — usada por outros fluxos)
//   - sem oferta status='enviada' do MESMO fornecedor pro mesmo pedido
//   - se forcar=false: tipo/pedido_minimo/raio compatíveis
//
// Pós-ação: UPDATE pedidos_orfaos SET status_orfao='em_captacao' se ainda
// estava 'aberto'.
//
// Privacy-before-acceptance: contato do cliente NUNCA vai pro fornecedor
// nesta camada — dispararOfertaNormal (chamado em cascata) já segue o
// template auditado.
//
// Smoke test curl (depende de cookie admin válido):
//   curl -X POST https://confeccione.com.br/api/admin/ofertar \
//     -H "Content-Type: application/json" \
//     -H "Cookie: confeccione_admin_session=<token>" \
//     -d '{"pedidoId":"<uuid>","fornecedorId":"<uuid>"}'
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { dispararOfertaParaFornecedor } from '@/app/lib/ofertas'
import {
  STATUS_FORNECEDOR_ATIVO,
  fornecedorAtendePedido,
} from '@/app/lib/matching'

type Body = {
  pedidoId?: unknown
  fornecedorId?: unknown
  forcar?: unknown
}

type PedidoRow = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string
  status: string
  fornecedor_aceito_id: string | null
}

type FornecedorRow = {
  id: string
  nome: string
  status: string
  tipos_produto: string[]
  pedido_minimo: number
  raio_atendimento: string
  estado: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  // 1. Parse + valida body
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 })
  }

  if (typeof body.pedidoId !== 'string' || !UUID_RE.test(body.pedidoId)) {
    return NextResponse.json({ erro: 'pedidoId inválido' }, { status: 400 })
  }
  if (typeof body.fornecedorId !== 'string' || !UUID_RE.test(body.fornecedorId)) {
    return NextResponse.json({ erro: 'fornecedorId inválido' }, { status: 400 })
  }
  const pedidoId = body.pedidoId
  const fornecedorId = body.fornecedorId
  const forcar = body.forcar === true

  // 2. Carrega pedido + fornecedor
  const [pedidoRes, fornecedorRes] = await Promise.all([
    supabaseAdmin
      .from('pedidos')
      .select('id, tipo, quantidade, estado, status, fornecedor_aceito_id')
      .eq('id', pedidoId)
      .maybeSingle<PedidoRow>(),
    supabaseAdmin
      .from('leads_fornecedores')
      .select(
        'id, nome, status, tipos_produto, pedido_minimo, raio_atendimento, estado'
      )
      .eq('id', fornecedorId)
      .maybeSingle<FornecedorRow>(),
  ])

  const pedido = pedidoRes.data
  const fornecedor = fornecedorRes.data
  if (!pedido) {
    return NextResponse.json({ erro: 'pedido não encontrado' }, { status: 404 })
  }
  if (!fornecedor) {
    return NextResponse.json(
      { erro: 'fornecedor não encontrado' },
      { status: 404 }
    )
  }

  // 3. Validações de pré-condição
  if (
    pedido.status !== 'novo' &&
    pedido.status !== 'buscando_fornecedor'
  ) {
    return NextResponse.json(
      { erro: `pedido em status '${pedido.status}' — não disparável` },
      { status: 422 }
    )
  }
  if (pedido.fornecedor_aceito_id) {
    return NextResponse.json(
      { erro: 'pedido já tem fornecedor aceito' },
      { status: 422 }
    )
  }
  if (fornecedor.status !== STATUS_FORNECEDOR_ATIVO) {
    return NextResponse.json(
      { erro: `fornecedor com status '${fornecedor.status}' — não disparável` },
      { status: 422 }
    )
  }

  // 3.a Já existe oferta pendente do mesmo fornecedor pra esse pedido?
  const { data: pendente } = await supabaseAdmin
    .from('ofertas')
    .select('id')
    .eq('pedido_id', pedidoId)
    .eq('fornecedor_id', fornecedorId)
    .eq('status', 'enviada')
    .limit(1)
    .maybeSingle()

  if (pendente) {
    return NextResponse.json(
      { erro: 'oferta pendente já existe pra esse par' },
      { status: 409 }
    )
  }

  // 4. Compatibilidade (se !forcar)
  if (!forcar) {
    if (!fornecedorAtendePedido(fornecedor, pedido)) {
      // Mensagem específica de qual critério falhou pra UX do admin
      const motivos: string[] = []
      if (!fornecedor.tipos_produto?.includes(pedido.tipo)) {
        motivos.push(`fornecedor não atende tipo '${pedido.tipo}'`)
      }
      if (
        pedido.quantidade !== null &&
        pedido.quantidade < fornecedor.pedido_minimo
      ) {
        motivos.push(
          `quantidade ${pedido.quantidade} < pedido mínimo ${fornecedor.pedido_minimo}`
        )
      }
      const cobreEstado =
        fornecedor.raio_atendimento === 'nacional' ||
        fornecedor.estado === pedido.estado
      if (!cobreEstado) {
        motivos.push(
          `fornecedor (${fornecedor.estado}, raio ${fornecedor.raio_atendimento}) não cobre ${pedido.estado}`
        )
      }
      return NextResponse.json(
        {
          erro: 'fornecedor não compatível com o pedido',
          motivos,
          hint: 'envie forcar=true pra ignorar (admin assume risco)',
        },
        { status: 422 }
      )
    }
  }

  // 5. Dispara oferta — reusa lib (INSERT + WhatsApp + email + ultimo_lead_em)
  const resultado = await dispararOfertaParaFornecedor(pedidoId, fornecedorId)
  if (!resultado.ok) {
    console.error(
      '[admin/ofertar] dispararOfertaParaFornecedor falhou',
      pedidoId,
      fornecedorId,
      resultado.erro
    )
    return NextResponse.json(
      { erro: resultado.erro },
      { status: 500 }
    )
  }

  // 6. UPDATE pedidos_orfaos: aberto → em_captacao
  // Failure-soft: oferta já foi disparada com sucesso; falha aqui só fica em log.
  const { error: orfErr } = await supabaseAdmin
    .from('pedidos_orfaos')
    .update({ status_orfao: 'em_captacao' })
    .eq('pedido_id', pedidoId)
    .eq('status_orfao', 'aberto')

  if (orfErr) {
    console.error('[admin/ofertar] update pedidos_orfaos falhou:', orfErr)
  }

  return NextResponse.json({
    ok: true,
    ofertaId: resultado.ofertaId,
    mensagem: 'Oferta enviada com sucesso',
  })
}
