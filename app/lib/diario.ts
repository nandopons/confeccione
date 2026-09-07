// app/lib/diario.ts
// ============================================================================
// DIÁRIO DE BORDO — a memória de gestão (placar semanal, decisões, atas).
//
// Uma lib só, usada por três portas:
//   /admin/diario          → a tela que o Fernando lê pelo celular
//   /api/admin/diario      → o que a tela chama
//   /api/mcp               → as ferramentas que o Claude chama
//
// Os números vêm SEMPRE de calcular_placar() no banco (migração
// 20260907220000_diario_de_bordo.sql). Aqui não se recalcula indicador: só se
// lê, grava a foto e escreve texto. Se um número parecer errado, o lugar de
// corrigir é a função SQL — assim admin, MCP e cron continuam concordando.
//
// Regra de autonomia que esta lib respeita: tudo aqui é leitura ou registro
// (texto no diário). Nenhuma função manda mensagem, cobra ou mexe em pedido.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type Placar = {
  referencia: string
  semana_inicio: string
  d7: Record<string, unknown>
  d30: Record<string, unknown>
  agora: Record<string, number>
}

export type PlacarGravado = {
  id: string
  semana_inicio: string
  gerado_em: string
  origem: string
  indicadores: Placar
  observacoes: string | null
}

export const STATUS_DECISAO = ['vigente', 'revisada', 'revogada'] as const
export type StatusDecisao = (typeof STATUS_DECISAO)[number]

export const TEMAS_DECISAO = [
  'whatsapp',
  'marketing',
  'produto',
  'fornecedores',
  'financeiro',
  'engenharia',
  'gestao',
] as const

export type Decisao = {
  id: string
  numero: number
  decidido_em: string
  tema: string
  titulo: string
  decisao: string
  contexto: string | null
  alternativas: string | null
  motivo: string | null
  numeros: Record<string, unknown> | null
  status: StatusDecisao
  revisar_em: string | null
  substituida_por: string | null
  reuniao_id: string | null
  documento: string | null
  origem: string
  criado_em: string
  atualizado_em: string
}

export type NovaDecisao = {
  tema: string
  titulo: string
  decisao: string
  contexto?: string | null
  alternativas?: string | null
  motivo?: string | null
  numeros?: Record<string, unknown> | null
  revisar_em?: string | null
  documento?: string | null
  reuniao_id?: string | null
  decidido_em?: string | null
  origem: 'admin' | 'mcp'
}

export const TIPOS_REUNIAO = ['segunda', 'sexta', 'mensal', 'sessao'] as const
export type TipoReuniao = (typeof TIPOS_REUNIAO)[number]

export type Pendencia = {
  descricao: string
  dono?: string | null
  prazo?: string | null
  feita?: boolean
}

export type Reuniao = {
  id: string
  realizada_em: string
  tipo: TipoReuniao
  titulo: string
  pauta: string | null
  resumo: string
  numeros: Record<string, unknown> | null
  pendencias: Pendencia[]
  placar_id: string | null
  origem: string
  criado_em: string
}

export type NovaReuniao = {
  tipo: TipoReuniao
  titulo: string
  resumo: string
  pauta?: string | null
  numeros?: Record<string, unknown> | null
  pendencias?: Pendencia[]
  placar_id?: string | null
  realizada_em?: string | null
  origem: 'admin' | 'mcp'
}

const COLUNAS_DECISAO =
  'id, numero, decidido_em, tema, titulo, decisao, contexto, alternativas, motivo, numeros, status, revisar_em, substituida_por, reuniao_id, documento, origem, criado_em, atualizado_em'

const COLUNAS_REUNIAO =
  'id, realizada_em, tipo, titulo, pauta, resumo, numeros, pendencias, placar_id, origem, criado_em'

// ─── Placar ─────────────────────────────────────────────────────────────────

/** Os nove indicadores agora, direto da função SQL. Nunca cacheia. */
export async function calcularPlacar(referencia?: Date): Promise<Placar> {
  const { data, error } = await supabaseAdmin.rpc(
    'calcular_placar',
    referencia ? { p_ref: referencia.toISOString() } : {}
  )
  if (error) throw new Error(`calcular_placar: ${error.message}`)
  return data as Placar
}

/** Tira a foto da semana. Regravar a mesma semana substitui a foto anterior —
 *  a segunda-feira de manhã é a foto "oficial"; as outras são rascunho. */
