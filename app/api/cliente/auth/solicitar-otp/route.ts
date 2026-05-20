// app/api/cliente/auth/solicitar-otp/route.ts
// ============================================================================
// POST /api/cliente/auth/solicitar-otp
// Body: { email: string }
//
// Fluxo:
//   1. Valida e normaliza email
//   2. garanteContaPorEmail (cria se não existir — sem revelar pra client)
//   3. Verifica bloqueio ativo → 429
//   4. Rate limit (3 solicitações em 15min) → 429
//   5. Cria OTP (1 ou 2 linhas — email + whatsapp se houver)
//   6. Envia email (sempre) + WhatsApp (se conta tem whatsapp)
//   7. Retorna { ok, canais_enviados }
//
// Não revela se a conta é nova ou existente (anti-enumeration soft).
// ============================================================================

import { NextResponse } from 'next/server'
import {
  contarSolicitacoesRecentes,
  criarOtp,
  estaBloqueado,
  garanteContaPorEmail,
  OTP_VALIDADE_MINUTOS,
  tempoBloqueioRestante,
} from '@/app/lib/cliente-auth'
import { emailCodigoLogin } from '@/app/lib/email'
import { enviarMensagem } from '@/app/lib/zapi'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_SOLICITACOES_15MIN = 3

export async function POST(req: Request) {
  let body: { email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'payload inválido' }, { status: 400 })
  }

  const emailRaw = (body.email ?? '').trim()
  if (!EMAIL_REGEX.test(emailRaw)) {
    return NextResponse.json({ erro: 'email inválido' }, { status: 400 })
  }
  const email = emailRaw.toLowerCase()

  // 1. Garante conta (cria se não existir)
  let conta
  try {
    conta = await garanteContaPorEmail(email)
  } catch (err) {
    console.error('[cliente/solicitar-otp] garanteContaPorEmail falhou:', err)
    return NextResponse.json({ erro: 'erro ao processar' }, { status: 500 })
  }

  // 2. Verifica bloqueio
  if (await estaBloqueado(conta.id)) {
    const ate = await tempoBloqueioRestante(conta.id)
    return NextResponse.json(
      { erro: 'conta bloqueada por tentativas excedidas', bloqueado_ate: ate },
      { status: 429 },
    )
  }

  // 3. Rate limit
  const solicitacoesRecentes = await contarSolicitacoesRecentes(conta.id)
  if (solicitacoesRecentes >= MAX_SOLICITACOES_15MIN) {
    return NextResponse.json(
      {
        erro: 'muitas solicitações — aguarde 15 minutos',
        max_por_janela: MAX_SOLICITACOES_15MIN,
      },
      { status: 429 },
    )
  }

  // 4. Cria OTP
  let codigo: string
  try {
    const otp = await criarOtp({
      contaId: conta.id,
      email,
      whatsapp: conta.whatsapp,
    })
    codigo = otp.codigo
  } catch (err) {
    console.error('[cliente/solicitar-otp] criarOtp falhou:', err)
    return NextResponse.json({ erro: 'erro ao processar' }, { status: 500 })
  }

  // 5. Envia email + WhatsApp em paralelo (best-effort)
  const canaisEnviados: string[] = []
  const promises: Promise<unknown>[] = []

  // Email — sempre
  const nomePraTemplate = conta.nome ?? email.split('@')[0]
  promises.push(
    emailCodigoLogin({
      email,
      nome: nomePraTemplate,
      codigo,
      validadeMinutos: OTP_VALIDADE_MINUTOS,
    })
      .then(() => {
        canaisEnviados.push('email')
      })
      .catch((err) => {
        console.error('[cliente/solicitar-otp] email falhou:', err)
      }),
  )

  // WhatsApp — só se conta já tem whatsapp registrado
  if (conta.whatsapp) {
    const nome = conta.nome ?? ''
    const saudacao = nome ? `Olá ${nome}! ` : ''
    promises.push(
      enviarMensagem(
        conta.whatsapp,
        `🔐 *Código de acesso ao Confeccione*\n\n${saudacao}Use este código para entrar:\n\n*${codigo}*\n\nVálido por ${OTP_VALIDADE_MINUTOS} minutos.\n\nSe você não solicitou, pode ignorar.`,
      )
        .then(() => {
          canaisEnviados.push('whatsapp')
        })
        .catch((err) => {
          console.error('[cliente/solicitar-otp] whatsapp falhou:', err)
        }),
    )
  }

  await Promise.allSettled(promises)

  // Log dev pra teste local (não vaza em prod — guard de env)
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV ONLY] OTP cliente ${email}: ${codigo}`)
  }

  return NextResponse.json({
    ok: true,
    conta_id: conta.id,
    canais_enviados: canaisEnviados,
  })
}
