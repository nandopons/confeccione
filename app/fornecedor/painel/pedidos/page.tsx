// app/fornecedor/painel/pedidos/page.tsx
// Pedidos do fornecedor — modelo novo (ofertas_pedido_assistente).
import { exigirFornecedorAtual } from '@/app/lib/auth-server'
import { pedidosPendentesFornecedor, pedidosAceitosFornecedor } from '@/app/lib/fornecedor-pedidos'
import PedidosFornecedor from './PedidosFornecedor'

export const dynamic = 'force-dynamic'

export default async function PedidosPage() {
  const fornecedor = await exigirFornecedorAtual()
  const [pendentes, aceitos] = await Promise.all([
    pedidosPendentesFornecedor(fornecedor.id),
    pedidosAceitosFornecedor(fornecedor.id),
  ])

  return (
    <section className="px-5 md:px-8 pt-8 pb-24 max-w-3xl mx-auto">
      <h1 className="text-gray-900 text-2xl font-medium mb-1">Pedidos</h1>
      <p className="text-gray-500 text-sm mb-8">Aceite os pedidos pagos enviados pra você e acompanhe os que assumiu.</p>
      <PedidosFornecedor pendentes={pendentes} aceitos={aceitos} />
    </section>
  )
}
