// app/lib/precisa-atencao.ts
// ============================================================================
// Fonte de verdade única do conjunto "Precisa de atenção".
//
// Núcleo de seleção compartilhado pela aba /admin/pedidos?aba=precisa_atencao
// e pelo card do dashboard /admin. Como ambos derivam da MESMA função,
// length da aba === count do card, sempre.
//
// Seleção (união de dois conjuntos, dedup por pedido_id):
//   (1) órfão ATIVO (aberto/em_captacao) cujo pedido ainda está
//       'buscando_fornecedor' — exclui quem tem oferta 'enviada';
//   (2) pedido 'buscando_fornecedor' sem fornecedor aceito e sem busca
//       agendada pro futuro (stuck) — exclui oferta enviada e dedup (órfão vence).
//
// NÃO faz N+1: 3 queries fixas independente do nº de linhas. O enriquecimento
// do modal (carregarDadosDetalhe) é responsabilidade da page, não daqui.
// ============================================================================

import { supabaseAdmin } from '@/app/lib/supabase-server'
import type { InfoOrfao } from '@/app/admin/(painel)/orfaos/ModalDetalhesOrfao'

export type PedidoBase = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string
  nome: string
  whatsapp: string
  criado_em: string
}

export type LinhaPrecisaAtencao = {
  pedido: PedidoBase
  motivo: string
  /** Presente quando o pedido já é órfão registrado (alimenta o modal). */
  orfao: InfoOrfao | null
}

/** pedido_ids com oferta 'enviada' ativa. Em oferta tem a maior precedência. */
async function pedidosComOfertaEnviada(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('ofertas')
    .select('pedido_id')
    .eq('status', 'enviada')
  return new Set(
    ((data ?? []) as Array<{ pedido_id: string }>).map((o) => o.pedido_id)
  )
}

/** Precisa de atenção = órfão ativo (buscando) UNIÃO buscando-sem-oferta-sem-
 *  agendamento, dedup por pedido_id (órfão vence), excluindo oferta enviada. */
export async function carregarPrecisaAtencao(
  agoraMs: number
): Promise<LinhaPrecisaAtencao[]> {
  const agoraIso = new Date(agoraMs).toISOString()
  const comOferta = await pedidosComOfertaEnviada()

  // (1) órfãos ativos — via view. Filtra pedido_status='buscando_fornecedor'
  //     pra um órfão stale num pedido já aceito NÃO duplicar com "Em negociação".
  const { data: orfaosRaw } = await supabaseAdmin
    .from('vw_pedidos_orfaos_admin')
    .select(
      'pedido_id, tipo, quantidade, estado, nome, whatsapp, pedido_criado_em, orfao_id, prioridade, motivo_orfao, status_orfao, notas_admin, responsavel_captacao'
    )
    .in('status_orfao', ['aberto', 'em_captacao'])
    .eq('pedido_status', 'buscando_fornecedor')

  const orfaos = (orfaosRaw ?? []) as Array<{
    pedido_id: string
    tipo: string
    quantidade: number | null
    estado: string
    nome: string
    whatsapp: string
    pedido_criado_em: string
    orfao_id: string
    prioridade: number
    motivo_orfao: string | null
    status_orfao: InfoOrfao['status_orfao']
    notas_admin: string | null
    responsavel_captacao: string | null
  }>

  // (2) buscando "preso": sem fornecedor, buscar_apos nulo/passado.
  const { data: stuckRaw } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, nome, whatsapp, criado_em')
    .eq('status', 'buscando_fornecedor')
    .is('fornecedor_aceito_id', null)
    .or(`buscar_apos.is.null,buscar_apos.lte.${agoraIso}`)

  const stuck = (stuckRaw ?? []) as PedidoBase[]

  const map = new Map<string, LinhaPrecisaAtencao>()

  for (const o of orfaos) {
    if (comOferta.has(o.pedido_id)) continue
    map.set(o.pedido_id, {
      pedido: {
        id: o.pedido_id,
        tipo: o.tipo,
        quantidade: o.quantidade,
        estado: o.estado,
        nome: o.nome,
        whatsapp: o.whatsapp,
        criado_em: o.pedido_criado_em,
      },
      motivo: o.motivo_orfao ?? 'sem fornecedor',
      orfao: {
        orfao_id: o.orfao_id,
        status_orfao: o.status_orfao,
        prioridade: o.prioridade,
        motivo_orfao: o.motivo_orfao,
        notas_admin: o.notas_admin,
        responsavel_captacao: o.responsavel_captacao,
      },
    })
  }

  for (const p of stuck) {
    if (comOferta.has(p.id)) continue
    if (map.has(p.id)) continue // já entrou como órfão (vence)
    map.set(p.id, {
      pedido: p,
      motivo: 'buscando, sem oferta ativa',
      orfao: null,
    })
  }

  // Ordena: maior prioridade primeiro (sem órfão = -1, vai depois), depois
  // mais antigo primeiro.
  return Array.from(map.values()).sort((a, b) => {
    const pa = a.orfao?.prioridade ?? -1
    const pb = b.orfao?.prioridade ?? -1
    if (pb !== pa) return pb - pa
    return (
      new Date(a.pedido.criado_em).getTime() -
      new Date(b.pedido.criado_em).getTime()
    )
  })
}

/** Contagem do conjunto "Precisa de atenção". Reusa o MESMO núcleo de seleção
 *  que a aba — garante que o card do dashboard nunca diverge da aba. */
export async function contarPrecisaAtencao(agoraMs: number): Promise<number> {
  return (await carregarPrecisaAtencao(agoraMs)).length
}
