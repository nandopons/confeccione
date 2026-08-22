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
//
// ARQUIVAR
// Card sai do quadro sem percorrer as oito etapas — o caso dos pedidos que já
// estavam pagos e entregues antes do CRM existir e entraram todos em
// "Planejamento". Arquivar NÃO apaga: a linha continua no banco (é ela que
// impede o card de ser recriado na próxima carga) e a gaveta devolve qualquer
// um com um clique. Por isso o botão não pede confirmação em modal — o desfazer
// está a dois cliques de distância.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

type Etapa = { id: string; titulo: string; ajuda: string }

type Card = {
  cardId: string
  origem: 'assistente' | 'orcamento'
  pedidoId: string | null
  orcamentoId: string | null
  referencia: string
  etapa: string
  entrouEtapaEm: string
  observacao: string | null
  clienteNome: string | null
  totalPecas: number
  resumo: string
  valorCentavos: number | null
  repasseCentavos: number | null
  fornecedorId: string | null
  fornecedorNome: string | null
  arquivadoEm: string | null
  arquivadoMotivo: string | null
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

type ProdutoPcp = { id: string; nome: string; prontoParaCalculo: boolean; operacoesSemTempo: number }

type ItemPcp = {
  id: string
  produtoId: string
  produtoNome: string
  cor: string
  tamanho: string
  quantidade: number
  observacao: string | null
}

type CargaMaquina = {
  maquinaId: string | null
  maquinaNome: string
  producaoSegundos: number
  setupSegundos: number
  totalSegundos: number
  capacidadeHorasDia: number | null
  diasDeMaquina: number | null
}

type Carga = {
  totalPecas: number
  totalSegundos: number
  setupSegundos: number
  porMaquina: CargaMaquina[]
  produtosIncompletos: string[]
  cores: string[]
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

/** Segundos → "6h 12min". A unidade do planejamento é hora de máquina. */
function horas(seg: number): string {
  if (seg <= 0) return '0min'
  const h = Math.floor(seg / 3600)
  const m = Math.round((seg % 3600) / 60)
  if (!h) return `${m}min`
  return m ? `${h}h ${m}min` : `${h}h`
}

function dataHora(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
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
  const [gaveta, setGaveta] = useState(false)
  const [arquivados, setArquivados] = useState<Card[] | null>(null)
  // Card em que você clicou "Arquivar" e que agora mostra o motivo + confirmar.
  const [confirmando, setConfirmando] = useState<string | null>(null)

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
    async (cardId: string, etapa: string) => {
      const anterior = cards
      setCards((cs) => cs.map((c) => (c.cardId === cardId ? { ...c, etapa, diasNaEtapa: 0 } : c)))
      try {
        const r = await fetch('/api/admin/producao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, etapa }),
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

  const carregarGaveta = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/producao?arquivados=1', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.erro || 'Falha ao carregar')
      setArquivados(d.cards ?? [])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar os arquivados')
    }
  }, [])

  /**
   * Some o card do quadro na hora e devolve se o servidor recusar — mesmo
   * contrato do mover. A gaveta é invalidada porque ficou desatualizada.
   */
  const arquivar = useCallback(
    async (cardId: string, motivo: string) => {
      const anterior = cards
      setCards((cs) => cs.filter((c) => c.cardId !== cardId))
      setConfirmando(null)
      try {
        const r = await fetch('/api/admin/producao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'arquivar', cardId, motivo: motivo.trim() || null }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          throw new Error(d?.erro || 'Não foi possível arquivar')
        }
        setArquivados(null)
      } catch (e) {
        setCards(anterior)
        setErro(e instanceof Error ? e.message : 'Não foi possível arquivar')
      }
    },
    [cards],
  )

  const restaurar = useCallback(
    async (cardId: string) => {
      const anterior = arquivados
      setArquivados((as) => (as ?? []).filter((c) => c.cardId !== cardId))
      try {
        const r = await fetch('/api/admin/producao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'restaurar', cardId }),
        })
        if (!r.ok) {
          const d = await r.json().catch(() => null)
          throw new Error(d?.erro || 'Não foi possível desarquivar')
        }
        await carregar()
      } catch (e) {
        setArquivados(anterior)
        setErro(e instanceof Error ? e.message : 'Não foi possível desarquivar')
      }
    },
    [arquivados, carregar],
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const abrindo = !gaveta
              setGaveta(abrindo)
              if (abrindo && arquivados === null) void carregarGaveta()
            }}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
          >
            {gaveta ? 'Voltar ao quadro' : 'Arquivados'}
          </button>
          <button
            onClick={() => void (gaveta ? carregarGaveta() : carregar())}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
          >
            Atualizar
          </button>
        </div>
      </div>

      {gaveta && (
        <Gaveta
          cards={arquivados}
          onRestaurar={(id) => void restaurar(id)}
          onVoltar={() => setGaveta(false)}
        />
      )}

      {erro && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          {erro}
        </div>
      )}

      {!gaveta && !cards.length && (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            Nenhum pedido em produção. Os cards entram sozinhos quando o pagamento é confirmado no Asaas.
          </p>
        </div>
      )}

      {/* Rolagem horizontal: 8 colunas não cabem em tela nenhuma sem espremer
          o card a ponto de não dar pra ler o que é o pedido. */}
      <div className="overflow-x-auto pb-4" hidden={gaveta}>
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
                      key={c.cardId}
                      draggable
                      onDragStart={() => setArrastando(c.cardId)}
                      onDragEnd={() => setArrastando(null)}
                      className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="text-[11px] font-mono truncate"
                          style={{ color: c.origem === 'orcamento' ? VERDE_ESCURO : '#9ca3af' }}
                          title={c.origem === 'orcamento' ? 'Orcamento avulso do admin' : 'Pedido do marketplace'}
                        >
                          {c.referencia}
                        </span>
                        <span className={'text-[11px] px-1.5 py-0.5 rounded-full ' + corParado(c.diasNaEtapa)}>
                          {c.diasNaEtapa === 0 ? 'hoje' : `${c.diasNaEtapa}d`}
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-gray-900 mt-1 leading-snug">
                        {c.totalPecas} peças
                      </p>
                      <p className="text-xs text-gray-600 truncate">{c.clienteNome ?? 'Cliente'}</p>
                      {c.fornecedorNome ? (
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">🏭 {c.fornecedorNome}</p>
                      ) : c.origem === 'orcamento' ? (
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">📄 Orçamento avulso</p>
                      ) : null}
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
                        onChange={(ev) => void mover(c.cardId, ev.target.value)}
                        aria-label={`Etapa do pedido ${c.referencia}`}
                        className="mt-2 w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                      >
                        {etapas.map((op) => (
                          <option key={op.id} value={op.id}>
                            {op.titulo}
                          </option>
                        ))}
                      </select>

                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <button
                          onClick={() => setAberto(c)}
                          className="text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2"
                        >
                          Detalhes
                        </button>
                        <button
                          onClick={() => setConfirmando(c.cardId)}
                          className="text-xs text-gray-400 hover:text-red-700"
                          title="Tirar do quadro sem arrastar até Pronto"
                        >
                          Arquivar
                        </button>
                      </div>

                      {confirmando === c.cardId && (
                        <ConfirmarArquivo
                          onCancelar={() => setConfirmando(null)}
                          onConfirmar={(motivo) => void arquivar(c.cardId, motivo)}
                        />
                      )}
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
// Confirmação de arquivamento, dentro do próprio card.
//
// Não é window.confirm nem modal: o card já está na sua frente, e um modal por
// cima de uma limpeza de dez cards seria dez modais. O motivo é opcional de
// propósito — se arquivar custar um texto obrigatório, o quadro nunca é limpo.
// ---------------------------------------------------------------------------
function ConfirmarArquivo({
  onConfirmar,
  onCancelar,
}: {
  onConfirmar: (motivo: string) => void
  onCancelar: () => void
}) {
  const [motivo, setMotivo] = useState('')
  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2">
      <p className="text-[11px] text-red-900 leading-snug">
        Tirar do quadro? Não apaga nada — fica em <strong>Arquivados</strong>, e volta com um clique.
      </p>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={280}
        placeholder="Motivo (opcional)"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirmar(motivo)
          if (e.key === 'Escape') onCancelar()
        }}
        className="mt-1.5 w-full text-xs border border-red-200 rounded-md px-2 py-1 bg-white"
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          onClick={() => onConfirmar(motivo)}
          className="flex-1 text-xs px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
        >
          Arquivar
        </button>
        <button
          onClick={onCancelar}
          className="flex-1 text-xs px-2 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A gaveta — lista simples do que saiu do quadro, com desarquivar.
