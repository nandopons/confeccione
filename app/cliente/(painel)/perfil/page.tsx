// app/cliente/(painel)/perfil/page.tsx
// ============================================================================
// Página de edição de perfil do cliente.
// Email é read-only (chave da conta). Nome e WhatsApp são editáveis.
// ============================================================================

import Link from 'next/link'
import { getContaAtual } from '@/app/lib/cliente-auth'
import PerfilForm from './PerfilForm'

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
  const conta = await getContaAtual()
  if (!conta) return null // layout redireciona

  return (
    <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href="/cliente/painel"
        className="text-sm text-gray-600 hover:text-gray-900 inline-block mb-4 transition-colors"
      >
        ← Voltar
      </Link>

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Perfil</h2>

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <PerfilForm
          email={conta.email}
          nomeInicial={conta.nome ?? ''}
          whatsappInicial={conta.whatsapp ?? ''}
        />
      </div>
    </section>
  )
}
