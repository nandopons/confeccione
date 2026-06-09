// app/fornecedor/painel/carteira/page.tsx
import { exigirFornecedorAtual } from '@/app/lib/auth-server'
import { carteiraFornecedor, obterDadosRepasse } from '@/app/lib/fornecedor-pedidos'
import CarteiraCliente from './CarteiraCliente'

export const dynamic = 'force-dynamic'

export default async function CarteiraPage() {
  const fornecedor = await exigirFornecedorAtual()
  const [carteira, dados] = await Promise.all([
    carteiraFornecedor(fornecedor.id),
    obterDadosRepasse(fornecedor.id),
  ])
  return (
    <section className="px-5 md:px-8 pt-8 pb-24 max-w-3xl mx-auto">
      <h1 className="text-gray-900 text-2xl font-medium mb-1">Carteira</h1>
      <p className="text-gray-500 text-sm mb-6">Acompanhe o que você tem a receber e cadastre os dados pra Confeccione repassar.</p>
      <CarteiraCliente carteira={carteira} dados={dados} />
    </section>
  )
}
