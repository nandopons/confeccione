// middleware.ts
// ============================================================================
// Proteção de rotas no Edge Runtime — duas barreiras independentes:
//
//   1. /fornecedor/painel/*  → exige cookie de sessão do fornecedor.
//      Validação real (token vs banco) acontece em pages/APIs via
//      validarSessao() de app/lib/sessoes.ts.
//
//   2. /admin/*  e  /api/admin/*  → exige cookie de sessão admin.
//      Validação real (cookie === ADMIN_SESSION_TOKEN) acontece em
//      pages/routes via ehTokenAdminValido() de app/lib/admin-auth.ts.
//      /admin/login e /api/admin/login são públicas (senão loop).
//
// IMPORTANTE: este arquivo roda no Edge Runtime — Supabase, node:crypto
// e process.env de runtime são limitados. Aqui fazemos só BARREIRA RÁPIDA
// (cookie existe + length plausível). Defesa em profundidade vive nas
// pages/routes.
//
// Nota: Next 16 deprecou o nome 'middleware' em favor de 'proxy'. A
// migração é dívida pós-Sprint 1. Backwards-compat mantida (build
// classifica este arquivo como "Proxy (Middleware)").
// ============================================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const COOKIE_FORNECEDOR = 'confeccione_session'
const COOKIE_ADMIN = 'confeccione_admin_session'

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  // ============================================================
  // ADMIN — /admin/* e /api/admin/*
  // ============================================================
  if (path.startsWith('/admin') || path.startsWith('/api/admin')) {
    // Login pages são públicas (senão loop infinito de redirect).
    if (path === '/admin/login' || path === '/api/admin/login') {
      return NextResponse.next()
    }

    const token = req.cookies.get(COOKIE_ADMIN)?.value

    if (!token || token.length < 32) {
      // APIs respondem JSON 401; pages redirecionam pro login.
      if (path.startsWith('/api/admin')) {
        return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
      }
      const url = req.nextUrl.clone()
      url.pathname = '/admin/login'
      url.searchParams.set('proximo', path)
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // ============================================================
  // FORNECEDOR — /fornecedor/painel/* (lógica preservada)
  // ============================================================
  if (path.startsWith('/fornecedor/painel')) {
    const token = req.cookies.get(COOKIE_FORNECEDOR)?.value

    if (!token || token.length < 20) {
      const url = req.nextUrl.clone()
      url.pathname = '/fornecedor/entrar'
      url.searchParams.set('proximo', path)
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/fornecedor/painel/:path*',
    '/admin/:path*',
    '/api/admin/:path*',
  ],
}
