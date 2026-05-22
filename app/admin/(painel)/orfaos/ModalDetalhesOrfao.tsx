'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import { formatarDuracaoRelativa } from '@/app/lib/admin-saude'
import { ColunaContato } from '../ColunaContato'
import { AcoesOrfao } from './AcoesOrfao'
import type { StatusOrfao } from '@/app/lib/orfaos'
import type {
  OfertaHistorico,
  PedidoDetalhe,
} from '@/app/lib/admin-pedido-detalhe'

// Re-export dos tipos (compat com imports antigos via este arquivo).
export type { OfertaHistorico, PedidoDetalhe }

/** Infos de órfão — só quando o pedido É órfão. Ausente = pedido comum. */
export type InfoOrfao = {
  orfao_id: string
  status_orfao: StatusOrfao
  prioridade: number
  motivo_orfao: string | null
  notas_admin: string | null
  responsavel_captacao: string | null
}

export function ModalDetalhesPedido({
  pedido,
  orfao,
  ofertas,
  agendadasPorFornecedor,
  temCreditoPorFornecedor,
  paresJaAgendados,
}: {
  pedido: PedidoDetalhe
  /** Presente só pra pedidos órfãos — esconde a seção de órfão quando ausente. */
  orfao?: InfoOrfao
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

  const tituloId = `modal-${pedido.pedido_id}-titulo`

  // Ofertar/reenviar só faz sentido (e a lib só permite) com o pedido ainda
  // buscando fornecedor. Em negociação/concluído → modal view-only.
  const podeOfertar = pedido.pedido_status === 'buscando_fornecedor'

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
          aria-labelledby={tituloId}
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
                id={tituloId}
                className="text-lg font-semibold text-gray-900 mb-1"
              >
                {orfao ? 'Detalhes do pedido órfão' : 'Detalhes do pedido'}
              </h2>
              <p className="text-xs text-gray-500 mb-5">
                {tipoLabel[pedido.tipo] ?? pedido.tipo} ·{' '}
                {pedido.quantidade !== null
                  ? `${pedido.quantidade} peças`
                  : 'qtd não informada'}{' '}
                · {pedido.estado}
              </p>

              <Secao titulo="Cliente">
                <ColunaContato nome={pedido.nome} whatsapp={pedido.whatsapp} />
                <div className="mt-2 space-y-0.5 text-sm text-gray-700">
                  {pedido.email && <div>Email: {pedido.email}</div>}
                  {pedido.prazo && (
                    <div>
                      Prazo: {prazoLabel[pedido.prazo] ?? pedido.prazo}
                    </div>
                  )}
                </div>
              </Secao>

              <Secao titulo="Pedido">
                <dl className="text-sm text-gray-900 space-y-1">
                  <Campo label="Criado em">
                    {agoraMs !== null
                      ? formatarDuracaoRelativa(
                          new Date(pedido.pedido_criado_em).getTime(),
                          agoraMs
                        )
                      : '…'}
                  </Campo>
                  <Campo label="Status do pedido">{pedido.pedido_status}</Campo>
                </dl>
              </Secao>

              {orfao && (
                <Secao titulo="Captação (órfão)">
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <BadgeStatusOrfao status={orfao.status_orfao} />
                      <span className="text-xs text-gray-500">
                        prioridade {orfao.prioridade}
                      </span>
                    </div>
                    <div className="text-gray-700">
                      <span className="text-gray-500">Motivo: </span>
                      {orfao.motivo_orfao ?? '—'}
                    </div>
                    {(orfao.responsavel_captacao || orfao.notas_admin) && (
                      <div className="text-gray-700 space-y-0.5">
                        {orfao.responsavel_captacao && (
                          <div>
                            <span className="text-gray-500">Responsável: </span>
                            {orfao.responsavel_captacao}
                          </div>
                        )}
                        {orfao.notas_admin && (
                          <div>
                            <span className="text-gray-500">Notas: </span>
                            {orfao.notas_admin}
                          </div>
                        )}
                      </div>
                    )}
                    <AcoesOrfao
                      orfaoId={orfao.orfao_id}
                      statusAtual={orfao.status_orfao}
                    />
                  </div>
                </Secao>
              )}

              <Secao titulo="Descrição do cliente">
                {pedido.descricao ? (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">
                    {pedido.descricao}
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
                        pedidoId={pedido.pedido_id}
                        podeOfertar={podeOfertar}
                        agendadasParaFornecedor={
                          agendadasPorFornecedor.get(o.fornecedor_id) ?? 0
                        }
                        temCredito={
                          temCreditoPorFornecedor.get(o.fornecedor_id) ?? false
                        }
                        jaAgendadoEstePar={paresJaAgendados.has(
                          `${pedido.pedido_id}:${o.fornecedor_id}`
                        )}
                      />
                    ))}
                  </ul>
                )}
              </Secao>

              {podeOfertar && (
                <Secao titulo="Ofertar manualmente">
                  <OfertarManual pedidoId={pedido.pedido_id} />
                </Secao>
              )}

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

