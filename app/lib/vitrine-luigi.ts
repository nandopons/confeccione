// app/lib/vitrine-luigi.ts
// ============================================================================
// A VITRINE FALA COM O LUIGI — 29/09/2026 (decisão do Fernando)
//
// Lado do cliente: o botão "Fazer pedido" da vitrine abre o WhatsApp com
// "(vitrine 8hex)" na mensagem. Aqui o marcador vira `wa_conversas.
// vitrine_item_id`, e o contexto do Luigi ganha o produto (peça, tecido,
// grade, mínimo, preço de referência) e a confecção dona — que recebe o
// pedido primeiro (fornecedor_preferido_id).
//
// Lado da confecção: os produtos com nome na vitrine e ficha incompleta
// (tecido, mínimo ou preço) são perguntados a ela, um por vez, pelo
// rodarFichaVitrine; a resposta cai no Luigi fornecedor, que grava com
// salvar_ficha_vitrine. "Quero que ele pergunte ao fornecedor o valor de
// cada produto na vitrine pra agilizar o approach com o cliente."
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { avisoOficial } from './whatsapp-notify'
import { estaEmHorarioDeOferta } from './horario'
import { BUCKET_PORTFOLIO } from './portfolio-fornecedor'

export const VITRINE_CITADA = /\(vitrine ([0-9a-f]{8})\)/i

export type ProdutoVitrine = {
  item_id: string
  nome: string | null
  tipo: string | null
  tecido: string | null
  tamanhos: string | null
  cores: string | null
  tecnicas: string | null
  pedido_minimo: number | null
  prazo_dias: number | null
  preco_centavos: number | null
  foto_url: string
  fornecedor_id: string
  fornecedor_nome: string | null
  fornecedor_cidade: string | null
  fornecedor_uf: string | null
}

const CAMPOS_ITEM = 'id, path, nome, tipo, tecido, tamanhos, cores, tecnicas, pedido_minimo, prazo_dias, preco_centavos, fornecedor_id, leads_fornecedores(nome, cidade, estado)'
type LinhaItem = {
  id: string
  path: string
  nome: string | null
  tipo: string | null
  tecido: string | null
  tamanhos: string | null
  cores: string | null
  tecnicas: string | null
  pedido_minimo: number | null
  prazo_dias: number | null
  preco_centavos: number | null
  fornecedor_id: string
  leads_fornecedores: { nome: string | null; cidade: string | null; estado: string | null } | Array<{ nome: string | null; cidade: string | null; estado: string | null }> | null
}

function paraProduto(r: LinhaItem): ProdutoVitrine {
  const f = Array.isArray(r.leads_fornecedores) ? r.leads_fornecedores[0] : r.leads_fornecedores
  return {
    item_id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    tecido: r.tecido,
    tamanhos: r.tamanhos,
    cores: r.cores,
    tecnicas: r.tecnicas,
    pedido_minimo: r.pedido_minimo,
    prazo_dias: r.prazo_dias,
    preco_centavos: r.preco_centavos,
    foto_url: supabaseAdmin.storage.from(BUCKET_PORTFOLIO).getPublicUrl(r.path).data.publicUrl,
    fornecedor_id: r.fornecedor_id,
    fornecedor_nome: f?.nome ?? null,
    fornecedor_cidade: f?.cidade ?? null,
    fornecedor_uf: f?.estado ?? null,
  }
}

/** O marcador "(vitrine 8hex)" da mensagem vira a origem da conversa. */
export async function registrarVitrineCitada(corpo: string | null, conversaId: string): Promise<void> {
  const m = VITRINE_CITADA.exec(corpo ?? '')
  if (!m) return
  const prefixo = m[1].toLowerCase()
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select('id')
    .gte('id', `${prefixo}-0000-0000-0000-000000000000`)
    .lte('id', `${prefixo}-ffff-ffff-ffff-ffffffffffff`)
    .limit(2)
  if (!data || data.length !== 1) return
  await supabaseAdmin
    .from('wa_conversas')
    .update({ vitrine_item_id: (data[0] as { id: string }).id, vitrine_visto_em: new Date().toISOString() })
    .eq('id', conversaId)
}