export async function gravarPlacar(
  origem: 'admin' | 'mcp' | 'cron',
  observacoes?: string | null
): Promise<PlacarGravado> {
  const indicadores = await calcularPlacar()
  const { data, error } = await supabaseAdmin
    .from('placar_semanal')
    .upsert(
      {
        semana_inicio: indicadores.semana_inicio,
        gerado_em: new Date().toISOString(),
        origem,
        indicadores,
        observacoes: observacoes ?? null,
      },
      { onConflict: 'semana_inicio' }
    )
    .select('id, semana_inicio, gerado_em, origem, indicadores, observacoes')
    .single()
  if (error) throw new Error(`gravar placar: ${error.message}`)
  return data as PlacarGravado
}

export async function listarPlacares(limite = 12): Promise<PlacarGravado[]> {
  const { data, error } = await supabaseAdmin
    .from('placar_semanal')
    .select('id, semana_inicio, gerado_em, origem, indicadores, observacoes')
    .order('semana_inicio', { ascending: false })
    .limit(limite)
  if (error) throw new Error(`listar placares: ${error.message}`)
  return (data ?? []) as PlacarGravado[]
}

// ─── Decisões ───────────────────────────────────────────────────────────────

export async function registrarDecisao(d: NovaDecisao): Promise<Decisao> {
  const { data, error } = await supabaseAdmin
    .from('decisoes')
    .insert({
      tema: d.tema.trim().toLowerCase(),
      titulo: d.titulo.trim(),
      decisao: d.decisao.trim(),
      contexto: d.contexto?.trim() || null,
      alternativas: d.alternativas?.trim() || null,
      motivo: d.motivo?.trim() || null,
      numeros: d.numeros ?? null,
      revisar_em: d.revisar_em || null,
      documento: d.documento?.trim() || null,
      reuniao_id: d.reuniao_id || null,
      ...(d.decidido_em ? { decidido_em: d.decidido_em } : {}),
      origem: d.origem,
    })
    .select(COLUNAS_DECISAO)
    .single()
  if (error) throw new Error(`registrar decisão: ${error.message}`)
  return data as Decisao
}

export type FiltroDecisoes = {
  status?: StatusDecisao | 'todas'
  tema?: string
  /** Busca textual simples em título, decisão, contexto e motivo. */
  texto?: string
  /** Só as que precisam de revisão até hoje. */
  paraRevisar?: boolean
  limite?: number
}

export async function listarDecisoes(f: FiltroDecisoes = {}): Promise<Decisao[]> {
  let q = supabaseAdmin
    .from('decisoes')
    .select(COLUNAS_DECISAO)
    .order('decidido_em', { ascending: false })
    .order('numero', { ascending: false })
    .limit(Math.min(Math.max(f.limite ?? 50, 1), 200))

  if (f.status && f.status !== 'todas') q = q.eq('status', f.status)
  if (f.tema) q = q.eq('tema', f.tema.trim().toLowerCase())
  if (f.paraRevisar) {
    q = q.eq('status', 'vigente').not('revisar_em', 'is', null).lte('revisar_em', hojeRecife())
  }
  if (f.texto && f.texto.trim()) {
    // ilike em 4 colunas; o padrão vai sem vírgulas pra não quebrar o parser do PostgREST.
    const t = `%${f.texto.trim().replace(/[,%]/g, ' ')}%`
    q = q.or(`titulo.ilike.${t},decisao.ilike.${t},contexto.ilike.${t},motivo.ilike.${t}`)
  }

  const { data, error } = await q
  if (error) throw new Error(`listar decisões: ${error.message}`)
  return (data ?? []) as Decisao[]
}

export async function buscarDecisao(ref: { id?: string; numero?: number }): Promise<Decisao | null> {
  let q = supabaseAdmin.from('decisoes').select(COLUNAS_DECISAO)
  if (ref.id) q = q.eq('id', ref.id)
  else if (typeof ref.numero === 'number') q = q.eq('numero', ref.numero)
  else return null
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(`buscar decisão: ${error.message}`)
  return (data as Decisao | null) ?? null
}

export type AtualizacaoDecisao = {
  status?: StatusDecisao
  revisar_em?: string | null
  substituida_por?: string | null
  motivo?: string | null
}

/** Decisão não se apaga: muda de status (revisada/revogada) e, se for o caso,
 *  aponta pra que a substituiu. O histórico é o valor. */
