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
//
// A moldura visual (sidebar escura desktop + topbar/drawer mobile) vive no
// client component AdminShell (./Nav.tsx).
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { AdminShell } from './Nav'

export default async function AdminPainelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await eAdminLogado())) {
    redirect('/admin/login')
  }

  return <AdminShell>{children}</AdminShell>
}
