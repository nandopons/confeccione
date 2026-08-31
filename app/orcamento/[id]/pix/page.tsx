// app/orcamento/[id]/pix/page.tsx
// ============================================================================
// Página pública de pagamento PIX de um orçamento avulso.
//
// Aberta pelo link "Copiar código PIX" do PDF do orçamento — o uuid na URL é
// o segredo (mesmo padrão do visualizador/[id]). Mostra QR + botão que copia
// o copia-e-cola com 1 clique (essencial no celular, onde o QR não ajuda).
// Só existe pra orçamentos com cobrança PIX gerada.
// ============================================================================

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import CopiarPixCliente from './CopiarPixCliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!RE_UUID.test(id)) notFound()

  const { data } = await supabaseAdmin
    .from('orcamentos')
    .select(
      'id, numero, cliente_nome, total_centavos, pix_copia_cola, pix_qr_imagem, cobranca_vencimento, asaas_invoice_url'
    )
    .eq('id', id)
    .single()

  if (!data || !data.pix_copia_cola) notFound()

  return (
    <CopiarPixCliente
      numero={data.numero}
      clienteNome={data.cliente_nome}
      totalCentavos={data.total_centavos}
      copiaCola={data.pix_copia_cola}
      qrImagem={data.pix_qr_imagem}
      vencimento={data.cobranca_vencimento}
      invoiceUrl={data.asaas_invoice_url}
    />
  )
}
