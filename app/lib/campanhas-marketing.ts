// app/lib/campanhas-marketing.ts
// ============================================================================
// CAMPANHAS DE MARKETING — disparo manual/agendado pra um segmento da base
// (leads_marketing), por WhatsApp (template oficial da Meta) ou e-mail.
//
// Como funciona:
//   1. `prepararCampanha` resolve o segmento AGORA e congela a fila em
//      campanha_envios (1 linha por lead, unique(campanha,lead)). A partir daí
//      a campanha não muda de alvo — o que entrou na base depois fica de fora.
//   2. `processarCampanha` consome a fila em lotes (LOTE por chamada). Pode ser
//      chamada pelo botão do painel ou pelo cron; é retomável e nunca manda
//      duas vezes pro mesmo lead.
//   3. Cada envio vira linha em contatos_marketing (histórico) e incrementa o
//      contador de toques do lead.
//
// Travas: opt-out sempre pulado; lead sem o canal da campanha é pulado; o cap
// por lote segura o custo do template pago (~R$0,31/msg).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarMensagem } from './zapi'
import { enviarTemplate, normalizarWaId } from './whatsapp-cloud'
import { enviarEmailMarketing } from './email'
import {
  listarLeadsCompleto,
  obterLead,
  registrarToque,
  type FiltroLeads,
  type Lead,
} from './leads-marketing'

export type CanalCampanha = 'whatsapp_template' | 'whatsapp_zapi' | 'email'
export type StatusCampanha = 'rascunho' | 'agendada' | 'enviando' | 'concluida' | 'cancelada'

/** Quantos envios por chamada de `processarCampanha`. */
export const LOTE_CAMPANHA = 40

export type Campanha = {
  id: string
  nome: string
  canal: CanalCampanha
  template: string | null
  templateParams: { corpo: string[]; botaoUrl?: string }
  assunto: string | null
  mensagem: string
  filtro: FiltroLeads
  status: StatusCampanha
  agendadaPara: string | null
  totalAlvo: number
  enviados: number
  erros: number
  criadoEm: string
  iniciadaEm: string | null
  concluidaEm: string | null
}

type CampanhaRow = {
  id: string
  nome: string
  canal: CanalCampanha
  template: string | null
  template_params: unknown
  assunto: string | null
  mensagem: string
  filtro: unknown
  status: StatusCampanha
  agendada_para: string | null
  total_alvo: number
  enviados: number
  erros: number
  criado_em: string
  iniciada_em: string | null
  concluida_em: string | null
}

const COLS =
  'id, nome, canal, template, template_params, assunto, mensagem, filtro, status, agendada_para, total_alvo, enviados, erros, criado_em, iniciada_em, concluida_em'

function daLinha(r: CampanhaRow): Campanha {
  const params = (r.template_params ?? {}) as { corpo?: unknown; botaoUrl?: unknown }
  return {
    id: r.id,
    nome: r.nome,
    canal: r.canal,
    template: r.template,
    templateParams: {
      corpo: Array.isArray(params.corpo) ? (params.corpo as string[]) : [],
      botaoUrl: typeof params.botaoUrl === 'string' ? params.botaoUrl : undefined,
    },
    assunto: r.assunto,
    mensagem: r.mensagem,
    filtro: (r.filtro ?? {}) as FiltroLeads,
    status: r.status,
    agendadaPara: r.agendada_para,
    totalAlvo: r.total_alvo,
    enviados: r.enviados,
    erros: r.erros,
    criadoEm: r.criado_em,
    iniciadaEm: r.iniciada_em,
    concluidaEm: r.concluida_em,
  }
}

// ─────────────────────────────────────────────────────────────
// Placeholders
// ─────────────────────────────────────────────────────────────

/**
 * Troca #nome (primeiro nome), #empresa, #cidade e #link pelos dados do lead.
 * Sem nome, o "#nome" some junto com a vírgula/espaço que sobraria.
 */
