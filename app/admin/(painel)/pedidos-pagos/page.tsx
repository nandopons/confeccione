// app/admin/(painel)/pedidos-pagos/page.tsx
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import PedidosPagosAdmin from './PedidosPagosAdmin'

export const dynamic = 'force-dynamic'

export default async function Page() {
  if (!(await eAdminLogado())) redirect('/admin/login')
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <PedidosPagosAdmin />
    </div>
  )
}
