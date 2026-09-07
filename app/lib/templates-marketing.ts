// app/lib/templates-marketing.ts
// ============================================================================
// BIBLIOTECA DE TEMPLATES — o conteúdo, separado de quem recebe.
// Campanha e automação escolhem um template daqui; assim a mesma mensagem é
// reaproveitada em vários fluxos e você edita a copy num lugar só.
//
// Três canais, com campos próprios:
//   email       assunto + corpo
//   whatsapp    nome do template aprovado na Meta + variáveis (ou texto Z-API)
//   mala_direta peça física: formato, arte, peso, custo — sem envio automático
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import type { CanalEnvio, ConteudoEnvio } from './envio-marketing'
import { blocosParaTexto, pendenciaDosBlocos, type Bloco } from './email-blocos'

export type StatusTemplate = 'rascunho' | 'ativo' | 'arquivado'
/** Formato do CORPO do e-mail: texto em parágrafos ou montado no editor visual.
 *  (Não confundir com `formato`, que é o formato da peça de mala direta.) */
export type FormatoEmail = 'texto' | 'blocos'
export type FormatoPeca = 'panfleto' | 'catalogo' | 'carta' | 'cartao_postal' | 'brinde'

export type TemplateMarketing = {
  id: string
  nome: string
  canal: CanalEnvio
  descricao: string | null
  assunto: string | null
  corpo: string
  formatoEmail: FormatoEmail
  blocos: Bloco[]
  templateMeta: string | null
  templateParams: { corpo: string[]; botaoUrl?: string }
  usaTemplateOficial: boolean
  formato: FormatoPeca | null
  arteUrl: string | null
  pesoGramas: number | null
  dimensoes: string | null
  custoUnitarioCentavos: number | null
  tags: string[]
  status: StatusTemplate
  criadoEm: string
}

type Row = {
  id: string
  nome: string
  canal: CanalEnvio
  descricao: string | null
  assunto: string | null
  corpo: string
  formato_email: FormatoEmail
  blocos: unknown
  template_meta: string | null
  template_params: unknown
  usa_template_oficial: boolean
  formato: FormatoPeca | null
  arte_url: string | null
  peso_gramas: number | null
  dimensoes: string | null
  custo_unitario_centavos: number | null
  tags: string[] | null
  status: StatusTemplate
  criado_em: string
}

const COLS =
  'id, nome, canal, descricao, assunto, corpo, formato_email, blocos, template_meta, template_params, usa_template_oficial, formato, arte_url, peso_gramas, dimensoes, custo_unitario_centavos, tags, status, criado_em'

function daLinha(r: Row): TemplateMarketing {
  const p = (r.template_params ?? {}) as { corpo?: unknown; botaoUrl?: unknown }
  return {
    id: r.id,
    nome: r.nome,
    canal: r.canal,
    descricao: r.descricao,
    assunto: r.assunto,
    corpo: r.corpo,
    formatoEmail: r.formato_email ?? 'texto',
    blocos: Array.isArray(r.blocos) ? (r.blocos as Bloco[]) : [],
    templateMeta: r.template_meta,
    templateParams: {
      corpo: Array.isArray(p.corpo) ? (p.corpo as string[]) : [],
      botaoUrl: typeof p.botaoUrl === 'string' ? p.botaoUrl : undefined,
    },
    usaTemplateOficial: r.usa_template_oficial,
    formato: r.formato,
    arteUrl: r.arte_url,
    pesoGramas: r.peso_gramas,
    dimensoes: r.dimensoes,
    custoUnitarioCentavos: r.custo_unitario_centavos,
    tags: r.tags ?? [],
    status: r.status,
    criadoEm: r.criado_em,
  }
}

export async function listarTemplates(canal?: CanalEnvio): Promise<TemplateMarketing[]> {
  let q = supabaseAdmin.from('templates_marketing').select(COLS)
  if (canal) q = q.eq('canal', canal)
  const { data } = await q.order('canal').order('nome')
  return ((data ?? []) as Row[]).map(daLinha)
}

export async function obterTemplate(id: string): Promise<TemplateMarketing | null> {
  const { data } = await supabaseAdmin.from('templates_marketing').select(COLS).eq('id', id).maybeSingle<Row>()
  return data ? daLinha(data) : null
}

