// app/lib/cliente-auth.ts
// ============================================================================
// Helpers de auth do cliente final (painel /cliente/*).
// Espelha admin-auth.ts + otp.ts + sessoes.ts mas pra cliente final.
//
// Cookie: confeccione_cliente_session
// Token: 32 bytes random (base64url, ~43 chars), hasheado SHA-256 no banco.
// Sessão: 30 dias de validade, ultimo_acesso_em renovado a cada >1h.
// OTP: 6 dígitos, hash SHA-256, validade 10min, max 5 tentativas → bloqueio 30min.
// ============================================================================

import { cookies } from 'next/headers'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'

export const COOKIE_CLIENTE = 'confeccione_cliente_session'
export const SESSAO_DURACAO_DIAS = 30
export const OTP_VALIDADE_MINUTOS = 10
export const OTP_MAX_TENTATIVAS = 5
export const BLOQUEIO_DURACAO_MINUTOS = 30
const SESSAO_RENEW_INTERVAL_MIN = 60 // só atualiza ultimo_acesso_em se >1h

// ============================================================================
// CRIPTO
// ============================================================================

export function gerarTokenSessao(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function gerarCodigoOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function hashCodigoOtp(codigo: string): string {
  return createHash('sha256').update(codigo).digest('hex')
}

// ============================================================================
// CONTAS_CLIENTES
// ============================================================================

export type ContaCliente = {
  id: string
  email: string
  nome: string | null
  whatsapp: string | null
  plano: 'free' | 'pro'
  plano_ativado_em: string | null
  plano_expira_em: string | null
  criado_em: string
  atualizado_em: string
  ultimo_login_em: string | null
}

/**
 * Busca conta pelo email (lower/trim). Se não existir, cria nova com plano=free.
 * Idempotente — usado em /solicitar-otp.
 */
export async function garanteContaPorEmail(email: string): Promise<ContaCliente> {
  const emailNorm = email.trim().toLowerCase()

  const { data: existente } = await supabaseAdmin
    .from('contas_clientes')
    .select('*')
    .eq('email', emailNorm)
    .maybeSingle()

  if (existente) return existente as ContaCliente

  const { data: nova, error } = await supabaseAdmin
    .from('contas_clientes')
    .insert({ email: emailNorm })
    .select('*')
    .single()

  if (error || !nova) {
    throw new Error(`Erro ao criar conta: ${error?.message ?? 'desconhecido'}`)
  }
  return nova as ContaCliente
}

// ============================================================================
// SESSÃO
// ============================================================================

/**
 * Lê sessão atual do cookie. Retorna null se inválida/expirada/cookie ausente.
 * Atualiza ultimo_acesso_em best-effort se passou > 1h da última atualização.
 */
export async function getContaAtual(): Promise<ContaCliente | null> {
  const c = await cookies()
  const token = c.get(COOKIE_CLIENTE)?.value
  if (!token || token.length < 20) return null

  const tokenHash = hashToken(token)
  const agoraISO = new Date().toISOString()

  const { data: sessao } = await supabaseAdmin
    .from('sessoes_clientes')
    .select('id, conta_id, expira_em, ultimo_acesso_em')
    .eq('token_hash', tokenHash)
    .gt('expira_em', agoraISO)
    .maybeSingle()

  if (!sessao) return null

  const { data: conta } = await supabaseAdmin
    .from('contas_clientes')
    .select('*')
    .eq('id', sessao.conta_id)
    .maybeSingle()

  if (!conta) return null

  // Renova ultimo_acesso_em best-effort se passou > 1h
  const passou = Date.now() - new Date(sessao.ultimo_acesso_em).getTime()
  if (passou > SESSAO_RENEW_INTERVAL_MIN * 60 * 1000) {
    supabaseAdmin
      .from('sessoes_clientes')
      .update({ ultimo_acesso_em: agoraISO })
      .eq('id', sessao.id)
      .then(
        () => undefined,
        (err) =>
          console.error('[cliente-auth] update ultimo_acesso falhou:', err),
      )
  }

  return conta as ContaCliente
}

export async function eClienteLogado(): Promise<boolean> {
  return (await getContaAtual()) !== null
}

/**
 * Cria nova sessão pra conta. Retorna o token CRU (pra cookie); banco guarda
 * apenas o hash.
 */
export async function criarSessao(params: {
  contaId: string
  userAgent?: string | null
  ip?: string | null
}): Promise<{ token: string; expiraEm: Date }> {
  const token = gerarTokenSessao()
  const tokenHash = hashToken(token)
  const expiraEm = new Date(
    Date.now() + SESSAO_DURACAO_DIAS * 24 * 60 * 60 * 1000,
  )

  const { error } = await supabaseAdmin.from('sessoes_clientes').insert({
    conta_id: params.contaId,
    token_hash: tokenHash,
    expira_em: expiraEm.toISOString(),
    user_agent: params.userAgent ?? null,
    ip: params.ip ?? null,
  })

  if (error) {
    throw new Error(`Erro ao criar sessão: ${error.message}`)
  }

  return { token, expiraEm }
}

export async function invalidarSessao(token: string): Promise<void> {
  if (!token) return
  const tokenHash = hashToken(token)
  await supabaseAdmin
    .from('sessoes_clientes')
    .delete()
    .eq('token_hash', tokenHash)
}

// ============================================================================
// OTP
// ============================================================================

/**
 * Cria OTP no banco. Retorna o código em claro (única vez).
 * Insere 2 linhas se passar `incluirWhatsapp=true` (uma email + uma whatsapp).
 */
export async function criarOtp(params: {
  contaId: string
  email: string
  whatsapp: string | null
}): Promise<{ codigo: string; expiraEm: Date }> {
  const codigo = gerarCodigoOtp()
  const codigoHash = hashCodigoOtp(codigo)
  const expiraEm = new Date(
    Date.now() + OTP_VALIDADE_MINUTOS * 60 * 1000,
  )

  const linhas: Array<{
    conta_id: string
    codigo_hash: string
    identificador: string
    tipo_identificador: 'email' | 'whatsapp'
    expira_em: string
  }> = [
    {
      conta_id: params.contaId,
      codigo_hash: codigoHash,
      identificador: params.email,
      tipo_identificador: 'email',
      expira_em: expiraEm.toISOString(),
    },
  ]
  if (params.whatsapp) {
    linhas.push({
      conta_id: params.contaId,
      codigo_hash: codigoHash,
      identificador: params.whatsapp,
      tipo_identificador: 'whatsapp',
      expira_em: expiraEm.toISOString(),
    })
  }

  const { error } = await supabaseAdmin.from('otps_clientes').insert(linhas)
  if (error) throw new Error(`Erro ao criar OTP: ${error.message}`)

  return { codigo, expiraEm }
}

/**
 * Valida código submetido pelo cliente.
 * Atualiza tentativas + cria bloqueio se exceder.
 */
export async function validarOtp(params: {
  contaId: string
  codigo: string
}): Promise<{
  valido: boolean
  motivo?:
    | 'codigo_incorreto'
    | 'codigo_nao_encontrado'
    | 'bloqueado'
    | 'tentativas_excedidas'
}> {
  const bloqueado = await estaBloqueado(params.contaId)
  if (bloqueado) return { valido: false, motivo: 'bloqueado' }

  const agoraISO = new Date().toISOString()
  const { data: otp } = await supabaseAdmin
    .from('otps_clientes')
    .select('id, codigo_hash, tentativas')
    .eq('conta_id', params.contaId)
    .is('usado_em', null)
    .gt('expira_em', agoraISO)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!otp) return { valido: false, motivo: 'codigo_nao_encontrado' }

  const codigoHash = hashCodigoOtp(params.codigo)
  if (codigoHash !== otp.codigo_hash) {
    const novasTentativas = otp.tentativas + 1
    if (novasTentativas >= OTP_MAX_TENTATIVAS) {
      await criarBloqueio(params.contaId)
      // Invalida TODOS os OTPs ativos da conta (defesa: não reusar OTP já saturado)
      await supabaseAdmin
        .from('otps_clientes')
        .update({ tentativas: novasTentativas, usado_em: agoraISO })
        .eq('conta_id', params.contaId)
        .is('usado_em', null)
      return { valido: false, motivo: 'tentativas_excedidas' }
    }
    // Incrementa tentativas em TODAS as linhas do mesmo OTP (email + whatsapp)
    // pra contagem ficar consistente independente de qual usuário tentou.
    await supabaseAdmin
      .from('otps_clientes')
      .update({ tentativas: novasTentativas })
      .eq('conta_id', params.contaId)
      .eq('codigo_hash', otp.codigo_hash)
      .is('usado_em', null)
    return { valido: false, motivo: 'codigo_incorreto' }
  }

  // Correto: marca TODAS as linhas desse OTP como usadas
  await supabaseAdmin
    .from('otps_clientes')
    .update({ usado_em: agoraISO })
    .eq('conta_id', params.contaId)
    .eq('codigo_hash', otp.codigo_hash)
    .is('usado_em', null)

  return { valido: true }
}

