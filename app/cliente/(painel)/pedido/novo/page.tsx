// app/cliente/(painel)/pedido/novo/page.tsx
// ============================================================================
// PÁGINA APOSENTADA — 11/09/2026.
//
// Era o formulário de 2 passos que criava pedido na tabela `pedidos` (era
// legada) pela rota /api/pedidos/criar, hoje fechada com 410. Nenhum link do
// site apontava pra cá desde o corte de 28/06 — varri o repo e as únicas
// menções ao caminho eram comentários. Quem chegava aqui tinha a URL salva, e
// o pedido que criasse não seria visto por automação nenhuma.
//
// Em vez de apagar, redireciona: cliente que tem o link antigo no favorito cai
// no lugar certo em vez de tomar 404. O `#pedido` é a seção da home onde o
// assistente monta o pedido novo (ver app/page.tsx).
//
// O formulário antigo (NovoPedidoForm.tsx) continua no repo por enquanto, sem
// uso; some junto com o resto da era legada quando ela for aposentada inteira.
// ============================================================================

import { redirect } from 'next/navigation'

export default async function NovoPedidoPage() {
  redirect('/#pedido')
}