/** O produto de onde o cliente veio, se foi há menos de 7 dias. */
export async function produtoDaVitrineDaConversa(conversaId: string): Promise<ProdutoVitrine | null> {
  const { data: c } = await supabaseAdmin
    .from('wa_conversas')
    .select('vitrine_item_id, vitrine_visto_em')
    .eq('id', conversaId)
    .maybeSingle<{ vitrine_item_id: string | null; vitrine_visto_em: string | null }>()
  if (!c?.vitrine_item_id || !c.vitrine_visto_em) return null
  if (Date.now() - new Date(c.vitrine_visto_em).getTime() > 7 * 24 * 3600_000) return null
  const { data } = await supabaseAdmin.from('portfolio_fornecedores').select(CAMPOS_ITEM).eq('id', c.vitrine_item_id).maybeSingle()
  return data ? paraProduto(data as unknown as LinhaItem) : null
}

export function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ---------------------------------------------------------------------------
// FICHA TÉCNICA: perguntar à confecção o que falta
// ---------------------------------------------------------------------------

export type FichaPendente = ProdutoVitrine & { falta: string[]; ficha_foto_enviada_em: string | null }

function oQueFalta(p: ProdutoVitrine): string[] {
  const f: string[] = []
  if (!p.nome) f.push('nome da peça')
  if (!p.tecido) f.push('tecido')
  if (p.pedido_minimo == null) f.push('mínimo de peças')
  if (p.preco_centavos == null) f.push('valor unitário aproximado')
  return f
}

/** Produtos desta confecção com ficha perguntada há menos de 7 dias e ainda incompleta. */
export async function fichasPendentesDoFornecedor(fornecedorId: string): Promise<FichaPendente[]> {
  const desde = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select(`${CAMPOS_ITEM}, ficha_foto_enviada_em`)
    .eq('fornecedor_id', fornecedorId)
    .gte('ficha_perguntada_em', desde)
    .order('ficha_perguntada_em', { ascending: false })
    .limit(5)
  return ((data ?? []) as unknown as Array<LinhaItem & { ficha_foto_enviada_em: string | null }>)
    .map((r) => ({ ...paraProduto(r), falta: oQueFalta(paraProduto(r)), ficha_foto_enviada_em: r.ficha_foto_enviada_em }))
    .filter((p) => p.falta.length > 0)
}

export async function salvarFichaVitrine(
  itemId: string,
  fornecedorId: string,
  campos: { nome?: string | null; tecido?: string | null; tamanhos?: string | null; cores?: string | null; pedido_minimo?: number | null; preco_centavos?: number | null; prazo_dias?: number | null }
): Promise<{ ok: boolean; erro?: string }> {
  const patch: Record<string, unknown> = {}
  if (campos.nome?.trim()) patch.nome = campos.nome.trim().slice(0, 80)
  if (campos.tecido?.trim()) patch.tecido = campos.tecido.trim().slice(0, 120)
  if (campos.tamanhos?.trim()) patch.tamanhos = campos.tamanhos.trim().slice(0, 120)
  if (campos.cores?.trim()) patch.cores = campos.cores.trim().slice(0, 120)
  if (typeof campos.pedido_minimo === 'number' && campos.pedido_minimo > 0) patch.pedido_minimo = Math.round(campos.pedido_minimo)
  if (typeof campos.preco_centavos === 'number' && campos.preco_centavos > 0) patch.preco_centavos = Math.round(campos.preco_centavos)
  if (typeof campos.prazo_dias === 'number' && campos.prazo_dias > 0) patch.prazo_dias = Math.round(campos.prazo_dias)
  if (Object.keys(patch).length === 0) return { ok: false, erro: 'nada pra gravar' }
  const { error } = await supabaseAdmin.from('portfolio_fornecedores').update(patch).eq('id', itemId).eq('fornecedor_id', fornecedorId)
  return error ? { ok: false, erro: error.message } : { ok: true }
}

