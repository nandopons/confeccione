// app/api/fornecedor/auth/solicitar-otp/route.ts
// ============================================================================
// Recebe email OU whatsapp, gera código OTP de 6 dígitos e envia por
// email + WhatsApp simultâneos.
//
// Anti-enumeration: SEMPRE retorna { ok: true } mesmo se identificador não
// existir. Assim, atacantes não conseguem descobrir quais contatos estão
// cadastrados tentando logar com vários.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { criarOtp, OTP_VALIDADE_MINUTOS } from '@/app/lib/otp'
import { emailCodigoLogin } from '@/app/lib/email'
import { enviarMensagem } from '@/app/lib/zapi'
import { normalizarWhatsApp } from '@/app/lib/phone'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: { identificador?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  }

  const identificador = (body.identificador ?? '').trim()
  if (identificador.length === 0) {
    return NextResponse.json(
      { error: 'Informe seu email ou WhatsApp' },
      { status: 400 }
    )
  }

  // Detecta se é email ou whatsapp
  const tipo: 'email' | 'whatsapp' = EMAIL_REGEX.test(identificador)
    ? 'email'
    : 'whatsapp'

  // Busca fornecedor pelo identificador
  let fornecedor: {
    id: string
    nome: string
    whatsapp: string
    email: string | null
  } | null = null

  if (tipo === 'email') {
    const { data } = await supabase
      .from('leads_fornecedores')
      .select('id, nome, whatsapp, email')
      .eq('email', identificador.toLowerCase())
      .maybeSingle()
    fornecedor = data
  } else {
    const numeroNormalizado = normalizarWhatsApp(identificador)
    const { data } = await supabase
      .from('leads_fornecedores')
      .select('id, nome, whatsapp, email')
      .eq('whatsapp', numeroNormalizado)
      .maybeSingle()
    fornecedor = data
  }

  // Anti-enumeration: SEMPRE responde { ok: true } mesmo se não existir.
  // Atacantes não conseguem descobrir contatos cadastrados.
  if (!fornecedor) {
    // Pequeno delay artificial pra timing attacks também não vazarem nada
    await new Promise((r) => setTimeout(r, 200))
    return NextResponse.json({
      ok: true,
      mensagem: 'Se este contato estiver cadastrado, você receberá um código em instantes.',
    })
  }

  // Cria OTP no banco
  let codigoEnviado: string
  try {
    const otp = await criarOtp({
      fornecedorId: fornecedor.id,
      identificador,
      tipoIdentificador: tipo,
    })
    codigoEnviado = otp.codigo
  } catch (err) {
    console.error('[solicitar-otp] criarOtp falhou:', err)
    // Mantém anti-enumeration mesmo em erro interno
    return NextResponse.json({
      ok: true,
      mensagem: 'Se este contato estiver cadastrado, você receberá um código em instantes.',
    })
  }

  // Envia email + WhatsApp em paralelo (best-effort, não bloqueia se falhar)
  const promises: Promise<unknown>[] = []

  if (fornecedor.email) {
    promises.push(
      emailCodigoLogin({
        email: fornecedor.email,
        nome: fornecedor.nome,
        codigo: codigoEnviado,
        validadeMinutos: OTP_VALIDADE_MINUTOS,
      }).catch((err) => {
        console.error('[solicitar-otp] email falhou:', err)
      })
    )
  }

  if (fornecedor.whatsapp) {
    promises.push(
      enviarMensagem(
        fornecedor.whatsapp,
        `🔐 *Código de acesso ao Confeccione*\n\nOlá ${fornecedor.nome}! Use este código para entrar no seu painel:\n\n*${codigoEnviado}*\n\nEste código é válido por ${OTP_VALIDADE_MINUTOS} minutos.\n\nSe você não solicitou esse acesso, pode ignorar esta mensagem.`
      ).catch((err) => {
        console.error('[solicitar-otp] whatsapp falhou:', err)
      })
    )
  }

  // Aguarda os envios concluírem (ou falharem) — mas não falhamos a resposta
  await Promise.allSettled(promises)

  return NextResponse.json({
    ok: true,
    mensagem: 'Se este contato estiver cadastrado, você receberá um código em instantes.',
  })
}
