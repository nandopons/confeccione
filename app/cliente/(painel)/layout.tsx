// app/cliente/(painel)/layout.tsx
// ============================================================================
// Layout do painel do cliente autenticado.
// Route group "(painel)" agrupa pages que exigem sessão válida.
// /cliente/login fica FORA pra evitar loop de redirect.
// ============================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getContaAtual } from '@/app/lib/cliente-auth'
import LogoutButton from './LogoutButton'

export default async function ClientePainelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const conta = await getContaAtual()
  if (!conta) {
    redirect('/cliente/login')
  }

  // Saudação: usa nome se tiver, senão a parte antes do @ do email
  const nomeExibido = conta.nome ?? conta.email.split('@')[0]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Confeccione
            </h1>
            <p className="text-xs text-gray-500">Olá, {nomeExibido}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/cliente/perfil"
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Perfil
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
