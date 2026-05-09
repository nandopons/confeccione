// app/api/fornecedor/auth/logout/route.ts
// ============================================================================
// Logout — apaga sessão do banco e cookie do navegador.
// ============================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { invalidarSessao, COOKIE_NAME } from '@/app/lib/sessoes'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value

  if (token) {
    try {
      await invalidarSessao(token)
    } catch (err) {
      console.error('[logout] invalidarSessao falhou:', err)
      // não bloqueia o logout — apaga cookie de qualquer jeito
    }
  }

  // Apaga o cookie do navegador
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return NextResponse.json({ ok: true })
}
