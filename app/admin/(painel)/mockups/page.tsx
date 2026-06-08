// app/admin/(painel)/mockups/page.tsx
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import MockupsAdmin from './MockupsAdmin'

export const dynamic = 'force-dynamic'

export default async function Page() {
  // Defesa em profundidade (layout já valida).
  if (!(await eAdminLogado())) redirect('/admin/login')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <MockupsAdmin />
    </div>
  )
}
