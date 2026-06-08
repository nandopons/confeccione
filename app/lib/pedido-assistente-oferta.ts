// app/lib/pedido-assistente-oferta.ts
// ============================================================================
// Oferta de PEDIDOS PAGOS (pedidos_assistente) a fornecedores escolhidos no
// admin. Modelo novo (jun/2026): a Confeccione recebe o pagamento do cliente,
// segura até a entrega e repassa 97% ao fornecedor (comissão de 3% embutida).
// Sem cota/mensalidade pro fornecedor — diferente do fluxo antigo (pedidos +
// ofertas + planos).
//
// Gatilho: só entra na fila quando pagamento_status='pago'. Quem oferta é o
// admin (escolhe os fornecedores). O aceite, por ora, é registrado pelo
// próprio admin (o fornecedor responde no WhatsApp). Privacidade: o contato
// do cliente NUNCA vai pro fornecedor antes do aceite.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarMensagem } from './zapi'

export const COMISSAO_PCT = 0.03

export type StatusOferta = 'ofertada' | 'aceita' | 'recusada' | 'cancelada'

export type LinhaPedido = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null
  estampas?: Array<{ posicao?: string | null; tamanho?: string | null }> | null
  descricao?: string | null
}

export type PedidoPago = {
  id: string
  criado_em: string
  nome: string | null
  cep: string | null
  valor_centavos: number | null
  pagamento_status: string | null
  linhas: LinhaPedido[]
  ofertas: OfertaResumo[]
}

export type OfertaResumo = {
  id: string
  fornecedor_id: string
  fornecedor_nome: string | null
  fornecedor_whatsapp: string | null
  status: StatusOferta
  valor_repasse_centavos: number | null
  criado_em: string
  respondido_em: string | null
}

export type FornecedorOpcao = {
  id: string
  nome: string | null
  whatsapp: string | null
  cidade: string | null
  estado: string | null
  status: string | null
  tipos_produto: string[] | null
}

// 97% do total (Confeccione fica com 3%). Arredonda a comissão pra baixo igual
// ao motor de orçamento (round) e devolve o restante ao fornecedor.
export function repasseFornecedor(valorCentavos: number | null | undefined): number | null {
  if (valorCentavos == null) return null
  const comissao = Math.round(valorCentavos * COMISSAO_PCT)
  return valorCentavos - comissao
}

