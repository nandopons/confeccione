// app/alinhar/[id]/page.tsx
// Server loader do chat de ALINHAMENTO. Carrega categoria + total de peças do
// pedido recém-criado e entrega ao chat, que decompõe em linhas e grava (PATCH)
// antes de seguir pro visualizador.
import { createClient } from '@supabase/supabase-js'
import SiteHeader from '@/app/components/SiteHeader'
import AlinharCliente from './AlinharCliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type LinhaDb = { total?: number | null; tamanhos?: Array<{ qtd?: number | null }> | null }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data } = await supabase
    .from('pedidos_assistente')
    .select('id, categoria, linhas')
    .eq('id', id)
    .single()

  if (!data) {
    return (
      <main className="min-h-screen bg-[#F7F8F9] font-sans">
        <SiteHeader />
        <div className="max-w-xl mx-auto px-5 py-20 text-center">
          <p className="text-gray-700">Pedido não encontrado.</p>
        </div>
      </main>
    )
  }

  const linhas = Array.isArray(data.linhas) ? (data.linhas as LinhaDb[]) : []
  const totalPecas = linhas.reduce((acc, l) => {
    const t = typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((a, x) => a + (x.qtd || 0), 0)
    return acc + (t || 0)
  }, 0)

  return (
    <main className="min-h-screen bg-[#F7F8F9] font-sans flex flex-col">
      <SiteHeader />
      <AlinharCliente pedidoId={data.id} categoria={data.categoria ?? null} totalPecas={totalPecas} />
    </main>
  )
}
