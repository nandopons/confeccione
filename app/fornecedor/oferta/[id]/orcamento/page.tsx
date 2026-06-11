// app/fornecedor/oferta/[id]/orcamento/page.tsx
// Página pública (uuid da oferta ACEITA) onde o FORNECEDOR define o orçamento
// final: líquido por produto + frete. O sistema converte pro preço do cliente
// (+taxa embutida) e avisa o cliente por e-mail e WhatsApp.
import { notFound } from 'next/navigation'
import { carregarOrcamentoFornecedor } from '@/app/lib/pedido-assistente-oferta'
import OrcamentoFornecedor from './OrcamentoFornecedor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function Page({ params }: Props) {
  const { id } = await params
  const dados = await carregarOrcamentoFornecedor(id)
  if (!dados) notFound()

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <OrcamentoFornecedor dados={dados} />
      </div>
    </main>
  )
}
