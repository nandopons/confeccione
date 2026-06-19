// app/admin/(painel)/pedidos-chat/page.tsx
// Página unificada em /admin/pedidos-pagos — esta rota só redireciona (legado).
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function Page() {
  redirect('/admin/pedidos-pagos')
}
