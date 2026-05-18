import { createClient } from '@supabase/supabase-js'
import { buscarFornecedorCompativel, type Pedido, type Fornecedor } from './matching'
import { enviarMensagem, whatsappAdminSemFornecedor } from './zapi'
import { emailOfertaFornecedor, emailAdminSemFornecedor } from './email'
import {
  PLANOS_CONFIG,
  PACOTES_LEADS_EXTRAS,
  JANELA_SEM_CREDITO_MS,
  planoEfetivo,
  podeReceberGatilhoUpgrade,
  registrarGatilhoUpgrade,
  type Plano,
} from './planos'
import { tipoLabel, prazoLabel } from './ofertas-labels'

// Re-export pra preservar imports server existentes (api routes etc).
// Client components devem importar direto de './ofertas-labels' pra não
// arrastar este arquivo (que cria Supabase client) pro bundle do browser.
export { tipoLabel, prazoLabel }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HORAS_4_MS = 4 * 60 * 60 * 1000

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

  const resultado = await buscarFornecedorCompativel(pedido as Pedido)

  // Caso 1: sem fornecedor disponível (nem com nem sem crédito)
  if (!resultado) {
    return await notificarAdminSemFornecedor(pedidoId, pedido)
  }

  // Caso 2: fornecedor com crédito → oferta normal
  if (resultado.tem_credito) {
    await dispararOfertaNormal(pedido as Pedido, resultado.fornecedor)
    return
  }

  // Caso 3: fornecedor sem crédito → oferta com gatilho de upgrade
  // Mas respeita anti-spam (máximo 1 gatilho por dia)
  const podeGatilho = await podeReceberGatilhoUpgrade(resultado.fornecedor.id)
  if (!podeGatilho) {
    // Tenta achar OUTRO sem crédito que ainda não recebeu gatilho hoje.
    // Por simplicidade, se o primeiro candidato sem crédito não pode receber
    // por causa do anti-spam, marca como sem fornecedor disponível desta rodada.
    // O cron tentará de novo no próximo ciclo (pedido fica em buscando_fornecedor).
    console.log(
      `[ofertas] fornecedor ${resultado.fornecedor.id} no anti-spam, pulando rodada`
    )
    return await notificarAdminSemFornecedor(pedidoId, pedido)
  }

  return await dispararOfertaSemCredito(pedido as Pedido, resultado.fornecedor)
}

// ============================================================
// OFERTA NORMAL (fornecedor tem crédito)
// ============================================================
async function dispararOfertaNormal(
  pedido: Pedido,
  fornecedor: Fornecedor
): Promise<string | null> {
  const { count } = await supabase
    .from('ofertas')
    .select('*', { count: 'exact', head: true })
    .eq('pedido_id', pedido.id)

  const tentativa = (count ?? 0) + 1
  const expiraEm = new Date(Date.now() + HORAS_4_MS).toISOString()

  const { data: inserida, error: ofertaErr } = await supabase
    .from('ofertas')
    .insert({
      pedido_id: pedido.id,
      fornecedor_id: fornecedor.id,
      status: 'enviada',
      tipo_oferta: 'normal',
      tentativa_numero: tentativa,
      expira_em: expiraEm,
    })
    .select('id')
    .single()

  if (ofertaErr || !inserida) {
    console.error('dispararOfertaNormal: erro ao inserir oferta', ofertaErr)
    return null
  }

  await supabase
    .from('leads_fornecedores')
    .update({ ultimo_lead_em: new Date().toISOString() })
    .eq('id', fornecedor.id)

  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
  const prazo = prazoLabel[pedido.prazo] ?? pedido.prazo

  let mensagem = `Novo pedido:\n\nTipo: ${tipo}`

  if (pedido.quantidade !== null && pedido.quantidade !== undefined) {
    mensagem += `\nQuantidade: ${pedido.quantidade} peças`
  }

  mensagem += `\nEstado: ${pedido.estado}\nPrazo: ${prazo}`

  if (pedido.descricao && String(pedido.descricao).trim().length > 0) {
    mensagem += `\nDetalhes: ${String(pedido.descricao).trim()}`
  }

  mensagem +=
    '\n\nQuer atender este cliente? Responde Sim ou Não.'

  await enviarMensagem(fornecedor.whatsapp, mensagem)

  if (fornecedor.email) {
    try {
      await emailOfertaFornecedor({
        email: fornecedor.email,
        nomeFornecedor: fornecedor.nome,
        tipo,
        quantidade: pedido.quantidade,
        estado: pedido.estado,
        prazo,
        descricao: pedido.descricao,
      })
    } catch (err) {
      console.error('email oferta falhou:', err)
    }
  }

  return (inserida as { id: string }).id
}

