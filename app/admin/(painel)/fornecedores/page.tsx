// app/admin/(painel)/fornecedores/page.tsx
// ============================================================================
// /admin/fornecedores — casca fina pós Fase 3a.
//
// Toda a lógica de tabela (filtros, ordenação, pausar/reativar, exportar)
// vive em FornecedoresTabela.tsx (Client Component) que consome as APIs
// /api/admin/fornecedores* da Fase 2.
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import FornecedoresTabela from './FornecedoresTabela'

export const dynamic = 'force-dynamic'

export default async function FornecedoresPage() {
  if (!(await eAdminLogado())) {
    redirect('/admin/login')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Fornecedores
      </h2>
      <FornecedoresTabela />
    </div>
  )
}
