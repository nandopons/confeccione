'use client'

// app/admin/(painel)/producao/ProducaoQuadro.tsx
// ============================================================================
// Quadro de produção — uma coluna por etapa, um card por pedido pago.
//
// DRAG AND DROP NATIVO, SEM BIBLIOTECA
// O projeto não tem nenhuma lib de UI (nem ícones), e o HTML5 drag-and-drop dá
// conta de arrastar card entre colunas. Não vale trazer uma dependência nova
// pra isso. O custo é que DnD nativo não funciona em toque — por isso cada card
// TAMBÉM tem um <select> de etapa, que é o caminho no celular e o acessível
// por teclado. Os dois chamam a mesma função.
//
// ATUALIZAÇÃO OTIMISTA
// O card pula de coluna na hora e volta sozinho se o servidor recusar. Arrastar
// e esperar meio segundo pra ver se andou destrói a sensação de quadro.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

type Etapa = { id: string; titulo: string; ajuda: string }

type Card = {
  pedidoId: string
  etapa: string
  entrouEtapaEm: string
  observacao: string | null
  clienteNome: string | null
  totalPecas: number
  resumo: string
  valorCentavos: number | null
  repasseCentavos: number | null
  prazoDias: number | null
  fornecedorId: string | null
  fornecedorNome: string | null
  diasNaEtapa: number
}

type Evento = {
  id: string
  deEtapa: string | null
  paraEtapa: string
  autor: string
  autorNome: string | null
  observacao: string | null
  criadoEm: string
}

type Versao = {
  id: string
  versao: number
  valorCentavos: number | null
  freteCentavos: number | null
  repasseCentavos: number | null
  autor: string
  autorNome: string | null
  motivo: string | null
  criadoEm: string
}

const VERDE = '#1D9E75'
const VERDE_ESCURO = '#0F6E56'
const VERDE_CLARO = '#E1F5EE'

