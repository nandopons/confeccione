'use client'

import { useEffect, useMemo, useState } from 'react'

type Tamanho = { tamanho?: string | null; qtd?: number | null }
type Estampa = { posicao?: string | null; tamanho?: string | null }
type Linha = {
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: Tamanho[] | null
  estampas?: Estampa[] | null
  descricao?: string | null
}
type Oferta = {
  id: string
  fornecedor_id: string
  fornecedor_nome: string | null
  fornecedor_whatsapp: string | null
  status: 'ofertada' | 'aceita' | 'recusada' | 'cancelada'
  valor_repasse_centavos: number | null
  criado_em: string
  respondido_em: string | null
}
type Pedido = {
  id: string
  criado_em: string
  nome: string | null
  cep: string | null
  valor_centavos: number | null
  linhas: Linha[]
  ofertas: Oferta[]
}
type Fornecedor = {
  id: string
  nome: string | null
  whatsapp: string | null
  cidade: string | null
  estado: string | null
  status: string | null
  tipos_produto: string[] | null
}

function brl(centavos: number | null | undefined): string {
  if (centavos == null) return '—'
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function data(s: string): string {
  try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return s }
}
function repasse97(centavos: number | null | undefined): number | null {
  if (centavos == null) return null
  return centavos - Math.round(centavos * 0.03)
}

const STATUS_COR: Record<Oferta['status'], string> = {
  ofertada: 'bg-amber-100 text-amber-800',
  aceita: 'bg-green-100 text-green-800',
  recusada: 'bg-gray-100 text-gray-600',
  cancelada: 'bg-gray-100 text-gray-500',
}

