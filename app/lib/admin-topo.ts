// app/lib/admin-topo.ts
// ============================================================================
// OS QUATRO NÚMEROS DO TOPO DO /admin — 11/09/2026.
//
// O dashboard media a era morta: "Em negociação" contava `pedidos` (última
// linha em 08/06), "Precisa de atenção" cruzava `pedidos` + `ofertas` (última
// em 28/06), e "Em oferta" e "Aguardando expediente" mostravam zero — zero
// porque a tabela parou, não porque não havia trabalho. Enquanto isso a era
// viva tinha 225 pedidos e 36 ofertas no ar, nenhum deles no topo da tela.
//
// O CRITÉRIO destes quatro: às 8h, sozinho, o Fernando não precisa saber o
// tamanho do negócio — precisa saber o que perde hoje se não agir. Então só
// entra número com relógio correndo ou com alguém do outro lado esperando.
//
// O que ficou de fora de propósito: "entrou nas últimas 24h" (não pede ação),
// `captado` e `pedido_completo` (estoque de entrada, 36 e 63 dias de média —
// é tela de funil, não topo de operação) e contagens brutas por etapa, que
// repetiriam o erro do dashboard antigo: número grande que não pede nada.
//
// Toda consulta aqui captura `error` e estoura. Card que mostra 0 porque a
// consulta falhou é exatamente o "verde falso" que fez este arquivo existir.
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { configCaptacao } from './captacao-pedido'

/** Oferta parada há mais que isto já merece cobrança. */
const DIAS_OFERTA_PARADA = 3

export type NumeroTopo = {
  label: string
  valor: number
  /** Uma linha dizendo o que fazer com o número, não o que ele é. */
  nota: string
  href: string
}

export async function numerosDoTopo(): Promise<NumeroTopo[]> {
  const { config } = await configCaptacao()

  const paradaDesde = new Date(Date.now() - DIAS_OFERTA_PARADA * 86400_000).toISOString()

  const [rEsperando, rOfertaParada, rOrcamento, semFornecedor] = await Promise.all([
    // 1) Conversa que saiu do Luigi e está com gente. Ninguém além do Fernando
    //    destrava isso — por isso é o primeiro, e por isso quase sempre é zero.
    supabaseAdmin.from('wa_conversas').select('id', { count: 'exact', head: true }).not('luigi_escalado_em', 'is', null),

    // 2) Confecção recebeu o pedido e não respondeu. Como `expira_em` é nulo em
    //    100% das ofertas, nada cancela e nada cobra: o pedido fica travado numa
    //    mão só até alguém olhar. É o maior vazamento silencioso de hoje.
    supabaseAdmin.from('ofertas_pedido_assistente').select('id', { count: 'exact', head: true })
      .eq('status', 'ofertada').lt('criado_em', paradaDesde),

    // 3) Cliente já disse sim e está esperando preço. Depois do #1, é onde a
    //    intenção de compra é mais alta e a espera dói mais.
    supabaseAdmin.from('pedidos_assistente_etapas').select('id', { count: 'exact', head: true }).eq('etapa', 'orcamento_atrasado'),

    // 4) Ver abaixo: a janela vem da config da captação, não de um número solto.
    semFornecedorNaJanela(config.idade_max_dias),
  ])

  if (rEsperando.error) throw new Error(`conversas escaladas: ${rEsperando.error.message}`)
  if (rOfertaParada.error) throw new Error(`ofertas paradas: ${rOfertaParada.error.message}`)
  if (rOrcamento.error) throw new Error(`orçamento atrasado: ${rOrcamento.error.message}`)
  const esperando = rEsperando.count ?? 0
  const ofertaParada = rOfertaParada.count ?? 0
  const orcamentoAtrasado = rOrcamento.count ?? 0

  return [
    {
      label: 'Cliente esperando você',
      valor: esperando,
      nota: esperando === 0 ? 'ninguém na fila humana' : 'o Luigi saiu da conversa — só você destrava',
      href: '/admin/whatsapp',
    },
    {
      label: 'Pedido sem confecção olhando',
      valor: semFornecedor,
      nota: `confirmados nos últimos ${config.idade_max_dias} dias — a fila que a captação trabalha`,
      href: '/admin/funil',
    },
    {
      label: `Oferta parada +${DIAS_OFERTA_PARADA}d`,
      valor: ofertaParada,
      nota: 'confecção não respondeu e a oferta não expira sozinha',
      href: '/admin/pedidos-pagos',
    },
    {
      label: 'Orçamento atrasado',
      valor: orcamentoAtrasado,
      nota: 'cliente já quis comprar e está sem preço',
      href: '/admin/funil',
    },
  ]
}

/**
 * Pedidos em `sem_fornecedor` dentro da janela que a captação de fato trabalha.
 *
 * A janela vem de `configCaptacao().idade_max_dias` de propósito: são 41 em
 * `sem_fornecedor` no total, mas os mais velhos que isso o cron não busca mais
 * — mostrar 41 seria mostrar um número que nenhuma ação sua muda hoje. Card e
 * robô lendo a MESMA config é o que impede os dois de divergirem depois.
 *
 * O filtro é em JS porque a regra é `confirmado_em ?? desde`, igual à de
 * `rodarCaptacaoPedidos`. São dezenas de linhas; não vale um `or=` ilegível.
 */
async function semFornecedorNaJanela(idadeMaxDias: number): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('pedidos_assistente_etapas')
    .select('id, confirmado_em, desde')
    .eq('etapa', 'sem_fornecedor')
  if (error) throw new Error(`pedidos sem fornecedor: ${error.message}`)
  const limite = Date.now() - idadeMaxDias * 86400_000
  return ((data ?? []) as Array<{ confirmado_em: string | null; desde: string }>)
    .filter((p) => new Date(p.confirmado_em ?? p.desde).getTime() >= limite).length
}
