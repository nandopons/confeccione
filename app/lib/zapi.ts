const ZAPI_INSTANCE     = process.env.ZAPI_INSTANCE_ID!
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN!
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!

export async function enviarMensagem(telefone: string, mensagem: string) {
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Token': ZAPI_CLIENT_TOKEN,
        },
        body: JSON.stringify({ phone: telefone, message: mensagem }),
      }
    )
    const data = await res.json()
    console.log('Z-API response:', JSON.stringify(data))
  } catch (err) {
    console.error('Z-API error:', err)
  }
}

export async function whatsappAdminSemFornecedor(params: {
  pedidoId: string
  nomeCliente: string
  tipo: string
  quantidade: number | null
  estado: string
  totalTentativas: number
}): Promise<void> {
  const adminWhatsapp = process.env.ADMIN_WHATSAPP

  if (!adminWhatsapp) {
    console.warn('[zapi] ADMIN_WHATSAPP ausente — alerta admin não enviado:', { pedidoId: params.pedidoId })
    return
  }

  const supabaseLink = `https://supabase.com/dashboard/project/oumfvryxxxfgflvpqeow/editor/pedidos?filter=id%3Aeq%3A${encodeURIComponent(params.pedidoId)}`

  const linhaQtd =
    params.quantidade !== null && params.quantidade !== undefined
      ? `\nQtd: ${params.quantidade} peças`
      : ''

  const mensagem =
    `⚠️ *Confeccione — pedido sem fornecedor*\n\n` +
    `Cliente: ${params.nomeCliente}\n` +
    `Tipo: ${params.tipo}` +
    linhaQtd +
    `\nEstado: ${params.estado}\n` +
    `Tentativas feitas: ${params.totalTentativas}\n\n` +
    `Pedido: ${params.pedidoId}\n` +
    supabaseLink

  try {
    await enviarMensagem(adminWhatsapp, mensagem)
  } catch (err) {
    console.error('[zapi] whatsappAdminSemFornecedor falhou:', err)
  }
}

export async function whatsappAdminFornecedorExpirou(params: {
  fornecedorId: string
  nomeFornecedor: string
  whatsappFornecedor: string
  pedidoId: string
  nomeCliente: string
  tipo: string
}): Promise<void> {
  const adminWhatsapp = process.env.ADMIN_WHATSAPP

  if (!adminWhatsapp) {
    console.warn('[zapi] ADMIN_WHATSAPP ausente — alerta expiração não enviado:', { fornecedorId: params.fornecedorId })
    return
  }

  const fornecedorLink = `https://supabase.com/dashboard/project/oumfvryxxxfgflvpqeow/editor/leads_fornecedores?filter=id%3Aeq%3A${encodeURIComponent(params.fornecedorId)}`

  const mensagem =
    `⏰ *Confeccione — fornecedor não respondeu em 4h*\n\n` +
    `Fornecedor: ${params.nomeFornecedor}\n` +
    `WhatsApp: ${params.whatsappFornecedor}\n\n` +
    `Pedido: ${params.tipo} de ${params.nomeCliente}\n` +
    `Pedido ID: ${params.pedidoId}\n\n` +
    `Sistema vai oferecer pra outro fornecedor automaticamente.\n\n` +
    fornecedorLink

  try {
    await enviarMensagem(adminWhatsapp, mensagem)
  } catch (err) {
    console.error('[zapi] whatsappAdminFornecedorExpirou falhou:', err)
  }
}
