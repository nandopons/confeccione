// app/api/admin/login/route.ts
// ============================================================================
// POST /api/admin/login
//
// Body JSON: { password: string }
//
// Comportamento:
//   - password === ADMIN_PASSWORD  →  set cookie admin (30d) + 200 { ok: true }
//   - password errado              →  401 (mensagem genérica)
//   - envs faltando                →  500 (log no servidor, mensagem genérica)
//
// O cookie tem valor = ADMIN_SESSION_TOKEN (literal). Toda page/route
// /admin/* compara o cookie com essa env via ehTokenAdminValido.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ADMIN, compararSeguro } from '@/app/lib/admin-auth'

const COOKIE_MAX_AGE_30D = 60 * 60 * 24 * 30

export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD
  const adminToken = process.env.ADMIN_SESSION_TOKEN

  if (!adminPassword || !adminToken) {
    console.error(
      '[admin-login] ADMIN_PASSWORD ou ADMIN_SESSION_TOKEN ausente no env'
    )
    return NextResponse.json(
      { erro: 'Configuração inválida' },
      { status: 500 }
    )
  }

  let password: string | undefined
  try {
    const body = await req.json()
    password = typeof body?.password === 'string' ? body.password : undefined
  } catch {
    return NextResponse.json({ erro: 'Body inválido' }, { status: 400 })
  }

  // compararSeguro evita timing attack. password ausente cai pra ''
  // (length diff entra na guarda do compararSeguro).
  if (!compararSeguro(password ?? '', adminPassword)) {
    return NextResponse.json(
      { erro: 'Credenciais inválidas' },
      { status: 401 }
    )
  }

  const response = NextResponse.json({ ok: true })

  response.cookies.set({
    name: COOKIE_ADMIN,
    value: adminToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_30D,
    path: '/',
  })

  return response
}
