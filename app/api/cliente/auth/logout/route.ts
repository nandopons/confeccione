// app/api/cliente/auth/logout/route.ts
// ============================================================================
// POST /api/cliente/auth/logout
//
// Lê cookie de sessão, deleta a linha em sessoes_clientes (best-effort),
// limpa o cookie. Retorna { ok: true } sempre — logout não falha.
// ============================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  COOKIE_CLIENTE,
  invalidarSessao,
} from '@/app/lib/cliente-auth'

export async function POST() {
  const c = await cookies()
  const token = c.get(COOKIE_CLIENTE)?.value

  if (token) {
    try {
      await invalidarSessao(token)
    } catch (err) {
      console.error('[cliente/logout] invalidarSessao falhou:', err)
    }
  }

  // Limpa cookie
  c.set({
    name: COOKIE_CLIENTE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return NextResponse.json({ ok: true })
}