/** Re-export do nome antigo — preserva imports existentes. */
export const ModalDetalhesOrfao = ModalDetalhesPedido

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
  pedidoId,
  podeOfertar,
  agendadasParaFornecedor,
  temCredito,
  jaAgendadoEstePar,
}: {
  oferta: OfertaHistorico
  agoraMs: number | null
  pedidoId: string
  podeOfertar: boolean
  agendadasParaFornecedor: number
  temCredito: boolean
  jaAgendadoEstePar: boolean
}) {
  const enviadoStr =
    agoraMs !== null
      ? formatarDuracaoRelativa(new Date(oferta.enviada_em).getTime(), agoraMs)
      : '…'

  // Reoferecível = expirou (sem resposta). Recusou NÃO reoferece. E só quando
  // o pedido ainda está buscando (podeOfertar).
  const reofertavel =
    podeOfertar &&
    (oferta.status === 'expirada' || oferta.status === 'expirada_sem_credito')

  return (
    <li className="flex items-start gap-3 text-sm">
      <DesfechoOferta status={oferta.status} />
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
        {reofertavel && (
          <div className="mt-1.5">
            <BotaoAgendarReenvio
              pedidoId={pedidoId}
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

// =============================================================================
// OFERTAR MANUAL — dropdown de fornecedores + botão
// =============================================================================

type FornecedorCompativel = {
  id: string
  nome: string
  estado: string
  tipos_produto: string[]
  pedido_minimo: number
  raio_atendimento: string
  compativel: boolean
}

function OfertarManual({ pedidoId }: { pedidoId: string }) {
  const router = useRouter()
  const [fornecedores, setFornecedores] = useState<FornecedorCompativel[]>([])
  const [loading, setLoading] = useState(true)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)
  const [incluirTodos, setIncluirTodos] = useState(false)
  const [selecionado, setSelecionado] = useState<string>('')

  type Estado = 'idle' | 'enviando' | 'enviado' | 'erro'
  const [estado, setEstado] = useState<Estado>('idle')
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)

  // Carrega lista quando incluirTodos muda
  useEffect(() => {
    let cancelado = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pattern padrão pra fetch com loading state
    setLoading(true)
    setErroCarregar(null)
    const url = `/api/admin/fornecedores-compativeis?pedidoId=${pedidoId}&incluirTodos=${incluirTodos}`
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelado) return
        if (data.ok) {
          setFornecedores(data.fornecedores as FornecedorCompativel[])
          setSelecionado('')
        } else {
          setErroCarregar(data.erro ?? 'erro ao carregar')
        }
      })
      .catch(() => {
        if (!cancelado) setErroCarregar('erro de rede')
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => {
      cancelado = true
    }
  }, [pedidoId, incluirTodos])

  async function handleEnviar() {
    if (!selecionado || estado === 'enviando' || estado === 'enviado') return
    setEstado('enviando')
    setErroEnvio(null)
    try {
      const res = await fetch('/api/admin/ofertar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pedidoId,
          fornecedorId: selecionado,
          forcar: incluirTodos,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setEstado('enviado')
        router.refresh()
        return
      }
      setEstado('erro')
      const motivos: string[] = Array.isArray(data.motivos) ? data.motivos : []
      setErroEnvio(
        motivos.length > 0
          ? `${data.erro}: ${motivos.join('; ')}`
          : (data.erro ?? 'erro')
      )
    } catch {
      setEstado('erro')
      setErroEnvio('erro de rede')
    }
  }

  if (estado === 'enviado') {
    return (
      <div className="text-sm px-3 py-2 bg-green-50 text-green-800 rounded">
        ✓ Oferta enviada. WhatsApp e e-mail disparados.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">Fornecedor</span>
        <select
          value={selecionado}
          onChange={(e) => setSelecionado(e.target.value)}
          disabled={loading || estado === 'enviando'}
          className="block w-full px-3 py-2 text-sm border border-gray-300 rounded-md disabled:opacity-60"
        >
          {loading ? (
            <option value="">Carregando…</option>
          ) : fornecedores.length === 0 ? (
            <option value="">
              {incluirTodos
                ? 'Nenhum fornecedor disponível'
                : 'Nenhum fornecedor compatível'}
            </option>
          ) : (
            <>
              <option value="">Selecione um fornecedor…</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} · {f.estado} ·{' '}
                  {f.tipos_produto.slice(0, 2).join('/')}
                  {f.tipos_produto.length > 2 ? '…' : ''}
                  {!f.compativel ? ' ⚠' : ''}
                </option>
              ))}
            </>
          )}
        </select>
      </label>

      <label className="inline-flex items-center gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={incluirTodos}
          onChange={(e) => setIncluirTodos(e.target.checked)}
          disabled={estado === 'enviando'}
          className="w-3.5 h-3.5"
        />
        <span>
          Mostrar todos os fornecedores (ignora critérios — admin assume risco)
        </span>
      </label>

      {erroCarregar && (
        <div className="text-xs text-red-700">⚠ {erroCarregar}</div>
      )}

      {erroEnvio && estado === 'erro' && (
        <div className="text-xs text-red-700">⚠ {erroEnvio}</div>
      )}

      <button
        type="button"
        onClick={handleEnviar}
        disabled={
          !selecionado || estado === 'enviando' || loading
        }
        className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {estado === 'enviando' ? 'Enviando…' : 'Enviar oferta agora'}
      </button>
    </div>
  )
}

/** Badge do DESFECHO da oferta (visão admin). Vermelho = recusou (não
 *  reoferecer); cinza = expirou (pode reoferecer); verde = aceitou; amarelo =
 *  ainda aberta. Valores novos caem no fallback genérico (renderizam crus). */
function DesfechoOferta({ status }: { status: string }) {
  const config: Record<string, { cor: string; label: string }> = {
    enviada: { cor: 'bg-yellow-100 text-yellow-800', label: 'Aguardando resposta' },
    aceita: { cor: 'bg-green-100 text-green-800', label: 'Aceitou' },
    recusada: { cor: 'bg-red-100 text-red-800', label: 'Recusou' },
    recusada_sem_credito: {
      cor: 'bg-red-100 text-red-800',
      label: 'Recusou (sem crédito)',
    },
    expirada: { cor: 'bg-gray-200 text-gray-700', label: 'Expirou sem resposta' },
    expirada_sem_credito: {
      cor: 'bg-gray-200 text-gray-700',
      label: 'Expirou (sem crédito)',
    },
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

/** Badge do status_orfao (na seção de captação do modal). */
function BadgeStatusOrfao({ status }: { status: StatusOrfao }) {
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
