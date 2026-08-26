// app/lib/pedido-acesso.ts
// ============================================================================
// Quem pode MEXER num pedido do fluxo /visualizador.
//
// O CONTEXTO, porque ele explica por que isto não é simplesmente "exigir
// login" (26/08/2026):
//
// O `/visualizador/{id}` é aberto DE PROPÓSITO. O cliente recebe o link por
// WhatsApp e por e-mail logo depois de fazer o pedido, e abre sem conta — é o
// caminho principal do produto, não um atalho. Exigir sessão ali quebraria
// todos os links já enviados e o fluxo de quem nunca criou senha.
//
// Só que as rotas de MUDANÇA de estado (cancelar, confirmar, pagar, recusar
// orçamento, trocar endereço) herdaram esse mesmo "qualquer um com o link" —
// e aí o preço é outro: um link reencaminhado num grupo permite cancelar o
// pedido de outra pessoa.
//
// O que esta função faz é o passo que NÃO quebra nada: quando existe sessão
// de cliente, ela passa a valer. Se você está logado como A e abre o link do
// pedido de B, a ação é recusada. Anônimo continua passando, como hoje.
//
// O que ela NÃO resolve, e precisa de decisão de produto: anônimo com o link
// ainda pode agir. O conserto de verdade é um token assinado no link
// (`?t=<hmac>`), com uma janela de convivência aceitando o id puro enquanto
// as mensagens antigas circulam. Está registrado na triagem de 26/08.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { getContaAtual } from './cliente-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type ResultadoAcesso =
  | { permitido: true; contaId: string | null }
  | { permitido: false; motivo: string }

type PedidoDono = {
  conta_id?: string | null
  email?: string | null
}

/**
 * @param pedido  linha do pedido já lida do banco (precisa de conta_id e email)
 *
 * Regras, nesta ordem:
 *   1. sem sessão  → permitido (modelo de link, comportamento atual)
 *   2. com sessão e o pedido é dela (por conta_id OU por e-mail) → permitido
 *   3. com sessão e o pedido é de outra pessoa → RECUSADO
 *
 * O casamento por e-mail existe porque pedido feito antes de a conta existir
 * nasce com `conta_id` nulo e só se liga à conta pelo e-mail — mesma regra de
 * `app/lib/cliente-pedidos.ts`.
 */
export async function podeMexerNoPedido(pedido: PedidoDono): Promise<ResultadoAcesso> {
  let conta: { id: string; email: string | null } | null = null
  try {
    conta = await getContaAtual()
  } catch {
    // Falha ao ler a sessão não pode virar bloqueio: o caminho anônimo é
    // legítimo e é o mais usado.
    return { permitido: true, contaId: null }
  }
  return decidirAcesso(pedido, conta)
}

/**
 * A decisão em si, sem cookies nem banco — separada pra ser testável.
 */
export function decidirAcesso(
  pedido: PedidoDono,
  conta: { id: string; email: string | null } | null,
): ResultadoAcesso {
  if (!conta) return { permitido: true, contaId: null }

  const mesmaConta = Boolean(pedido.conta_id) && pedido.conta_id === conta.id
  const mesmoEmail =
    Boolean(pedido.email) &&
    Boolean(conta.email) &&
    pedido.email!.trim().toLowerCase() === conta.email!.trim().toLowerCase()

  if (mesmaConta || mesmoEmail) return { permitido: true, contaId: conta.id }

  return {
    permitido: false,
    motivo: 'Este pedido pertence a outra conta. Saia da sua conta ou entre com o e-mail usado no pedido.',
  }
}

/**
 * Versão pronta pra rota: lê o dono no banco e devolve `null` quando pode
 * seguir, ou a mensagem de recusa quando não pode.
 *
 * Falha de leitura NÃO bloqueia: a rota já lida com pedido inexistente logo
 * depois, e transformar indisponibilidade do banco em "pedido de outra
 * pessoa" seria mentir pro cliente certo.
 */
export async function recusaPorDono(pedidoId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('pedidos_assistente')
    .select('conta_id, email')
    .eq('id', pedidoId)
    .maybeSingle<PedidoDono>()

  if (error || !data) return null

  const r = await podeMexerNoPedido(data)
  return r.permitido ? null : r.motivo
}
