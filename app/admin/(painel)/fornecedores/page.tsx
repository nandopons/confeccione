// app/admin/(painel)/fornecedores/page.tsx
// ============================================================================
// /admin/fornecedores — lista de fornecedores cadastrados com info operacional.
//
// Server Component. Filtro por status via ?status (default = 'ativo').
// Aba "Todos" = SEM filtro (mostra ativo, pausado, aguardando_contato e
// quaisquer outros valores que apareçam no futuro).
//
// Sem ações de mutation nesta Fase 1 — só leitura. Pausar/reativar fica
// pra Fase 2 (ver memory project_confeccione_admin_pos_fase1).
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { formatarDuracaoRelativa } from '@/app/lib/admin-saude'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { ColunaContato } from '../ColunaContato'

// ============================================================================
// Tipos e constantes
// ============================================================================

type FiltroStatus = 'ativo' | 'pausado' | 'todos'

const TABS: Array<{ valor: FiltroStatus; label: string }> = [
  { valor: 'ativo', label: 'Ativo' },
  { valor: 'pausado', label: 'Pausado' },
  { valor: 'todos', label: 'Todos' },
]

const TABS_VALIDOS = TABS.map((t) => t.valor) as readonly FiltroStatus[]

const RAIO_LABEL: Record<string, string> = {
  nacional: 'Nacional',
  estado: 'Estado',
  regiao: 'Região',
}

type LinhaFornecedor = {
  id: string
  nome: string | null
  whatsapp: string
  estado: string
  cidade: string | null
  plano: string
  status: string
  tipos_produto: string[]
  pedido_minimo: number
  raio_atendimento: string
  ultimo_lead_em: string | null
  criado_em: string
}

// ============================================================================
// Page
// ============================================================================

export default async function AdminFornecedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  if (!(await eAdminLogado())) {
    redirect('/admin/login?proximo=/admin/fornecedores')
  }

  const params = await searchParams
  const filtro: FiltroStatus = TABS_VALIDOS.includes(
    params.status as FiltroStatus
  )
    ? (params.status as FiltroStatus)
    : 'ativo'

  const agoraMs = Date.now()
  const fornecedores = await carregarFornecedores(filtro)

  const emptyTexto =
    filtro === 'ativo'
      ? 'Nenhum fornecedor ativo no momento.'
      : filtro === 'pausado'
        ? 'Nenhum fornecedor pausado.'
        : 'Nenhum fornecedor cadastrado.'

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Fornecedores
      </h2>

      {/* Tabs */}
      <nav className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((t) => {
          const ativo = filtro === t.valor
          return (
            <a
              key={t.valor}
              href={`/admin/fornecedores?status=${t.valor}`}
              className={
                'text-sm px-3 py-1.5 rounded-md font-medium ' +
                (ativo
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100')
              }
            >
              {t.label}
            </a>
          )
        })}
      </nav>

      {fornecedores.length === 0 ? (
        <EmptyState texto={emptyTexto} />
      ) : (
        <Tabela fornecedores={fornecedores} agoraMs={agoraMs} />
      )}

      {fornecedores.length > 0 && (
        <p className="mt-4 text-xs text-gray-500">
          {fornecedores.length}{' '}
          {fornecedores.length === 1 ? 'fornecedor' : 'fornecedores'} no filtro
          atual
        </p>
      )}
    </div>
  )
}

// ============================================================================
// Loader
// ============================================================================

async function carregarFornecedores(
  filtro: FiltroStatus
): Promise<LinhaFornecedor[]> {
  let builder = supabaseAdmin
    .from('leads_fornecedores')
    .select(
      'id, nome, whatsapp, estado, cidade, plano, status, ' +
        'tipos_produto, pedido_minimo, raio_atendimento, ' +
        'ultimo_lead_em, criado_em'
    )
    .order('ultimo_lead_em', { ascending: false, nullsFirst: false })

  if (filtro === 'ativo' || filtro === 'pausado') {
    builder = builder.eq('status', filtro)
  }
  // 'todos' = sem filtro de status → mostra tudo, inclusive aguardando_contato

  const { data, error } = await builder

  if (error) {
    console.error('[admin/fornecedores] erro ao listar:', error)
    return []
  }

  // Cast via unknown porque o builder reatribuído condicionalmente faz o TS
  // inferir um tipo de retorno mais amplo (incluindo o GenericStringError do
  // supabase-js que não overlap com LinhaFornecedor).
  return (data ?? []) as unknown as LinhaFornecedor[]
}

