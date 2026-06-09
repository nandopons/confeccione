// app/fornecedor/painel/envio/page.tsx
import { exigirFornecedorAtual } from '@/app/lib/auth-server'

export const dynamic = 'force-dynamic'

export default async function EnvioPage() {
  await exigirFornecedorAtual()
  return (
    <section className="px-5 md:px-8 pt-8 pb-24 max-w-3xl mx-auto">
      <h1 className="text-gray-900 text-2xl font-medium mb-1">Envio</h1>
      <p className="text-gray-500 text-sm mb-6">Emita etiquetas de frete pros pedidos que você produz.</p>

      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <div className="text-4xl mb-3">📦</div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Integração com o Melhor Envio — em breve</h2>
        <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
          Em breve você vai gerar a etiqueta de envio direto por aqui, com os dados do pedido já preenchidos.
          O frete é cobrado à parte e calculado depois que você assume o pedido (a partir da sua localização e a do cliente).
        </p>
        <a
          href="https://melhorenvio.com.br"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-5 text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Conhecer o Melhor Envio
        </a>
      </div>
    </section>
  )
}