//
// Lista e não kanban: aqui ninguém quer arrastar nada, só conferir o que tirou
// e consertar se tirou errado.
// ---------------------------------------------------------------------------
function Gaveta({
  cards,
  onRestaurar,
  onVoltar,
}: {
  cards: Card[] | null
  onRestaurar: (cardId: string) => void
  onVoltar: () => void
}) {
  if (cards === null) return <p className="text-sm text-gray-500">Carregando os arquivados…</p>

  if (!cards.length) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm text-gray-600">Nada arquivado.</p>
        <button onClick={onVoltar} className="mt-3 text-sm underline underline-offset-2 text-gray-600">
          Voltar ao quadro
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
        <p className="text-sm text-gray-700">
          <strong>{cards.length}</strong> {cards.length === 1 ? 'card arquivado' : 'cards arquivados'} —
          fora do quadro, mas nada foi apagado.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {cards.map((c) => (
          <li key={c.cardId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-mono text-gray-400">{c.referencia}</p>
              <p className="text-sm text-gray-900">
                {c.totalPecas} peças · {c.clienteNome ?? 'Cliente'} · {brl(c.valorCentavos)}
              </p>
              <p className="text-xs text-gray-500">
                Arquivado {c.arquivadoEm ? dataHora(c.arquivadoEm) : ''}
                {c.arquivadoMotivo ? ` — ${c.arquivadoMotivo}` : ''}
              </p>
            </div>
            <button
              onClick={() => onRestaurar(c.cardId)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 shrink-0"
            >
              Devolver ao quadro
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// O que este card É, em termos de fábrica — e quanto custa por máquina.
//
// POR QUE ISTO PRECISOU EXISTIR
// O card nasce do pedido, e o pedido descreve a peça em texto livre ("10
// camisas"). O cadastro técnico sabe que a camisa básica tem 15 operações e
// quanto cada uma custa. As duas coisas nunca se falavam — então o roteiro, por
// completo que estivesse, não virava hora de máquina nenhuma. Aqui você aponta
// o card pro produto, informa cor e grade, e a carga aparece.
//
// A COR NÃO É DECORAÇÃO
// É ela que dispara a troca de linha da máquina. Duas cores no mesmo card = dois
// setups na overloque, e isso aparece separado do tempo de produção.
// ---------------------------------------------------------------------------
type LinhaItem = { produtoId: string; cor: string; tamanho: string; quantidade: string }

function SecaoPcp({ cardId }: { cardId: string }) {
  const [produtos, setProdutos] = useState<ProdutoPcp[]>([])
  const [carga, setCarga] = useState<Carga | null>(null)
  const [linhas, setLinhas] = useState<LinhaItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const r = await fetch(`/api/admin/producao?carga=${cardId}`, { cache: 'no-store' })
        const d = await r.json()
        if (!vivo || !r.ok) return
        setProdutos(d.produtos ?? [])
        setCarga(d.carga ?? null)
        setLinhas(
          (d.itens ?? []).map((i: ItemPcp) => ({
            produtoId: i.produtoId,
            cor: i.cor,
            tamanho: i.tamanho,
            quantidade: String(i.quantidade),
          })),
        )
      } finally {
        if (vivo) setCarregando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [cardId])

  const mudar = (i: number, campo: keyof LinhaItem, v: string) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)))

  async function salvar() {
    setSalvando(true)
    setAviso(null)
    try {
      const r = await fetch('/api/admin/producao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'salvar_itens_pcp',
          cardId,
          itens: linhas
            .filter((l) => l.produtoId && l.tamanho.trim() && parseInt(l.quantidade, 10) > 0)
            .map((l) => ({
              produtoId: l.produtoId,
              cor: l.cor.trim() || 'Único',
              tamanho: l.tamanho.trim().toUpperCase(),
              quantidade: parseInt(l.quantidade, 10),
            })),
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.erro || 'Não foi possível salvar')
      setCarga(d.carga ?? null)
      setAviso('Salvo.')
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Não foi possível salvar')
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) {
    return <p className="text-xs text-gray-500 mt-5">Carregando a ficha de produção…</p>
  }

  const gargalo = carga?.porMaquina?.[0] ?? null

  return (
    <section className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Ficha de produção
      </h3>

      {produtos.length === 0 ? (
        <p className="text-xs text-gray-600 leading-relaxed border border-amber-200 bg-amber-50 rounded-xl px-3 py-2">
          Nenhum produto cadastrado ainda. Cadastre o modelo em <strong>Produtos</strong> — com o
          roteiro de operações e os tempos — e ele aparece aqui pra ser apontado.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {linhas.map((l, i) => (
              <div key={i} className="flex flex-wrap items-end gap-1.5">
                <label className="text-[11px] text-gray-500 grow min-w-[140px]">
                  Produto
                  <select
                    value={l.produtoId}
                    onChange={(e) => mudar(i, 'produtoId', e.target.value)}
                    className="mt-0.5 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900"
                  >
                    <option value="">— escolha —</option>
                    {produtos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                        {p.prontoParaCalculo ? '' : ` (faltam ${p.operacoesSemTempo} tempos)`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-gray-500">
                  Cor
                  <input
                    value={l.cor}
                    onChange={(e) => mudar(i, 'cor', e.target.value)}
                    placeholder="Preto"
                    className="mt-0.5 w-24 text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                  />
                </label>
                <label className="text-[11px] text-gray-500">
                  Tam.
                  <input
                    value={l.tamanho}
                    onChange={(e) => mudar(i, 'tamanho', e.target.value.toUpperCase())}
                    className="mt-0.5 w-14 text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-center text-gray-900"
                  />
                </label>
                <label className="text-[11px] text-gray-500">
                  Qtd
                  <input
                    value={l.quantidade}
                    onChange={(e) => mudar(i, 'quantidade', e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    className="mt-0.5 w-16 text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                  />
                </label>
                <button
                  onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
                  className="text-xs text-gray-400 hover:text-red-700 pb-2"
                  aria-label="Remover linha"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              onClick={() =>
                setLinhas((ls) => [
                  ...ls,
                  {
                    // Repete produto e cor da última linha: preencher a grade é
                    // digitar o mesmo produto cinco vezes trocando só o tamanho.
                    produtoId: ls[ls.length - 1]?.produtoId ?? '',
                    cor: ls[ls.length - 1]?.cor ?? '',
                    tamanho: '',
                    quantidade: '',
                  },
                ])
              }
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
            >
              + Tamanho
            </button>
            <button
              onClick={() => void salvar()}
              disabled={salvando}
              className="text-xs px-4 py-1.5 rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: VERDE }}
            >
              {salvando ? 'Salvando…' : 'Salvar ficha'}
            </button>
            {aviso && <span className="text-xs text-gray-600">{aviso}</span>}
          </div>
        </>
      )}

      {carga && carga.porMaquina.length > 0 && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm text-gray-900">
            <strong>{carga.totalPecas}</strong> peças ·{' '}
            <strong>{horas(carga.totalSegundos)}</strong> de máquina
            {carga.setupSegundos > 0 && (
              <span className="text-gray-600">
                {' '}
                (sendo {horas(carga.setupSegundos)} de troca de linha
                {carga.cores.length > 1 ? `, ${carga.cores.length} cores` : ''})
              </span>
            )}
          </p>

          <table className="w-full text-xs mt-2">
            <thead className="text-left text-gray-400">
              <tr>
                <th className="font-medium pb-1">Máquina</th>
                <th className="font-medium pb-1 text-right">Produção</th>
                <th className="font-medium pb-1 text-right">Troca</th>
                <th className="font-medium pb-1 text-right">Dias</th>
              </tr>
            </thead>
            <tbody>
              {carga.porMaquina.map((m) => (
                <tr key={m.maquinaNome}>
                  <td className="py-0.5 text-gray-800">
                    {m.maquinaNome}
                    {gargalo && m.maquinaNome === gargalo.maquinaNome && m.diasDeMaquina != null && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                        gargalo
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-gray-700">
                    {horas(m.producaoSegundos)}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-gray-500">
                    {m.setupSegundos > 0 ? horas(m.setupSegundos) : '—'}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-gray-900 font-medium">
                    {m.diasDeMaquina == null ? '—' : m.diasDeMaquina.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">
            <strong>Dias</strong> = a carga dividida pela capacidade diária daquele tipo de máquina
            (quantidade × horas/dia). A primeira linha é a que estoura primeiro.
          </p>
        </div>
      )}

      {carga && carga.produtosIncompletos.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-2 leading-snug">
          Fora da conta por falta de tempo cronometrado: {carga.produtosIncompletos.join(', ')}.
          Um produto só entra no cálculo com todas as operações medidas — somar o que se conhece
          daria um número menor que a realidade, sem aviso.
        </p>
      )}
    </section>
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
        fetch(`/api/admin/producao?card=${card.cardId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        // Versoes de orcamento so existem no fluxo do marketplace. Orcamento
        // avulso e escrito de uma vez, no admin — nao ha ida e volta com
        // fornecedor pra versionar.
        card.pedidoId
          ? fetch(`/api/admin/pedidos-assistente/orcamento?pedido=${card.pedidoId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!vivo) return
      setEventos(a?.eventos ?? [])
      setVersoes(b?.versoes ?? [])
      setPago(b?.pedido?.pagamento_status === 'pago')
    })()
    return () => {
      vivo = false
    }
  }, [card.cardId, card.pedidoId])

  async function salvarObservacao() {
    setSalvando(true)
    setAviso(null)
    try {
      const r = await fetch('/api/admin/producao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: card.cardId, etapa: card.etapa, observacao: obs }),
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
            <p className="text-[11px] font-mono text-gray-400">
              {card.referencia}
              {card.origem === 'orcamento' ? ' · orçamento avulso' : ''}
            </p>
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

        <SecaoPcp cardId={card.cardId} />

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
            Cliente pagou {brl(card.valorCentavos)}
            {card.origem === 'assistente' ? ` · fornecedor recebe ${brl(card.repasseCentavos)}` : ''}
          </p>
          {pago && (
            <p className="text-[11px] text-gray-500 mt-1 leading-snug">
              Pedido já pago — o valor não pode mais ser corrigido por aqui, senão descola do que o Asaas
              cobrou e o repasse sai errado.
            </p>
          )}

          {card.origem === 'orcamento' ? (
            <p className="text-xs text-gray-500 mt-3 leading-snug">
              Orçamento avulso — feito por você de uma vez no admin, sem ida e volta com fornecedor,
              então não há versões a comparar.
            </p>
          ) : versoes.length === 0 ? (
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
