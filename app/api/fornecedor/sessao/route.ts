// app/api/fornecedor/sessao/route.ts
// ============================================================================
// Endpoint público GET — retorna apenas { logado: boolean }.
// NÃO expõe dados sensíveis (nome, email, plano, etc).
// Usado pelo SiteHeader pra decidir entre abrir modal ou redirecionar
// direto pro painel quando o user clica em "Sou fornecedor".
// ============================================================================

import { NextResponse } from 'next/server'
import { getFornecedorAtual } from '@/app/lib/auth-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const fornecedor = await getFornecedorAtual()
  return NextResponse.json({ logado: !!fornecedor })
}
