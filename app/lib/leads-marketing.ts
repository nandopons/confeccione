// app/lib/leads-marketing.ts
// ============================================================================
// BASE DE LEADS DE MARKETING (leads_marketing)
//
// Aqui o lead é uma entidade própria, independente de ter pedido no chat:
//   • origem 'chat'       → veio de pedidos_assistente (sincronizado)
//   • origem 'conta'      → cadastrou conta no site (contas_clientes)
//   • origem 'manual'     → cadastrado à mão no painel
//   • origem 'importacao' → veio de um CSV importado
//
// Chave de deduplicação: telefone_norm (só dígitos, com DDI 55) e email_norm
// (minúsculo). Toda escrita passa por `upsertLead`, que procura antes de
// gravar — nunca cria um segundo registro pro mesmo WhatsApp/e-mail.
//
// opt_out = pediu pra não receber mais. Campanha e nutrição SEMPRE pulam.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type OrigemLead = 'chat' | 'conta' | 'manual' | 'importacao'
export type StatusLead = 'lead' | 'cliente' | 'descadastrado'

export type Lead = {
  id: string
  nome: string | null
  empresa: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  origem: OrigemLead
  tags: string[]
  observacao: string | null
  status: StatusLead
  optOut: boolean
  pedidoId: string | null
  ultimoContatoEm: string | null
  toques: number
  criadoEm: string
}

type LeadRow = {
  id: string
  nome: string | null
  empresa: string | null
  telefone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  origem: OrigemLead
  tags: string[] | null
  observacao: string | null
  status: StatusLead
  opt_out: boolean
  pedido_id: string | null
  ultimo_contato_em: string | null
  toques: number
  criado_em: string
}

const COLUNAS =
  'id, nome, empresa, telefone, email, cidade, uf, cep, logradouro, numero, complemento, bairro, origem, tags, observacao, status, opt_out, pedido_id, ultimo_contato_em, toques, criado_em'

function daLinha(r: LeadRow): Lead {
  return {
    id: r.id,
    nome: r.nome,
    empresa: r.empresa,
    telefone: r.telefone,
    email: r.email,
    cidade: r.cidade,
    uf: r.uf,
    cep: r.cep,
    logradouro: r.logradouro,
    numero: r.numero,
    complemento: r.complemento,
    bairro: r.bairro,
    origem: r.origem,
    tags: r.tags ?? [],
    observacao: r.observacao,
    status: r.status,
    optOut: r.opt_out,
    pedidoId: r.pedido_id,
    ultimoContatoEm: r.ultimo_contato_em,
    toques: r.toques,
    criadoEm: r.criado_em,
  }
}

// ─────────────────────────────────────────────────────────────
// Normalização (as chaves de dedupe)
// ─────────────────────────────────────────────────────────────

/**
 * Telefone → só dígitos com DDI 55. Aceita "(81) 99578-2077", "81995782077",
 * "+55 81 99578 2077". Devolve null se não parecer um número brasileiro
 * válido (menos de 10 dígitos depois do DDD).
 */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  let d = (bruto ?? '').replace(/\D/g, '')
  if (!d) return null
  d = d.replace(/^0+/, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length < 10 || d.length > 11) return null
  // Celular sem o 9 na frente (base antiga): completa.
  if (d.length === 10 && Number(d[2]) >= 6) d = d.slice(0, 2) + '9' + d.slice(2)
  return '55' + d
}

export function normalizarEmail(bruto: string | null | undefined): string | null {
  const e = (bruto ?? '').trim().toLowerCase()
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null
  return e
}

