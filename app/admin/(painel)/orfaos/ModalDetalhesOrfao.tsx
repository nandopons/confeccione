'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import { formatarDuracaoRelativa } from '@/app/lib/admin-saude'
import { ColunaContato } from '../ColunaContato'
import type { VwPedidoOrfaoAdmin } from '@/app/lib/orfaos'

export type OfertaHistorico = {
  id: string
  fornecedor_id: string
  /** Status conhecidos hoje: 'enviada' | 'aceita' | 'recusada' | 'expirada'.
   *  Tipado como string pra aceitar valores novos sem mudança de tipo. */
  status: string
  enviada_em: string
  respondida_em: string | null
  fornecedor_nome: string
}

export function ModalDetalhesOrfao({
  orfao,
  ofertas,
  agendadasPorFornecedor,
  temCreditoPorFornecedor,
  paresJaAgendados,
}: {
  orfao: VwPedidoOrfaoAdmin
  ofertas: OfertaHistorico[]
  /** Map<fornecedor_id, count de agendadas pendentes globais do fornecedor> */
  agendadasPorFornecedor: Map<string, number>
  /** Map<fornecedor_id, tem_credito_disponivel> */
  temCreditoPorFornecedor: Map<string, boolean>
  /** Set<`${pedido_id}:${fornecedor_id}`> dos pares com agendada pendente */
  paresJaAgendados: Set<string>
}) {
  const [aberto, setAberto] = useState(false)
  const [agoraMs, setAgoraMs] = useState<number | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Captura agora apenas no client após abrir — sem Date.now() no render
  // pra evitar qualquer chance de hydration mismatch.
  useEffect(() => {
    if (aberto && agoraMs === null) setAgoraMs(Date.now())
  }, [aberto, agoraMs])

  // ESC fecha
  useEffect(() => {
    if (!aberto) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto])

  // Foco inicial no botão Fechar — acessibilidade básica
  useEffect(() => {
    if (aberto) closeButtonRef.current?.focus()
  }, [aberto])

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors whitespace-nowrap"
      >
        👁 Detalhes
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`modal-${orfao.orfao_id}-titulo`}
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        >
          {/* Overlay clicável */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setAberto(false)}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-5">
              <h2
                id={`modal-${orfao.orfao_id}-titulo`}
                className="text-lg font-semibold text-gray-900 mb-1"
              >
                Detalhes do pedido órfão
              </h2>
              <p className="text-xs text-gray-500 mb-5">
                {tipoLabel[orfao.tipo] ?? orfao.tipo} ·{' '}
                {orfao.quantidade !== null
                  ? `${orfao.quantidade} peças`
                  : 'qtd não informada'}{' '}
                · {orfao.estado}
              </p>

              <Secao titulo="Cliente">
                <ColunaContato nome={orfao.nome} whatsapp={orfao.whatsapp} />
                <div className="mt-2 space-y-0.5 text-sm text-gray-700">
                  {orfao.email && <div>Email: {orfao.email}</div>}
                  {orfao.prazo && (
                    <div>
                      Prazo: {prazoLabel[orfao.prazo] ?? orfao.prazo}
                    </div>
                  )}
                </div>
              </Secao>

              <Secao titulo="Pedido">
                <dl className="text-sm text-gray-900 space-y-1">
                  <Campo label="Criado em">
                    {agoraMs !== null
                      ? formatarDuracaoRelativa(
                          new Date(orfao.pedido_criado_em).getTime(),
                          agoraMs
                        )
                      : '…'}
                  </Campo>
                  <Campo label="Status do pedido">{orfao.pedido_status}</Campo>
                  <Campo label="Motivo do órfão">
                    {orfao.motivo_orfao ?? '—'}
                  </Campo>
                </dl>
              </Secao>

              <Secao titulo="Descrição do cliente">
                {orfao.descricao ? (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">
                    {orfao.descricao}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 italic">
                    Cliente não escreveu descrição.
                  </p>
                )}
              </Secao>

              <Secao titulo={`Histórico de ofertas (${ofertas.length})`}>
                {ofertas.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">
                    Nenhuma oferta foi enviada ainda.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {ofertas.map((o) => (
                      <ItemOferta
                        key={o.id}
                        oferta={o}
                        agoraMs={agoraMs}
                        orfaoPedidoId={orfao.pedido_id}
                        agendadasParaFornecedor={
                          agendadasPorFornecedor.get(o.fornecedor_id) ?? 0
                        }
                        temCredito={
                          temCreditoPorFornecedor.get(o.fornecedor_id) ?? false
                        }
                        jaAgendadoEstePar={paresJaAgendados.has(
                          `${orfao.pedido_id}:${o.fornecedor_id}`
                        )}
                      />
                    ))}
                  </ul>
                )}
              </Secao>

              <div className="mt-6 flex justify-end">
                <button
                  ref={closeButtonRef}
                  onClick={() => setAberto(false)}
                  className="text-sm px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-md font-medium"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

