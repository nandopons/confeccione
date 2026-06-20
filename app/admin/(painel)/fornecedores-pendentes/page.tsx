// /admin/fornecedores-pendentes — fila de aprovação de fornecedores novos.
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import PendentesLista, { type FornecedorPendente } from './PendentesLista'

export const dynamic = 'force-dynamic'

export default async function FornecedoresPendentesPage() {
  if (!(await eAdminLogado())) redirect('/admin/login')

  const { data } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, email, tipos_produto, descricao_livre, pedido_minimo, estado, cidade, raio_atendimento, cpf_cnpj, criado_em')
    .eq('aprovacao_status', 'pendente')
    .order('criado_em', { ascending: true })

  const pendentes = (data ?? []) as FornecedorPendente[]

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h2 className="text-lg font-semibold text-gray-900">Aprovação de fornecedores</h2>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Fornecedores que acabaram de se cadastrar e aguardam revisão. Eles não recebem pedidos até serem aprovados.
      </p>
      <PendentesLista inicial={pendentes} />
    </div>
  )
}
