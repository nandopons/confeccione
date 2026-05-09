// middleware.ts
// ============================================================================
// Protege rotas /fornecedor/painel/* — exige cookie de sessão.
//
// IMPORTANTE: este middleware roda no Edge Runtime, que não suporta operações
// de banco (Supabase) nem node:crypto plenamente. Por isso, fazemos apenas a
// checagem MÍNIMA aqui (cookie existe?) e deixamos a validação real (token vs
// banco, expira_em, fornecedor existe) pra dentro das páginas/APIs do painel.
//
// Em outras palavras: este middleware é uma BARREIRA RÁPIDA. Não é a única
// linha de defesa. As páginas do painel devem chamar validarSessao() pra
// verificar de verdade.
// ============================================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const COOKIE_NAME = 'confeccione_session'

export function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value

  // Se não tem cookie, redireciona pro login
  if (!token || token.length < 20) {
    const url = req.nextUrl.clone()
    url.pathname = '/fornecedor/entrar'
    // Preserva pra onde ele queria ir, pra redirecionar de volta após login
    url.searchParams.set('proximo', req.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // Cookie existe — deixa a página/API validar contra o banco
  return NextResponse.next()
}

// Aplica middleware só em /fornecedor/painel/*
export const config = {
  matcher: ['/fornecedor/painel/:path*'],
}
