// app/admin/(painel)/pedidos/page.tsx
// ============================================================================
// /admin/pedidos — pedidos em execução agrupados em 5 abas mutuamente exclusivas.
//
// Server Component. Carrega SÓ os dados da aba ativa (sem custo das outras).
//
// Abas (precedência p/ exclusividade — um pedido = uma aba):
//   1. em_oferta              → tem oferta 'enviada' (maior precedência)
//   2. em_negociacao          → pedido.status='em_negociacao' (fornecedor aceito)
//   3. precisa_atencao        → órfão ativo OU buscando sem oferta/sem agendamento;
//                               exclui quem tem oferta enviada (vai p/ em_oferta)
//   4. aguardando_expediente  → buscar_apos futuro; exclui órfão ativo (vai p/ precisa_atencao)
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

type PedidoBase = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string
  nome: string
  whatsapp: string
  criado_em: string
}

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

type LinhaPrecisaAtencao = {
  pedido: PedidoBase
  /** prioridade do órfão (0-100) ou null se ainda não registrado como órfão */
  prioridade: number | null
  motivo: string
  ehOrfao: boolean
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

  // Carrega só dados da aba ativa
  let conteudo: React.ReactNode
  let total = 0

  if (aba === 'em_oferta') {
    const dados = await carregarEmOferta()
    total = dados.length
    conteudo =
      dados.length === 0 ? (
        <EmptyState texto="Nenhum pedido com oferta ativa no momento." />
      ) : (
        <TabelaEmOferta dados={dados} agoraMs={agoraMs} />
      )
  } else if (aba === 'em_negociacao') {
    const dados = await carregarEmNegociacao()
    total = dados.length
    conteudo =
      dados.length === 0 ? (
        <EmptyState texto="Nenhum pedido em negociação." />
      ) : (
        <TabelaEmNegociacao dados={dados} agoraMs={agoraMs} />
      )
  } else if (aba === 'precisa_atencao') {
    const dados = await carregarPrecisaAtencao(agoraMs)
    total = dados.length
    conteudo =
      dados.length === 0 ? (
        <EmptyState texto="Nenhum pedido precisando de atenção. Painel limpo." />
      ) : (
        <TabelaPrecisaAtencao dados={dados} agoraMs={agoraMs} />
      )
  } else if (aba === 'aguardando_expediente') {
    const dados = await carregarAguardandoExpediente(agoraMs)
    total = dados.length
    conteudo =
      dados.length === 0 ? (
        <EmptyState texto="Nenhum pedido aguardando expediente." />
      ) : (
        <TabelaAguardando dados={dados} agoraMs={agoraMs} />
      )
  } else {
    const dados = await carregarConcluidos()
    total = dados.length
    conteudo =
      dados.length === 0 ? (
        <EmptyState texto="Nenhum pedido concluído ainda." />
      ) : (
        <TabelaConcluidos dados={dados} agoraMs={agoraMs} />
      )
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

/** pedido_ids com oferta 'enviada' ativa. Em oferta tem a maior precedência:
 *  qualquer aba "abaixo" exclui esses pedidos. */
async function pedidosComOfertaEnviada(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('ofertas')
    .select('pedido_id')
    .eq('status', 'enviada')
  return new Set(
    ((data ?? []) as Array<{ pedido_id: string }>).map((o) => o.pedido_id)
  )
}

/** pedido_ids com órfão ATIVO (aberto/em_captacao). Precisa-de-atenção vence
 *  Aguardando-expediente. */
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
  // Q1: ofertas enviadas (ordenadas por enviada_em ASC = mais antiga primeiro)
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

  // Q2 e Q3 em paralelo
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

  // Filtra ofertas cujo pedido ainda está não-atribuído + mantém ordem da Q1
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
  // Q1: pedidos em negociação
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

  // Q2 e Q3 em paralelo
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

  // Sort por respondida_em DESC. null vai pro final.
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

/** Precisa de atenção = órfão ativo (via vw) UNIÃO buscando-sem-oferta-sem-
 *  agendamento, dedup por pedido_id (órfão vence, traz prioridade/motivo),
 *  excluindo quem tem oferta enviada (precedência: Em oferta). */
async function carregarPrecisaAtencao(
  agoraMs: number
): Promise<LinhaPrecisaAtencao[]> {
  const agoraIso = new Date(agoraMs).toISOString()
  const comOferta = await pedidosComOfertaEnviada()

  // (1) órfãos ativos — via view (já traz dados do pedido + prioridade/motivo).
  //     Filtra pedido_status='buscando_fornecedor': um órfão stale num pedido já
  //     aceito (em_negociacao) NÃO pode aparecer aqui (senão duplica com a aba
  //     "Em negociação"). Garante exclusividade independente da limpeza do órfão.
  const { data: orfaosRaw } = await supabaseAdmin
    .from('vw_pedidos_orfaos_admin')
    .select(
      'pedido_id, tipo, quantidade, estado, nome, whatsapp, pedido_criado_em, prioridade, motivo_orfao, status_orfao'
    )
    .in('status_orfao', ['aberto', 'em_captacao'])
    .eq('pedido_status', 'buscando_fornecedor')

  const orfaos = (orfaosRaw ?? []) as Array<{
    pedido_id: string
    tipo: string
    quantidade: number | null
    estado: string
    nome: string
    whatsapp: string
    pedido_criado_em: string
    prioridade: number
    motivo_orfao: string | null
  }>

  // (2) buscando "preso": status=buscando_fornecedor, sem fornecedor aceito,
  //     buscar_apos nulo/passado (não é "aguardando expediente").
  const { data: stuckRaw } = await supabaseAdmin
    .from('pedidos')
    .select('id, tipo, quantidade, estado, nome, whatsapp, criado_em')
    .eq('status', 'buscando_fornecedor')
    .is('fornecedor_aceito_id', null)
    .or(`buscar_apos.is.null,buscar_apos.lte.${agoraIso}`)

  const stuck = (stuckRaw ?? []) as PedidoBase[]

  // União dedup por pedido_id, excluindo quem tem oferta enviada.
  const map = new Map<string, LinhaPrecisaAtencao>()

  for (const o of orfaos) {
    if (comOferta.has(o.pedido_id)) continue
    map.set(o.pedido_id, {
      pedido: {
        id: o.pedido_id,
        tipo: o.tipo,
        quantidade: o.quantidade,
        estado: o.estado,
        nome: o.nome,
        whatsapp: o.whatsapp,
        criado_em: o.pedido_criado_em,
      },
      prioridade: o.prioridade,
      motivo: o.motivo_orfao ?? 'sem fornecedor',
      ehOrfao: true,
    })
  }

  for (const p of stuck) {
    if (comOferta.has(p.id)) continue
    if (map.has(p.id)) continue // já entrou como órfão (vence)
    map.set(p.id, {
      pedido: p,
      prioridade: null,
      motivo: 'buscando, sem oferta ativa',
      ehOrfao: false,
    })
  }

  // Ordena: maior prioridade primeiro (null = ainda não pontuado, vai depois),
  // depois mais antigo primeiro.
  return Array.from(map.values()).sort((a, b) => {
    const pa = a.prioridade ?? -1
    const pb = b.prioridade ?? -1
    if (pb !== pa) return pb - pa
    return (
      new Date(a.pedido.criado_em).getTime() -
      new Date(b.pedido.criado_em).getTime()
    )
  })
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
// Sub-components: tabelas por aba
// ============================================================================

function TabelaEmOferta({
  dados,
  agoraMs,
}: {
  dados: LinhaEmOferta[]
  agoraMs: number
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
}: {
  dados: LinhaEmNegociacao[]
  agoraMs: number
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
}: {
  dados: LinhaPrecisaAtencao[]
  agoraMs: number
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
                {l.prioridade !== null ? l.prioridade : '—'}
              </Td>
              <Td className="text-gray-600 text-xs max-w-[220px]">{l.motivo}</Td>
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
}: {
  dados: LinhaAguardando[]
  agoraMs: number
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Retoma em</Th>
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
}: {
  dados: LinhaConcluido[]
  agoraMs: number
}) {
  return (
    <TabelaWrapper>
      <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
        <tr>
          <Th>Pedido</Th>
          <Th>Cliente</Th>
          <Th>Idade pedido</Th>
          <Th>Fornecedor</Th>
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