export async function estaBloqueado(contaId: string): Promise<boolean> {
  const agoraISO = new Date().toISOString()
  const { count } = await supabaseAdmin
    .from('bloqueios_login_cliente')
    .select('*', { count: 'exact', head: true })
    .eq('conta_id', contaId)
    .gt('bloqueado_ate', agoraISO)
  return (count ?? 0) > 0
}

export async function tempoBloqueioRestante(
  contaId: string,
): Promise<string | null> {
  const agoraISO = new Date().toISOString()
  const { data } = await supabaseAdmin
    .from('bloqueios_login_cliente')
    .select('bloqueado_ate')
    .eq('conta_id', contaId)
    .gt('bloqueado_ate', agoraISO)
    .order('bloqueado_ate', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.bloqueado_ate ?? null
}

async function criarBloqueio(contaId: string): Promise<void> {
  const bloqueadoAte = new Date(
    Date.now() + BLOQUEIO_DURACAO_MINUTOS * 60 * 1000,
  ).toISOString()
  await supabaseAdmin.from('bloqueios_login_cliente').insert({
    conta_id: contaId,
    bloqueado_ate: bloqueadoAte,
  })
}

// ============================================================================
// RATE LIMIT — /solicitar-otp
// ============================================================================

/**
 * Conta solicitações de OTP nos últimos 15min. Usado pra throttle.
 * Conta apenas linhas tipo_identificador='email' pra não duplicar (cada
 * solicitação cria 1 ou 2 linhas).
 */
export async function contarSolicitacoesRecentes(
  contaId: string,
): Promise<number> {
  const limite = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('otps_clientes')
    .select('*', { count: 'exact', head: true })
    .eq('conta_id', contaId)
    .eq('tipo_identificador', 'email')
    .gte('criado_em', limite)
  return count ?? 0
}
