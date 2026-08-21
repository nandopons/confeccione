'use client'

// app/admin/(painel)/orcamentos/HistoricoOrcamentos.tsx
// ============================================================================
// Histórico dos orçamentos avulsos + operação das parcelas.
//
// POR QUE ESTA TELA EXISTE
// O gerador criava orçamento e cobrança desde 02/07/2026 e não havia onde
// olhar. Em 21/08/2026, oito cobranças estavam vencidas somando R$ 12.448,19
// e ninguém sabia — não por descuido, por falta de tela. O que aparece aqui
// primeiro, então, é o vencido.
//
// O QUE DÁ PRA FAZER DAQUI
//   · ver o que foi emitido, com o status de cada parcela
//   · liberar a parcela final de um 50/50 (só com o sinal pago)
//   · dar baixa manual quando o cliente paga PIX direto na chave — com motivo
//   · copiar o link de pagamento pra recobrar pelo WhatsApp
//   · conferir tudo contra o Asaas (reconciliação), sem sair da tela
//
// A tela não decide nada sobre pagamento: quem decide é o server
// (orcamento-parcelas.ts). Aqui só chama e mostra o resultado.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

type Orcamento = {
  id: string
  numero: string
  cliente_nome: string | null
  cliente_documento: string | null
  total_centavos: number | null
  frete_centavos: number | null
  data_orcamento: string | null
  validade: string | null
  status: string | null
  pagamento_status: string | null
  pago_em: string | null
  asaas_payment_id: string | null
  asaas_invoice_url: string | null
  cobranca_vencimento: string | null
  modalidade: 'integral' | 'sinal_50' | null
  desconto_pix_percentual: number | null
  criado_em: string
}

type Parcela = {
  id: string
  parcela: number
  rotulo: 'integral' | 'sinal' | 'final'
  valorCentavos: number
  descontoPercentual: number
  vencimento: string | null
  asaasPaymentId: string | null
  asaasInvoiceUrl: string | null
  pixCopiaCola: string | null
  status: 'gerada' | 'paga' | 'cancelada'
  pagoEm: string | null
  origemBaixa: 'asaas' | 'manual' | null
  baixaMotivo: string | null
}

