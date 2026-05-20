// app/cliente/login/page.tsx
// ============================================================================
// Página de login do cliente. FORA do route group (painel) pra evitar loop:
// o layout de painel redireciona pra cá quando sessão é inválida.
//
// Se já logado, redireciona pro painel imediatamente.
// ============================================================================

import { redirect } from 'next/navigation'
import { getContaAtual } from '@/app/lib/cliente-auth'
import LoginForm from './LoginForm'

export const dynamic = 'force-dynamic'

export default async function ClienteLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const conta = await getContaAtual()
  if (conta) {
    redirect('/cliente/painel')
  }

  const params = await searchParams
  const emailPrefill = params.email?.trim() ?? ''

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Confeccione</h1>
          <p className="text-sm text-gray-500 mt-1">
            Acompanhe seus pedidos
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <LoginForm emailPrefill={emailPrefill} />
        </div>
      </div>
    </div>
  )
}
