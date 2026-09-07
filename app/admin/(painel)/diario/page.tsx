// app/admin/(painel)/diario/page.tsx
// ============================================================================
// DIÁRIO DE BORDO — a memória de gestão, legível pelo celular.
//
// Placar da semana (os nove indicadores), registro de decisões e atas das
// reuniões, tudo vindo do mesmo banco que os números. A mesma lib alimenta o
// servidor MCP (/api/mcp): o que o Fernando lê aqui é o que o Claude lê lá.
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import DiarioPainel from './DiarioPainel'

export const dynamic = 'force-dynamic'

export default async function Page() {
  if (!(await eAdminLogado())) redirect('/admin/login')
  return (
    <section className="px-5 md:px-8 pt-8 pb-14 max-w-6xl mx-auto">
      <DiarioPainel />
    </section>
  )
}
