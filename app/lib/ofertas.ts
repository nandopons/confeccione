import { createClient } from '@supabase/supabase-js'
import { buscarFornecedorCompativel, Pedido } from './matching'
import { enviarMensagem } from './zapi'
import { emailOfertaFornecedor } from './email'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const tipoLabel: Record<string, string> = {
  interclasse: 'Interclasse/Evento',
  private_label: 'Private Label',
  peca_unica: 'Peca Unica',
  fardamento: 'Fardamento',
  padrao_esportivo: 'Padrao Esportivo',
  ajuste: 'Ajuste/Conserto',
}

const prazoLabel: Record<string, string> = {
  urgente: 'Urgente (até 7 dias)',
  normal: 'Normal (8 a 21 dias)',
  sempressa: 'Sem pressa (21+ dias)',
}

export async function criarEDispararOferta(pedidoId: string): Promise<void> {
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('*')
    .eq('id', pedidoId)
    .single()

  if (pedidoErr || !pedido) {
    console.error('criarEDispararOferta: pedido não encontrado', pedidoErr)
    return
  }

  if (pedido.status !== 'buscando_fornecedor') return

  const fornecedor = await buscarFornecedorCompativel(pedido as Pedido)
  if (!fornecedor) return

  const { count } = await supabase
    .from('ofertas')
    .select('*', { count: 'exact', head: true })
    .eq('pedido_id', pedidoId)

  const tentativa = (count ?? 0) + 1
  const expiraEm = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()

  const { error: ofertaErr } = await supabase.from('ofertas').insert({
    pedido_id: pedidoId,
    fornecedor_id: fornecedor.id,
    status: 'enviada',
    tentativa_numero: tentativa,
    expira_em: expiraEm,
  })

  if (ofertaErr) {
    console.error('criarEDispararOferta: erro ao inserir oferta', ofertaErr)
    return
  }

  await supabase
    .from('leads_fornecedores')
    .update({ ultimo_lead_em: new Date().toISOString() })
    .eq('id', fornecedor.id)

  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
  const prazo = prazoLabel[pedido.prazo] ?? pedido.prazo

  let mensagem = `Olá ${fornecedor.nome}! Temos um pedido que bate com seu perfil:\n\nTipo: ${tipo}`

  if (pedido.quantidade !== null && pedido.quantidade !== undefined) {
    mensagem += `\nQuantidade: ${pedido.quantidade} peças`
  }

  mensagem += `\nEstado: ${pedido.estado}\nPrazo: ${prazo}`

  if (pedido.descricao && String(pedido.descricao).trim().length > 0) {
    mensagem += `\nDetalhes: ${String(pedido.descricao).trim()}`
  }

  mensagem +=
    '\n\nQuer atender esse cliente? Responde SIM ou NAO nas próximas 4h. Se não responder vamos oferecer pra outro fornecedor.'

  await enviarMensagem(fornecedor.whatsapp, mensagem)

  if (fornecedor.email) {
    emailOfertaFornecedor({
      email: fornecedor.email,
      nomeFornecedor: fornecedor.nome,
      tipo,
      quantidade: pedido.quantidade,
      estado: pedido.estado,
      prazo,
      descricao: pedido.descricao,
    }).catch(err => console.error('email oferta falhou:', err))
  }
}