export type DadosTemplate = {
  nome: string
  canal: CanalEnvio
  descricao?: string | null
  assunto?: string | null
  corpo?: string
  formatoEmail?: FormatoEmail
  blocos?: Bloco[]
  templateMeta?: string | null
  templateParams?: { corpo: string[]; botaoUrl?: string }
  usaTemplateOficial?: boolean
  formato?: FormatoPeca | null
  arteUrl?: string | null
  pesoGramas?: number | null
  dimensoes?: string | null
  custoUnitarioCentavos?: number | null
  tags?: string[]
  status?: StatusTemplate
}

function paraLinha(d: Partial<DadosTemplate>): Record<string, unknown> {
  const o: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if (d.nome !== undefined) o.nome = d.nome
  if (d.canal !== undefined) o.canal = d.canal
  if (d.descricao !== undefined) o.descricao = d.descricao
  if (d.assunto !== undefined) o.assunto = d.assunto
  if (d.corpo !== undefined) o.corpo = d.corpo
  if (d.formatoEmail !== undefined) o.formato_email = d.formatoEmail
  // O corpo em texto é derivado dos blocos: serve de fallback no e-mail e é
  // o que fica no histórico do lead.
  if (d.blocos !== undefined) {
    o.blocos = d.blocos
    if (d.formatoEmail === 'blocos' || d.corpo === undefined) o.corpo = blocosParaTexto(d.blocos)
  }
  if (d.templateMeta !== undefined) o.template_meta = d.templateMeta
  if (d.templateParams !== undefined) o.template_params = d.templateParams
  if (d.usaTemplateOficial !== undefined) o.usa_template_oficial = d.usaTemplateOficial
  if (d.formato !== undefined) o.formato = d.formato
  if (d.arteUrl !== undefined) o.arte_url = d.arteUrl
  if (d.pesoGramas !== undefined) o.peso_gramas = d.pesoGramas
  if (d.dimensoes !== undefined) o.dimensoes = d.dimensoes
  if (d.custoUnitarioCentavos !== undefined) o.custo_unitario_centavos = d.custoUnitarioCentavos
  if (d.tags !== undefined) o.tags = d.tags
  if (d.status !== undefined) o.status = d.status
  return o
}

export async function criarTemplate(d: DadosTemplate): Promise<TemplateMarketing> {
  const { data, error } = await supabaseAdmin
    .from('templates_marketing')
    .insert({ corpo: '', ...paraLinha(d) })
    .select(COLS)
    .single<Row>()
  if (error) throw new Error(error.message)
  return daLinha(data)
}

export async function atualizarTemplate(id: string, d: Partial<DadosTemplate>): Promise<void> {
  const { error } = await supabaseAdmin.from('templates_marketing').update(paraLinha(d)).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function excluirTemplate(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { count } = await supabaseAdmin
    .from('automacao_passos')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id)
  if ((count ?? 0) > 0) {
    return { ok: false, erro: 'Esse template está sendo usado por um fluxo de automação. Tire do fluxo antes de excluir.' }
  }
  const { error } = await supabaseAdmin.from('templates_marketing').delete().eq('id', id)
  return error ? { ok: false, erro: error.message } : { ok: true }
}

/** Converte o template no conteúdo que o motor de envio entende. */
export function conteudoDoTemplate(t: TemplateMarketing): ConteudoEnvio {
  return {
    canal: t.canal,
    assunto: t.assunto,
    mensagem: t.corpo,
    formato: t.formatoEmail,
    blocos: t.blocos,
    templateMeta: t.templateMeta,
    templateParams: t.templateParams,
    usaTemplateOficial: t.usaTemplateOficial,
  }
}

/** Aviso de pendência pra tela — o que falta pro template poder ser usado. */
export function pendenciaDoTemplate(t: TemplateMarketing): string | null {
  if (t.canal === 'email') {
    if (!t.assunto?.trim()) return 'Falta o assunto do e-mail.'
    if (t.formatoEmail === 'blocos') return pendenciaDosBlocos(t.blocos)
    if (t.corpo.trim().length < 20) return 'O corpo do e-mail está muito curto.'
    return null
  }
  if (t.canal === 'whatsapp') {
    if (t.usaTemplateOficial && !t.templateMeta?.trim()) {
      return 'Falta o nome do template aprovado na Meta.'
    }
    if (!t.usaTemplateOficial && t.corpo.trim().length < 10) return 'Falta o texto da mensagem.'
    return null
  }
  if (!t.formato) return 'Escolha o formato da peça.'
  if (!t.arteUrl?.trim()) return 'Falta o link da arte (PDF).'
  return null
}
