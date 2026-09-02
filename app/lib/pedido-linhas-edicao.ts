// app/lib/pedido-linhas-edicao.ts
// ============================================================================
// Edição das LINHAS de um pedido do chat (pedidos_assistente) pelos dois lados
// da negociação, antes/durante o orçamento:
//   - cliente  → visualizador (PATCH /api/pedido/assistente/[id])
//   - fornecedor que aceitou → página da oferta (PATCH /api/fornecedor/oferta/[id]/linhas)
//
// Decisões (02/09/2026, Fernando):
//   1. Edição vale NA HORA — o outro lado é avisado pelo WhatsApp oficial.
//   2. Fornecedor pode editar mesmo com orçamento 'definido': o orçamento volta
//      a 'aguardando_fornecedor' (valores ficam como rascunho) e ele reenvia.
//
// O que este módulo garante:
//   - lid estável em toda linha (uuid), pra casar versões e pra badge no cliente
//   - mockups/artes (indexados por POSIÇÃO em pedidos_assistente.mockups) são
//     re-mapeados quando o fornecedor remove/reordena linhas (via origIdx)
//   - preco_unit_centavos que o fornecedor já definiu é preservado por lid
//   - histórico em pedidos_assistente_edicoes (antes/depois + resumo)
//   - aviso cruzado via avisoOficial (texto na janela de 24h, senão template)
// ============================================================================

import { randomUUID } from 'crypto'
import { supabaseAdmin } from './supabase-server'
import { avisoOficial } from './whatsapp-notify'
import { primeiroNome } from './nome'
import type { LinhaPedido } from './pedido-assistente-oferta'

export type AutorEdicao = 'cliente' | 'fornecedor' | 'admin'

/** Linha como chega do editor do fornecedor: mesma forma + índice de origem. */
export type LinhaEditada = LinhaPedido & {
  publico?: string | null
  estampado?: boolean | null
  acabamentos?: string[] | null
  categoria?: string | null
  objetivo_material?: string | null
  /** Posição da linha no pedido ANTES da edição (null = linha nova). */
  origIdx?: number | null
}

