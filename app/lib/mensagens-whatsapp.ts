// app/lib/mensagens-whatsapp.ts
// ============================================================================
// Textos que abrem a conversa de WhatsApp entre cliente e fornecedor depois do
// aceite da oferta.
//
// POR QUE ISTO EXISTE
// O link `wa.me` sem `?text=` abre uma conversa em branco. Os dois lados ficam
// olhando pro cursor sem saber quem e o outro nem de que pedido se trata —
// principalmente o fornecedor, que pode ter varios pedidos abertos ao mesmo
// tempo. Uma primeira mensagem pronta resolve a apresentacao e ancora a
// conversa num pedido especifico.
//
// REGRAS QUE VALEM PARA OS DOIS TEXTOS
// - Curto. Texto pre-preenchido comprido a pessoa apaga antes de enviar.
// - Sem aviso de politica. O alerta de "orce e pague pela Confeccione" ja
//   aparece na tela, ao lado do botao; repetir dentro da mensagem soa a
//   desconfianca logo no "oi".
// - Sem emoji. Vai como mensagem da pessoa, nao da plataforma.
// - Nada de dado sensivel: o texto viaja na URL e fica no historico do
//   navegador. So nome, quantidade e a referencia curta do pedido.
// ============================================================================

/** Primeiro nome, para o vocativo não ficar com nome e sobrenome completos. */
function primeiroNome(nome: string | null | undefined): string | null {
  const limpo = (nome ?? '').trim()
  if (!limpo) return null
  return limpo.split(/\s+/)[0]
}

/**
 * Referência curta do pedido — os 8 primeiros caracteres do uuid.
 * Serve para o suporte achar o pedido quando alguém manda print da conversa.
 * Não é segredo: quem está na conversa já tem acesso ao pedido inteiro.
 */
export function refPedido(pedidoId: string): string {
  return pedidoId.replace(/-/g, '').slice(0, 8).toUpperCase()
}

function pecas(total: number): string {
  return total === 1 ? '1 peça' : `${total} peças`
}

/** Fornecedor abrindo conversa com o cliente, logo depois de assumir o pedido. */
export function msgFornecedorParaCliente(params: {
  clienteNome: string | null
  fornecedorNome: string | null
  totalPecas: number
  pedidoId: string
}): string {
  const oi = primeiroNome(params.clienteNome)
  const quem = (params.fornecedorNome ?? '').trim().slice(0, 60)
  return [
    oi ? `Olá, ${oi}!` : 'Olá!',
    quem
      ? `Aqui é ${quem}, da Confeccione.`
      : 'Aqui é o fornecedor do seu pedido na Confeccione.',
    `Assumi seu pedido de ${pecas(params.totalPecas)} (ref. ${refPedido(params.pedidoId)}) e já posso alinhar os detalhes com você.`,
  ].join(' ')
}

/** Cliente abrindo conversa com o fornecedor que assumiu o pedido. */
export function msgClienteParaFornecedor(params: {
  clienteNome: string | null
  fornecedorNome: string | null
  totalPecas: number | null
  pedidoId: string
}): string {
  // Nome do fornecedor vai INTEIRO, não só a primeira palavra: em geral é
  // razão social ("Malharia Recife LTDA"), e "Olá, Malharia!" soa errado.
  // Já o nome do cliente é de pessoa, aí o primeiro nome é o natural.
  const quem = (params.fornecedorNome ?? '').trim().slice(0, 60)
  const eu = primeiroNome(params.clienteNome)
  const oQue =
    params.totalPecas && params.totalPecas > 0
      ? `meu pedido de ${pecas(params.totalPecas)}`
      : 'meu pedido'
  return [
    quem ? `Olá, ${quem}!` : 'Olá!',
    eu ? `Sou ${eu}, da Confeccione.` : 'Sou cliente da Confeccione.',
    `Você assumiu ${oQue} (ref. ${refPedido(params.pedidoId)}) e queria alinhar os detalhes.`,
  ].join(' ')
}
