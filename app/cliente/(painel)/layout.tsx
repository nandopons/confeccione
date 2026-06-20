// app/cliente/(painel)/layout.tsx
// ============================================================================
// Layout do painel do cliente autenticado.
// Route group "(painel)" agrupa pages que exigem sessão válida.
// /cliente/login fica FORA pra evitar loop de redirect.
//
// Navegação: sidebar desktop / bottom nav mobile via <PainelNavCliente>
// (duplicado do padrão do painel do fornecedor).
// ============================================================================

import { redirect } from 'next/navigation'
import { getContaAtual } from '@/app/lib/cliente-auth'
import PainelNavCliente from './PainelNavCliente'

export default async function ClientePainelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const conta = await getContaAtual()
  if (!conta) {
    redirect('/cliente/login')
  }

  // Nome exibido na sidebar: usa nome se tiver, senão a parte antes do @.
  const nomeExibido = conta.nome ?? conta.email.split('@')[0]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="md:flex">
        <PainelNavCliente nomeCliente={nomeExibido} />

        {/* Conteúdo principal — pb-20 no mobile pra bottom bar não cobrir */}
        <main className="flex-1 min-w-0 pb-20 md:pb-0">{children}</main>
      </div>
    </div>
  )
}