// ============================================================
// OFERTA SEM CRÉDITO (gatilho de upgrade)
// ============================================================
async function dispararOfertaSemCredito(
  pedido: Pedido,
  fornecedor: Fornecedor
): Promise<void> {
  const { count } = await supabase
    .from('ofertas')
    .select('*', { count: 'exact', head: true })
    .eq('pedido_id', pedido.id)

  const tentativa = (count ?? 0) + 1
  const expiraEm = new Date(Date.now() + JANELA_SEM_CREDITO_MS).toISOString()

  // Insere oferta com tipo_oferta='sem_credito' e janela de 3h
  const { data: ofertaInserida, error: ofertaErr } = await supabase
    .from('ofertas')
    .insert({
      pedido_id: pedido.id,
      fornecedor_id: fornecedor.id,
      status: 'enviada',
      tipo_oferta: 'sem_credito',
      tentativa_numero: tentativa,
      expira_em: expiraEm,
    })
    .select('id')
    .single()

  if (ofertaErr || !ofertaInserida) {
    console.error('dispararOfertaSemCredito: erro ao inserir oferta', ofertaErr)
    return
  }

  // Registra anti-spam (1 gatilho/dia)
  await registrarGatilhoUpgrade({
    fornecedorId: fornecedor.id,
    pedidoId: pedido.id,
    ofertaId: ofertaInserida.id,
  })

  // Monta mensagem com resumo do lead + opções de upgrade
  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
  const prazo = prazoLabel[pedido.prazo] ?? pedido.prazo
  const planoAtual = planoEfetivo({
    plano: fornecedor.plano,
    plano_expira_em: fornecedor.plano_expira_em,
  })
  const config = PLANOS_CONFIG[planoAtual] ?? PLANOS_CONFIG['free']

  let mensagem = `Novo pedido:\n\nTipo: ${tipo}`

  if (pedido.quantidade !== null && pedido.quantidade !== undefined) {
    mensagem += `\nQuantidade: ${pedido.quantidade} peças`
  }

  mensagem += `\nEstado: ${pedido.estado}\nPrazo: ${prazo}`

  if (pedido.descricao && String(pedido.descricao).trim().length > 0) {
    mensagem += `\nDetalhes: ${String(pedido.descricao).trim()}`
  }

  mensagem += `\n\n⚠️ Você atingiu o limite de ${config.leads_inclusos} pedidos do plano *${config.nome}* este mês.\n\nPra receber este pedido, você pode:`

  // Pacotes de leads extras (preço varia conforme plano)
  PACOTES_LEADS_EXTRAS.forEach((pacote, i) => {
    const preco = pacote.quantidade * config.preco_lead_extra
    mensagem += `\n*${i + 1}* — Pacote de ${pacote.quantidade} pedidos por R$ ${preco}`
  })

  // Opção de upgrade pro próximo plano (se houver um acima)
  const planos: Plano[] = ['free', 'starter', 'pro']
  const idxAtual = planos.indexOf(planoAtual)
  if (idxAtual >= 0 && idxAtual < planos.length - 1) {
    const proximoPlano = planos[idxAtual + 1]
    const cfgProximo = PLANOS_CONFIG[proximoPlano]
    mensagem += `\n*4* — Upgrade pro plano *${cfgProximo.nome}* (R$ ${cfgProximo.preco_mes}/mês, ${cfgProximo.leads_inclusos} pedidos)`
  }

  mensagem += `\n*5* — Não tenho interesse neste pedido\n\n⏰ Você tem 3 horas pra responder. Se não responder, ofereço pra outro fornecedor.`

  await enviarMensagem(fornecedor.whatsapp, mensagem)
}

// ============================================================
// SEM FORNECEDOR DISPONÍVEL — notifica admin
// ============================================================
async function notificarAdminSemFornecedor(
  pedidoId: string,
  pedido: { tipo: string; estado: string; quantidade: number | null; nome: string }
): Promise<void> {
  const { count } = await supabase
    .from('ofertas')
    .select('*', { count: 'exact', head: true })
    .eq('pedido_id', pedidoId)

  const tipoFmt = tipoLabel[pedido.tipo] ?? pedido.tipo

  console.warn('[ofertas] sem fornecedor disponível', {
    pedidoId,
    tipo: pedido.tipo,
    estado: pedido.estado,
    tentativas: count ?? 0,
  })

  await Promise.allSettled([
    whatsappAdminSemFornecedor({
      pedidoId,
      nomeCliente: pedido.nome,
      tipo: tipoFmt,
      quantidade: pedido.quantidade,
      estado: pedido.estado,
      totalTentativas: count ?? 0,
    }),
    emailAdminSemFornecedor({
      pedidoId,
      nomeCliente: pedido.nome,
      tipo: tipoFmt,
      quantidade: pedido.quantidade,
      estado: pedido.estado,
      totalTentativas: count ?? 0,
    }),
  ])
}

// ============================================================
// DISPARO PRA FORNECEDOR ESPECÍFICO (sem passar por matching)
// ============================================================

/** Dispara oferta normal pra um fornecedor ESPECÍFICO. Usado pelo B3
 *  (processamento de fila de reenvios) quando o admin já decidiu qual
 *  fornecedor deve receber. Reusa dispararOfertaNormal internamente.
 *
 *  Defensivo: valida que pedido ainda está "buscando" e sem fornecedor
 *  aceito. Se algo mudou entre o agendamento e o disparo (ex: pedido
 *  foi aceito por outro fornecedor), NÃO dispara — retorna erro. */
export async function dispararOfertaParaFornecedor(
  pedidoId: string,
  fornecedorId: string
): Promise<
  | { ok: true; ofertaId: string }
  | { ok: false; erro: string }
> {
  const { data: pedido } = await supabase
    .from('pedidos')
    .select('*')
    .eq('id', pedidoId)
    .single()
  if (!pedido) return { ok: false, erro: 'pedido não encontrado' }

  if (
    pedido.status !== 'aguardando_contato' &&
    pedido.status !== 'buscando_fornecedor'
  ) {
    return {
      ok: false,
      erro: `pedido em status ${pedido.status}, não disparável`,
    }
  }
  if (pedido.fornecedor_aceito_id) {
    return { ok: false, erro: 'pedido já tem fornecedor aceito' }
  }

  const { data: fornecedor } = await supabase
    .from('leads_fornecedores')
    .select('*')
    .eq('id', fornecedorId)
    .single()
  if (!fornecedor) return { ok: false, erro: 'fornecedor não encontrado' }

  const ofertaId = await dispararOfertaNormal(
    pedido as Pedido,
    fornecedor as Fornecedor
  )
  if (!ofertaId) {
    return { ok: false, erro: 'falha ao inserir oferta' }
  }
  return { ok: true, ofertaId }
}
