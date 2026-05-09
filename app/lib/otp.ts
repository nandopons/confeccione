// app/lib/otp.ts
// ============================================================================
// Geração e validação de OTPs (códigos de 6 dígitos pra login).
// Códigos NUNCA são salvos em claro — apenas o hash SHA-256.
// Validade: 10 minutos. Máximo 5 tentativas erradas antes de bloqueio.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { createHash, randomInt } from 'node:crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Configurações
export const OTP_VALIDADE_MINUTOS = 10
export const OTP_MAX_TENTATIVAS = 5
export const BLOQUEIO_DURACAO_MINUTOS = 30

/**
 * Gera um código OTP de 6 dígitos numéricos.
 * Usa randomInt do crypto (CSPRNG) — não Math.random.
 */
export function gerarCodigoOtp(): string {
  // randomInt(0, 1000000) gera número de 0 a 999999.
  // padStart pra sempre ter 6 dígitos (preenche com zeros à esquerda).
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * Calcula hash SHA-256 do código.
 * Salvamos o hash no banco, nunca o código em claro.
 */
export function hashCodigoOtp(codigo: string): string {
  return createHash('sha256').update(codigo).digest('hex')
}

/**
 * Cria um novo OTP no banco para o fornecedor.
 * Retorna o código em claro (pra ser enviado por email/whatsapp).
 *
 * IMPORTANTE: o código retornado é a única vez que ele aparece em claro.
 * Após este momento, só o hash existe no banco.
 */
export async function criarOtp(params: {
  fornecedorId: string
  identificador: string                      // email ou whatsapp usado
  tipoIdentificador: 'email' | 'whatsapp'
}): Promise<{ codigo: string; expiraEm: Date }> {
  const codigo = gerarCodigoOtp()
  const codigoHash = hashCodigoOtp(codigo)
  const expiraEm = new Date(Date.now() + OTP_VALIDADE_MINUTOS * 60 * 1000)

  const { error } = await supabase.from('otps_fornecedores').insert({
    fornecedor_id: params.fornecedorId,
    codigo_hash: codigoHash,
    identificador: params.identificador,
    tipo_identificador: params.tipoIdentificador,
    expira_em: expiraEm.toISOString(),
  })

  if (error) {
    throw new Error(`Erro ao criar OTP: ${error.message}`)
  }

  return { codigo, expiraEm }
}

/**
 * Valida um código OTP submetido pelo fornecedor.
 *
 * Retorna { valido: boolean, motivo?: string }.
 * Atualiza tentativas e bloqueio conforme necessário.
 */
export async function validarOtp(params: {
  fornecedorId: string
  codigo: string
}): Promise<{
  valido: boolean
  motivo?:
    | 'codigo_incorreto'
    | 'codigo_expirado'
    | 'codigo_nao_encontrado'
    | 'bloqueado'
    | 'tentativas_excedidas'
}> {
  // 1. Verifica se o fornecedor está bloqueado
  const bloqueado = await estaBloqueado(params.fornecedorId)
  if (bloqueado) {
    return { valido: false, motivo: 'bloqueado' }
  }

  // 2. Busca OTP mais recente, não usado, não expirado
  const agoraISO = new Date().toISOString()
  const { data: otp } = await supabase
    .from('otps_fornecedores')
    .select('id, codigo_hash, expira_em, usado_em, tentativas')
    .eq('fornecedor_id', params.fornecedorId)
    .is('usado_em', null)
    .gt('expira_em', agoraISO)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!otp) {
    return { valido: false, motivo: 'codigo_nao_encontrado' }
  }

  // 3. Compara hash do código submetido com o salvo
  const codigoHash = hashCodigoOtp(params.codigo)
  if (codigoHash !== otp.codigo_hash) {
    // Incrementa tentativas
    const novasTentativas = otp.tentativas + 1

    if (novasTentativas >= OTP_MAX_TENTATIVAS) {
      // Bloqueia o fornecedor por 30 min
      await criarBloqueio(params.fornecedorId)
      // Marca OTP como usado pra invalidar
      await supabase
        .from('otps_fornecedores')
        .update({ tentativas: novasTentativas, usado_em: agoraISO })
        .eq('id', otp.id)
      return { valido: false, motivo: 'tentativas_excedidas' }
    }

    await supabase
      .from('otps_fornecedores')
      .update({ tentativas: novasTentativas })
      .eq('id', otp.id)
    return { valido: false, motivo: 'codigo_incorreto' }
  }

  // 4. OTP correto → marca como usado
  await supabase
    .from('otps_fornecedores')
    .update({ usado_em: agoraISO })
    .eq('id', otp.id)

  return { valido: true }
}

/**
 * Verifica se o fornecedor está atualmente bloqueado.
 */
async function estaBloqueado(fornecedorId: string): Promise<boolean> {
  const agoraISO = new Date().toISOString()
  const { count } = await supabase
    .from('bloqueios_login')
    .select('*', { count: 'exact', head: true })
    .eq('fornecedor_id', fornecedorId)
    .gt('bloqueado_ate', agoraISO)

  return (count ?? 0) > 0
}

/**
 * Cria um bloqueio de 30 min para o fornecedor.
 */
async function criarBloqueio(fornecedorId: string): Promise<void> {
  const bloqueadoAte = new Date(
    Date.now() + BLOQUEIO_DURACAO_MINUTOS * 60 * 1000
  ).toISOString()

  await supabase.from('bloqueios_login').insert({
    fornecedor_id: fornecedorId,
    bloqueado_ate: bloqueadoAte,
  })
}
