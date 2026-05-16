// app/admin/(painel)/layout.tsx
// ============================================================================
// Layout do painel admin autenticado.
//
// Route group "(painel)" agrupa as pages que exigem cookie admin válido.
// /admin/login fica FORA desse group (em app/admin/login/page.tsx) pra evitar
// loop de redirect (layout que checa auth + login que seta cookie).
//
// Camadas de auth no /admin/*:
//   1. middleware.ts (Edge)         → barreira rápida (cookie existe + length≥32)
//   2. este layout                   → validação real via eAdminLogado()
//   3. cada page filha               → eAdminLogado() de novo (defesa em
//                                      profundidade; cobre edge cases de
//                                      streaming do Next.js Server Components)
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { AdminNav } from './Nav'

export default async function AdminPainelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await eAdminLogado())) {
    redirect('/admin/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="mb-3">
            <h1 className="text-xl font-bold text-gray-900">
              Confeccione · admin
            </h1>
          </div>
          <AdminNav />
        </div>
      </header>

      <main>{children}</main>
    </div>
  )
}