// ============================================================================
// Sub-components
// ============================================================================

function Tabela({
  fornecedores,
  agoraMs,
}: {
  fornecedores: LinhaFornecedor[]
  agoraMs: number
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
            <tr>
              <Th>Contato</Th>
              <Th>Plano</Th>
              <Th>Local</Th>
              <Th>Verticais</Th>
              <Th>Pedido min</Th>
              <Th>Raio</Th>
              <Th>Último lead</Th>
              <Th>Cadastrado há</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-sm">
            {fornecedores.map((f) => (
              <LinhaTr key={f.id} f={f} agoraMs={agoraMs} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LinhaTr({
  f,
  agoraMs,
}: {
  f: LinhaFornecedor
  agoraMs: number
}) {
  const nomeExibido = f.nome ?? '(sem nome)'
  const local = f.cidade ? `${f.cidade} / ${f.estado}` : f.estado
  const ultimoLeadStr = f.ultimo_lead_em
    ? formatarDuracaoRelativa(new Date(f.ultimo_lead_em).getTime(), agoraMs)
    : 'nunca'
  const cadastradoStr = formatarDuracaoRelativa(
    new Date(f.criado_em).getTime(),
    agoraMs
  )

  return (
    <tr className="hover:bg-gray-50">
      <Td>
        <ColunaContato nome={nomeExibido} whatsapp={f.whatsapp} />
      </Td>
      <Td>
        <BadgePlano plano={f.plano} />
      </Td>
      <Td className="text-gray-700">{local}</Td>
      <Td>
        <Verticais tipos={f.tipos_produto} />
      </Td>
      <Td className="whitespace-nowrap text-gray-700">
        {f.pedido_minimo} peças
      </Td>
      <Td className="whitespace-nowrap text-gray-700">
        {RAIO_LABEL[f.raio_atendimento] ?? f.raio_atendimento}
      </Td>
      <Td className="whitespace-nowrap text-gray-700">{ultimoLeadStr}</Td>
      <Td className="whitespace-nowrap text-gray-700">{cadastradoStr}</Td>
      <Td className="whitespace-nowrap">
        <BadgeStatusFornecedor status={f.status} />
      </Td>
    </tr>
  )
}

function BadgeStatusFornecedor({ status }: { status: string }) {
  const config: Record<string, { cor: string; label: string }> = {
    ativo: { cor: 'bg-green-100 text-green-800', label: 'Ativo' },
    pausado: { cor: 'bg-gray-200 text-gray-700', label: 'Pausado' },
    aguardando_contato: {
      cor: 'bg-blue-100 text-blue-800',
      label: 'Aguardando',
    },
  }
  const def = config[status] ?? {
    cor: 'bg-gray-100 text-gray-500',
    label: status,
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${def.cor}`}
    >
      {def.label}
    </span>
  )
}

function BadgePlano({ plano }: { plano: string }) {
  const premium = plano === 'pro' || plano === 'enterprise'
  const cor = premium
    ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${cor}`}
    >
      {plano}
    </span>
  )
}

function Verticais({ tipos }: { tipos: string[] }) {
  if (!tipos || tipos.length === 0) {
    return <span className="text-xs text-gray-400">—</span>
  }
  const MAX = 3
  const visiveis = tipos.slice(0, MAX)
  const extras = tipos.length - MAX
  const labelExtras =
    extras > 0
      ? tipos
          .slice(MAX)
          .map((t) => tipoLabel[t] ?? t)
          .join(', ')
      : ''

  return (
    <div className="flex flex-wrap gap-1">
      {visiveis.map((t) => (
        <span
          key={t}
          className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-700 whitespace-nowrap"
        >
          {tipoLabel[t] ?? t}
        </span>
      ))}
      {extras > 0 && (
        <span
          title={labelExtras}
          className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-500"
        >
          +{extras}
        </span>
      )}
    </div>
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
