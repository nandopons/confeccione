// app/admin/(painel)/page.tsx
// ============================================================================
// Dashboard /admin — semáforo de saúde + 4 cards resumo.
//
// Server Component. Lê métricas via supabaseAdmin (8 queries paralelas + 1
// sequencial dependente). Determinismo: agoraMs capturado UMA vez no início
// do render e propagado pras funções puras de admin-saude.ts.
// ============================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { STATUS_PEDIDO_DETECTAVEL } from '@/app/lib/orfaos'
import {
  calcularStatusSemaforo,
  mensagemSemaforo,
  type SemaforoMetricas,
  type SemaforoStatus,
} from '@/app/lib/admin-saude'

export default async function AdminDashboardPage() {
  if (!(await eAdminLogado())) {
    redirect('/admin/login')
  }

  const agoraMs = Date.now()
  const umaHoraAtras = new Date(agoraMs - 60 * 60 * 1000).toISOString()
  const oitoHorasAtras = new Date(agoraMs - 8 * 60 * 60 * 1000).toISOString()
  const agoraIso = new Date(agoraMs).toISOString()

  // ─────────────────────────────────────────────────────────────
  // 8 queries em paralelo
  // ─────────────────────────────────────────────────────────────
  const [
    resUltimaExec,
    resOrfaosNovos,
    resOfertasEnviadas,
    resPedidosElegiveis8h,
    resPedidosNaoAtribuidos,
    resCardNegociacao,
    resCardAguardando,
    resCardOrfaosAtivos,
  ] = await Promise.all([
    supabaseAdmin
      .from('cron_execucoes')
      .select('executado_em')
      .eq('nome_cron', 'detectar-gaps')
      .order('executado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabaseAdmin
      .from('pedidos_orfaos')
      .select('id', { count: 'exact', head: true })
      .gt('criado_em', umaHoraAtras),

    supabaseAdmin
      .from('ofertas')
      .select('pedido_id, enviada_em')
      .eq('status', 'enviada'),

    supabaseAdmin
      .from('pedidos')
      .select('id')
      .in('status', STATUS_PEDIDO_DETECTAVEL as string[])
      .is('fornecedor_aceito_id', null)
      .lt('criado_em', oitoHorasAtras)
      .or(`buscar_apos.is.null,buscar_apos.lte.${agoraIso}`),

    supabaseAdmin
      .from('pedidos')
      .select('id')
      .in('status', STATUS_PEDIDO_DETECTAVEL as string[])
      .is('fornecedor_aceito_id', null),

    supabaseAdmin
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'em_negociacao'),

    supabaseAdmin
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .gt('buscar_apos', agoraIso)
      .in('status', STATUS_PEDIDO_DETECTAVEL as string[])
      .is('fornecedor_aceito_id', null),

    supabaseAdmin
      .from('pedidos_orfaos')
      .select('id', { count: 'exact', head: true })
      .in('status_orfao', ['aberto', 'em_captacao']),
  ])

  // ─────────────────────────────────────────────────────────────
  // Pós-processamento em JS
  // ─────────────────────────────────────────────────────────────
  const ultimaExecucaoMs =
    resUltimaExec.data
      ? new Date(
          (resUltimaExec.data as { executado_em: string }).executado_em
        ).getTime()
      : null
  const minutosDesdeUltimoCron =
    ultimaExecucaoMs !== null
      ? Math.floor((agoraMs - ultimaExecucaoMs) / 60_000)
      : null

  const orfaosNovosNestaHora = resOrfaosNovos.count ?? 0

  const ofertasEnviadas = (resOfertasEnviadas.data ?? []) as Array<{
    pedido_id: string
    enviada_em: string
  }>
  const corte24hMs = agoraMs - 24 * 60 * 60 * 1000
  const corte48hMs = agoraMs - 48 * 60 * 60 * 1000
  const ofertasEnviadasMais24h = ofertasEnviadas.filter(
    (o) => new Date(o.enviada_em).getTime() < corte24hMs
  ).length
  const ofertasEnviadasMais48h = ofertasEnviadas.filter(
    (o) => new Date(o.enviada_em).getTime() < corte48hMs
  ).length

  // Q4b sequencial — só roda se houver candidatos
  const pedidosElegiveis = (resPedidosElegiveis8h.data ?? []) as Array<{
    id: string
  }>
  let pedidosSemOfertaMais8h = 0
  if (pedidosElegiveis.length > 0) {
    const ids = pedidosElegiveis.map((p) => p.id)
    const { data: ofertasDosElegiveis } = await supabaseAdmin
      .from('ofertas')
      .select('pedido_id')
      .in('pedido_id', ids)
    const idsComOferta = new Set(
      (ofertasDosElegiveis ?? []).map(
        (o) => (o as { pedido_id: string }).pedido_id
      )
    )
    pedidosSemOfertaMais8h = pedidosElegiveis.filter(
      (p) => !idsComOferta.has(p.id)
    ).length
  }

  // Card "Em oferta": interseção em JS reusando ofertasEnviadas + pedidos
  // não atribuídos.
  const pedidosNaoAtribuidos = (resPedidosNaoAtribuidos.data ?? []) as Array<{
    id: string
  }>
  const idsComOfertaEnviada = new Set(
    ofertasEnviadas.map((o) => o.pedido_id)
  )
  const cardEmOferta = pedidosNaoAtribuidos.filter((p) =>
    idsComOfertaEnviada.has(p.id)
  ).length

  // ─────────────────────────────────────────────────────────────
  // Cálculo do semáforo (puro)
  // ─────────────────────────────────────────────────────────────
  const metricas: SemaforoMetricas = {
    minutosDesdeUltimoCron,
    orfaosNovosNestaHora,
    ofertasEnviadasMais24h,
    ofertasEnviadasMais48h,
    pedidosSemOfertaMais8h,
  }
  const status = calcularStatusSemaforo(metricas)
  const mensagem = mensagemSemaforo(status, metricas, agoraMs, ultimaExecucaoMs)

  // ─────────────────────────────────────────────────────────────
  // Cards
  // ─────────────────────────────────────────────────────────────
  const cards: Array<{ label: string; valor: number; href: string }> = [
    {
      label: 'Em oferta',
      valor: cardEmOferta,
      href: '/admin/pedidos?aba=em_oferta',
    },
    {
      label: 'Em negociação',
      valor: resCardNegociacao.count ?? 0,
      href: '/admin/pedidos?aba=em_negociacao',
    },
    {
      label: 'Aguardando expediente',
      valor: resCardAguardando.count ?? 0,
      href: '/admin/pedidos?aba=aguardando_expediente',
    },
    {
      label: 'Órfãos ativos',
      valor: resCardOrfaosAtivos.count ?? 0,
      href: '/admin/orfaos',
    },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Semaforo status={status} mensagem={mensagem} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
          >
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              {c.label}
            </div>
            <div className="text-4xl font-bold text-gray-900 mt-2">
              {c.valor}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// Sub-component: Semáforo
// ===========================================================================

function Semaforo({
  status,
  mensagem,
}: {
  status: SemaforoStatus
  mensagem: string
}) {
  const config: Record<
    SemaforoStatus,
    { emoji: string; titulo: string; bg: string; text: string }
  > = {
    verde:    { emoji: '🟢', titulo: 'Sistema saudável', bg: 'bg-green-100',  text: 'text-green-900' },
    amarelo:  { emoji: '🟡', titulo: 'Atenção',          bg: 'bg-yellow-100', text: 'text-yellow-900' },
    vermelho: { emoji: '🔴', titulo: 'Sistema travado',  bg: 'bg-red-100',    text: 'text-red-900' },
  }
  const { emoji, titulo, bg, text } = config[status]

  return (
    <div className={`${bg} ${text} px-5 py-4 rounded-lg mb-6`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xl">{emoji}</span>
        <h2 className="text-lg font-semibold">{titulo}</h2>
      </div>
      <p className="text-sm">{mensagem}</p>
    </div>
  )
}
