// app/cliente/(painel)/perfil/page.tsx
// ============================================================================
// Página de edição de perfil do cliente.
// Email é read-only (chave da conta). Nome e WhatsApp são editáveis.
// ============================================================================

import Link from 'next/link'
import { getContaAtual } from '@/app/lib/cliente-auth'
import PerfilForm from './PerfilForm'

export const dynamic = 'force-dynamic'

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<{ completar?: string }>
}) {
  const conta = await getContaAtual()
  if (!conta) return null // layout redireciona

  const { completar } = await searchParams
  const modoCompletar = completar === '1'

  return (
    <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {!modoCompletar && (
        <Link
          href="/cliente/painel"
          className="text-sm text-gray-600 hover:text-gray-900 inline-block mb-4 transition-colors"
        >
          ← Voltar
        </Link>
      )}

      <h2 className="text-lg font-semibold text-gray-900 mb-4">Perfil</h2>

      {modoCompletar && (
        <div className="mb-4 rounded-2xl border border-[#1D9E75]/40 bg-[#E1F5EE] p-4 text-sm text-[#0F6E56] leading-relaxed">
          👋 Bem-vindo! Pra começar, complete seu cadastro com seu WhatsApp.
          Assim a gente pode te avisar quando um fornecedor aceitar seu pedido.
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <PerfilForm
          email={conta.email}
          nomeInicial={conta.nome ?? ''}
          whatsappInicial={conta.whatsapp ?? ''}
          completar={modoCompletar}
        />
      </div>
    </section>
  )
}
