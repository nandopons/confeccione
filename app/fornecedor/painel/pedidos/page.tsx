// app/fornecedor/painel/pedidos/page.tsx
// ============================================================================
// Página de Pedidos do painel — server component.
// Carrega as 3 categorias de ofertas (pendentes, aceitas, histórico) em
// paralelo e passa pra um client component que cuida das tabs.
// ============================================================================

import { exigirFornecedorAtual } from '@/app/lib/auth-server'
import {
  buscarOfertasFornecedor,
  buscarLinksArtes,
} from '@/app/lib/ofertas-painel'
import PedidosTabs from './PedidosTabs'

export const dynamic = 'force-dynamic'

export default async function PedidosPage() {
  const fornecedor = await exigirFornecedorAtual()

  // Busca as 3 categorias em paralelo
  const [pendentes, aceitas, historico] = await Promise.all([
    buscarOfertasFornecedor(fornecedor.id, 'pendentes'),
    buscarOfertasFornecedor(fornecedor.id, 'aceitas'),
    buscarOfertasFornecedor(fornecedor.id, 'historico'),
  ])

  // Links de artes compartilhadas, escopados ao fornecedor logado e a
  // compartilhamentos não-expirados (depende dos pedido_ids das aceitas).
  const linksArtes = await buscarLinksArtes(
    fornecedor.id,
    aceitas.map((o) => o.pedido_id),
  )

  return (
    <section className="px-5 md:px-8 pt-8 pb-12 max-w-4xl mx-auto">
      <h1 className="text-gray-900 text-2xl font-medium mb-1">Pedidos</h1>
      <p className="text-gray-500 text-sm mb-8">
        Aceite, recuse e acompanhe os pedidos enviados pra você.
      </p>

      <PedidosTabs
        pendentes={pendentes}
        aceitas={aceitas}
        historico={historico}
        linksArtes={linksArtes}
      />
    </section>
  )
}
