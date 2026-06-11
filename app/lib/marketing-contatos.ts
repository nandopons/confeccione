// app/lib/marketing-contatos.ts
// ============================================================================
// Marketing — histórico de contatos, nutrição automática e disparo em massa.
//
// contatos_marketing: log de TODA mensagem de marketing enviada a um lead
// (pedidos_assistente): lembrete/feedback manuais, nutrição automática e
// ofertas em massa. Origem 'manual' (botões do admin) ou 'automatico' (cron).
//
// Nutrição automática (executarNutricao) — travas anti-spam:
//   - só fases não pagas e com telefone
//   - lead parado há >= dias_parado (atualizado_em ?? criado_em)
//   - menos de max_toques contatos registrados no total
//   - último contato há >= dias_parado (espaçamento entre toques)
//   - no máximo NUTRICAO_MAX_POR_RODADA envios por execução
// Config em marketing_config (linha única id=1); toggle padrão DESLIGADO.
//
// Disparo em massa (executarDisparo): mensagem custom com placeholder #nome
// pra um segmento (fase/UF/busca). Fluxo em 2 passos no painel: prévia →
// confirmação. Cap DISPARO_MAX_POR_RODADA por rodada (repete pra continuar).
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { enviarMensagem } from './zapi'
import { listarLeadsMarketing, type FaseLead, type LeadMarketing } from './marketing'

export type TipoContato = 'lembrete' | 'nutricao' | 'oferta' | 'feedback'
export type OrigemContato = 'manual' | 'automatico'

export type ContatoMarketing = {
  id: string
  pedidoId: string
  tipo: TipoContato
  canal: string
  origem: OrigemContato
  mensagem: string
  enviadoEm: string
}

export const NUTRICAO_MAX_POR_RODADA = 15
export const DISPARO_MAX_POR_RODADA = 40

// ─────────────────────────────────────────────────────────────
// Histórico
// ─────────────────────────────────────────────────────────────

export async function registrarContato(
  pedidoId: string,
  dados: { tipo: TipoContato; mensagem: string; origem?: OrigemContato; canal?: string }
): Promise<void> {
  const { error } = await supabaseAdmin.from('contatos_marketing').insert({
    pedido_id: pedidoId,
    tipo: dados.tipo,
    origem: dados.origem ?? 'manual',
    canal: dados.canal ?? 'whatsapp',
    mensagem: dados.mensagem,
  })
  if (error) console.error('[marketing-contatos] registrarContato falhou', { pedidoId, error })
}

type ContatoRow = {
  id: string
  pedido_id: string
  tipo: TipoContato
  canal: string
  origem: OrigemContato
  mensagem: string
  enviado_em: string
}

export async function contatosDoLead(pedidoId: string): Promise<ContatoMarketing[]> {
  const { data } = await supabaseAdmin
    .from('contatos_marketing')
    .select('id, pedido_id, tipo, canal, origem, mensagem, enviado_em')
    .eq('pedido_id', pedidoId)
    .order('enviado_em', { ascending: false })
    .limit(50)
  return ((data ?? []) as ContatoRow[]).map((c) => ({
    id: c.id,
    pedidoId: c.pedido_id,
    tipo: c.tipo,
    canal: c.canal,
    origem: c.origem,
    mensagem: c.mensagem,
    enviadoEm: c.enviado_em,
  }))
}

export type ResumoContatos = Record<string, { toques: number; ultimoEm: string }>

/** Resumo por lead pra tabela do painel (toques + data do último contato). */
export async function resumoContatosPorLead(): Promise<ResumoContatos> {
  const { data } = await supabaseAdmin
    .from('contatos_marketing')
    .select('pedido_id, enviado_em')
    .order('enviado_em', { ascending: false })
    .limit(2000)
  const r: ResumoContatos = {}
  for (const c of (data ?? []) as Array<{ pedido_id: string; enviado_em: string }>) {
    const atual = r[c.pedido_id]
    if (atual) atual.toques += 1
    else r[c.pedido_id] = { toques: 1, ultimoEm: c.enviado_em }
  }
  return r
}

// ─────────────────────────────────────────────────────────────
// Config da nutrição
// ─────────────────────────────────────────────────────────────

export type ConfigNutricao = { ativa: boolean; diasParado: number; maxToques: number }

export async function obterConfigNutricao(): Promise<ConfigNutricao> {
  const { data } = await supabaseAdmin
    .from('marketing_config')
    .select('nutricao_ativa, dias_parado, max_toques')
    .eq('id', 1)
    .maybeSingle<{ nutricao_ativa: boolean; dias_parado: number; max_toques: number }>()
  return {
    ativa: data?.nutricao_ativa ?? false,
    diasParado: data?.dias_parado ?? 3,
    maxToques: data?.max_toques ?? 2,
  }
}

