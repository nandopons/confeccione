// app/api/cliente/auth/solicitar-otp/route.ts
// ============================================================================
// POST /api/cliente/auth/solicitar-otp
// Body: { email?: string; telefone?: string } — um dos dois.
//
// Fluxo:
//   1. Identifica a conta: por email (garante/cria) ou por telefone (só busca
//      — sem e-mail não dá pra abrir cadastro; não achou → orienta usar email)
//   2. Verifica bloqueio ativo → 429
//   3. Rate limit (3 solicitações em 15min) → 429
//   4. Cria OTP (1 ou 2 linhas — email + whatsapp se houver)
//   5. Envia email (sempre) + WhatsApp OFICIAL (template codigo_acesso,
//      se a conta tem whatsapp)
//   6. Retorna { ok, canais_enviados }
//
// Não revela se a conta é nova ou existente (anti-enumeration soft).
// ============================================================================

import { NextResponse } from 'next/server'
import {
  buscarContaPorWhatsApp,
  contarSolicitacoesRecentes,
  criarOtp,
  estaBloqueado,
  garanteContaPorEmail,
  OTP_VALIDADE_MINUTOS,
  tempoBloqueioRestante,
} from '@/app/lib/cliente-auth'
import { emailCodigoLogin } from '@/app/lib/email'
import { primeiroNome } from '@/app/lib/nome'
import { enviarCodigoAcesso } from '@/app/lib/whatsapp-cloud'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_SOLICITACOES_15MIN = 3

export async function POST(req: Request) {
  let body: { email?: string; telefone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ erro: 'payload inválido' }, { status: 400 })
  }

  const emailRaw = (body.email ?? '').trim()
  const telefoneRaw = (body.telefone ?? '').trim()

  // 1. Identifica a conta — por email (garante/cria) ou por telefone (busca)
  let conta
  if (emailRaw) {
    if (!EMAIL_REGEX.test(emailRaw)) {
      return NextResponse.json({ erro: 'email inválido' }, { status: 400 })
    }
    try {
      conta = await garanteContaPorEmail(emailRaw.toLowerCase())
    } catch (err) {
      console.error('[cliente/solicitar-otp] garanteContaPorEmail falhou:', err)
      return NextResponse.json({ erro: 'erro ao processar' }, { status: 500 })
    }
  } else if (telefoneRaw) {
    if (telefoneRaw.replace(/\D/g, '').length < 10) {
      return NextResponse.json({ erro: 'WhatsApp inválido — use DDD + número' }, { status: 400 })
    }
    conta = await buscarContaPorWhatsApp(telefoneRaw)
    if (!conta) {
      return NextResponse.json(
        { erro: 'Não achamos conta com esse WhatsApp. Tente com o e-mail que você usou no pedido.' },
        { status: 404 },
      )
    }
  } else {
    return NextResponse.json({ erro: 'informe e-mail ou WhatsApp' }, { status: 400 })
  }

  const email = conta.email

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
      nome: primeiroNome(nomePraTemplate),
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

  // WhatsApp OFICIAL (template codigo_acesso) — só se conta tem whatsapp
  if (conta.whatsapp) {
    promises.push(
      enviarCodigoAcesso(conta.whatsapp, codigo)
        .then((r) => {
          if (r.ok) canaisEnviados.push('whatsapp')
          else console.error('[cliente/solicitar-otp] whatsapp oficial falhou:', r.erro)
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