export function normalizarUf(bruto: string | null | undefined): string | null {
  const u = (bruto ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(u) ? u : null
}

function limpo(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s ? s.slice(0, 200) : null
}

// ─────────────────────────────────────────────────────────────
// Leitura
// ─────────────────────────────────────────────────────────────

export type FiltroLeads = {
  busca?: string
  uf?: string
  origem?: OrigemLead | 'todas'
  status?: StatusLead | 'todos'
  tag?: string
  canal?: 'todos' | 'whatsapp' | 'email' | 'endereco'
  incluirOptOut?: boolean
}

export type PaginaLeads = { leads: Lead[]; total: number }

export async function listarLeads(
  filtro: FiltroLeads = {},
  pagina = 0,
  porPagina = 50
): Promise<PaginaLeads> {
  let q = supabaseAdmin.from('leads_marketing').select(COLUNAS, { count: 'exact' })

  if (!filtro.incluirOptOut) q = q.eq('opt_out', false)
  if (filtro.uf) q = q.eq('uf', filtro.uf.toUpperCase())
  if (filtro.origem && filtro.origem !== 'todas') q = q.eq('origem', filtro.origem)
  if (filtro.status && filtro.status !== 'todos') q = q.eq('status', filtro.status)
  if (filtro.tag) q = q.contains('tags', [filtro.tag])
  if (filtro.canal === 'whatsapp') q = q.not('telefone_norm', 'is', null)
  if (filtro.canal === 'email') q = q.not('email_norm', 'is', null)
  if (filtro.canal === 'endereco') q = q.not('cep', 'is', null)

  const busca = (filtro.busca ?? '').trim()
  if (busca) {
    const t = busca.replace(/[%,()]/g, '')
    const digitos = busca.replace(/\D/g, '')
    const ors = [`nome.ilike.%${t}%`, `empresa.ilike.%${t}%`, `email.ilike.%${t}%`, `cidade.ilike.%${t}%`]
    if (digitos.length >= 4) ors.push(`telefone_norm.ilike.%${digitos}%`)
    q = q.or(ors.join(','))
  }

  const de = pagina * porPagina
  const { data, count } = await q.order('criado_em', { ascending: false }).range(de, de + porPagina - 1)
  return { leads: ((data ?? []) as LeadRow[]).map(daLinha), total: count ?? 0 }
}

/** Todos os leads que batem no filtro (sem paginar) — usado por campanha/export. */
export async function listarLeadsCompleto(filtro: FiltroLeads = {}): Promise<Lead[]> {
  const out: Lead[] = []
  for (let p = 0; p < 60; p++) {
    const { leads } = await listarLeads(filtro, p, 1000)
    out.push(...leads)
    if (leads.length < 1000) break
  }
  return out
}

export async function obterLead(id: string): Promise<Lead | null> {
  const { data } = await supabaseAdmin.from('leads_marketing').select(COLUNAS).eq('id', id).maybeSingle<LeadRow>()
  return data ? daLinha(data) : null
}

export type ResumoBaseLeads = {
  total: number
  comWhatsapp: number
  comEmail: number
  clientes: number
  optOut: number
  porOrigem: Record<string, number>
}

export async function resumoBaseLeads(): Promise<ResumoBaseLeads> {
  const total = await contarLeads()
  const [comWhatsapp, comEmail, clientes, optOut] = await Promise.all([
    contarLeads({ comTelefone: true }),
    contarLeads({ comEmail: true }),
    contarLeads({ status: 'cliente' }),
    contarLeads({ optOut: true }),
  ])
  const porOrigem: Record<string, number> = {}
  for (const o of ['chat', 'conta', 'manual', 'importacao'] as OrigemLead[]) {
    porOrigem[o] = await contarLeads({ origem: o })
  }
  return { total, comWhatsapp, comEmail, clientes, optOut, porOrigem }
}

async function contarLeads(
  f: { comTelefone?: boolean; comEmail?: boolean; status?: StatusLead; optOut?: boolean; origem?: OrigemLead } = {}
): Promise<number> {
  let q = supabaseAdmin.from('leads_marketing').select('id', { count: 'exact', head: true })
  if (f.comTelefone) q = q.not('telefone_norm', 'is', null)
  if (f.comEmail) q = q.not('email_norm', 'is', null)
  if (f.status) q = q.eq('status', f.status)
  if (f.optOut !== undefined) q = q.eq('opt_out', f.optOut)
  if (f.origem) q = q.eq('origem', f.origem)
  const { count } = await q
  return count ?? 0
}

// ─────────────────────────────────────────────────────────────
// Escrita — sempre via upsert com dedupe
// ─────────────────────────────────────────────────────────────

export type DadosLead = {
  nome?: string | null
  empresa?: string | null
  telefone?: string | null
  email?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  tags?: string[]
  observacao?: string | null
  status?: StatusLead
  origem?: OrigemLead
  pedidoId?: string | null
  contaId?: string | null
  importacao?: string | null
}

export type ResultadoUpsert = { acao: 'criado' | 'atualizado' | 'invalido'; id?: string; motivo?: string }

/**
 * Grava um lead deduplicando por telefone/e-mail.
 * Campos vazios NUNCA apagam o que já existe — só completam.
 */
export async function upsertLead(d: DadosLead): Promise<ResultadoUpsert> {
  const telefoneNorm = normalizarTelefone(d.telefone)
  const emailNorm = normalizarEmail(d.email)
  if (!telefoneNorm && !emailNorm) {
    return { acao: 'invalido', motivo: 'sem WhatsApp nem e-mail válido' }
  }

  const existente = await acharPorContato(telefoneNorm, emailNorm)

  const campos: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  const preenche = (col: string, valor: unknown) => {
    if (valor === null || valor === undefined || valor === '') return
    campos[col] = valor
  }
  preenche('nome', limpo(d.nome))
  preenche('empresa', limpo(d.empresa))
  preenche('cidade', limpo(d.cidade))
  preenche('uf', normalizarUf(d.uf))
  preenche('cep', limpo(d.cep))
  preenche('logradouro', limpo(d.logradouro))
  preenche('numero', limpo(d.numero))
  preenche('complemento', limpo(d.complemento))
  preenche('bairro', limpo(d.bairro))
  preenche('observacao', limpo(d.observacao))
  preenche('pedido_id', d.pedidoId)
  preenche('conta_id', d.contaId)
  preenche('importacao', d.importacao)
  if (telefoneNorm) {
    campos.telefone_norm = telefoneNorm
    campos.telefone = limpo(d.telefone) ?? telefoneNorm
  }
  if (emailNorm) {
    campos.email_norm = emailNorm
    campos.email = emailNorm
  }

  if (!existente) {
    const { data, error } = await supabaseAdmin
      .from('leads_marketing')
      .insert({
        ...campos,
        origem: d.origem ?? 'manual',
        status: d.status ?? 'lead',
        tags: d.tags ?? [],
      })
      .select('id')
      .single<{ id: string }>()
    if (error) return { acao: 'invalido', motivo: error.message }
    return { acao: 'criado', id: data.id }
  }

  // Atualiza: status só sobe (lead → cliente), tags são unidas.
  if (d.status === 'cliente') campos.status = 'cliente'
  if (d.tags?.length) campos.tags = Array.from(new Set([...existente.tags, ...d.tags]))
  // Não sobrescreve o pedido de origem já vinculado.
  if (existente.pedidoId) delete campos.pedido_id

  const { error } = await supabaseAdmin.from('leads_marketing').update(campos).eq('id', existente.id)
  if (error) return { acao: 'invalido', motivo: error.message }
  return { acao: 'atualizado', id: existente.id }
}

async function acharPorContato(telefoneNorm: string | null, emailNorm: string | null): Promise<Lead | null> {
  if (telefoneNorm) {
    const { data } = await supabaseAdmin
      .from('leads_marketing')
      .select(COLUNAS)
      .eq('telefone_norm', telefoneNorm)
      .maybeSingle<LeadRow>()
    if (data) return daLinha(data)
  }
  if (emailNorm) {
    const { data } = await supabaseAdmin
      .from('leads_marketing')
      .select(COLUNAS)
      .eq('email_norm', emailNorm)
      .maybeSingle<LeadRow>()
    if (data) return daLinha(data)
  }
  return null
}

export async function atualizarLead(id: string, d: DadosLead): Promise<{ ok: boolean; erro?: string }> {
  const campos: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if (d.nome !== undefined) campos.nome = limpo(d.nome)
  if (d.empresa !== undefined) campos.empresa = limpo(d.empresa)
  if (d.cidade !== undefined) campos.cidade = limpo(d.cidade)
  if (d.uf !== undefined) campos.uf = normalizarUf(d.uf)
  for (const c of ['cep', 'logradouro', 'numero', 'complemento', 'bairro'] as const) {
    if (d[c] !== undefined) campos[c] = limpo(d[c])
  }
  if (d.observacao !== undefined) campos.observacao = limpo(d.observacao)
  if (d.tags !== undefined) campos.tags = d.tags
  if (d.status !== undefined) campos.status = d.status
  if (d.telefone !== undefined) {
    const n = normalizarTelefone(d.telefone)
    campos.telefone_norm = n
    campos.telefone = n ? (limpo(d.telefone) ?? n) : null
  }
  if (d.email !== undefined) {
    const n = normalizarEmail(d.email)
    campos.email_norm = n
    campos.email = n
  }
  const { error } = await supabaseAdmin.from('leads_marketing').update(campos).eq('id', id)
  return error ? { ok: false, erro: error.message } : { ok: true }
}

export async function definirOptOut(id: string, optOut: boolean): Promise<void> {
  await supabaseAdmin
    .from('leads_marketing')
    .update({
      opt_out: optOut,
      opt_out_em: optOut ? new Date().toISOString() : null,
      status: optOut ? 'descadastrado' : 'lead',
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
}

export async function excluirLead(id: string): Promise<void> {
  await supabaseAdmin.from('leads_marketing').delete().eq('id', id)
}

/** Marca um toque de contato (chamada depois de cada envio). */
export async function registrarToque(id: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('leads_marketing')
    .select('toques')
    .eq('id', id)
    .maybeSingle<{ toques: number }>()
  await supabaseAdmin
    .from('leads_marketing')
    .update({ toques: (data?.toques ?? 0) + 1, ultimo_contato_em: new Date().toISOString() })
    .eq('id', id)
}

// ─────────────────────────────────────────────────────────────
// Sincronização com o resto do site
// ─────────────────────────────────────────────────────────────

export type ResultadoSync = { lidos: number; criados: number; atualizados: number; ignorados: number }

/**
 * Traz pra base todo mundo que já apareceu no site: quem montou pedido no
 * chat (pedidos_assistente) e quem criou conta (contas_clientes). Idempotente
 * — pode rodar quantas vezes quiser.
 */
export async function sincronizarLeadsDoSite(): Promise<ResultadoSync> {
  const r: ResultadoSync = { lidos: 0, criados: 0, atualizados: 0, ignorados: 0 }

  const { data: pedidos } = await supabaseAdmin
    .from('pedidos_assistente')
    .select('id, nome, telefone, email, cidade, uf, pagamento_status, criado_em')
    .order('criado_em', { ascending: true })
    .limit(5000)

  for (const p of (pedidos ?? []) as Array<{
    id: string
    nome: string | null
    telefone: string | null
    email: string | null
    cidade: string | null
    uf: string | null
    pagamento_status: string | null
  }>) {
    r.lidos++
    const res = await upsertLead({
      nome: p.nome,
      telefone: p.telefone,
      email: p.email,
      cidade: p.cidade,
      uf: p.uf,
      origem: 'chat',
      pedidoId: p.id,
      status: p.pagamento_status === 'pago' ? 'cliente' : 'lead',
    })
    if (res.acao === 'criado') r.criados++
    else if (res.acao === 'atualizado') r.atualizados++
    else r.ignorados++
  }

  const { data: contas } = await supabaseAdmin
    .from('contas_clientes')
    .select('id, nome, email, whatsapp, cidade, uf')
    .limit(5000)

  for (const c of (contas ?? []) as Array<{
    id: string
    nome: string | null
    email: string
    whatsapp: string | null
    cidade: string | null
    uf: string | null
  }>) {
    r.lidos++
    const res = await upsertLead({
      nome: c.nome,
      email: c.email,
      telefone: c.whatsapp,
      cidade: c.cidade,
      uf: c.uf,
      origem: 'conta',
      contaId: c.id,
    })
    if (res.acao === 'criado') r.criados++
    else if (res.acao === 'atualizado') r.atualizados++
    else r.ignorados++
  }

  return r
}

// ─────────────────────────────────────────────────────────────
// CSV — leitura genérica com mapeamento de colunas
// ─────────────────────────────────────────────────────────────

/** Detecta o separador (; do Excel BR, , do padrão, ou tab). */
function detectarSeparador(primeiraLinha: string): string {
  const cand = [';', ',', '\t']
  let melhor = ';'
  let max = -1
  for (const c of cand) {
    const n = primeiraLinha.split(c).length
    if (n > max) {
      max = n
      melhor = c
    }
  }
  return melhor
}

/** Parser de CSV com aspas e quebra de linha dentro do campo. */
export function lerCsv(texto: string): { cabecalho: string[]; linhas: string[][] } {
  const limpoTexto = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const sep = detectarSeparador(limpoTexto.split('\n')[0] ?? '')

  const linhas: string[][] = []
  let campo = ''
  let atual: string[] = []
  let aspas = false

  for (let i = 0; i < limpoTexto.length; i++) {
    const ch = limpoTexto[i]
    if (aspas) {
      if (ch === '"') {
        if (limpoTexto[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
      } else campo += ch
      continue
    }
    if (ch === '"') aspas = true
    else if (ch === sep) {
      atual.push(campo)
      campo = ''
    } else if (ch === '\n') {
      atual.push(campo)
      linhas.push(atual)
      atual = []
      campo = ''
    } else campo += ch
  }
  if (campo || atual.length) {
    atual.push(campo)
    linhas.push(atual)
  }

  const naoVazias = linhas.filter((l) => l.some((c) => c.trim() !== ''))
  const cabecalho = (naoVazias.shift() ?? []).map((c) => c.trim())
  return { cabecalho, linhas: naoVazias }
}

export type CampoLead =
  | 'nome' | 'empresa' | 'telefone' | 'email'
  | 'cep' | 'logradouro' | 'numero' | 'complemento' | 'bairro'
  | 'cidade' | 'uf' | 'observacao' | 'ignorar'

export const CAMPOS_LEAD: Array<{ campo: CampoLead; label: string }> = [
  { campo: 'nome', label: 'Nome' },
  { campo: 'empresa', label: 'Empresa' },
  { campo: 'telefone', label: 'WhatsApp / telefone' },
  { campo: 'email', label: 'E-mail' },
  { campo: 'cep', label: 'CEP' },
  { campo: 'logradouro', label: 'Rua / logradouro' },
  { campo: 'numero', label: 'Número' },
  { campo: 'complemento', label: 'Complemento' },
  { campo: 'bairro', label: 'Bairro' },
  { campo: 'cidade', label: 'Cidade' },
  { campo: 'uf', label: 'UF' },
  { campo: 'observacao', label: 'Observação' },
  { campo: 'ignorar', label: '— não importar —' },
]

/** Chuta o mapeamento a partir dos nomes das colunas do arquivo. */
export function sugerirMapeamento(cabecalho: string[]): CampoLead[] {
  const regra: Array<[RegExp, CampoLead]> = [
    [/whats|celul|fone|tele|phone|contato/i, 'telefone'],
    [/mail/i, 'email'],
    [/empres|raz[aã]o|fantasia|loja|marca/i, 'empresa'],
    [/nome|cliente|respons/i, 'nome'],
    [/cep|c[oó]digo postal/i, 'cep'],
    [/logradouro|endere[cç]o|^rua|^av/i, 'logradouro'],
    [/^n[uú]m|^n[oº]$/i, 'numero'],
    [/complem/i, 'complemento'],
    [/bairro/i, 'bairro'],
    [/cidade|munic/i, 'cidade'],
    [/^uf$|estado/i, 'uf'],
    [/obs|nota|coment/i, 'observacao'],
  ]
  return cabecalho.map((col) => {
    for (const [re, campo] of regra) if (re.test(col)) return campo
    return 'ignorar'
  })
}

export type LinhaImport = {
  nome?: string; empresa?: string; telefone?: string; email?: string
  cep?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string
  cidade?: string; uf?: string; observacao?: string
}

/** Aplica o mapeamento coluna→campo nas linhas cruas do CSV. */
export function aplicarMapeamento(linhas: string[][], mapa: CampoLead[]): LinhaImport[] {
  return linhas.map((cols) => {
    const o: LinhaImport = {}
    mapa.forEach((campo, i) => {
      if (campo === 'ignorar') return
      const v = (cols[i] ?? '').trim()
      if (v) o[campo] = v
    })
    return o
  })
}

export type PreviaImport = {
  totalLinhas: number
  validos: number
  invalidos: number
  novos: number
  jaExistem: number
  amostra: Array<LinhaImport & { situacao: 'novo' | 'ja_existe' | 'invalido'; motivo?: string }>
}

/** Confere o arquivo sem gravar nada: quantos entram, quantos já existem. */
export async function previaImportacao(linhas: LinhaImport[]): Promise<PreviaImport> {
  const p: PreviaImport = { totalLinhas: linhas.length, validos: 0, invalidos: 0, novos: 0, jaExistem: 0, amostra: [] }
  const vistos = new Set<string>()

  for (const l of linhas) {
    const tel = normalizarTelefone(l.telefone)
    const mail = normalizarEmail(l.email)
    let situacao: 'novo' | 'ja_existe' | 'invalido' = 'novo'
    let motivo: string | undefined

    if (!tel && !mail) {
      situacao = 'invalido'
      motivo = 'sem WhatsApp nem e-mail válido'
      p.invalidos++
    } else {
      const chave = tel ?? mail!
      if (vistos.has(chave)) {
        situacao = 'ja_existe'
        motivo = 'repetido no próprio arquivo'
        p.jaExistem++
      } else {
        vistos.add(chave)
        p.validos++
        const existe = await acharPorContato(tel, mail)
        if (existe) {
          situacao = 'ja_existe'
          motivo = 'já está na base'
          p.jaExistem++
        } else p.novos++
      }
    }
    if (p.amostra.length < 12) p.amostra.push({ ...l, situacao, motivo })
  }
  return p
}

export type ResultadoImport = { criados: number; atualizados: number; invalidos: number; erros: string[] }

export async function importarLeads(
  linhas: LinhaImport[],
  opts: { etiqueta?: string; tags?: string[] } = {}
): Promise<ResultadoImport> {
  const r: ResultadoImport = { criados: 0, atualizados: 0, invalidos: 0, erros: [] }
  const etiqueta = opts.etiqueta ?? `import-${new Date().toISOString().slice(0, 10)}`

  for (const l of linhas) {
    const res = await upsertLead({
      ...l,
      origem: 'importacao',
      importacao: etiqueta,
      tags: opts.tags,
    })
    if (res.acao === 'criado') r.criados++
    else if (res.acao === 'atualizado') r.atualizados++
    else {
      r.invalidos++
      if (res.motivo && r.erros.length < 10) r.erros.push(res.motivo)
    }
  }
  return r
}

/** CSV da base pra backup/planilha (BOM + separador ;). */
export function leadsParaCsv(leads: Lead[]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const linhas = [
    ['nome', 'empresa', 'whatsapp', 'email', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'origem', 'status', 'tags', 'toques', 'ultimo_contato', 'criado_em'].join(';'),
    ...leads.map((l) =>
      [
        esc(l.nome),
        esc(l.empresa),
        esc(l.telefone),
        esc(l.email),
        esc(l.cep),
        esc(l.logradouro),
        esc(l.numero),
        esc(l.complemento),
        esc(l.bairro),
        esc(l.cidade),
        esc(l.uf),
        esc(l.origem),
        esc(l.status),
        esc(l.tags.join(', ')),
        l.toques,
        esc(l.ultimoContatoEm),
        esc(l.criadoEm),
      ].join(';')
    ),
  ]
  return '﻿' + linhas.join('\n')
}

/** Monta o filtro da lista a partir da query string do painel. */
export function filtroLeadsDaQuery(sp: URLSearchParams): FiltroLeads {
  return {
    busca: sp.get('busca') ?? undefined,
    uf: sp.get('uf') ?? undefined,
    origem: (sp.get('origem') as FiltroLeads['origem']) ?? undefined,
    status: (sp.get('status') as FiltroLeads['status']) ?? undefined,
    tag: sp.get('tag') ?? undefined,
    canal: (sp.get('canal') as FiltroLeads['canal']) ?? undefined,
    incluirOptOut: sp.get('optout') === '1',
  }
}