export async function salvarConfigNutricao(c: ConfigNutricao): Promise<void> {
  const { error } = await supabaseAdmin.from('marketing_config').upsert({
    id: 1,
    nutricao_ativa: c.ativa,
    dias_parado: c.diasParado,
    max_toques: c.maxToques,
    atualizado_em: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

// ─────────────────────────────────────────────────────────────
// Nutrição automática
// ─────────────────────────────────────────────────────────────

export function mensagemReativacao(nome: string | null): string {
  return `Oi${nome ? ', ' + nome.split(' ')[0] : ''}! Vi que você realizou um pedido em nosso site. Gostaria de ajuda para finalizar? 😊`
}

export type ResultadoNutricao = {
  ativa: boolean
  candidatos: number
  enviados: number
  restantes: number
  erros: number
}

/** Filtra os leads elegíveis pra nutrição (puro — testável). */
export function leadsElegiveisNutricao(
  leads: LeadMarketing[],
  resumo: ResumoContatos,
  cfg: ConfigNutricao,
  agoraMs: number
): LeadMarketing[] {
  const limiteParadoMs = agoraMs - cfg.diasParado * 24 * 60 * 60 * 1000
  return leads.filter((l) => {
    if (l.fase === 'pago') return false
    if (!l.telefone) return false
    const baseMs = new Date(l.atualizadoEm ?? l.criadoEm).getTime()
    if (Number.isNaN(baseMs) || baseMs > limiteParadoMs) return false // ainda ativo
    const r = resumo[l.id]
    if (r) {
      if (r.toques >= cfg.maxToques) return false
      if (new Date(r.ultimoEm).getTime() > limiteParadoMs) return false // toque recente
    }
    return true
  })
}

/**
 * Roda uma rodada de nutrição. Sem `forcar`, respeita o toggle (cron);
 * com `forcar:true` (botão "Rodar agora" do admin), roda mesmo desligada —
 * mas SEMPRE respeitando as travas anti-spam.
 */
export async function executarNutricao(opts?: { forcar?: boolean }): Promise<ResultadoNutricao> {
  const cfg = await obterConfigNutricao()
  if (!cfg.ativa && !opts?.forcar) {
    return { ativa: false, candidatos: 0, enviados: 0, restantes: 0, erros: 0 }
  }

  const [leads, resumo] = await Promise.all([listarLeadsMarketing(), resumoContatosPorLead()])
  const candidatos = leadsElegiveisNutricao(leads, resumo, cfg, Date.now())
  const alvo = candidatos.slice(0, NUTRICAO_MAX_POR_RODADA)

  let enviados = 0
  let erros = 0
  for (const l of alvo) {
    const msg = mensagemReativacao(l.nome)
    let ok = false
    try {
      ok = await enviarMensagem(l.telefone!, msg)
    } catch {
      ok = false
    }
    if (ok) {
      enviados++
      await registrarContato(l.id, { tipo: 'nutricao', origem: 'automatico', mensagem: msg })
    } else {
      erros++
    }
  }

  return {
    ativa: true,
    candidatos: candidatos.length,
    enviados,
    restantes: Math.max(candidatos.length - alvo.length, 0),
    erros,
  }
}

// ─────────────────────────────────────────────────────────────
// Disparo em massa por segmento
// ─────────────────────────────────────────────────────────────

export type FiltroDisparo = { fase?: FaseLead | 'todas'; uf?: string; busca?: string }

/** Filtra leads pro disparo (puro). Só entra quem tem WhatsApp. */
export function filtrarLeadsDisparo(leads: LeadMarketing[], f: FiltroDisparo): LeadMarketing[] {
  const q = (f.busca ?? '').trim().toLowerCase()
  const uf = (f.uf ?? '').trim().toUpperCase()
  return leads.filter((l) => {
    if (!l.telefone) return false
    if (f.fase && f.fase !== 'todas' && l.fase !== f.fase) return false
    if (uf && (l.uf ?? '').toUpperCase() !== uf) return false
    if (q && ![l.nome, l.email, l.cidade, l.interesse].some((v) => (v ?? '').toLowerCase().includes(q))) {
      return false
    }
    return true
  })
}

/** Substitui #nome pelo primeiro nome; sem nome, remove o placeholder limpo. */
export function aplicarTemplate(msg: string, nome: string | null): string {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0] ?? ''
  if (primeiro) return msg.split('#nome').join(primeiro)
  return msg.replace(/ ?,? ?#nome/g, '').replace(/ {2,}/g, ' ')
}

export type PreviaDisparo = {
  total: number
  amostra: Array<{ nome: string | null; cidade: string | null; uf: string | null }>
  exemplo: string | null
  cap: number
}

export async function previaDisparo(filtro: FiltroDisparo, mensagem: string): Promise<PreviaDisparo> {
  const leads = filtrarLeadsDisparo(await listarLeadsMarketing(), filtro)
  return {
    total: leads.length,
    amostra: leads.slice(0, 8).map((l) => ({ nome: l.nome, cidade: l.cidade, uf: l.uf })),
    exemplo: leads[0] ? aplicarTemplate(mensagem, leads[0].nome) : null,
    cap: DISPARO_MAX_POR_RODADA,
  }
}

export type ResultadoDisparo = { total: number; enviados: number; erros: number; restantes: number }

export async function executarDisparo(filtro: FiltroDisparo, mensagem: string): Promise<ResultadoDisparo> {
  const leads = filtrarLeadsDisparo(await listarLeadsMarketing(), filtro)
  const alvo = leads.slice(0, DISPARO_MAX_POR_RODADA)

  let enviados = 0
  let erros = 0
  for (const l of alvo) {
    const msg = aplicarTemplate(mensagem, l.nome)
    let ok = false
    try {
      ok = await enviarMensagem(l.telefone!, msg)
    } catch {
      ok = false
    }
    if (ok) {
      enviados++
      await registrarContato(l.id, { tipo: 'oferta', origem: 'manual', mensagem: msg })
    } else {
      erros++
    }
  }

  return { total: leads.length, enviados, erros, restantes: Math.max(leads.length - alvo.length, 0) }
}