export async function atualizarDecisao(id: string, a: AtualizacaoDecisao): Promise<Decisao> {
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if (a.status) patch.status = a.status
  if (a.revisar_em !== undefined) patch.revisar_em = a.revisar_em || null
  if (a.substituida_por !== undefined) patch.substituida_por = a.substituida_por || null
  if (a.motivo !== undefined) patch.motivo = a.motivo?.trim() || null

  const { data, error } = await supabaseAdmin
    .from('decisoes')
    .update(patch)
    .eq('id', id)
    .select(COLUNAS_DECISAO)
    .single()
  if (error) throw new Error(`atualizar decisão: ${error.message}`)
  return data as Decisao
}

// ─── Reuniões ───────────────────────────────────────────────────────────────

export async function registrarReuniao(r: NovaReuniao): Promise<Reuniao> {
  const { data, error } = await supabaseAdmin
    .from('reunioes')
    .insert({
      tipo: r.tipo,
      titulo: r.titulo.trim(),
      resumo: r.resumo.trim(),
      pauta: r.pauta?.trim() || null,
      numeros: r.numeros ?? null,
      pendencias: normalizarPendencias(r.pendencias),
      placar_id: r.placar_id || null,
      ...(r.realizada_em ? { realizada_em: r.realizada_em } : {}),
      origem: r.origem,
    })
    .select(COLUNAS_REUNIAO)
    .single()
  if (error) throw new Error(`registrar reunião: ${error.message}`)
  return data as Reuniao
}

export async function listarReunioes(f: { tipo?: TipoReuniao; limite?: number } = {}): Promise<Reuniao[]> {
  let q = supabaseAdmin
    .from('reunioes')
    .select(COLUNAS_REUNIAO)
    .order('realizada_em', { ascending: false })
    .limit(Math.min(Math.max(f.limite ?? 20, 1), 100))
  if (f.tipo) q = q.eq('tipo', f.tipo)
  const { data, error } = await q
  if (error) throw new Error(`listar reuniões: ${error.message}`)
  return (data ?? []) as Reuniao[]
}

export function normalizarPendencias(p: Pendencia[] | null | undefined): Pendencia[] {
  if (!Array.isArray(p)) return []
  return p
    .filter((x) => x && typeof x.descricao === 'string' && x.descricao.trim())
    .slice(0, 30)
    .map((x) => ({
      descricao: x.descricao.trim().slice(0, 300),
      dono: x.dono?.trim() || null,
      prazo: x.prazo || null,
      feita: Boolean(x.feita),
    }))
}

// ─── Filas (o que vira alerta) ──────────────────────────────────────────────

export type ItemCobranca = {
  fonte: 'pedido' | 'orcamento_avulso'
  id: string
  referencia: string
  cliente: string | null
  telefone: string | null
  email: string | null
  valor_centavos: number
  desde: string | null
  dias_em_aberto: number | null
  link_pagamento: string | null
}

/** Quem tem orçamento definido e ainda não pagou — a receita mais próxima
 *  que existe. Pedidos do chat + orçamentos avulsos com cobrança gerada. */
export async function filaCobranca(): Promise<ItemCobranca[]> {
  const [pedidosQ, orcamentosQ] = await Promise.all([
    supabaseAdmin
      .from('pedidos_assistente')
      .select('id, codigo, numero, nome, telefone, email, valor_centavos, orcamento_definido_em, pix_link, pagamento_status')
      .eq('status', 'confirmado')
      .eq('orcamento_status', 'definido')
      .or('pagamento_status.is.null,pagamento_status.neq.pago')
      .order('orcamento_definido_em', { ascending: true })
      .limit(200),
    supabaseAdmin
      .from('orcamentos')
      .select('id, numero, cliente_nome, cliente_email, total_centavos, criado_em, cobranca_vencimento, asaas_invoice_url')
      .eq('pagamento_status', 'gerado')
      .order('criado_em', { ascending: true })
      .limit(200),
  ])
  if (pedidosQ.error) throw new Error(`fila de cobrança (pedidos): ${pedidosQ.error.message}`)
  if (orcamentosQ.error) throw new Error(`fila de cobrança (orçamentos): ${orcamentosQ.error.message}`)

  type P = {
    id: string; codigo: string | null; numero: string | null; nome: string | null; telefone: string | null
    email: string | null; valor_centavos: number | null; orcamento_definido_em: string | null; pix_link: string | null
  }
  type O = {
    id: string; numero: string | null; cliente_nome: string | null; cliente_email: string | null
    total_centavos: number | null; criado_em: string; cobranca_vencimento: string | null; asaas_invoice_url: string | null
  }

  const pedidos = ((pedidosQ.data ?? []) as P[]).map<ItemCobranca>((p) => ({
    fonte: 'pedido',
    id: p.id,
    referencia: p.codigo || p.numero || p.id.slice(0, 8).toUpperCase(),
    cliente: p.nome,
    telefone: p.telefone,
    email: p.email,
    valor_centavos: p.valor_centavos ?? 0,
    desde: p.orcamento_definido_em,
    dias_em_aberto: diasDesde(p.orcamento_definido_em),
    link_pagamento: p.pix_link,
  }))

  const orcamentos = ((orcamentosQ.data ?? []) as O[]).map<ItemCobranca>((o) => ({
    fonte: 'orcamento_avulso',
    id: o.id,
    referencia: o.numero || o.id.slice(0, 8).toUpperCase(),
    cliente: o.cliente_nome,
    telefone: null,
    email: o.cliente_email,
    valor_centavos: o.total_centavos ?? 0,
    desde: o.criado_em,
    dias_em_aberto: diasDesde(o.criado_em),
    link_pagamento: o.asaas_invoice_url,
  }))

  return [...pedidos, ...orcamentos].sort((a, b) => (b.dias_em_aberto ?? 0) - (a.dias_em_aberto ?? 0))
}

