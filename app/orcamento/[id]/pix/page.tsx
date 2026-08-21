// app/orcamento/[id]/pix/page.tsx
// ============================================================================
// Página pública de pagamento PIX de um orçamento avulso.
//
// Aberta pelo link "Copiar código PIX" do PDF do orçamento — o uuid na URL é
// o segredo (mesmo padrão do visualizador/[id]). Mostra QR + botão que copia
// o copia-e-cola com 1 clique (essencial no celular, onde o QR não ajuda).
//
// 21/08/2026 — AGORA LÊ A PARCELA, NÃO O ORÇAMENTO
// Com o 50/50 um orçamento tem dois títulos. Sem `?p=`, mostra a primeira
// parcela ainda em aberto — que é sempre a que o cliente precisa pagar agora.
// `?p=2` abre a final direto (é o link que você manda depois do sinal).
//
// O DESCONTO VEM DO BANCO, NÃO DE UMA CONSTANTE
// Antes esta página assumia 3% sempre. Com o desconto virando escolha por
// orçamento, isso viraria preço errado na tela do cliente: ele leria "3% de
// desconto" e copiaria um PIX de valor cheio. Agora o percentual é o da
// parcela — sinal e final saem com 0.
// ============================================================================

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import CopiarPixCliente from './CopiarPixCliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LinhaOrcamento = {
  id: string
  numero: string
  cliente_nome: string | null
  total_centavos: number
  modalidade: 'integral' | 'sinal_50' | null
  desconto_pix_percentual: number | null
  pix_copia_cola: string | null
  pix_qr_imagem: string | null
  cobranca_vencimento: string | null
  asaas_invoice_url: string | null
}

type LinhaCobranca = {
  parcela: number
  rotulo: 'integral' | 'sinal' | 'final'
  valor_centavos: number
  desconto_percentual: number
  vencimento: string | null
  pix_copia_cola: string | null
  pix_qr_imagem: string | null
  asaas_invoice_url: string | null
  status: 'gerada' | 'paga' | 'cancelada'
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ p?: string }>
}) {
  const { id } = await params
  if (!RE_UUID.test(id)) notFound()

  const { p } = await searchParams
  const parcelaPedida = p === '2' ? 2 : p === '1' ? 1 : null

  const { data: orc } = await supabaseAdmin
    .from('orcamentos')
    .select(
      'id, numero, cliente_nome, total_centavos, modalidade, desconto_pix_percentual, ' +
        'pix_copia_cola, pix_qr_imagem, cobranca_vencimento, asaas_invoice_url'
    )
    .eq('id', id)
    .maybeSingle<LinhaOrcamento>()

  if (!orc) notFound()

  const { data: cobrancas } = await supabaseAdmin
    .from('orcamento_cobrancas')
    .select(
      'parcela, rotulo, valor_centavos, desconto_percentual, vencimento, ' +
        'pix_copia_cola, pix_qr_imagem, asaas_invoice_url, status'
    )
    .eq('orcamento_id', id)
    .order('parcela', { ascending: true })

  const lista = ((cobrancas ?? []) as unknown as LinhaCobranca[]).filter(
    (c) => c.status !== 'cancelada'
  )

  // Sem `?p=`, a parcela em aberto — é a que o cliente tem pra pagar agora. Se
  // todas estão pagas, mostra a última, e a tela exibe o aviso de já pago.
  const escolhida =
    (parcelaPedida ? lista.find((c) => c.parcela === parcelaPedida) : null) ??
    lista.find((c) => c.status === 'gerada') ??
    lista[lista.length - 1] ??
    null

  // Fallback pros orçamentos anteriores à tabela de parcelas, caso algum tenha
  // escapado do backfill.
  const copiaCola = escolhida?.pix_copia_cola ?? orc.pix_copia_cola
  if (!copiaCola) notFound()

  const valorParcela = escolhida?.valor_centavos ?? orc.total_centavos
  const desconto = escolhida?.desconto_percentual ?? orc.desconto_pix_percentual ?? 0
  const restante =
    escolhida && escolhida.rotulo !== 'integral'
      ? Math.max(0, (orc.total_centavos ?? 0) - valorParcela)
      : 0

  return (
    <CopiarPixCliente
      numero={orc.numero}
      clienteNome={orc.cliente_nome}
      totalCentavos={valorParcela}
      descontoPercentual={desconto}
      rotulo={escolhida?.rotulo ?? 'integral'}
      pago={escolhida?.status === 'paga'}
      restanteCentavos={restante}
      copiaCola={copiaCola}
      qrImagem={escolhida?.pix_qr_imagem ?? orc.pix_qr_imagem}
      vencimento={escolhida?.vencimento ?? orc.cobranca_vencimento}
      invoiceUrl={escolhida?.asaas_invoice_url ?? orc.asaas_invoice_url}
    />
  )
}
