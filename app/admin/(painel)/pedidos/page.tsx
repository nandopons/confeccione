// app/admin/(painel)/pedidos/page.tsx
// ============================================================================
// /admin/pedidos — pedidos em execução em 5 abas mutuamente exclusivas.
// Cada linha tem 👁 Detalhes (ModalDetalhesPedido). A aba "Precisa de atenção"
// consolidou a antiga tela de órfãos (detectar + ações via modal).
//
// Abas (precedência — um pedido = uma aba):
//   1. em_oferta              → tem oferta 'enviada'
//   2. em_negociacao          → pedido.status='em_negociacao'
//   3. precisa_atencao        → órfão ativo (buscando) OU buscando sem oferta/
//                               agendamento; exclui quem tem oferta enviada
//   4. aguardando_expediente  → buscar_apos futuro; exclui órfão ativo
//   5. concluido              → pedido.status='concluido'
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import {
  formatarIdadeHoras,
  formatarDuracaoFutura,
} from '@/app/lib/admin-saude'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { ColunaContato } from '../ColunaContato'
import { BotaoDetectar } from '../orfaos/BotaoDetectar'
import {
  ModalDetalhesPedido,
  type InfoOrfao,
} from '../orfaos/ModalDetalhesOrfao'
import {
  carregarDadosDetalhe,
  type DadosDetalhe,
} from '@/app/lib/admin-pedido-detalhe'
import {
  carregarPrecisaAtencao,
  type PedidoBase,
  type LinhaPrecisaAtencao,
} from '@/app/lib/precisa-atencao'

// ============================================================================
// Tipos e constantes
// ============================================================================

type Aba =
  | 'em_oferta'
  | 'em_negociacao'
  | 'precisa_atencao'
  | 'aguardando_expediente'
  | 'concluido'

const ABAS: Array<{ valor: Aba; label: string }> = [
  { valor: 'em_oferta', label: 'Em oferta' },
  { valor: 'em_negociacao', label: 'Em negociação' },
  { valor: 'precisa_atencao', label: 'Precisa de atenção' },
  { valor: 'aguardando_expediente', label: 'Aguardando expediente' },
  { valor: 'concluido', label: 'Concluídos' },
]

const ABAS_VALIDAS = ABAS.map((a) => a.valor) as readonly Aba[]

type LinhaEmOferta = {
  pedido: PedidoBase
  oferta_enviada_em: string
  fornecedor_nome: string
}

type LinhaEmNegociacao = {
  pedido: PedidoBase
  fornecedor_nome: string
  respondida_em: string | null
}

type LinhaAguardando = {
  pedido: PedidoBase
  buscar_apos: string
}

type LinhaConcluido = {
  pedido: PedidoBase
  fornecedor_nome: string
}

// ============================================================================
// Page
// ============================================================================

