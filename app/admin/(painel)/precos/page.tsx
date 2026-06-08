// app/admin/(painel)/precos/page.tsx
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import PrecosAdmin from './PrecosAdmin'

export const dynamic = 'force-dynamic'

export default async function Page() {
  if (!(await eAdminLogado())) redirect('/admin/login')
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <PrecosAdmin />
    </div>
  )
}