export type ConversaSemResposta = {
  conversa_id: string
  contato: string | null
  wa_id: string | null
  vinculo: 'cliente' | 'fornecedor' | null
  ultima_entrada_em: string
  horas_esperando: number
  preview: string | null
}

/** Mensagens recebidas há mais de N horas sem nenhuma resposta nossa depois
 *  (últimos 7 dias). É a cauda do p90 do atendimento. */
export async function conversasSemResposta(horas = 2): Promise<ConversaSemResposta[]> {
  const desde = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('wa_mensagens')
    .select('conversa_id, direcao, corpo, criado_em')
    .gte('criado_em', desde)
    .order('criado_em', { ascending: true })
    .limit(5000)
  if (error) throw new Error(`conversas sem resposta: ${error.message}`)

  type M = { conversa_id: string; direcao: string; corpo: string | null; criado_em: string }
  // Última mensagem de cada conversa: se for de entrada e velha o bastante, está sem resposta.
  const ultima = new Map<string, M>()
  for (const m of (data ?? []) as M[]) ultima.set(m.conversa_id, m)

  const limite = Date.now() - horas * 3600_000
  const pendentes = [...ultima.values()].filter(
    (m) => m.direcao === 'entrada' && new Date(m.criado_em).getTime() < limite
  )
  if (pendentes.length === 0) return []

  const { data: convs } = await supabaseAdmin
    .from('wa_conversas')
    .select('id, preview, contato:wa_contatos(nome, wa_id, cliente_id, fornecedor_id)')
    .in('id', pendentes.map((m) => m.conversa_id))

  type C = {
    id: string
    preview: string | null
    contato: { nome: string | null; wa_id: string | null; cliente_id: string | null; fornecedor_id: string | null } | null
  }
  const porId = new Map(((convs ?? []) as unknown as C[]).map((c) => [c.id, c]))

  return pendentes
    .map<ConversaSemResposta>((m) => {
      const c = porId.get(m.conversa_id)
      const ct = c?.contato ?? null
      return {
        conversa_id: m.conversa_id,
        contato: ct?.nome ?? null,
        wa_id: ct?.wa_id ?? null,
        vinculo: ct?.fornecedor_id ? 'fornecedor' : ct?.cliente_id ? 'cliente' : null,
        ultima_entrada_em: m.criado_em,
        horas_esperando: Math.round((Date.now() - new Date(m.criado_em).getTime()) / 3600_000),
        preview: (m.corpo ?? c?.preview ?? null)?.slice(0, 160) ?? null,
      }
    })
    .sort((a, b) => b.horas_esperando - a.horas_esperando)
}

export type PedidoSemFornecedor = {
  id: string
  referencia: string
  cliente: string | null
  telefone: string | null
  uf: string | null
  categoria: string | null
  resumo: string
  valor_centavos: number | null
  confirmado_em: string | null
  horas_esperando: number
  ofertas_no_ar: number
  ofertas_recusadas: number
}

/** Pedidos confirmados sem nenhuma oferta aceita há mais de N horas. É onde
 *  o mapa de lacunas de fornecedores começa. */
