// app/cliente/(painel)/pedido/novo/page.tsx
// ============================================================================
// Criar pedido dentro do painel (cliente autenticado). Form de 2 passos —
// os dados pessoais (nome/email/whatsapp) vêm da conta, então não há passo 3.
// Se a conta ainda não tem WhatsApp, o form pede (e a API salva no perfil).
// ============================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getContaAtual, perfilCompleto } from '@/app/lib/cliente-auth'
import NovoPedidoForm from './NovoPedidoForm'

export const dynamic = 'force-dynamic'

export default async function NovoPedidoPage() {
  const conta = await getContaAtual()
  if (!conta) return null // layout redireciona
  if (!perfilCompleto(conta)) redirect('/cliente/perfil?completar=1')

  const nomeExibido = conta.nome ?? conta.email.split('@')[0]

  return (
    <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href="/cliente/painel"
        className="text-sm text-gray-600 hover:text-gray-900 inline-block mb-4 transition-colors"
      >
        ← Voltar
      </Link>

      <h2 className="text-lg font-semibold text-gray-900 mb-1">Novo pedido</h2>
      <p className="text-sm text-gray-500 mb-4">
        Vamos buscar fornecedores compatíveis. Você acompanha tudo por aqui.
      </p>

      <NovoPedidoForm nomeExibido={nomeExibido} email={conta.email} />
    </section>
  )
}
