// app/api/pedidos/criar/route.ts
// ============================================================================
// ROTA FECHADA — 11/09/2026.
//
// Esta rota criava pedido na tabela `pedidos`, a era legada. Ela não recebe
// linha nova desde 28/06/2026 (conferido: zero pedidos com `criado_em` depois
// do corte), e hoje nenhuma automação olha pra lá — o disparo saiu das TAREFAS
// 1, 2 e 6 do scheduler em 10/09. Ou seja: um pedido criado aqui ficaria parado
// pra sempre, sem oferta, sem cron e sem ninguém avisado.
//
// Ela ficou alcançável esse tempo todo por um detalhe: a página
// /cliente/pedido/novo não tem link em lugar nenhum do site, mas existe, e
// cliente logado que tivesse a URL salva criava um pedido invisível. Dormente
// é melhor que ativa, mas armadilha dormente ainda é armadilha.
//
// O fluxo vivo é o assistente: POST /api/pedido/assistente/criar, que grava em
// `pedidos_assistente`. O corpo antigo desta rota está no histórico do git
// (último commit com ela funcionando: fb84c5c).
//
// 410 e não 404 de propósito: 404 diz "nunca existiu" e manda o cliente
// procurar erro de digitação; 410 diz "existiu e acabou", que é a verdade.
// ============================================================================

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Esta forma de criar pedido foi desativada. O pedido agora é montado pelo assistente.',
      use: '/api/pedido/assistente/criar',
    },
    { status: 410 },
  )
}