function Secao({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-5">
      <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
        {titulo}
      </h3>
      {children}
    </section>
  )
}

function Campo({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-500 min-w-[140px]">{label}:</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  )
}

function ItemOferta({
  oferta,
  agoraMs,
  orfaoPedidoId,
  agendadasParaFornecedor,
  temCredito,
  jaAgendadoEstePar,
}: {
  oferta: OfertaHistorico
  agoraMs: number | null
  orfaoPedidoId: string
  agendadasParaFornecedor: number
  temCredito: boolean
  jaAgendadoEstePar: boolean
}) {
  const enviadoStr =
    agoraMs !== null
      ? formatarDuracaoRelativa(new Date(oferta.enviada_em).getTime(), agoraMs)
      : '…'

  return (
    <li className="flex items-start gap-3 text-sm">
      <BadgeOferta status={oferta.status} />
      <div className="flex-1 min-w-0">
        <div className="text-gray-900 flex items-center gap-1.5 flex-wrap">
          <span>{oferta.fornecedor_nome}</span>
          {agendadasParaFornecedor > 0 && (
            <span className="text-xs text-gray-500">
              ({agendadasParaFornecedor} na fila)
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          enviada {enviadoStr}
          {oferta.respondida_em && agoraMs !== null && (
            <>
              {' · '}respondida{' '}
              {formatarDuracaoRelativa(
                new Date(oferta.respondida_em).getTime(),
                agoraMs
              )}
            </>
          )}
        </div>
        {oferta.status === 'expirada' && (
          <div className="mt-1.5">
            <BotaoAgendarReenvio
              pedidoId={orfaoPedidoId}
              fornecedorId={oferta.fornecedor_id}
              temCredito={temCredito}
              iniciaAgendado={jaAgendadoEstePar}
            />
          </div>
        )}
      </div>
    </li>
  )
}

function BotaoAgendarReenvio({
  pedidoId,
  fornecedorId,
  temCredito,
  iniciaAgendado,
}: {
  pedidoId: string
  fornecedorId: string
  temCredito: boolean
  iniciaAgendado: boolean
}) {
  const router = useRouter()
  type Estado = 'idle' | 'loading' | 'agendado' | 'erro'
  const [estado, setEstado] = useState<Estado>(
    iniciaAgendado ? 'agendado' : 'idle'
  )

  // Disabled checks (precedência: já agendado > sem crédito)
  const disabledMotivo: string | null = iniciaAgendado
    ? 'Já agendado pra esse fornecedor'
    : !temCredito
      ? 'Fornecedor sem créditos disponíveis'
      : null

  async function handleClick() {
    if (estado === 'loading' || estado === 'agendado') return
    setEstado('loading')
    try {
      const res = await fetch('/api/admin/oferta-agendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId, fornecedorId }),
      })
      // 409 (duplicado) também conta como sucesso visual — já agendado
      if (res.ok || res.status === 409) {
        setEstado('agendado')
        router.refresh() // recarrega Server Component pra atualizar maps
        return
      }
      setEstado('erro')
    } catch {
      setEstado('erro')
    }
  }

  if (estado === 'agendado') {
    return (
      <span className="inline-flex items-center text-xs px-2 py-1 bg-green-50 text-green-700 rounded font-medium">
        ✓ Agendado
      </span>
    )
  }

  if (disabledMotivo) {
    return (
      <button
        type="button"
        disabled
        title={disabledMotivo}
        className="text-xs px-2 py-1 bg-gray-100 text-gray-400 rounded cursor-not-allowed"
      >
        ↻ Agendar reenvio
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={estado === 'loading'}
      className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {estado === 'loading'
        ? 'Agendando…'
        : estado === 'erro'
          ? '⚠ Erro · clique pra tentar de novo'
          : '↻ Agendar reenvio'}
    </button>
  )
}

function BadgeOferta({ status }: { status: string }) {
  // Só mapeia status com evidência no banco (enviada/aceita/recusada/expirada).
  // Valores futuros caem no fallback genérico — renderizam crus, ficam visíveis.
  const config: Record<string, { cor: string; label: string }> = {
    enviada:  { cor: 'bg-yellow-100 text-yellow-800', label: 'Enviada' },
    aceita:   { cor: 'bg-green-100 text-green-800',   label: 'Aceita' },
    recusada: { cor: 'bg-red-100 text-red-800',       label: 'Recusada' },
    expirada: { cor: 'bg-gray-200 text-gray-700',     label: 'Expirada' },
  }
  const def = config[status] ?? {
    cor: 'bg-gray-100 text-gray-500',
    label: status,
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${def.cor}`}
    >
      {def.label}
    </span>
  )
}
