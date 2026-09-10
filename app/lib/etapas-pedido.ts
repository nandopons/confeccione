// app/lib/etapas-pedido.ts
// ============================================================================
// ETAPAS DO PEDIDO — o catálogo que acompanha a view pedidos_assistente_etapas
// (migração 20260908010000_etapas_pedido.sql, decisão D-8).
//
// A etapa é calculada NO BANCO; aqui só mora o que a tela e o agente precisam
// saber sobre cada uma: nome pra mostrar, grupo, cor, se é alerta e o que
// fazer. Nenhuma função deste arquivo decide etapa — se a regra parecer
// errada, o lugar de mexer é a view.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { ETAPAS, type Etapa, type GrupoEtapa, type MotivoEncerramento } from './etapas-pedido-catalogo'

export * from './etapas-pedido-catalogo'

// ─── Leitura da view ────────────────────────────────────────────────────────

export type PedidoEtapa = {
  id: string
  codigo: string | null
  numero: string | null
  nome: string | null
  telefone: string | null
  email: string | null
  uf: string | null
  cidade: string | null
  categoria: string | null
  origem: string | null
  status: string
  orcamento_status: string | null
  pagamento_status: string | null
  valor_centavos: number | null
  repasse_centavos: number | null
  criado_em: string
  atualizado_em: string
  confirmado_em: string | null
  orcamento_definido_em: string | null
  finalizado_em: string | null
  encerrado_em: string | null
  encerrado_motivo: MotivoEncerramento | null
  encerrado_por: string | null
  motivo_parada: string | null
  motivo_parada_em: string | null
  linhas: unknown
  peca_completa: boolean
  contato_ok: boolean
  oferta_aceita: boolean
  aceita_em: string | null
  ofertas_no_ar: number
  ofertas_recusadas: number
  ofertas_total: number
  ultimo_contato_cliente_em: string | null
  ultimo_toque_em: string | null
  etapa: Etapa
  grupo: GrupoEtapa
  alerta: boolean
  desde: string
}

export const COLUNAS_ETAPA =
  'id, codigo, numero, nome, telefone, email, uf, cidade, categoria, origem, status, orcamento_status, pagamento_status, ' +
  'valor_centavos, repasse_centavos, criado_em, atualizado_em, confirmado_em, orcamento_definido_em, finalizado_em, ' +
  'encerrado_em, encerrado_motivo, encerrado_por, motivo_parada, motivo_parada_em, linhas, peca_completa, contato_ok, ' +
  'oferta_aceita, aceita_em, ofertas_no_ar, ofertas_recusadas, ofertas_total, ultimo_contato_cliente_em, ultimo_toque_em, ' +
  'etapa, grupo, alerta, desde'

export function diasNaEtapa(p: Pick<PedidoEtapa, 'desde'>, agora = Date.now()): number {
  return Math.max(0, Math.floor((agora - new Date(p.desde).getTime()) / 86400_000))
}