function brl(centavos: number | null | undefined): string {
  if (centavos == null) return '—'
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

// Resumo do pedido SEM dados de contato do cliente — usado na mensagem de
// WhatsApp ao fornecedor e nos cartões do admin.
export function resumirLinhas(linhas: LinhaPedido[]): { totalPecas: number; texto: string } {
  let totalPecas = 0
  const partes: string[] = []
  for (const l of linhas || []) {
    const qtd = typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((s, t) => s + (t.qtd || 0), 0)
    totalPecas += qtd || 0
    const tamanhos = (l.tamanhos || [])
      .filter((t) => t.tamanho)
      .map((t) => `${t.tamanho}:${t.qtd ?? '?'}`)
      .join(' ')
    const estampado = (l.estampas?.length ?? 0) > 0 ? ' (estampado)' : ''
    const cor = l.cor ? ` ${l.cor}` : ''
    const material = l.material ? ` · ${l.material}` : ''
    partes.push(
      `• ${qtd || '?'}x ${l.modelo ?? 'peça'}${cor}${material}${estampado}` +
        (tamanhos ? `\n   tamanhos: ${tamanhos}` : '')
    )
  }
  return { totalPecas, texto: partes.join('\n') }
}

// ---------------------------------------------------------------------------
// Listagem: pedidos pagos + ofertas + fornecedores disponíveis pro seletor.
// ---------------------------------------------------------------------------
export async function listarPedidosPagos(): Promise<{
  pedidos: PedidoPago[]
  fornecedores: FornecedorOpcao[]
}> {
  const { data: pedidosRaw } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, criado_em, nome, cep, valor_centavos, pagamento_status, linhas')
    .eq('pagamento_status', 'pago')
    .order('criado_em', { ascending: false })

  const pedidos = (pedidosRaw ?? []) as Omit<PedidoPago, 'ofertas'>[]
  const ids = pedidos.map((p) => p.id)

  const ofertasPorPedido = new Map<string, OfertaResumo[]>()
  if (ids.length > 0) {
    const { data: ofertasRaw } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select(
        'id, pedido_id, fornecedor_id, status, valor_repasse_centavos, criado_em, respondido_em, leads_fornecedores(nome, whatsapp)'
      )
      .in('pedido_id', ids)
      .order('criado_em', { ascending: true })

    for (const o of (ofertasRaw ?? []) as any[]) {
      const lista = ofertasPorPedido.get(o.pedido_id) ?? []
      lista.push({
        id: o.id,
        fornecedor_id: o.fornecedor_id,
        fornecedor_nome: o.leads_fornecedores?.nome ?? null,
        fornecedor_whatsapp: o.leads_fornecedores?.whatsapp ?? null,
        status: o.status,
        valor_repasse_centavos: o.valor_repasse_centavos,
        criado_em: o.criado_em,
        respondido_em: o.respondido_em,
      })
      ofertasPorPedido.set(o.pedido_id, lista)
    }
  }

  // Todos os fornecedores (admin escolhe; inclui pausados — a pausa só
  // interrompe o disparo automático, não a escolha manual).
  const { data: fornRaw } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, cidade, estado, status, tipos_produto')
    .order('nome', { ascending: true })

  return {
    pedidos: pedidos.map((p) => ({
      ...p,
      linhas: Array.isArray(p.linhas) ? (p.linhas as LinhaPedido[]) : [],
      ofertas: ofertasPorPedido.get(p.id) ?? [],
    })),
    fornecedores: (fornRaw ?? []) as FornecedorOpcao[],
  }
}

// ---------------------------------------------------------------------------
// Ofertar: cria (ou reativa) ofertas pros fornecedores escolhidos e dispara
// WhatsApp. Idempotente por par (pedido,fornecedor): se já existe ofertada,
// não duplica nem re-notifica; se estava recusada/cancelada, reabre.
// ---------------------------------------------------------------------------
export async function ofertarPedido(
  pedidoId: string,
  fornecedorIds: string[]
): Promise<{ ok: boolean; criadas: number; notificadas: number; erro?: string }> {
  const { data: pedido } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, pagamento_status, valor_centavos, linhas, cep')
    .eq('id', pedidoId)
    .maybeSingle<{
      id: string
      pagamento_status: string | null
      valor_centavos: number | null
      linhas: LinhaPedido[]
      cep: string | null
    }>()

  if (!pedido) return { ok: false, criadas: 0, notificadas: 0, erro: 'Pedido não encontrado' }
  if (pedido.pagamento_status !== 'pago') {
    return { ok: false, criadas: 0, notificadas: 0, erro: 'Pedido ainda não está pago' }
  }

  const repasse = repasseFornecedor(pedido.valor_centavos)
  const linhas = Array.isArray(pedido.linhas) ? pedido.linhas : []
  const { totalPecas, texto } = resumirLinhas(linhas)

  const { data: forns } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp')
    .in('id', fornecedorIds)

  const fornById = new Map((forns ?? []).map((f: any) => [f.id, f]))

  let criadas = 0
  let notificadas = 0

  for (const fid of fornecedorIds) {
    const forn = fornById.get(fid)
    if (!forn) continue

    // Já existe oferta pra esse par?
    const { data: existente } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id, status')
      .eq('pedido_id', pedidoId)
      .eq('fornecedor_id', fid)
      .maybeSingle<{ id: string; status: StatusOferta }>()

    if (existente && existente.status === 'ofertada') {
      // já ofertada e pendente — não duplica nem re-notifica
      continue
    }

    if (existente) {
      // reabre (estava recusada/cancelada/aceita) -> volta a ofertada
      const { error } = await supabaseAdmin
        .from('ofertas_pedido_assistente')
        .update({ status: 'ofertada', valor_repasse_centavos: repasse, respondido_em: null })
        .eq('id', existente.id)
      if (error) continue
    } else {
      const { error } = await supabaseAdmin.from('ofertas_pedido_assistente').insert({
        pedido_id: pedidoId,
        fornecedor_id: fid,
        status: 'ofertada',
        valor_repasse_centavos: repasse,
      })
      if (error) continue
    }
    criadas++

    // WhatsApp ao fornecedor — sem contato do cliente.
    if (forn.whatsapp) {
      const mensagem =
        `🧵 *Confeccione — pedido disponível*\n\n` +
        `Um pedido *já pago* está disponível para produção:\n\n` +
        `${texto}\n\n` +
        `Total: *${totalPecas} peças*\n` +
        `Seu repasse: *${brl(repasse)}* (pagamento garantido pela Confeccione, liberado após a entrega em conformidade)\n\n` +
        `Quer assumir este pedido? Responda *SIM* por aqui que a gente te passa os detalhes e o contato.`
      const enviado = await enviarMensagem(forn.whatsapp, mensagem)
      if (enviado) notificadas++
    }
  }

  return { ok: true, criadas, notificadas }
}

// ---------------------------------------------------------------------------
// Marcar status de uma oferta (admin registra o aceite/recusa que veio pelo
// WhatsApp). Ao aceitar, cancela as demais ofertas em aberto do mesmo pedido.
// ---------------------------------------------------------------------------
export async function definirStatusOferta(
  ofertaId: string,
  novoStatus: Extract<StatusOferta, 'aceita' | 'recusada' | 'cancelada'>
): Promise<{ ok: boolean; erro?: string }> {
  const { data: oferta } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('id, pedido_id, fornecedor_id')
    .eq('id', ofertaId)
    .maybeSingle<{ id: string; pedido_id: string; fornecedor_id: string }>()

  if (!oferta) return { ok: false, erro: 'Oferta não encontrada' }

  const { error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .update({ status: novoStatus, respondido_em: new Date().toISOString() })
    .eq('id', ofertaId)
  if (error) return { ok: false, erro: error.message }

  if (novoStatus === 'aceita') {
    // cancela as outras ofertas ainda em aberto do mesmo pedido
    await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .update({ status: 'cancelada', respondido_em: new Date().toISOString() })
      .eq('pedido_id', oferta.pedido_id)
      .eq('status', 'ofertada')
      .neq('id', ofertaId)
  }

  return { ok: true }
}