function brl(c: number | null | undefined) {
  if (c == null) return '—'
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataHora(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function ref(pedidoId: string) {
  return pedidoId.replace(/-/g, '').slice(0, 8).toUpperCase()
}

/**
 * Cor do "parado há N dias". Não é enfeite: um card que ficou duas semanas na
 * mesma etapa é o sinal mais útil do quadro inteiro.
 */
function corParado(dias: number): string {
  if (dias >= 10) return 'bg-red-100 text-red-800'
  if (dias >= 5) return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-600'
}

export default function ProducaoQuadro() {
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [aberto, setAberto] = useState<Card | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const r = await fetch('/api/admin/producao', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.erro || 'Falha ao carregar')
      setEtapas(d.etapas ?? [])
      setCards(d.cards ?? [])
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const mover = useCallback(
    async (pedidoId: string, etapa: string) => {
      const anterior = cards
      setCards((cs) => cs.map((c) => (c.pedidoId === pedidoId ? { ...c, etapa, diasNaEtapa: 0 } : c)))
      try {
        const r = await fetch('/api/admin/producao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedidoId, etapa }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          throw new Error(d?.erro || 'Não foi possível mover')
        }
      } catch (e) {
        setCards(anterior) // desfaz — o quadro não pode mentir
        setErro(e instanceof Error ? e.message : 'Não foi possível mover')
      }
    },
    [cards],
  )

  const porEtapa = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const e of etapas) m.set(e.id, [])
    for (const c of cards) {
      if (!m.has(c.etapa)) m.set(c.etapa, [])
      m.get(c.etapa)!.push(c)
    }
    // Mais parado primeiro: quem está travado há mais tempo pede atenção antes.
    for (const [, lista] of m) lista.sort((a, b) => b.diasNaEtapa - a.diasNaEtapa)
    return m
  }, [cards, etapas])

  const totalPecasAbertas = cards.reduce((s, c) => s + c.totalPecas, 0)

  if (carregando && !cards.length) {
    return <p className="text-sm text-gray-500">Carregando o quadro…</p>
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-gray-600">
          <strong className="text-gray-900">{cards.length}</strong> pedidos em produção ·{' '}
          <strong className="text-gray-900">{totalPecasAbertas}</strong> peças ·{' '}
          {brl(cards.reduce((s, c) => s + (c.valorCentavos ?? 0), 0))} em jogo
        </div>
        <button
          onClick={() => void carregar()}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Atualizar
        </button>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          {erro}
        </div>
      )}

      {!cards.length && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            Nenhum pedido em produção. Os cards entram sozinhos quando o pagamento é confirmado no Asaas.
          </p>
        </div>
      )}

      {/* Rolagem horizontal: 8 colunas não cabem em tela nenhuma sem espremer
          o card a ponto de não dar pra ler o que é o pedido. */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-3 min-w-max">
          {etapas.map((e) => {
            const lista = porEtapa.get(e.id) ?? []
            const alvo = sobre === e.id
            return (
              <div
                key={e.id}
                onDragOver={(ev) => {
                  ev.preventDefault()
                  setSobre(e.id)
                }}
                onDragLeave={() => setSobre((s) => (s === e.id ? null : s))}
                onDrop={(ev) => {
                  ev.preventDefault()
                  setSobre(null)
                  if (arrastando) void mover(arrastando, e.id)
                  setArrastando(null)
                }}
                className="w-[260px] shrink-0 rounded-2xl border p-3 transition-colors"
                style={
                  alvo
                    ? { borderColor: VERDE, backgroundColor: VERDE_CLARO }
                    : { borderColor: '#e5e7eb', backgroundColor: '#fafafa' }
                }
              >
                <div className="mb-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">{e.titulo}</h3>
                    <span className="text-xs text-gray-500 tabular-nums">{lista.length}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{e.ajuda}</p>
                </div>

                <div className="flex flex-col gap-2">
                  {lista.map((c) => (
                    <article
                      key={c.pedidoId}
                      draggable
                      onDragStart={() => setArrastando(c.pedidoId)}
                      onDragEnd={() => setArrastando(null)}
                      className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] font-mono text-gray-400">{ref(c.pedidoId)}</span>
                        <span className={'text-[11px] px-1.5 py-0.5 rounded-full ' + corParado(c.diasNaEtapa)}>
                          {c.diasNaEtapa === 0 ? 'hoje' : `${c.diasNaEtapa}d`}
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-gray-900 mt-1 leading-snug">
                        {c.totalPecas} peças
                      </p>
                      <p className="text-xs text-gray-600 truncate">{c.clienteNome ?? 'Cliente'}</p>
                      {c.fornecedorNome && (
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">🏭 {c.fornecedorNome}</p>
                      )}
                      <p className="text-[11px] mt-1" style={{ color: VERDE_ESCURO }}>
                        {brl(c.valorCentavos)}
                      </p>

                      {c.observacao && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-1 mt-2 leading-snug">
                          {c.observacao}
                        </p>
                      )}

                      {/* Caminho de toque e de teclado — DnD nativo não cobre celular. */}
                      <select
                        value={c.etapa}
                        onChange={(ev) => void mover(c.pedidoId, ev.target.value)}
                        aria-label={`Etapa do pedido ${ref(c.pedidoId)}`}
                        className="mt-2 w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                      >
                        {etapas.map((op) => (
                          <option key={op.id} value={op.id}>
                            {op.titulo}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => setAberto(c)}
                        className="mt-1.5 w-full text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2"
                      >
                        Detalhes e histórico
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {aberto && (
        <PainelDetalhe
          card={aberto}
          etapas={etapas}
          onFechar={() => setAberto(null)}
          onMudou={() => void carregar()}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Painel lateral: linha do tempo da produção + histórico e correção do orçamento
// ---------------------------------------------------------------------------
function PainelDetalhe({
  card,
  etapas,
  onFechar,
  onMudou,
}: {
  card: Card
  etapas: Etapa[]
  onFechar: () => void
  onMudou: () => void
}) {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [versoes, setVersoes] = useState<Versao[]>([])
  const [pago, setPago] = useState<boolean>(true)
  const [obs, setObs] = useState(card.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const titulo = (id: string) => etapas.find((e) => e.id === id)?.titulo ?? id

  useEffect(() => {
    let vivo = true
    void (async () => {
      const [a, b] = await Promise.all([
        fetch(`/api/admin/producao?pedido=${card.pedidoId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch(`/api/admin/pedidos-assistente/orcamento?pedido=${card.pedidoId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ])
      if (!vivo) return
      setEventos(a?.eventos ?? [])
      setVersoes(b?.versoes ?? [])
      setPago(b?.pedido?.pagamento_status === 'pago')
    })()
    return () => {
      vivo = false
    }
  }, [card.pedidoId])

  async function salvarObservacao() {
    setSalvando(true)
    setAviso(null)
    try {
      const r = await fetch('/api/admin/producao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: card.pedidoId, etapa: card.etapa, observacao: obs }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        throw new Error(d?.erro || 'Não foi possível salvar')
      }
      setAviso('Recado salvo.')
      onMudou()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Não foi possível salvar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar}>
      <aside
        className="w-full max-w-lg h-full overflow-y-auto bg-white p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[11px] font-mono text-gray-400">{ref(card.pedidoId)}</p>
            <h2 className="text-lg font-semibold text-gray-900">
              {card.totalPecas} peças · {card.clienteNome ?? 'Cliente'}
            </h2>
            <p className="text-sm text-gray-600">{titulo(card.etapa)}</p>
          </div>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">
            ×
          </button>
        </div>

        <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed border border-gray-200 rounded-xl p-3 bg-gray-50">
          {card.resumo}
        </p>

        {card.fornecedorNome && (
          <p className="text-sm text-gray-600 mt-3">🏭 {card.fornecedorNome}</p>
        )}

        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Recado no card
          </h3>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            maxLength={280}
            rows={2}
            placeholder="Ex.: malha chega quinta"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
          <button
            onClick={() => void salvarObservacao()}
            disabled={salvando}
            className="mt-2 text-sm px-4 py-2 rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: VERDE }}
          >
            {salvando ? 'Salvando…' : 'Salvar recado'}
          </button>
          {aviso && <p className="text-xs text-gray-600 mt-2">{aviso}</p>}
        </section>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Orçamento
          </h3>
          <p className="text-sm text-gray-900">
            Cliente pagou {brl(card.valorCentavos)} · fornecedor recebe {brl(card.repasseCentavos)}
          </p>
          {pago && (
            <p className="text-[11px] text-gray-500 mt-1 leading-snug">
              Pedido já pago — o valor não pode mais ser corrigido por aqui, senão descola do que o Asaas
              cobrou e o repasse sai errado.
            </p>
          )}

          {versoes.length === 0 ? (
            <p className="text-xs text-gray-500 mt-3 leading-snug">
              Sem versões registradas. O histórico começou em 20/08/2026 — orçamentos enviados antes disso
              foram sobrescritos e não dá para recuperar.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {versoes.map((v) => (
                <li key={v.id} className="text-xs border border-gray-200 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900">v{v.versao}</span>
                    <span className="text-gray-400">{dataHora(v.criadoEm)}</span>
                  </div>
                  <p className="text-gray-700 mt-0.5">
                    {brl(v.valorCentavos)} · repasse {brl(v.repasseCentavos)}
                  </p>
                  <p className="text-gray-500">
                    {v.autor === 'admin' ? 'Admin' : v.autorNome || 'Fornecedor'}
                    {v.motivo ? ` — ${v.motivo}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Linha do tempo da produção
          </h3>
          {eventos.length === 0 ? (
            <p className="text-xs text-gray-500">Ainda sem movimentação.</p>
          ) : (
            <ol className="space-y-2">
              {eventos.map((ev) => (
                <li key={ev.id} className="text-xs border-l-2 pl-3" style={{ borderColor: VERDE_CLARO }}>
                  <p className="text-gray-900">
                    {ev.deEtapa ? `${titulo(ev.deEtapa)} → ` : ''}
                    <strong>{titulo(ev.paraEtapa)}</strong>
                  </p>
                  <p className="text-gray-500">
                    {dataHora(ev.criadoEm)} ·{' '}
                    {ev.autor === 'sistema' ? 'sistema' : ev.autorNome || ev.autor}
                  </p>
                  {ev.observacao && <p className="text-gray-600 mt-0.5">{ev.observacao}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  )
}
