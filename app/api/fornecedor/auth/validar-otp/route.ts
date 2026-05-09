// app/api/fornecedor/auth/validar-otp/route.ts
// ============================================================================
// Valida o código OTP submetido pelo fornecedor.
// Se válido, cria sessão e seta cookie httpOnly.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { validarOtp } from '@/app/lib/otp'
import { criarSessao, COOKIE_NAME, SESSAO_DURACAO_DIAS, getCookieDomain } from '@/app/lib/sessoes'
import { normalizarWhatsApp } from '@/app/lib/phone'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: { identificador?: string; codigo?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'payload inválido' }, { status: 400 })
  }

  const identificador = (body.identificador ?? '').trim()
  const codigo = (body.codigo ?? '').replace(/\D/g, '')

  if (!identificador || codigo.length !== 6) {
    return NextResponse.json(
      { error: 'Informe o identificador e o código de 6 dígitos' },
      { status: 400 }
    )
  }

  // Busca o fornecedor pelo identificador
  const tipo: 'email' | 'whatsapp' = EMAIL_REGEX.test(identificador)
    ? 'email'
    : 'whatsapp'

  let fornecedor: { id: string } | null = null

  if (tipo === 'email') {
    const { data } = await supabase
      .from('leads_fornecedores')
      .select('id')
      .eq('email', identificador.toLowerCase())
      .maybeSingle()
    fornecedor = data
  } else {
    const numeroNormalizado = normalizarWhatsApp(identificador)
    const { data } = await supabase
      .from('leads_fornecedores')
      .select('id')
      .eq('whatsapp', numeroNormalizado)
      .maybeSingle()
    fornecedor = data
  }

  if (!fornecedor) {
    // Anti-enumeration: mesma resposta de código incorreto
    return NextResponse.json({ error: 'Código inválido ou expirado' }, { status: 401 })
  }

  // Valida OTP
  const resultado = await validarOtp({
    fornecedorId: fornecedor.id,
    codigo,
  })

  if (!resultado.valido) {
    if (resultado.motivo === 'bloqueado') {
      return NextResponse.json(
        {
          error:
            'Muitas tentativas erradas. Aguarde 30 minutos antes de tentar novamente.',
        },
        { status: 429 }
      )
    }
    if (resultado.motivo === 'tentativas_excedidas') {
      return NextResponse.json(
        {
          error:
            'Você excedeu o número de tentativas. Aguarde 30 minutos antes de solicitar um novo código.',
        },
        { status: 429 }
      )
    }
    if (resultado.motivo === 'codigo_expirado' || resultado.motivo === 'codigo_nao_encontrado') {
      return NextResponse.json(
        { error: 'Código expirado ou inválido. Solicite um novo código.' },
        { status: 401 }
      )
    }
    return NextResponse.json({ error: 'Código inválido ou expirado' }, { status: 401 })
  }

  // Cria sessão
  const userAgent = req.headers.get('user-agent') ?? undefined
  const { token } = await criarSessao({
    fornecedorId: fornecedor.id,
    userAgent,
  })

  // Seta cookie httpOnly
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSAO_DURACAO_DIAS * 24 * 60 * 60,
    domain: getCookieDomain(),
  })

  return NextResponse.json({ ok: true })
}
