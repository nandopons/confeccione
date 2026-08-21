// app/admin/(painel)/producao/page.tsx
// Quadro de produção — pedidos pagos, uma coluna por etapa de fábrica.
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import ProducaoQuadro from './ProducaoQuadro'

export const dynamic = 'force-dynamic'

export default async function ProducaoPage() {
  if (!(await eAdminLogado())) redirect('/admin/login')

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-gray-900 text-2xl font-medium mb-1">Produção</h1>
      <p className="text-gray-500 text-sm mb-6">
        Entra sozinho quando o cliente paga. Arraste o card ou use o seletor de etapa — o fornecedor também
        move os pedidos dele pelo painel, e tudo fica registrado em quem moveu e quando.
      </p>
      <ProducaoQuadro />
    </div>
  )
}