export function textoPerguntaFicha(nome: string | null, produto: string | null, falta: string[]): { texto: string; resumo: string } {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0]
  const peca = produto ? `a peça "${produto}"` : 'uma peça sua'
  const lista = falta.join(', ')
  return {
    texto: `${primeiro ? `Oi, ${primeiro}! ` : 'Oi! '}Sobre ${peca} que está na sua vitrine da Confeccione: me diz ${lista}? É pra eu já responder o cliente na hora, sem te chamar toda vez`,
    resumo: `sobre ${peca} na sua vitrine da Confeccione: me diz ${lista}? É pra eu responder o cliente na hora`,
  }
}

const MAX_POR_RODADA = 5
const DIAS_ENTRE_PERGUNTAS = 3

/**
 * Uma pergunta por confecção por rodada, sobre UM produto de cada vez. Só
 * produtos com nome (os que estão na vitrine), com ficha incompleta e sem
 * pergunta nos últimos dias. A resposta cai no Luigi fornecedor.
 */
export async function rodarFichaVitrine(): Promise<{ enviadas: number; puladas: number; observacao?: string }> {
  if (!estaEmHorarioDeOferta()) return { enviadas: 0, puladas: 0, observacao: 'fora do expediente de oferta' }
  const corte = new Date(Date.now() - DIAS_ENTRE_PERGUNTAS * 24 * 3600_000).toISOString()
  const { data } = await supabaseAdmin
    .from('portfolio_fornecedores')
    .select(`${CAMPOS_ITEM}, ficha_perguntada_em, leads_fornecedores!inner(nome, cidade, estado, whatsapp, aprovacao_status, status)`)
    .not('nome', 'is', null)
    .or('tecido.is.null,pedido_minimo.is.null,preco_centavos.is.null')
    .or(`ficha_perguntada_em.is.null,ficha_perguntada_em.lt.${corte}`)
    .eq('leads_fornecedores.aprovacao_status', 'aprovado')
    .eq('leads_fornecedores.status', 'ativo')
    .order('criado_em', { ascending: true })
    .limit(60)
  type L = LinhaItem & { ficha_perguntada_em: string | null; leads_fornecedores: { nome: string | null; cidade: string | null; estado: string | null; whatsapp: string | null } }
  const porFornecedor = new Map<string, L>()
  for (const r of (data ?? []) as unknown as L[]) if (!porFornecedor.has(r.fornecedor_id)) porFornecedor.set(r.fornecedor_id, r)

  let enviadas = 0
  let puladas = 0
  for (const r of porFornecedor.values()) {
    if (enviadas >= MAX_POR_RODADA) break
    const f = r.leads_fornecedores
    if (!f?.whatsapp) {
      puladas++
      continue
    }
    // Uma pergunta por confecção por vez: se outra peça dela foi perguntada há pouco, espera.
    const { data: recente } = await supabaseAdmin.from('portfolio_fornecedores').select('id').eq('fornecedor_id', r.fornecedor_id).gte('ficha_perguntada_em', corte).limit(1)
    if ((recente ?? []).length > 0) {
      puladas++
      continue
    }
    const p = paraProduto(r)
    const t = textoPerguntaFicha(f.nome, p.nome, oQueFalta(p))
    const ok = await avisoOficial({ telefone: f.whatsapp, nome: f.nome, texto: t.texto, resumo: t.resumo, caminhoBotao: 'fornecedor' }).catch(() => false)
    if (!ok) {
      puladas++
      continue
    }
    await supabaseAdmin.from('portfolio_fornecedores').update({ ficha_perguntada_em: new Date().toISOString() }).eq('id', r.id)
    enviadas++
  }
  return { enviadas, puladas }
}
