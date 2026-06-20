// app/visualizador/[id]/page.tsx
// Server loader: carrega o pedido salvo (pedidos_assistente) + fornecedor da
// oferta aceita (se houver) e entrega ao client.
import { createClient } from '@supabase/supabase-js'
import { buscarEnderecoCep } from '@/app/lib/cep'
import Link from 'next/link'
import SiteHeader from '@/app/components/SiteHeader'
import SiteFooter from '@/app/components/SiteFooter'
import VisualizadorCliente, { type PedidoVis } from './VisualizadorCliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data } = await supabase
    .from('pedidos_assistente')
    .select('id, conta_id, linhas, nome, telefone, email, cep, complemento, logradouro, bairro, cidade, uf, status, mockups, prazo_dias, confirmado_em, orcamento_status, valor_centavos, frete_centavos, pagamento_status')
    .eq('id', id)
    .single()

  // Backfill: pedidos salvos sem endereço resolvido (ex.: CEP que o ViaCEP não
  // conhecia na hora) ganham rua/bairro/cidade aqui — e ficam persistidos.
  let pedido = data
  if (pedido?.cep && !pedido.cidade) {
    const end = await buscarEnderecoCep(pedido.cep)
    if (end && (end.cidade || end.logradouro)) {
      const patchEnd = { logradouro: end.logradouro, bairro: end.bairro, cidade: end.cidade, uf: end.uf, atualizado_em: new Date().toISOString() }
      await supabase.from('pedidos_assistente').update(patchEnd).eq('id', pedido.id)
      pedido = { ...pedido, ...patchEnd }
    }
  }
  // Pré-preenche a ENTREGA do pedido com o endereço do PERFIL do cliente
  // (contas_clientes), quando o pedido ainda não tem CEP e está vinculado a uma conta.
  if (pedido && !pedido.cep && pedido.conta_id) {
    const { data: conta } = await supabase
      .from('contas_clientes')
      .select('cep, numero, complemento, logradouro, bairro, cidade, uf')
      .eq('id', pedido.conta_id)
      .maybeSingle<{ cep: string | null; numero: string | null; complemento: string | null; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null }>()
    if (conta?.cep) {
      const complementoPerfil = [conta.numero, conta.complemento].filter(Boolean).join(' - ') || null
      const patchPerfil = {
        cep: conta.cep,
        complemento: pedido.complemento || complementoPerfil,
        logradouro: conta.logradouro,
        bairro: conta.bairro,
        cidade: conta.cidade,
        uf: conta.uf,
        atualizado_em: new Date().toISOString(),
      }
      await supabase.from('pedidos_assistente').update(patchPerfil).eq('id', pedido.id)
      pedido = { ...pedido, ...patchPerfil }
    }
  }

  // Fornecedor da oferta aceita (mostrado no orçamento final).
  let fornecedorNome: string | null = null
  if (pedido) {
    const { data: oferta } = await supabase
      .from('ofertas_pedido_assistente')
      .select('status, leads_fornecedores(nome)')
      .eq('pedido_id', pedido.id)
      .eq('status', 'aceita')
      .maybeSingle<{ status: string; leads_fornecedores: { nome: string | null } | null }>()
    fornecedorNome = oferta?.leads_fornecedores?.nome ?? null
  }

  return (
    <main className="min-h-screen bg-[#F7F8F9] font-sans flex flex-col">
      <SiteHeader />
      {!pedido ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
          <p className="text-gray-900 text-lg font-medium mb-2">Pedido não encontrado</p>
          <p className="text-gray-500 text-sm mb-6 max-w-sm">
            Esse link de visualização não existe ou expirou. Você pode montar um novo pedido na página inicial.
          </p>
          <Link href="/#pedido" className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
            Fazer um pedido
          </Link>
        </div>
      ) : (
        <VisualizadorCliente pedido={{ ...(pedido as PedidoVis), fornecedor_nome: fornecedorNome }} />
      )}
      <SiteFooter />
    </main>
  )
}