export function aplicarPlaceholders(texto: string, lead: Lead, link?: string): string {
  const primeiro = (lead.nome ?? '').trim().split(/\s+/)[0] ?? ''
  let out = texto
  out = primeiro
    ? out.split('#nome').join(primeiro)
    : out.replace(/ ?,? ?#nome/g, '').replace(/ {2,}/g, ' ')
  out = out.split('#empresa').join(lead.empresa ?? '')
  out = out.split('#cidade').join(lead.cidade ?? '')
  if (link) out = out.split('#link').join(link)
  return out.trim()
}

/** O canal exige WhatsApp ou e-mail? Serve pro filtro e pra pular o lead. */
export function canalDoLead(canal: CanalCampanha): 'whatsapp' | 'email' {
  return canal === 'email' ? 'email' : 'whatsapp'
}

function leadAtendeCanal(lead: Lead, canal: CanalCampanha): boolean {
  return canalDoLead(canal) === 'email' ? !!lead.email : !!lead.telefone
}

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

export type DadosCampanha = {
  nome: string
  canal: CanalCampanha
  template?: string | null
  templateParams?: { corpo: string[]; botaoUrl?: string }
  assunto?: string | null
  mensagem: string
  filtro: FiltroLeads
  agendadaPara?: string | null
}

export async function criarCampanha(d: DadosCampanha): Promise<Campanha> {
  const { data, error } = await supabaseAdmin
    .from('campanhas_marketing')
    .insert({
      nome: d.nome,
      canal: d.canal,
      template: d.template ?? null,
      template_params: d.templateParams ?? { corpo: [] },
      assunto: d.assunto ?? null,
      mensagem: d.mensagem,
      filtro: d.filtro,
      agendada_para: d.agendadaPara ?? null,
      status: d.agendadaPara ? 'agendada' : 'rascunho',
    })
    .select(COLS)
    .single<CampanhaRow>()
  if (error) throw new Error(error.message)
  return daLinha(data)
}

export async function listarCampanhas(limite = 50): Promise<Campanha[]> {
  const { data } = await supabaseAdmin
    .from('campanhas_marketing')
    .select(COLS)
    .order('criado_em', { ascending: false })
    .limit(limite)
  return ((data ?? []) as CampanhaRow[]).map(daLinha)
}

export async function obterCampanha(id: string): Promise<Campanha | null> {
  const { data } = await supabaseAdmin.from('campanhas_marketing').select(COLS).eq('id', id).maybeSingle<CampanhaRow>()
  return data ? daLinha(data) : null
}

export async function cancelarCampanha(id: string): Promise<void> {
  await supabaseAdmin
    .from('campanhas_marketing')
    .update({ status: 'cancelada', concluida_em: new Date().toISOString() })
    .eq('id', id)
}

export async function excluirCampanha(id: string): Promise<void> {
  await supabaseAdmin.from('campanhas_marketing').delete().eq('id', id)
}

// ─────────────────────────────────────────────────────────────
// Prévia
// ─────────────────────────────────────────────────────────────

export type PreviaCampanha = {
  total: number
  semCanal: number
  amostra: Array<{ nome: string | null; empresa: string | null; cidade: string | null; uf: string | null; destino: string | null }>
  exemplo: string | null
  lote: number
}

/** Quem entraria na campanha se disparasse agora, e como a mensagem fica. */
export async function previaCampanha(
  filtro: FiltroLeads,
  canal: CanalCampanha,
  mensagem: string
): Promise<PreviaCampanha> {
  const todos = await listarLeadsCompleto({ ...filtro, incluirOptOut: false })
  const alvo = todos.filter((l) => leadAtendeCanal(l, canal))
  const primeiro = alvo[0]
  return {
    total: alvo.length,
    semCanal: todos.length - alvo.length,
    amostra: alvo.slice(0, 8).map((l) => ({
      nome: l.nome,
      empresa: l.empresa,
      cidade: l.cidade,
      uf: l.uf,
      destino: canalDoLead(canal) === 'email' ? l.email : l.telefone,
    })),
    exemplo: primeiro ? aplicarPlaceholders(mensagem, primeiro) : null,
    lote: LOTE_CAMPANHA,
  }
}

// ─────────────────────────────────────────────────────────────
// Fila
// ─────────────────────────────────────────────────────────────

/**
 * Congela o público da campanha em campanha_envios e coloca em 'enviando'
 * (ou mantém 'agendada' se tiver data futura). Idempotente: rodar de novo
 * não duplica linha nem reenvia quem já recebeu.
 */
export async function prepararCampanha(id: string): Promise<{ total: number; status: StatusCampanha }> {
  const c = await obterCampanha(id)
  if (!c) throw new Error('Campanha não encontrada')
  if (c.status === 'concluida' || c.status === 'cancelada') {
    return { total: c.totalAlvo, status: c.status }
  }

  const leads = (await listarLeadsCompleto({ ...c.filtro, incluirOptOut: false })).filter((l) =>
    leadAtendeCanal(l, c.canal)
  )

  for (let i = 0; i < leads.length; i += 500) {
    const fatia = leads.slice(i, i + 500).map((l) => ({ campanha_id: id, lead_id: l.id }))
    if (fatia.length) {
      await supabaseAdmin.from('campanha_envios').upsert(fatia, { onConflict: 'campanha_id,lead_id', ignoreDuplicates: true })
    }
  }

  const agendadaFutura = c.agendadaPara ? new Date(c.agendadaPara).getTime() > Date.now() : false
  const status: StatusCampanha = agendadaFutura ? 'agendada' : 'enviando'
  await supabaseAdmin
    .from('campanhas_marketing')
    .update({
      total_alvo: leads.length,
      status,
      iniciada_em: c.iniciadaEm ?? (status === 'enviando' ? new Date().toISOString() : null),
    })
    .eq('id', id)

  return { total: leads.length, status }
}

export type ResultadoLote = {
  campanha: string
  enviados: number
  erros: number
  pulados: number
  restantes: number
  concluida: boolean
}

/** Manda o próximo lote. Chamar de novo enquanto `restantes > 0`. */
export async function processarCampanha(id: string, lote = LOTE_CAMPANHA): Promise<ResultadoLote> {
  const c = await obterCampanha(id)
  if (!c) throw new Error('Campanha não encontrada')
  if (c.status !== 'enviando') {
    return { campanha: c.nome, enviados: 0, erros: 0, pulados: 0, restantes: 0, concluida: c.status === 'concluida' }
  }

  const { data: pendentes } = await supabaseAdmin
    .from('campanha_envios')
    .select('id, lead_id')
    .eq('campanha_id', id)
    .eq('status', 'pendente')
    .limit(lote)

  let enviados = 0
  let erros = 0
  let pulados = 0

  for (const envio of (pendentes ?? []) as Array<{ id: string; lead_id: string }>) {
    const lead = await obterLead(envio.lead_id)
    if (!lead || lead.optOut || !leadAtendeCanal(lead, c.canal)) {
      await marcarEnvio(envio.id, 'pulado', lead ? 'sem canal ou descadastrado' : 'lead removido')
      pulados++
      continue
    }

    const r = await enviarParaLead(c, lead)
    if (r.ok) {
      enviados++
      await marcarEnvio(envio.id, 'enviado')
      await registrarContatoCampanha(c, lead, r.mensagem)
      await registrarToque(lead.id)
    } else {
      erros++
      await marcarEnvio(envio.id, 'erro', r.erro)
    }
  }

  const { count: restantes } = await supabaseAdmin
    .from('campanha_envios')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', id)
    .eq('status', 'pendente')

  const faltam = restantes ?? 0
  const concluida = faltam === 0
  await supabaseAdmin
    .from('campanhas_marketing')
    .update({
      enviados: c.enviados + enviados,
      erros: c.erros + erros,
      ...(concluida ? { status: 'concluida', concluida_em: new Date().toISOString() } : {}),
    })
    .eq('id', id)

  return { campanha: c.nome, enviados, erros, pulados, restantes: faltam, concluida }
}

async function marcarEnvio(id: string, status: 'enviado' | 'erro' | 'pulado', erro?: string): Promise<void> {
  await supabaseAdmin
    .from('campanha_envios')
    .update({ status, erro: erro ?? null, enviado_em: new Date().toISOString() })
    .eq('id', id)
}

async function registrarContatoCampanha(c: Campanha, lead: Lead, mensagem: string): Promise<void> {
  await supabaseAdmin.from('contatos_marketing').insert({
    lead_id: lead.id,
    pedido_id: lead.pedidoId,
    campanha_id: c.id,
    tipo: 'oferta',
    origem: 'manual',
    canal: c.canal === 'email' ? 'email' : 'whatsapp',
    mensagem,
  })
}

/** Envio unitário — é aqui que cada canal encosta na API dele. */
async function enviarParaLead(c: Campanha, lead: Lead): Promise<{ ok: boolean; mensagem: string; erro?: string }> {
  const corpo = aplicarPlaceholders(c.mensagem, lead)

  if (c.canal === 'email') {
    const assunto = aplicarPlaceholders(c.assunto ?? c.nome, lead)
    const r = await enviarEmailMarketing({ para: lead.email!, assunto, corpo, leadId: lead.id })
    return { ok: r.ok, mensagem: `${assunto}\n\n${corpo}`, erro: r.erro }
  }

  if (c.canal === 'whatsapp_zapi') {
    try {
      const ok = await enviarMensagem(lead.telefone!, corpo)
      return { ok, mensagem: corpo, erro: ok ? undefined : 'Z-API recusou o envio' }
    } catch (e) {
      return { ok: false, mensagem: corpo, erro: e instanceof Error ? e.message : 'falha Z-API' }
    }
  }

  // whatsapp_template — template aprovado na Meta.
  if (!c.template) return { ok: false, mensagem: corpo, erro: 'campanha sem template definido' }
  const params = c.templateParams.corpo.map((p) => ({ type: 'text', text: aplicarPlaceholders(p, lead) || '-' }))
  const components: unknown[] = []
  if (params.length) components.push({ type: 'body', parameters: params })
  if (c.templateParams.botaoUrl) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: aplicarPlaceholders(c.templateParams.botaoUrl, lead) }],
    })
  }
  try {
    const r = await enviarTemplate(normalizarWaId(lead.telefone!), c.template, 'pt_BR', components)
    return { ok: r.ok, mensagem: corpo || `[template ${c.template}]`, erro: r.ok ? undefined : 'Meta recusou o envio' }
  } catch (e) {
    return { ok: false, mensagem: corpo, erro: e instanceof Error ? e.message : 'falha Meta' }
  }
}

/** Campanhas agendadas cuja hora chegou — usado pelo cron. */
export async function campanhasParaRodar(): Promise<Campanha[]> {
  const agora = new Date().toISOString()
  const { data } = await supabaseAdmin
    .from('campanhas_marketing')
    .select(COLS)
    .in('status', ['agendada', 'enviando'])
    .or(`agendada_para.is.null,agendada_para.lte.${agora}`)
    .order('agendada_para', { ascending: true })
    .limit(5)
  return ((data ?? []) as CampanhaRow[]).map(daLinha)
}
