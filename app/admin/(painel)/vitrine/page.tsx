// /admin/vitrine — curadoria das fotos que os fornecedores sobem.
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { listarParaCuradoria } from '@/app/lib/portfolio-fornecedor'
import VitrineLista, { type ItemVitrine } from './VitrineLista'

export const dynamic = 'force-dynamic'

export default async function VitrinePage() {
  if (!(await eAdminLogado())) redirect('/admin/login')

  const itens = await listarParaCuradoria('todas')

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h2 className="text-lg font-semibold text-gray-900">Vitrine da home</h2>
      <p className="text-sm text-gray-500 mt-1 mb-5 max-w-2xl">
        Fotos que os fornecedores subiram no portfólio deles. O que você marcar como destaque
        entra no carrossel da página inicial — o resto fica só na oferta que o cliente recebe.
      </p>
      <VitrineLista inicial={itens as unknown as ItemVitrine[]} />
    </div>
  )
}