/** Pedidos numa (ou mais) etapa(s), do mais tempo parado pro mais recente. */
export async function pedidosPorEtapa(etapas: Etapa[], limite = 100): Promise<PedidoEtapa[]> {
  if (etapas.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select(COLUNAS_ETAPA)
    .in('etapa', etapas)
    .order('desde', { ascending: true })
    .limit(Math.min(Math.max(limite, 1), 500))
  if (error) throw new Error(`pedidos por etapa: ${error.message}`)
  return (data ?? []) as unknown as PedidoEtapa[]
}

/** Etapa de um conjunto de pedidos (pra enriquecer listas que já existem). */
export async function etapasDosPedidos(ids: string[]): Promise<Map<string, Pick<PedidoEtapa, 'etapa' | 'grupo' | 'alerta' | 'desde' | 'encerrado_motivo' | 'motivo_parada'>>> {
  const mapa = new Map<string, Pick<PedidoEtapa, 'etapa' | 'grupo' | 'alerta' | 'desde' | 'encerrado_motivo' | 'motivo_parada'>>()
  if (ids.length === 0) return mapa
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id, etapa, grupo, alerta, desde, encerrado_motivo, motivo_parada')
    .in('id', ids)
  if (error) throw new Error(`etapas dos pedidos: ${error.message}`)
  for (const r of (data ?? []) as Array<{ id: string } & Pick<PedidoEtapa, 'etapa' | 'grupo' | 'alerta' | 'desde' | 'encerrado_motivo' | 'motivo_parada'>>) {
    mapa.set(r.id, { etapa: r.etapa, grupo: r.grupo, alerta: r.alerta, desde: r.desde, encerrado_motivo: r.encerrado_motivo, motivo_parada: r.motivo_parada })
  }
  return mapa
}

/** Contagem por etapa (a foto do funil). */
export async function contagemPorEtapa(): Promise<Array<{ etapa: Etapa; grupo: GrupoEtapa; n: number; valor_centavos: number }>> {
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('etapa, grupo, valor_centavos')
    .limit(5000)
  if (error) throw new Error(`contagem por etapa: ${error.message}`)
  const acc = new Map<Etapa, { grupo: GrupoEtapa; n: number; valor_centavos: number }>()
  for (const r of (data ?? []) as Array<{ etapa: Etapa; grupo: GrupoEtapa; valor_centavos: number | null }>) {
    const a = acc.get(r.etapa) ?? { grupo: r.grupo, n: 0, valor_centavos: 0 }
    a.n++
    a.valor_centavos += r.valor_centavos ?? 0
    acc.set(r.etapa, a)
  }
  const saida: Array<{ etapa: Etapa; grupo: GrupoEtapa; n: number; valor_centavos: number }> = []
  for (const e of ETAPAS) {
    const a = acc.get(e)
    if (a) saida.push({ etapa: e, ...a })
  }
  return saida
}

// ─── Fatos novos: encerrar e motivo de parada ───────────────────────────────

export type QuemEncerra = 'admin' | 'luigi' | 'gestor_whatsapp' | 'mcp' | 'regua'

/**
 * Dá o pedido como perdido, com motivo. Pedido pago ou finalizado não se encerra.
 *
 * ATÉ 10/09/2026 A REGRA ERA "NUNCA UM CRON" — e mudou de propósito.
 * A ideia original era boa: encerrar é um julgamento sobre a intenção de alguém,
 * e máquina não julga intenção. O que aprendemos é que NÃO encerrar também é um
 * julgamento, e pior: o pedido fica no funil pra sempre e a pessoa segue
 * recebendo lembrete de um pedido que ela abandonou em três dias.
 *
 * Então a régua de pedido incompleto encerra, com duas amarras que a máquina
 * consegue respeitar: só depois de três toques sem UMA interação, e sempre com
 * motivo `sumiu`, que é literalmente o fato observado — não uma leitura do que
 * a pessoa quis. Quem disse qualquer coisa sai da régua antes disso, e quem
 * pediu tempo é silenciado pelo Luigi sem perder o pedido.
 */
export async function encerrarPedido(
  id: string,
  motivo: MotivoEncerramento,
  por: QuemEncerra,
  observacao?: string | null
): Promise<PedidoEtapa> {
  const { data: atual, error: e1 } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id, etapa, nome, codigo')
    .eq('id', id)
    .maybeSingle()
  if (e1) throw new Error(`encerrar pedido: ${e1.message}`)
  if (!atual) throw new Error('Pedido não encontrado.')
  const etapaAtual = (atual as { etapa: Etapa }).etapa
  if (['pago', 'em_producao', 'pronto', 'entregue', 'finalizado'].includes(etapaAtual)) {
    throw new Error(`Pedido ${etapaAtual}: não se encerra pedido pago.`)
  }
  if (etapaAtual === 'encerrado' || etapaAtual === 'cancelado') {
    throw new Error(`Pedido já está ${etapaAtual}.`)
  }
  const agora = new Date().toISOString()
  const { error: e2 } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({
      encerrado_em: agora,
      encerrado_motivo: motivo,
      encerrado_por: por,
      ...(observacao?.trim() ? { motivo_parada: observacao.trim().slice(0, 500), motivo_parada_em: agora } : {}),
      atualizado_em: agora,
    })
    .eq('id', id)
  if (e2) throw new Error(`encerrar pedido: ${e2.message}`)
  return await pedidoEtapaOuErro(id)
}

/** Reabre um pedido encerrado (a decisão foi precipitada, o cliente voltou). */
export async function reabrirPedidoEncerrado(id: string): Promise<PedidoEtapa> {
  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ encerrado_em: null, encerrado_motivo: null, encerrado_por: null, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`reabrir pedido: ${error.message}`)
  return await pedidoEtapaOuErro(id)
}

/** Registra por que o cliente parou, sem encerrar (o pedido continua aberto). */
export async function registrarMotivoParada(id: string, motivo: string): Promise<PedidoEtapa> {
  const texto = motivo.trim().slice(0, 500)
  if (texto.length < 3) throw new Error('Motivo curto demais.')
  const { error } = await supabaseAdmin
    .from('pedidos_assistente')
    .update({ motivo_parada: texto, motivo_parada_em: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(`motivo de parada: ${error.message}`)
  return await pedidoEtapaOuErro(id)
}

async function pedidoEtapaOuErro(id: string): Promise<PedidoEtapa> {
  const p = await pedidoEtapa(id)
  if (!p) throw new Error('Pedido não encontrado.')
  return p
}

export async function pedidoEtapa(id: string): Promise<PedidoEtapa | null> {
  const { data, error } = await supabaseAdmin.from('pedidos_assistente_etapas').select(COLUNAS_ETAPA).eq('id', id).maybeSingle()
  if (error) throw new Error(`pedido etapa: ${error.message}`)
  return (data as unknown as PedidoEtapa) ?? null
}

/** Acha um pedido pelo código (202609…), número ou começo do id. */
export async function acharPedido(ref: string): Promise<PedidoEtapa | null> {
  const r = ref.trim()
  if (!r) return null
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select(COLUNAS_ETAPA)
    .or(`codigo.eq.${r},numero.eq.${r},id.eq.${/^[0-9a-f-]{36}$/i.test(r) ? r : '00000000-0000-0000-0000-000000000000'}`)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`achar pedido: ${error.message}`)
  return (data as unknown as PedidoEtapa) ?? null
}
