// app/inscricao/[token]/page.tsx
// Página PÚBLICA de coleta. Quem tem o link informa nome/tamanho do modelo.
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { primeiroNome } from '@/app/lib/nome'
import InscricaoForm from './InscricaoForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function corLabel(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}

function thumbDoModelo(mockups: unknown, idx: number): string | null {
  if (!mockups || typeof mockups !== 'object') return null
  const m = (mockups as Record<string, { fotos?: string[]; ia?: { url?: string }[]; arte?: string; liso?: string }>)[String(idx)]
  if (!m) return null
  if (Array.isArray(m.fotos) && m.fotos[0]) return m.fotos[0]
  if (Array.isArray(m.ia) && m.ia[0]?.url) return m.ia[0]!.url!
  return m.arte || m.liso || null
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: lista } = await supabase
    .from('listas_externas')
    .select('id, pedido_id, linha_index, modelo_nome, cor, titulo, ativa')
    .eq('token', token)
    .single()

  if (!lista) {
    return (
      <Casca>
        <p className="text-gray-800 font-medium">Lista não encontrada</p>
        <p className="text-sm text-gray-500 mt-1">Confere o link com quem te enviou.</p>
      </Casca>
    )
  }

  const { data: ped } = await supabase
    .from('pedidos_assistente')
    .select('codigo, nome, mockups')
    .eq('id', lista.pedido_id)
    .single()

  const organizador = primeiroNome(ped?.nome)
  const thumb = thumbDoModelo(ped?.mockups, lista.linha_index)
  const modelo = [lista.modelo_nome, corLabel(lista.cor)].filter(Boolean).join(' · ') || lista.titulo || 'a camiseta do grupo'

  return (
    <Casca>
      <div className="flex items-center gap-3">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="Modelo" className="w-16 h-16 rounded-xl object-cover border border-gray-200 shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gray-100 flex items-center justify-center text-2xl shrink-0">👕</div>
        )}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[#0F6E56] font-semibold">Pedido na Confeccione</p>
          <p className="text-gray-900 font-semibold leading-tight capitalize truncate">{modelo}</p>
          {organizador && <p className="text-xs text-gray-500 mt-0.5">Organizado por {organizador}</p>}
        </div>
      </div>

      <p className="text-sm text-gray-600 mt-4 leading-relaxed">
        {organizador ? `${organizador} está` : 'Estão'} montando um pedido de camisetas e {organizador ? 'precisa' : 'precisam'} do seu
        <strong> nome</strong> e <strong>tamanho</strong>. Leva 30 segundos. 🙌
      </p>

      {!lista.ativa ? (
        <div className="mt-5 bg-amber-50 border border-amber-100 text-amber-800 text-sm rounded-xl px-4 py-3">
          A coleta está fechada no momento. Fala com quem te enviou o link.
        </div>
      ) : (
        <InscricaoForm token={token} />
      )}

      <p className="text-center text-[11px] text-gray-400 mt-6">
        Feito com <Link href="https://www.confeccione.com.br" className="text-[#0F6E56] underline">confeccione.com.br</Link>
      </p>
    </Casca>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#E1F5EE] to-white flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-6">{children}</div>
    </main>
  )
}
