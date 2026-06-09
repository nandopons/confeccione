// app/fornecedor/oferta/[id]/page.tsx
// Página pública da oferta pro fornecedor (link via WhatsApp/e-mail).
// Mostra mockups + detalhes do pedido SEM o contato do cliente.
import { notFound } from 'next/navigation'
import { carregarOfertaParaFornecedor } from '@/app/lib/pedido-assistente-oferta'
import OfertaCliente from './OfertaCliente'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function Page({ params }: Props) {
  const { id } = await params
  const oferta = await carregarOfertaParaFornecedor(id)
  if (!oferta) notFound()

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <OfertaCliente oferta={oferta} />
      </div>
    </main>
  )
}