export async function pedidosSemFornecedor(horas = 24): Promise<PedidoSemFornecedor[]> {
  const { data: pedidos, error } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, codigo, numero, nome, telefone, uf, categoria, linhas, valor_centavos, confirmado_em, criado_em, pagamento_status')
    .eq('status', 'confirmado')
    .or('pagamento_status.is.null,pagamento_status.neq.pago')
    .order('confirmado_em', { ascending: true })
    .limit(300)
  if (error) throw new Error(`pedidos sem fornecedor: ${error.message}`)

  type P = {
    id: string; codigo: string | null; numero: string | null; nome: string | null; telefone: string | null
    uf: string | null; categoria: string | null; linhas: unknown; valor_centavos: number | null
    confirmado_em: string | null; criado_em: string
  }
  const lista = (pedidos ?? []) as P[]
  if (lista.length === 0) return []

  const { data: ofertas } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select('pedido_id, status')
    .in('pedido_id', lista.map((p) => p.id))

  type O = { pedido_id: string; status: string }
  const porPedido = new Map<string, { aceita: boolean; noAr: number; recusadas: number }>()
  for (const o of (ofertas ?? []) as O[]) {
    const s = porPedido.get(o.pedido_id) ?? { aceita: false, noAr: 0, recusadas: 0 }
    if (o.status === 'aceita') s.aceita = true
    if (o.status === 'ofertada') s.noAr++
    if (o.status === 'recusada') s.recusadas++
    porPedido.set(o.pedido_id, s)
  }

  const limite = Date.now() - horas * 3600_000
  return lista
    .filter((p) => {
      const s = porPedido.get(p.id)
      const desde = new Date(p.confirmado_em ?? p.criado_em).getTime()
      return !s?.aceita && desde < limite
    })
    .map<PedidoSemFornecedor>((p) => {
      const s = porPedido.get(p.id)
      const desde = p.confirmado_em ?? p.criado_em
      return {
        id: p.id,
        referencia: p.codigo || p.numero || p.id.slice(0, 8).toUpperCase(),
        cliente: p.nome,
        telefone: p.telefone,
        uf: p.uf,
        categoria: p.categoria,
        resumo: resumoLinhas(p.linhas),
        valor_centavos: p.valor_centavos,
        confirmado_em: p.confirmado_em,
        horas_esperando: Math.round((Date.now() - new Date(desde).getTime()) / 3600_000),
        ofertas_no_ar: s?.noAr ?? 0,
        ofertas_recusadas: s?.recusadas ?? 0,
      }
    })
    .sort((a, b) => b.horas_esperando - a.horas_esperando)
}

// ─── Resumo pra reunião ─────────────────────────────────────────────────────

export type ResumoGestao = {
  gerado_em: string
  placar: Placar
  ultimo_placar_gravado: PlacarGravado | null
  decisoes_para_revisar: Decisao[]
  decisoes_recentes: Decisao[]
  pendencias_abertas: Array<Pendencia & { reuniao: string; realizada_em: string }>
  ultimas_reunioes: Array<Pick<Reuniao, 'id' | 'realizada_em' | 'tipo' | 'titulo'>>
}

/** O que a reunião de segunda (e o briefing das 06:45) precisa numa chamada:
 *  placar de agora, última foto gravada, decisões vencendo, pendências em
 *  aberto das últimas atas. */
export async function resumoGestao(): Promise<ResumoGestao> {
  const [placar, placares, paraRevisar, recentes, reunioes] = await Promise.all([
    calcularPlacar(),
    listarPlacares(1),
    listarDecisoes({ paraRevisar: true, limite: 20 }),
    listarDecisoes({ status: 'vigente', limite: 8 }),
    listarReunioes({ limite: 6 }),
  ])

  const pendencias = reunioes.flatMap((r) =>
    (r.pendencias ?? [])
      .filter((p) => !p.feita)
      .map((p) => ({ ...p, reuniao: r.titulo, realizada_em: r.realizada_em }))
  )

  return {
    gerado_em: new Date().toISOString(),
    placar,
    ultimo_placar_gravado: placares[0] ?? null,
    decisoes_para_revisar: paraRevisar,
    decisoes_recentes: recentes,
    pendencias_abertas: pendencias,
    ultimas_reunioes: reunioes.map((r) => ({ id: r.id, realizada_em: r.realizada_em, tipo: r.tipo, titulo: r.titulo })),
  }
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

export function hojeRecife(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date())
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)
}

function resumoLinhas(linhas: unknown): string {
  const arr = Array.isArray(linhas) ? (linhas as Array<{ modelo?: string | null; total?: number | null }>) : []
  if (arr.length === 0) return 'sem itens'
  const pecas = arr.reduce((acc, l) => acc + (typeof l.total === 'number' ? l.total : 0), 0)
  const primeiro = arr[0]?.modelo || 'item'
  const resto = arr.length > 1 ? ` +${arr.length - 1}` : ''
  return `${primeiro}${resto} · ${pecas} pç`
}