function brl(centavos: number | null): string {
  return ((centavos ?? 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function dataBR(iso: string | null): string {
  if (!iso) return '—'
  const so = iso.slice(0, 10)
  const [ano, mes, dia] = so.split('-')
  return `${dia}/${mes}/${ano}`
}

/** Hoje em YYYY-MM-DD no fuso local — comparar string com string evita o
 *  clássico "venceu ontem" causado por new Date('2026-08-21') virar UTC. */
function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const ROTULO_PARCELA: Record<Parcela['rotulo'], string> = {
  integral: 'Pagamento integral',
  sinal: 'Sinal 50%',
  final: 'Parcela final 50%',
}

type Filtro = 'todos' | 'vencidos' | 'aberto' | 'pagos'

const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'vencidos', texto: 'Vencidos' },
  { id: 'aberto', texto: 'Em aberto' },
  { id: 'pagos', texto: 'Pagos' },
  { id: 'todos', texto: 'Todos' },
]

export default function HistoricoOrcamentos() {
  const [lista, setLista] = useState<Orcamento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('vencidos')
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [reconciliando, setReconciliando] = useState(false)
  const [avisoReconciliar, setAvisoReconciliar] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const r = await fetch('/api/admin/orcamentos', { cache: 'no-store' })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setErro(j?.erro ?? `Erro ao carregar (HTTP ${r.status}).`)
        return
      }
      setLista((j?.orcamentos ?? []) as Orcamento[])
    } catch {
      setErro('Falha de rede ao carregar os orçamentos.')
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function reconciliar() {
    setReconciliando(true)
    setAvisoReconciliar(null)
    try {
      const r = await fetch('/api/admin/orcamentos/reconciliar', { cache: 'no-store' })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setAvisoReconciliar(j?.erro ?? `Falhou (HTTP ${r.status}).`)
        return
      }
      const n = j?.marcadosPagos ?? 0
      setAvisoReconciliar(
        n > 0
          ? `${n} cobrança(s) marcada(s) como paga(s) — ${brl(j?.somaPagaCentavos ?? 0)}. Já estão no quadro de produção.`
          : `Conferi ${j?.conferidos ?? 0} cobrança(s) no Asaas. Nenhuma novidade.`
      )
      await carregar()
    } catch {
      setAvisoReconciliar('Falha de rede ao falar com o Asaas.')
    } finally {
      setReconciliando(false)
    }
  }

  const hoje = hojeISO()

  const enriquecidos = useMemo(() => {
    return (lista ?? []).map((o) => {
      const pago = o.pagamento_status === 'pago'
      const temCobranca = Boolean(o.asaas_payment_id)
      const venc = o.cobranca_vencimento?.slice(0, 10) ?? null
      const vencido = temCobranca && !pago && venc !== null && venc < hoje
      return { o, pago, temCobranca, vencido }
    })
  }, [lista, hoje])

  const resumo = useMemo(() => {
    let vencido = 0
    let aberto = 0
    let pago = 0
    let nVencidos = 0
    for (const e of enriquecidos) {
      const v = e.o.total_centavos ?? 0
      if (e.pago) pago += v
      else if (e.vencido) {
        vencido += v
        nVencidos++
      } else if (e.temCobranca) aberto += v
    }
    return { vencido, aberto, pago, nVencidos }
  }, [enriquecidos])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return enriquecidos
      .filter((e) => {
        if (filtro === 'vencidos') return e.vencido
        if (filtro === 'aberto') return !e.pago && e.temCobranca && !e.vencido
        if (filtro === 'pagos') return e.pago
        return true
      })
      .filter((e) => {
        if (!termo) return true
        return (
          e.o.numero.toLowerCase().includes(termo) ||
          (e.o.cliente_nome ?? '').toLowerCase().includes(termo)
        )
      })
  }, [enriquecidos, filtro, busca])

  if (erro) {
    return (
      <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
        {erro}
      </div>
    )
  }

  if (lista === null) {
    return <div className="text-sm text-gray-400 py-8 text-center">Carregando orçamentos…</div>
  }

  return (
    <div>
      {/* Resumo — o vencido em primeiro lugar, de propósito */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-red-200 rounded-2xl p-4">
          <div className="text-xs text-red-500">
            Vencido{resumo.nVencidos ? ` · ${resumo.nVencidos} cobrança(s)` : ''}
          </div>
          <div className="text-xl font-semibold text-red-600 mt-0.5">{brl(resumo.vencido)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="text-xs text-gray-500">Em aberto, dentro do prazo</div>
          <div className="text-xl font-semibold text-gray-800 mt-0.5">{brl(resumo.aberto)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="text-xs text-gray-500">Pago</div>
          <div className="text-xl font-semibold text-[#1D9E75] mt-0.5">{brl(resumo.pago)}</div>
        </div>
      </div>

      {/* Filtros + busca + reconciliação */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
              filtro === f.id
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {f.texto}
          </button>
        ))}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por número ou cliente"
          className="flex-1 min-w-[180px] border border-gray-200 rounded-xl px-3 py-1.5 text-xs text-gray-800 focus:outline-none focus:border-[#1D9E75] bg-white"
        />
        <button
          type="button"
          onClick={reconciliar}
          disabled={reconciliando}
          className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl px-3 py-1.5 disabled:opacity-50 bg-white"
          title="Pergunta ao Asaas o status de cada cobrança em aberto e grava o que mudou"
        >
          {reconciliando ? 'Conferindo…' : 'Conferir no Asaas'}
        </button>
      </div>

      {avisoReconciliar ? (
        <div className="mt-3 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          {avisoReconciliar}
        </div>
      ) : null}

      {/* Lista */}
      <div className="mt-4 space-y-2">
        {visiveis.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center border border-dashed border-gray-200 rounded-2xl">
            {filtro === 'vencidos'
              ? 'Nenhuma cobrança vencida. Bom sinal.'
              : 'Nenhum orçamento neste filtro.'}
          </div>
        ) : (
          visiveis.map(({ o, pago, vencido, temCobranca }) => (
            <div
              key={o.id}
              className={`bg-white border rounded-2xl overflow-hidden ${
                vencido ? 'border-red-200' : 'border-gray-200'
              }`}
            >
              <button
                type="button"
                onClick={() => setAberto((a) => (a === o.id ? null : o.id))}
                className="w-full text-left px-4 py-3 hover:bg-gray-50/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{o.numero}</span>
                      {o.modalidade === 'sinal_50' ? (
                        <span className="text-[10px] rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100">
                          50/50
                        </span>
                      ) : null}
                      {pago ? (
                        <span className="text-[10px] rounded-full px-2 py-0.5 bg-[#1D9E75]/10 text-[#0F6E56] border border-[#1D9E75]/20">
                          {o.modalidade === 'sinal_50' ? 'sinal pago' : 'pago'}
                        </span>
                      ) : vencido ? (
                        <span className="text-[10px] rounded-full px-2 py-0.5 bg-red-50 text-red-600 border border-red-100">
                          vencido {dataBR(o.cobranca_vencimento)}
                        </span>
                      ) : temCobranca ? (
                        <span className="text-[10px] rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-100">
                          aguardando pagamento
                        </span>
                      ) : (
                        <span className="text-[10px] rounded-full px-2 py-0.5 bg-gray-100 text-gray-500 border border-gray-200">
                          sem cobrança
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate">
                      {o.cliente_nome ?? 'sem cliente'} · emitido {dataBR(o.data_orcamento ?? o.criado_em)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-gray-900">
                      {brl(o.total_centavos)}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {aberto === o.id ? 'fechar' : 'ver parcelas'}
                    </div>
                  </div>
                </div>
              </button>

              {aberto === o.id ? (
                <PainelParcelas orcamento={o} aoMudar={carregar} />
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Painel de parcelas de um orçamento
// ---------------------------------------------------------------------------

function PainelParcelas({
  orcamento,
  aoMudar,
}: {
  orcamento: Orcamento
  aoMudar: () => Promise<void>
}) {
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [baixando, setBaixando] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')
  const [copiado, setCopiado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/admin/orcamentos/cobrancas?orcamento=${encodeURIComponent(orcamento.id)}`,
        { cache: 'no-store' }
      )
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setErro(j?.erro ?? `Erro ao carregar as parcelas (HTTP ${r.status}).`)
        return
      }
      setParcelas((j?.parcelas ?? []) as Parcela[])
    } catch {
      setErro('Falha de rede ao carregar as parcelas.')
    }
  }, [orcamento.id])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function agir(corpo: Record<string, unknown>) {
    setErro(null)
    setOcupado(true)
    try {
      const r = await fetch('/api/admin/orcamentos/cobrancas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) {
        setErro(j?.erro ?? `Não deu (HTTP ${r.status}).`)
        return
      }
      setParcelas((j?.parcelas ?? []) as Parcela[])
      setBaixando(null)
      setMotivo('')
      await aoMudar()
    } catch {
      setErro('Falha de rede.')
    } finally {
      setOcupado(false)
    }
  }

  async function copiarLink(parcela: number) {
    const url = `${window.location.origin}/orcamento/${orcamento.id}/pix?p=${parcela}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(`p${parcela}`)
      setTimeout(() => setCopiado(null), 2500)
    } catch {
      setErro(`Não consegui copiar. O link é: ${url}`)
    }
  }

  const temSinalPago = (parcelas ?? []).some((p) => p.rotulo === 'sinal' && p.status === 'paga')
  const temFinal = (parcelas ?? []).some((p) => p.rotulo === 'final')
  const podeGerarFinal = orcamento.modalidade === 'sinal_50' && temSinalPago && !temFinal

  return (
    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4">
      {parcelas === null ? (
        <div className="text-xs text-gray-400">Carregando parcelas…</div>
      ) : parcelas.length === 0 ? (
        <div className="text-xs text-gray-500">
          Este orçamento não tem cobrança gerada — foi emitido só como PDF.
        </div>
      ) : (
        <div className="space-y-2">
          {parcelas.map((p) => {
            const vencida =
              p.status === 'gerada' && p.vencimento !== null && p.vencimento.slice(0, 10) < hojeISO()
            return (
              <div
                key={p.id}
                className="bg-white border border-gray-200 rounded-xl px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm text-gray-900">
                      {ROTULO_PARCELA[p.rotulo]}{' '}
                      <strong>{brl(p.valorCentavos)}</strong>
                      {p.descontoPercentual > 0 ? (
                        <span className="text-xs text-gray-400">
                          {' '}
                          · {p.descontoPercentual}% no PIX até o vencimento
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs mt-0.5">
                      {p.status === 'paga' ? (
                        <span className="text-[#0F6E56]">
                          Paga em {dataBR(p.pagoEm)}
                          {p.origemBaixa === 'manual'
                            ? ` · baixa manual: ${p.baixaMotivo ?? 'sem motivo'}`
                            : ' · confirmada pelo Asaas'}
                        </span>
                      ) : p.status === 'cancelada' ? (
                        <span className="text-gray-400">Cancelada</span>
                      ) : vencida ? (
                        <span className="text-red-600">
                          Venceu em {dataBR(p.vencimento)} — cobrar
                        </span>
                      ) : (
                        <span className="text-gray-500">
                          Vence em {dataBR(p.vencimento)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {p.pixCopiaCola ? (
                      <button
                        type="button"
                        onClick={() => copiarLink(p.parcela)}
                        className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5"
                      >
                        {copiado === `p${p.parcela}` ? 'Link copiado ✓' : 'Copiar link'}
                      </button>
                    ) : null}
                    {p.asaasInvoiceUrl ? (
                      <a
                        href={p.asaasInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                      >
                        Asaas
                      </a>
                    ) : null}
                    {p.status === 'gerada' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setBaixando(baixando === p.parcela ? null : p.parcela)
                          setMotivo('')
                        }}
                        className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5"
                      >
                        Marcar como paga
                      </button>
                    ) : null}
                  </div>
                </div>

                {baixando === p.parcela ? (
                  <div className="mt-2.5 border-t border-gray-100 pt-2.5">
                    <label className="block text-[11px] text-gray-500 mb-1">
                      Como o cliente pagou? Fica registrado — daqui a três meses você vai
                      querer saber.
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ex.: PIX direto na chave, comprovante no WhatsApp em 21/08"
                        className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#1D9E75]"
                      />
                      <button
                        type="button"
                        disabled={ocupado || motivo.trim().length < 3}
                        onClick={() =>
                          agir({
                            acao: 'baixa_manual',
                            orcamentoId: orcamento.id,
                            parcela: p.parcela,
                            motivo: motivo.trim(),
                          })
                        }
                        className="bg-gray-900 disabled:opacity-40 text-white text-xs rounded-lg px-3 py-1.5"
                      >
                        {ocupado ? 'Gravando…' : 'Confirmar baixa'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* Liberar a parcela final */}
      {orcamento.modalidade === 'sinal_50' ? (
        <div className="mt-3">
          {podeGerarFinal ? (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => agir({ acao: 'gerar_final', orcamentoId: orcamento.id })}
              className="bg-[#1D9E75] hover:bg-[#188a65] disabled:opacity-50 text-white text-xs font-medium rounded-xl px-4 py-2"
            >
              {ocupado ? 'Gerando…' : 'Liberar parcela final (50%)'}
            </button>
          ) : temFinal ? null : (
            <div className="text-xs text-gray-400">
              A parcela final fica disponível assim que o sinal for pago.
            </div>
          )}
        </div>
      ) : null}

      {erro ? (
        <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          {erro}
        </div>
      ) : null}

      <div className="mt-3 text-[11px] text-gray-400">
        {orcamento.pagamento_status === 'pago'
          ? 'Pagamento liberado — este orçamento já está no quadro de produção.'
          : 'A produção começa quando a primeira parcela for paga.'}
      </div>
    </div>
  )
}
