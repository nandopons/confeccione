// app/admin/orfaos/page.tsx
// ============================================================================
// Painel admin de pedidos órfãos.
// Server Component lendo via supabaseAdmin + vw_pedidos_orfaos_admin.
//
// Defesa em profundidade: middleware bloqueia rota sem cookie válido,
// mas validamos de novo aqui (eAdminLogado). Custo zero.
//
// Filtro de status via ?status= na URL. Default 'aberto'.
// Mensagem opcional ?detectados=N após "Detectar agora".
// ============================================================================

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import {
  listarOrfaos,
  type StatusOrfao,
  type VwPedidoOrfaoAdmin,
} from '@/app/lib/orfaos'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { linkWhatsApp } from '@/app/lib/phone'
import { AcoesOrfao } from './AcoesOrfao'
import { BotaoDetectar } from './BotaoDetectar'

type FiltroStatus = StatusOrfao | 'todos'

const STATUS_QS: Array<{ valor: FiltroStatus; label: string }> = [
  { valor: 'aberto', label: 'Aberto' },
  { valor: 'em_captacao', label: 'Em captação' },
  { valor: 'resolvido', label: 'Resolvido' },
  { valor: 'descartado', label: 'Descartado' },
  { valor: 'todos', label: 'Todos' },
]

export default async function AdminOrfaosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  if (!(await eAdminLogado())) {
    redirect('/admin/login?proximo=/admin/orfaos')
  }

  const params = await searchParams
  const statusFiltro: FiltroStatus = STATUS_QS.some(
    (s) => s.valor === params.status
  )
    ? (params.status as FiltroStatus)
    : 'aberto'

  const orfaos = await listarOrfaos({ status: statusFiltro })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Pedidos órfãos
            </h1>
            <p className="text-sm text-gray-500">
              Confeccione · admin
            </p>
          </div>
          <BotaoDetectar />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tabs de filtro */}
        <nav className="flex gap-2 mb-4 flex-wrap">
          {STATUS_QS.map((s) => {
            const ativo = statusFiltro === s.valor
            return (
              <a
                key={s.valor}
                href={`/admin/orfaos?status=${s.valor}`}
                className={
                  'text-sm px-3 py-1.5 rounded-md font-medium ' +
                  (ativo
                    ? 'bg-gray-900 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100')
                }
              >
                {s.label}
              </a>
            )
          })}
        </nav>

        {/* Tabela ou empty state */}
        {orfaos.length === 0 ? (
          <EmptyState filtro={statusFiltro} />
        ) : (
          <Tabela orfaos={orfaos} />
        )}

        {/* Contagem total */}
        {orfaos.length > 0 && (
          <p className="mt-4 text-xs text-gray-500">
            {orfaos.length} {orfaos.length === 1 ? 'órfão' : 'órfãos'} no filtro atual
          </p>
        )}
      </main>
    </div>
  )
}

// ===========================================================================
// Sub-components (server-side puros — sem state)
// ===========================================================================

function EmptyState({ filtro }: { filtro: FiltroStatus }) {
  const msg =
    filtro === 'aberto'
      ? 'Nenhum pedido órfão aberto. Painel limpo.'
      : filtro === 'todos'
        ? 'Nenhum órfão registrado ainda.'
        : `Nenhum órfão com status "${filtro}".`

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500 text-sm">
      {msg}
    </div>
  )
}

function Tabela({ orfaos }: { orfaos: VwPedidoOrfaoAdmin[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
            <tr>
              <Th>Prioridade</Th>
              <Th>Pedido</Th>
              <Th>Cliente</Th>
              <Th>Idade</Th>
              <Th>Status</Th>
              <Th>Motivo</Th>
              <Th>Notas / Resp.</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-sm">
            {orfaos.map((o) => (
              <Linha key={o.orfao_id} o={o} />
            ))}
          </tbody>
        </table>
      </div>
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

function Linha({ o }: { o: VwPedidoOrfaoAdmin }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <BadgePrioridade prioridade={o.prioridade} />
      </td>
      <td className="px-3 py-2.5">
        <div className="font-medium text-gray-900">
          {tipoLabel[o.tipo] ?? o.tipo}
        </div>
        <div className="text-xs text-gray-500">
          {o.quantidade !== null ? `${o.quantidade} peças` : 'qtd não informada'}
          {' · '}
          {o.estado}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="text-gray-900">{o.nome}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {/* Número como texto selecionável (não link) — evita abrir
              conversa por click acidental ao navegar a lista. */}
          <span className="text-xs text-gray-600 select-text">
            {o.whatsapp}
          </span>
          <a
            href={linkWhatsApp(o.whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
            title={`Abrir WhatsApp · ${o.nome}`}
            aria-label={`Abrir WhatsApp ${o.nome}`}
            className="text-xs px-1.5 py-0.5 bg-green-50 hover:bg-green-100 rounded text-green-700 leading-none"
          >
            💬
          </a>
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
        {formatarIdade(o.idade_horas)}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <BadgeStatus status={o.status_orfao} />
      </td>
      <td className="px-3 py-2.5 text-gray-600 text-xs max-w-[200px]">
        {o.motivo_orfao ?? '—'}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[180px]">
        {o.responsavel_captacao && (
          <div className="font-medium text-gray-700">
            {o.responsavel_captacao}
          </div>
        )}
        {o.notas_admin ? o.notas_admin : !o.responsavel_captacao && '—'}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <AcoesOrfao orfaoId={o.orfao_id} statusAtual={o.status_orfao} />
      </td>
    </tr>
  )
}

function BadgePrioridade({ prioridade }: { prioridade: number }) {
  const cor =
    prioridade >= 80
      ? 'bg-red-100 text-red-800'
      : prioridade >= 50
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-green-100 text-green-800'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cor}`}
    >
      {prioridade}
    </span>
  )
}

function BadgeStatus({ status }: { status: StatusOrfao }) {
  const map: Record<StatusOrfao, { cor: string; label: string }> = {
    aberto: { cor: 'bg-blue-100 text-blue-800', label: 'Aberto' },
    em_captacao: { cor: 'bg-yellow-100 text-yellow-800', label: 'Em captação' },
    resolvido: { cor: 'bg-green-100 text-green-800', label: 'Resolvido' },
    descartado: { cor: 'bg-gray-200 text-gray-700', label: 'Descartado' },
  }
  const { cor, label } = map[status]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cor}`}
    >
      {label}
    </span>
  )
}

function formatarIdade(horas: number): string {
  if (horas < 1) return '< 1h'
  if (horas < 24) return `${Math.floor(horas)}h`
  const dias = Math.floor(horas / 24)
  const restoHoras = Math.floor(horas % 24)
  return restoHoras > 0 ? `${dias}d ${restoHoras}h` : `${dias}d`
}