export default function PedidosPagosAdmin() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [selecao, setSelecao] = useState<Record<string, Set<string>>>({})
  const [filtro, setFiltro] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const r = await fetch('/api/admin/pedidos-pagos', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao carregar')
      setPedidos(j.pedidos || [])
      setFornecedores(j.fornecedores || [])
    } catch (e: any) {
      setErro(e.message || 'Erro')
    } finally {
      setCarregando(false)
    }
  }
  useEffect(() => { carregar() }, [])

  function toggleForn(pedidoId: string, fid: string) {
    setSelecao((prev) => {
      const atual = new Set(prev[pedidoId] ?? [])
      if (atual.has(fid)) atual.delete(fid)
      else atual.add(fid)
      return { ...prev, [pedidoId]: atual }
    })
  }

  async function ofertar(pedidoId: string) {
    const ids = [...(selecao[pedidoId] ?? [])]
    if (ids.length === 0) { setAviso('Selecione ao menos um fornecedor.'); return }
    setEnviando(pedidoId)
    setAviso(null)
    try {
      const r = await fetch('/api/admin/pedidos-pagos/ofertar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId, fornecedorIds: ids }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao ofertar')
      setAviso(`Ofertado a ${j.criadas} fornecedor(es) — ${j.notificadas} notificado(s) por WhatsApp.`)
      setSelecao((prev) => ({ ...prev, [pedidoId]: new Set() }))
      await carregar()
    } catch (e: any) {
      setAviso(e.message || 'Erro')
    } finally {
      setEnviando(null)
    }
  }

  async function mudarStatus(ofertaId: string, status: 'aceita' | 'recusada' | 'cancelada') {
    try {
      const r = await fetch('/api/admin/pedidos-pagos/oferta-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ofertaId, status }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha')
      await carregar()
    } catch (e: any) {
      setAviso(e.message || 'Erro')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedidos pagos</h1>
          <p className="text-sm text-gray-500">Pedidos já pagos pelo cliente. Escolha os fornecedores e oferte — eles recebem o resumo e o valor do pedido por WhatsApp.</p>
        </div>
        <button onClick={carregar} className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50">Atualizar</button>
      </div>

      {aviso && <div className="mb-4 text-sm rounded-md bg-blue-50 text-blue-800 px-3 py-2">{aviso}</div>}
      {erro && <div className="mb-4 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro}</div>}
      {carregando && <p className="text-sm text-gray-500">Carregando…</p>}
      {!carregando && pedidos.length === 0 && <p className="text-sm text-gray-500">Nenhum pedido pago no momento.</p>}

      <div className="space-y-5">
        {pedidos.map((p) => {
          const totalPecas = p.linhas.reduce((s, l) => s + (typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)), 0)
          const aceita = p.ofertas.find((o) => o.status === 'aceita')
          const f = (filtro[p.id] || '').toLowerCase()
          const listaForn = fornecedores.filter((x) =>
            !f || (x.nome || '').toLowerCase().includes(f) || (x.cidade || '').toLowerCase().includes(f) || (x.estado || '').toLowerCase().includes(f)
          )
          const sel = selecao[p.id] ?? new Set<string>()
          const jaOfertados = new Set(p.ofertas.filter((o) => o.status === 'ofertada' || o.status === 'aceita').map((o) => o.fornecedor_id))
          return (
            <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-500">{data(p.criado_em)} · {p.cep || 'sem CEP'}</div>
                  <div className="font-medium text-gray-900">{totalPecas} peças · cliente pagou {brl(p.valor_centavos)} · fornecedor recebe {brl(repasse97(p.valor_centavos))}</div>
                </div>
                {aceita && (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">
                    Aceito por {aceita.fornecedor_nome || 'fornecedor'}
                  </span>
                )}
              </div>

              <ul className="mt-3 text-sm text-gray-700 space-y-1">
                {p.linhas.map((l, i) => {
                  const tam = (l.tamanhos || []).filter((t) => t.tamanho).map((t) => `${t.tamanho}:${t.qtd ?? '?'}`).join(' ')
                  const estampado = (l.estampas?.length ?? 0) > 0
                  return (
                    <li key={i}>
                      • {l.total ?? '?'}× {l.modelo || 'peça'}{l.cor ? ` ${l.cor}` : ''}{l.material ? ` · ${l.material}` : ''}{estampado ? ' (estampado)' : ''}
                      {tam ? <span className="text-gray-500"> — {tam}</span> : null}
                    </li>
                  )
                })}
              </ul>

              {/* Ofertas já feitas */}
              {p.ofertas.length > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="text-xs font-medium text-gray-500 mb-1">Ofertas</div>
                  <div className="space-y-1">
                    {p.ofertas.map((o) => (
                      <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={'text-xs px-2 py-0.5 rounded-full ' + STATUS_COR[o.status]}>{o.status}</span>
                        <span className="text-gray-800">{o.fornecedor_nome || o.fornecedor_id.slice(0, 8)}</span>
                        {o.fornecedor_whatsapp && <span className="text-gray-400">{o.fornecedor_whatsapp}</span>}
                        {o.status === 'ofertada' && (
                          <span className="flex gap-1">
                            <button onClick={() => mudarStatus(o.id, 'aceita')} className="text-xs px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50">Marcar aceito</button>
                            <button onClick={() => mudarStatus(o.id, 'recusada')} className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">Recusou</button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Seletor de fornecedores */}
              {!aceita && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-medium text-gray-500">Ofertar a fornecedores</div>
                    <input
                      value={filtro[p.id] || ''}
                      onChange={(e) => setFiltro((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="filtrar por nome/cidade/UF"
                      className="text-sm border border-gray-300 rounded px-2 py-1 w-56"
                    />
                  </div>
                  <div className="max-h-52 overflow-auto rounded border border-gray-100 divide-y divide-gray-50">
                    {listaForn.map((x) => {
                      const ja = jaOfertados.has(x.id)
                      return (
                        <label key={x.id} className={'flex items-center gap-2 px-2 py-1.5 text-sm ' + (ja ? 'opacity-50' : 'hover:bg-gray-50 cursor-pointer')}>
                          <input
                            type="checkbox"
                            disabled={ja}
                            checked={sel.has(x.id)}
                            onChange={() => toggleForn(p.id, x.id)}
                          />
                          <span className="text-gray-800">{x.nome || x.id.slice(0, 8)}</span>
                          <span className="text-gray-400">{[x.cidade, x.estado].filter(Boolean).join('/')}</span>
                          {x.status !== 'ativo' && <span className="text-xs text-amber-600">({x.status})</span>}
                          {ja && <span className="text-xs text-gray-400 ml-auto">já ofertado</span>}
                        </label>
                      )
                    })}
                    {listaForn.length === 0 && <div className="px-2 py-2 text-sm text-gray-400">Nenhum fornecedor.</div>}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => ofertar(p.id)}
                      disabled={enviando === p.id || sel.size === 0}
                      className="text-sm px-3 py-1.5 rounded-md bg-gray-900 text-white disabled:opacity-40"
                    >
                      {enviando === p.id ? 'Ofertando…' : `Ofertar (${sel.size})`}
                    </button>
                    <span className="text-xs text-gray-400">Envia WhatsApp com o resumo + valor, sem o contato do cliente.</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