export default async function AdminPedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>
}) {
  if (!(await eAdminLogado())) {
    redirect('/admin/login?proximo=/admin/pedidos')
  }

  const params = await searchParams
  const aba: Aba = ABAS_VALIDAS.includes(params.aba as Aba)
    ? (params.aba as Aba)
    : 'em_oferta'

  const agoraMs = Date.now()

  // Carrega só dados da aba ativa + o detalhe (modal) pros pedidos exibidos.
  let conteudo: React.ReactNode
  let total = 0

  if (aba === 'em_oferta') {
    const dados = await carregarEmOferta()
    total = dados.length
    if (dados.length === 0) {
      conteudo = <EmptyState texto="Nenhum pedido com oferta ativa no momento." />
    } else {
      const detalhe = await carregarDadosDetalhe(dados.map((d) => d.pedido.id))
      conteudo = <TabelaEmOferta dados={dados} agoraMs={agoraMs} detalhe={detalhe} />
    }
  } else if (aba === 'em_negociacao') {
    const dados = await carregarEmNegociacao()
    total = dados.length
    if (dados.length === 0) {
      conteudo = <EmptyState texto="Nenhum pedido em negociação." />
    } else {
      const detalhe = await carregarDadosDetalhe(dados.map((d) => d.pedido.id))
      conteudo = (
        <TabelaEmNegociacao dados={dados} agoraMs={agoraMs} detalhe={detalhe} />
      )
    }
  } else if (aba === 'precisa_atencao') {
    const dados = await carregarPrecisaAtencao(agoraMs)
    total = dados.length
    const detalhe =
      dados.length > 0
        ? await carregarDadosDetalhe(dados.map((d) => d.pedido.id))
        : null
    conteudo = (
      <>
        <div className="mb-3 flex justify-end">
          <BotaoDetectar />
        </div>
        {dados.length === 0 || detalhe === null ? (
          <EmptyState texto="Nenhum pedido precisando de atenção. Painel limpo." />
        ) : (
          <TabelaPrecisaAtencao dados={dados} agoraMs={agoraMs} detalhe={detalhe} />
        )}
      </>
    )
  } else if (aba === 'aguardando_expediente') {
    const dados = await carregarAguardandoExpediente(agoraMs)
    total = dados.length
    if (dados.length === 0) {
      conteudo = <EmptyState texto="Nenhum pedido aguardando expediente." />
    } else {
      const detalhe = await carregarDadosDetalhe(dados.map((d) => d.pedido.id))
      conteudo = (
        <TabelaAguardando dados={dados} agoraMs={agoraMs} detalhe={detalhe} />
      )
    }
  } else {
    const dados = await carregarConcluidos()
    total = dados.length
    if (dados.length === 0) {
      conteudo = <EmptyState texto="Nenhum pedido concluído ainda." />
    } else {
      const detalhe = await carregarDadosDetalhe(dados.map((d) => d.pedido.id))
      conteudo = (
        <TabelaConcluidos dados={dados} agoraMs={agoraMs} detalhe={detalhe} />
      )
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Pedidos em execução
      </h2>

      {/* Tabs */}
      <nav className="flex gap-2 mb-4 flex-wrap">
        {ABAS.map((a) => {
          const ativo = aba === a.valor
          return (
            <a
              key={a.valor}
              href={`/admin/pedidos?aba=${a.valor}`}
              className={
                'text-sm px-3 py-1.5 rounded-md font-medium ' +
                (ativo
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100')
              }
            >
              {a.label}
            </a>
          )
        })}
      </nav>

      {conteudo}

      {total > 0 && (
        <p className="mt-4 text-xs text-gray-500">
          {total} {total === 1 ? 'pedido' : 'pedidos'} no filtro atual
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Helpers de conjuntos (precedência entre abas)
// ============================================================================

/** pedido_ids com órfão ATIVO (aberto/em_captacao). */
async function pedidosOrfaoAtivo(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('pedidos_orfaos')
    .select('pedido_id')
    .in('status_orfao', ['aberto', 'em_captacao'])
  return new Set(
    ((data ?? []) as Array<{ pedido_id: string }>).map((o) => o.pedido_id)
  )
}

// ============================================================================
// Loaders — uma função por aba
// ============================================================================

async function carregarEmOferta(): Promise<LinhaEmOferta[]> {
  const { data: ofertasRaw } = await supabaseAdmin
    .from('ofertas')
    .select('id, pedido_id, fornecedor_id, enviada_em')
    .eq('status', 'enviada')
    .order('enviada_em', { ascending: true })

  const ofertas = (ofertasRaw ?? []) as Array<{
    id: string
    pedido_id: string
    fornecedor_id: string
    enviada_em: string
  }>
  if (ofertas.length === 0) return []

  const pedidoIds = Array.from(new Set(ofertas.map((o) => o.pedido_id)))
  const fornecedorIds = Array.from(
    new Set(ofertas.map((o) => o.fornecedor_id))
  )

  const [{ data: pedidosRaw }, { data: fornecedoresRaw }] = await Promise.all([
    supabaseAdmin
      .from('pedidos')
      .select('id, tipo, quantidade, estado, nome, whatsapp, criado_em')
      .in('id', pedidoIds)
      .is('fornecedor_aceito_id', null),
    supabaseAdmin
      .from('leads_fornecedores')
      .select('id, nome')
      .in('id', fornecedorIds),
  ])

  const pedidoMap = new Map(
    ((pedidosRaw ?? []) as PedidoBase[]).map((p) => [p.id, p])
  )
  const fornecedorMap = new Map(
    ((fornecedoresRaw ?? []) as Array<{ id: string; nome: string }>).map(
      (f) => [f.id, f.nome]
    )
  )

  const linhas: LinhaEmOferta[] = []
  for (const o of ofertas) {
    const pedido = pedidoMap.get(o.pedido_id)
    if (!pedido) continue // pedido já foi atribuído depois — pula
    linhas.push({
      pedido,
      oferta_enviada_em: o.enviada_em,
      fornecedor_nome: fornecedorMap.get(o.fornecedor_id) ?? '—',
    })
  }

  return linhas
}

async function carregarEmNegociacao(): Promise<LinhaEmNegociacao[]> {
  const { data: pedidosRaw } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, estado, nome, whatsapp, criado_em, fornecedor_aceito_id'
    )
    .eq('status', 'em_negociacao')

  const pedidos = (pedidosRaw ?? []) as Array<
    PedidoBase & { fornecedor_aceito_id: string | null }
  >
  if (pedidos.length === 0) return []

  const fornecedorIds = Array.from(
    new Set(
      pedidos.map((p) => p.fornecedor_aceito_id).filter(Boolean) as string[]
    )
  )
  const pedidoIds = pedidos.map((p) => p.id)

  const [{ data: fornecedoresRaw }, { data: ofertasAceitasRaw }] =
    await Promise.all([
      fornecedorIds.length > 0
        ? supabaseAdmin
            .from('leads_fornecedores')
            .select('id, nome')
            .in('id', fornecedorIds)
        : Promise.resolve({ data: [] as Array<{ id: string; nome: string }> }),
      supabaseAdmin
        .from('ofertas')
        .select('pedido_id, respondida_em')
        .eq('status', 'aceita')
        .in('pedido_id', pedidoIds),
    ])

  const fornecedorMap = new Map(
    ((fornecedoresRaw ?? []) as Array<{ id: string; nome: string }>).map(
      (f) => [f.id, f.nome]
    )
  )
  const respondidaMap = new Map(
    (
      (ofertasAceitasRaw ?? []) as Array<{
        pedido_id: string
        respondida_em: string | null
      }>
    ).map((o) => [o.pedido_id, o.respondida_em])
  )

  const linhas: LinhaEmNegociacao[] = pedidos
    .map((p) => ({
      pedido: {
        id: p.id,
        tipo: p.tipo,
        quantidade: p.quantidade,
        estado: p.estado,
        nome: p.nome,
        whatsapp: p.whatsapp,
        criado_em: p.criado_em,
      },
      fornecedor_nome:
        (p.fornecedor_aceito_id && fornecedorMap.get(p.fornecedor_aceito_id)) ??
        '—',
      respondida_em: respondidaMap.get(p.id) ?? null,
    }))
    .sort((a, b) => {
      const aMs = a.respondida_em ? new Date(a.respondida_em).getTime() : 0
      const bMs = b.respondida_em ? new Date(b.respondida_em).getTime() : 0
      return bMs - aMs
    })

  return linhas
}

async function carregarAguardandoExpediente(
  agoraMs: number
): Promise<LinhaAguardando[]> {
  const agoraIso = new Date(agoraMs).toISOString()

  // Exclui órfãos ativos (precedência: vão pra "Precisa de atenção").
  const orfaoAtivo = await pedidosOrfaoAtivo()

  const { data } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, nome, whatsapp, criado_em, buscar_apos')
    .gt('buscar_apos', agoraIso)
    .eq('status', 'buscando_fornecedor')
    .is('fornecedor_aceito_id', null)
    .order('buscar_apos', { ascending: true })

  const pedidos = (data ?? []) as Array<PedidoBase & { buscar_apos: string }>
  return pedidos
    .filter((p) => !orfaoAtivo.has(p.id))
    .map((p) => ({
      pedido: {
        id: p.id,
        tipo: p.tipo,
        quantidade: p.quantidade,
        estado: p.estado,
        nome: p.nome,
        whatsapp: p.whatsapp,
        criado_em: p.criado_em,
      },
      buscar_apos: p.buscar_apos,
    }))
}

async function carregarConcluidos(): Promise<LinhaConcluido[]> {
  const { data: pedidosRaw } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, estado, nome, whatsapp, criado_em, fornecedor_aceito_id'
    )
    .eq('status', 'concluido')
    .order('criado_em', { ascending: false })

  const pedidos = (pedidosRaw ?? []) as Array<
    PedidoBase & { fornecedor_aceito_id: string | null }
  >
  if (pedidos.length === 0) return []

  const fornecedorIds = Array.from(
    new Set(
      pedidos.map((p) => p.fornecedor_aceito_id).filter(Boolean) as string[]
    )
  )
  const { data: fornecedoresRaw } =
    fornecedorIds.length > 0
      ? await supabaseAdmin
          .from('leads_fornecedores')
          .select('id, nome')
          .in('id', fornecedorIds)
      : { data: [] as Array<{ id: string; nome: string }> }

  const fornecedorMap = new Map(
    ((fornecedoresRaw ?? []) as Array<{ id: string; nome: string }>).map(
      (f) => [f.id, f.nome]
    )
  )

  return pedidos.map((p) => ({
    pedido: {
      id: p.id,
      tipo: p.tipo,
      quantidade: p.quantidade,
      estado: p.estado,
      nome: p.nome,
      whatsapp: p.whatsapp,
      criado_em: p.criado_em,
    },
    fornecedor_nome:
      (p.fornecedor_aceito_id && fornecedorMap.get(p.fornecedor_aceito_id)) ??
      '—',
  }))
}

// ============================================================================
// Sub-components: célula de detalhes (modal) reusada por todas as abas
// ============================================================================

function CelulaDetalhes({
  pedidoId,
  detalhe,
  orfao,
}: {
  pedidoId: string
  detalhe: DadosDetalhe
  orfao?: InfoOrfao | null
}) {
  const pedido = detalhe.pedidoDetalhe.get(pedidoId)
  if (!pedido) return <span className="text-gray-400 text-xs">—</span>
  return (
    <ModalDetalhesPedido
      pedido={pedido}
      orfao={orfao ?? undefined}
      ofertas={detalhe.ofertasPorPedido.get(pedidoId) ?? []}
      agendadasPorFornecedor={detalhe.agendadasPorFornecedor}
      temCreditoPorFornecedor={detalhe.temCreditoPorFornecedor}
      paresJaAgendados={detalhe.paresJaAgendados}
    />
  )
}

// ============================================================================
// Sub-components: tabelas por aba
// ============================================================================

function TabelaEmOferta({
  dados,
  agoraMs,
  detalhe,
}: {
  dados: LinhaEmOferta[]
  agoraMs: number
  detalhe: DadosDetalhe
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Oferta há</Th>
          <Th>Fornecedor</Th>
          <Th>Detalhes</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 text-sm">
        {dados.map((l) => {
          const idadePedidoH =
            (agoraMs - new Date(l.pedido.criado_em).getTime()) / 3600_000
          const idadeOfertaH =
            (agoraMs - new Date(l.oferta_enviada_em).getTime()) / 3600_000
          return (
            <tr key={l.pedido.id + l.oferta_enviada_em} className="hover:bg-gray-50">
              <Td>
                <PedidoResumo p={l.pedido} />
              </Td>
              <Td>
                <ColunaContato nome={l.pedido.nome} whatsapp={l.pedido.whatsapp} />
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {formatarIdadeHoras(idadePedidoH)}
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {formatarIdadeHoras(idadeOfertaH)}
              </Td>
              <Td className="text-gray-900">{l.fornecedor_nome}</Td>
              <Td>
                <CelulaDetalhes pedidoId={l.pedido.id} detalhe={detalhe} />
              </Td>
            </tr>
          )
        })}
      </tbody>
    </TabelaWrapper>
  )
}

function TabelaEmNegociacao({
  dados,
  agoraMs,
  detalhe,
}: {
  dados: LinhaEmNegociacao[]
  agoraMs: number
  detalhe: DadosDetalhe
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Negociando há</Th>
          <Th>Fornecedor aceito</Th>
          <Th>Detalhes</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 text-sm">
        {dados.map((l) => {
          const idadePedidoH =
            (agoraMs - new Date(l.pedido.criado_em).getTime()) / 3600_000
          const negociandoStr = l.respondida_em
            ? formatarIdadeHoras(
                (agoraMs - new Date(l.respondida_em).getTime()) / 3600_000
              )
            : '—'
          return (
            <tr key={l.pedido.id} className="hover:bg-gray-50">
              <Td>
                <PedidoResumo p={l.pedido} />
              </Td>
              <Td>
                <ColunaContato nome={l.pedido.nome} whatsapp={l.pedido.whatsapp} />
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {formatarIdadeHoras(idadePedidoH)}
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {negociandoStr}
              </Td>
              <Td className="text-gray-900">{l.fornecedor_nome}</Td>
              <Td>
                <CelulaDetalhes pedidoId={l.pedido.id} detalhe={detalhe} />
              </Td>
            </tr>
          )
        })}
      </tbody>
    </TabelaWrapper>
  )
}

function TabelaPrecisaAtencao({
  dados,
  agoraMs,
  detalhe,
}: {
  dados: LinhaPrecisaAtencao[]
  agoraMs: number
  detalhe: DadosDetalhe
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Sinal</Th>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Prioridade</Th>
          <Th>Motivo</Th>
          <Th>Detalhes</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 text-sm">
        {dados.map((l) => {
          const idadePedidoH =
            (agoraMs - new Date(l.pedido.criado_em).getTime()) / 3600_000
          return (
            <tr
              key={l.pedido.id}
              className="hover:bg-gray-50 border-l-4 border-l-red-500"
            >
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
                  ● Precisa de você
                </span>
              </Td>
              <Td>
                <PedidoResumo p={l.pedido} />
              </Td>
              <Td>
                <ColunaContato nome={l.pedido.nome} whatsapp={l.pedido.whatsapp} />
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {formatarIdadeHoras(idadePedidoH)}
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {l.orfao ? l.orfao.prioridade : '—'}
              </Td>
              <Td className="text-gray-600 text-xs max-w-[220px]">{l.motivo}</Td>
              <Td>
                <CelulaDetalhes
                  pedidoId={l.pedido.id}
                  detalhe={detalhe}
                  orfao={l.orfao}
                />
              </Td>
            </tr>
          )
        })}
      </tbody>
    </TabelaWrapper>
  )
}

function TabelaAguardando({
  dados,
  agoraMs,
  detalhe,
}: {
  dados: LinhaAguardando[]
  agoraMs: number
  detalhe: DadosDetalhe
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Retoma em</Th>
          <Th>Detalhes</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 text-sm">
        {dados.map((l) => {
          const idadePedidoH =
            (agoraMs - new Date(l.pedido.criado_em).getTime()) / 3600_000
          const retomaStr = formatarDuracaoFutura(
            new Date(l.buscar_apos).getTime(),
            agoraMs
          )
          return (
            <tr key={l.pedido.id} className="hover:bg-gray-50">
              <Td>
                <PedidoResumo p={l.pedido} />
              </Td>
              <Td>
                <ColunaContato nome={l.pedido.nome} whatsapp={l.pedido.whatsapp} />
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {formatarIdadeHoras(idadePedidoH)}
              </Td>
              <Td className="whitespace-nowrap text-gray-700">{retomaStr}</Td>
              <Td>
                <CelulaDetalhes pedidoId={l.pedido.id} detalhe={detalhe} />
              </Td>
            </tr>
          )
        })}
      </tbody>
    </TabelaWrapper>
  )
}

function TabelaConcluidos({
  dados,
  agoraMs,
  detalhe,
}: {
  dados: LinhaConcluido[]
  agoraMs: number
  detalhe: DadosDetalhe
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Fornecedor</Th>
          <Th>Detalhes</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 text-sm">
        {dados.map((l) => {
          const idadePedidoH =
            (agoraMs - new Date(l.pedido.criado_em).getTime()) / 3600_000
          return (
            <tr key={l.pedido.id} className="hover:bg-gray-50">
              <Td>
                <PedidoResumo p={l.pedido} />
              </Td>
              <Td>
                <ColunaContato nome={l.pedido.nome} whatsapp={l.pedido.whatsapp} />
              </Td>
              <Td className="whitespace-nowrap text-gray-700">
                {formatarIdadeHoras(idadePedidoH)}
              </Td>
              <Td className="text-gray-900">{l.fornecedor_nome}</Td>
              <Td>
                <CelulaDetalhes pedidoId={l.pedido.id} detalhe={detalhe} />
              </Td>
            </tr>
          )
        })}
      </tbody>
    </TabelaWrapper>
  )
}

// ============================================================================
// Sub-components: helpers visuais
// ============================================================================

function TabelaWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          {children}
        </table>
      </div>
    </div>
  )
}

function PedidoResumo({ p }: { p: PedidoBase }) {
  return (
    <>
      <div className="font-medium text-gray-900">
        {tipoLabel[p.tipo] ?? p.tipo}
      </div>
      <div className="text-xs text-gray-500">
        {p.quantidade !== null ? `${p.quantidade} peças` : 'qtd não informada'}
        {' · '}
        {p.estado}
      </div>
    </>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={`px-3 py-2.5 ${className ?? ''}`}>{children}</td>
}

function EmptyState({ texto }: { texto: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500 text-sm">
      {texto}
    </div>
  )
}