type MapaMockups = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function normalizarLinha(raw: LinhaEditada, anterior: LinhaPedido | null): LinhaPedido & { origIdx: number | null } {
  const tamanhos = Array.isArray(raw.tamanhos)
    ? raw.tamanhos
        .map((t) => ({ tamanho: str(t?.tamanho), qtd: Number.isFinite(Number(t?.qtd)) && Number(t?.qtd) > 0 ? Math.round(Number(t?.qtd)) : null }))
        .filter((t) => t.tamanho)
    : []
  const somaTam = tamanhos.reduce((s, t) => s + (t.qtd ?? 0), 0)
  const totalRaw = Number.isFinite(Number(raw.total)) && Number(raw.total) > 0 ? Math.round(Number(raw.total)) : null
  // Com grade preenchida, o total é a soma da grade; sem grade, vale o total digitado.
  const total = somaTam > 0 ? somaTam : totalRaw

  const out: LinhaPedido & { origIdx: number | null } = {
    lid: str(raw.lid) ?? anterior?.lid ?? randomUUID(),
    modelo: str(raw.modelo),
    cor: str(raw.cor),
    material: str(raw.material),
    total,
    tamanhos,
    estampas: Array.isArray(raw.estampas) ? raw.estampas : anterior?.estampas ?? [],
    descricao: str(raw.descricao),
    // Preço já definido pelo fornecedor sobrevive a edições de texto/grade —
    // é ele quem reabre o orçamento se quiser mudar.
    preco_unit_centavos:
      typeof raw.preco_unit_centavos === 'number' ? raw.preco_unit_centavos : anterior?.preco_unit_centavos ?? null,
    origIdx: typeof raw.origIdx === 'number' && raw.origIdx >= 0 ? raw.origIdx : null,
  }
  // Campos extras que o visualizador do cliente usa (não perdem no round-trip).
  const extras: Array<keyof LinhaEditada> = ['publico', 'estampado', 'acabamentos', 'categoria', 'objetivo_material']
  for (const k of extras) {
    const v = raw[k] !== undefined ? raw[k] : (anterior as LinhaEditada | null)?.[k]
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

function descreverLinha(l: LinhaPedido): string {
  return [l.total ? `${l.total}×` : null, l.modelo || 'peça', l.cor ? `· ${l.cor}` : null].filter(Boolean).join(' ')
}

function gradeStr(l: LinhaPedido): string {
  return (l.tamanhos ?? []).map((t) => `${t.tamanho}:${t.qtd ?? 0}`).join(',')
}

/** Resumo humano do que mudou (pra WhatsApp e pro histórico). */
export function resumirDiffLinhas(antes: LinhaPedido[], depois: LinhaPedido[]): { resumo: string; lidsAlterados: string[]; mudou: boolean } {
  const porLid = new Map<string, LinhaPedido>()
  for (const l of antes) if (l.lid) porLid.set(l.lid, l)
  const partes: string[] = []
  const lids: string[] = []
  let mudou = false

  for (const l of depois) {
    const a = l.lid ? porLid.get(l.lid) : undefined
    if (!a) {
      partes.push(`+ ${descreverLinha(l)}`)
      if (l.lid) lids.push(l.lid)
      mudou = true
      continue
    }
    porLid.delete(l.lid!)
    const difs: string[] = []
    if ((a.modelo ?? '') !== (l.modelo ?? '')) difs.push('modelo')
    if ((a.cor ?? '') !== (l.cor ?? '')) difs.push('cor')
    if ((a.material ?? '') !== (l.material ?? '')) difs.push('material')
    if ((a.total ?? 0) !== (l.total ?? 0) || gradeStr(a) !== gradeStr(l)) difs.push('grade/quantidade')
    if ((a.descricao ?? '') !== (l.descricao ?? '')) difs.push('observação')
    if (difs.length) {
      partes.push(`~ ${descreverLinha(l)} (${difs.join(', ')})`)
      if (l.lid) lids.push(l.lid)
      mudou = true
    }
  }
  for (const a of porLid.values()) {
    partes.push(`− ${descreverLinha(a)}`)
    mudou = true
  }
  return { resumo: partes.join('\n'), lidsAlterados: lids, mudou }
}

/**
 * Re-mapeia o mapa de mockups (chave = índice da linha) pra nova ordem.
 * Linhas novas não têm mockup; linhas removidas perdem o mockup (era delas).
 */
function remapearMockups(mk: MapaMockups | null, novas: Array<{ origIdx: number | null }>): MapaMockups {
  if (!mk || typeof mk !== 'object') return {}
  const out: MapaMockups = {}
  novas.forEach((l, novoIdx) => {
    if (l.origIdx == null) return
    const v = mk[String(l.origIdx)]
    if (v !== undefined) out[String(novoIdx)] = v
  })
  return out
}

export type ResultadoEdicao =
  | { ok: true; linhas: LinhaPedido[]; resumo: string; mudou: boolean; orcamentoReaberto: boolean }
  | { ok: false; erro: string; status: number }

/**
 * Grava as linhas editadas pelo FORNECEDOR (com origIdx) ou pelo admin,
 * cuidando de lid, mockups, preço, orçamento e histórico. Não avisa ninguém —
 * quem chama decide (ver avisarClienteEdicaoFornecedor).
 */
export async function salvarLinhasEditadas(params: {
  pedidoId: string
  linhas: LinhaEditada[]
  autor: AutorEdicao
  fornecedorId?: string | null
  ofertaId?: string | null
}): Promise<ResultadoEdicao> {
  const { data: ped } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, linhas, mockups, status, orcamento_status, pagamento_status')
    .eq('id', params.pedidoId)
    .maybeSingle<{ id: string; linhas: LinhaPedido[] | null; mockups: MapaMockups | null; status: string | null; orcamento_status: string | null; pagamento_status: string | null }>()
  if (!ped) return { ok: false, erro: 'Pedido não encontrado', status: 404 }
  if (ped.pagamento_status === 'pago') return { ok: false, erro: 'Pedido já pago — não dá mais pra alterar os produtos.', status: 409 }
  if (ped.status === 'cancelado') return { ok: false, erro: 'Pedido cancelado.', status: 409 }

  const antes: LinhaPedido[] = Array.isArray(ped.linhas) ? ped.linhas : []
  const novas = params.linhas
    .map((raw) => normalizarLinha(raw, raw.origIdx != null ? antes[raw.origIdx] ?? null : null))
    .filter((l) => l.modelo || l.cor || (l.total ?? 0) > 0 || (l.tamanhos?.length ?? 0) > 0)
  if (novas.length === 0) return { ok: false, erro: 'O pedido precisa ter pelo menos um produto.', status: 400 }

  const linhasFinais: LinhaPedido[] = novas.map((l) => { const { origIdx, ...resto } = l; void origIdx; return resto })
  const diff = resumirDiffLinhas(antes, linhasFinais)
  const orcamentoReaberto = diff.mudou && ped.orcamento_status === 'definido'

  const patch: Record<string, unknown> = {
    linhas: linhasFinais,
    mockups: remapearMockups(ped.mockups, novas),
    atualizado_em: new Date().toISOString(),
  }
  if (orcamentoReaberto) patch.orcamento_status = 'aguardando_fornecedor'

  const { error } = await supabaseAdmin.from('pedidos_assistente').update(patch).eq('id', params.pedidoId)
  if (error) return { ok: false, erro: error.message, status: 500 }

  if (diff.mudou) {
    try {
      await supabaseAdmin.from('pedidos_assistente_edicoes').insert({
        pedido_id: params.pedidoId,
        autor: params.autor,
        fornecedor_id: params.fornecedorId ?? null,
        oferta_id: params.ofertaId ?? null,
        resumo: diff.resumo.slice(0, 2000),
        linhas_antes: antes,
        linhas_depois: linhasFinais,
      })
    } catch (err) {
      console.error('[pedido-linhas] histórico falhou', { err })
    }
  }
  return { ok: true, linhas: linhasFinais, resumo: diff.resumo, mudou: diff.mudou, orcamentoReaberto }
}

/**
 * Histórico + aviso ao FORNECEDOR quando o CLIENTE edita pelo visualizador.
 * O PATCH do cliente já gravou as linhas; aqui só comparamos e avisamos se
 * houver oferta aceita. Failure-soft.
 */
export async function registrarEdicaoCliente(pedidoId: string, antes: LinhaPedido[], depois: LinhaPedido[]): Promise<void> {
  try {
    const diff = resumirDiffLinhas(antes, depois)
    if (!diff.mudou) return
    await supabaseAdmin.from('pedidos_assistente_edicoes').insert({
      pedido_id: pedidoId,
      autor: 'cliente',
      resumo: diff.resumo.slice(0, 2000),
      linhas_antes: antes,
      linhas_depois: depois,
    })
    const { data: oferta } = await supabaseAdmin
      .from('ofertas_pedido_assistente')
      .select('id, leads_fornecedores(nome, whatsapp)')
      .eq('pedido_id', pedidoId)
      .eq('status', 'aceita')
      .maybeSingle<{ id: string; leads_fornecedores: { nome: string | null; whatsapp: string | null } | null }>()
    const tel = oferta?.leads_fornecedores?.whatsapp
    if (!oferta || !tel) return
    const { data: ped } = await supabaseAdmin.from('pedidos_assistente').select('codigo, nome').eq('id', pedidoId).maybeSingle<{ codigo: string | null; nome: string | null }>()
    const cliente = primeiroNome(ped?.nome ?? '') || 'O cliente'
    const cod = ped?.codigo ? ` nº ${ped.codigo}` : ''
    await avisoOficial({
      telefone: tel,
      nome: oferta.leads_fornecedores?.nome ?? null,
      texto: `${cliente} ajustou o pedido${cod} na Confeccione:\n${diff.resumo}\n\nConfira antes de orçar/produzir:\nhttps://www.confeccione.com.br/fornecedor/oferta/${oferta.id}`,
      resumo: `${cliente} ajustou os produtos do pedido${cod} — confira antes de orçar`,
      caminhoBotao: `fornecedor/oferta/${oferta.id}`,
    })
  } catch (err) {
    console.error('[pedido-linhas] registrarEdicaoCliente falhou', { err })
  }
}

/** Aviso ao CLIENTE quando o FORNECEDOR edita pela página da oferta. Failure-soft. */
export async function avisarClienteEdicaoFornecedor(params: {
  pedidoId: string
  fornecedorNome: string | null
  resumo: string
  orcamentoReaberto: boolean
}): Promise<boolean> {
  try {
    const { data: ped } = await supabaseAdmin
      .from('pedidos_assistente')
      .select('nome, telefone, codigo')
      .eq('id', params.pedidoId)
      .maybeSingle<{ nome: string | null; telefone: string | null; codigo: string | null }>()
    if (!ped?.telefone) return false
    const forn = (params.fornecedorNome ?? '').trim() || 'O fornecedor'
    const cod = ped.codigo ? ` nº ${ped.codigo}` : ''
    const rodape = params.orcamentoReaberto ? '\n\nO orçamento anterior foi cancelado — você recebe o novo valor assim que o fornecedor reenviar.' : ''
    return await avisoOficial({
      telefone: ped.telefone,
      nome: ped.nome,
      texto: `${forn} ajustou o seu pedido${cod}:\n${params.resumo}${rodape}\n\nVeja como ficou e, se não concordar, fale com eles ou com a gente:\nhttps://www.confeccione.com.br/visualizador/${params.pedidoId}`,
      resumo: `${forn} ajustou os produtos do seu pedido${cod} — veja como ficou`,
      caminhoBotao: `visualizador/${params.pedidoId}`,
    })
  } catch (err) {
    console.error('[pedido-linhas] avisarClienteEdicaoFornecedor falhou', { err })
    return false
  }
}

/** Última edição feita pelo fornecedor (pro selo no visualizador do cliente). */
export async function ultimaEdicaoFornecedor(pedidoId: string): Promise<{ em: string; resumo: string | null; lids: string[] } | null> {
  const { data } = await supabaseAdmin
    .from('pedidos_assistente_edicoes')
    .select('criado_em, resumo, linhas_antes, linhas_depois')
    .eq('pedido_id', pedidoId)
    .eq('autor', 'fornecedor')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle<{ criado_em: string; resumo: string | null; linhas_antes: LinhaPedido[]; linhas_depois: LinhaPedido[] }>()
  if (!data) return null
  const diff = resumirDiffLinhas(data.linhas_antes ?? [], data.linhas_depois ?? [])
  return { em: data.criado_em, resumo: data.resumo, lids: diff.lidsAlterados }
}
