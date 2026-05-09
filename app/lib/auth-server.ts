// app/lib/auth-server.ts
// ============================================================================
// Helpers de autenticação para uso em SERVER COMPONENTS e API ROUTES.
// NÃO EXPORTAR PRA CLIENT — depende de cookies() e Supabase com service role.
//
// Uso típico em páginas do painel:
//
//   const fornecedor = await getFornecedorAtual()
//   if (!fornecedor) redirect('/fornecedor/entrar')
// ============================================================================

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { validarSessao, COOKIE_NAME } from './sessoes'

export type FornecedorSessao = {
  id: string
  nome: string
  whatsapp: string
  email: string | null
  status: string
}

/**
 * Retorna o fornecedor logado, ou null se sessão inválida/ausente.
 * Use em páginas do painel pra checar autenticação.
 */
export async function getFornecedorAtual(): Promise<FornecedorSessao | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  const resultado = await validarSessao(token)
  if (!resultado) return null

  return resultado.fornecedor
}

/**
 * Versão com redirect automático para login quando não tem sessão.
 * Use em páginas do painel que SEMPRE exigem fornecedor logado.
 *
 * IMPORTANTE: como `redirect()` lança um erro especial do Next, esta função
 * sempre retorna um fornecedor válido OU lança o redirect (nunca retorna null).
 */
export async function exigirFornecedorAtual(): Promise<FornecedorSessao> {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) {
    redirect('/fornecedor/entrar')
  }
  return fornecedor
}
