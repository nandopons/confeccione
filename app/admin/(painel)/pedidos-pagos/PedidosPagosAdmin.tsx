'use client'

import { useEffect, useRef, useState } from 'react'

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
  codigo?: string | null
  criado_em: string
  nome: string | null
  cep: string | null
  valor_centavos: number | null
  pagamento_status?: string | null
  finalizado_em?: string | null
  confirmado_em?: string | null
  orcamento_status?: string | null
  status?: string | null
  telefone?: string | null
  email?: string | null
  prazo_dias?: number | null
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

// Detalhe do chat (reusa /api/admin/pedidos-assistente/[id])
type LinhaDetalhe = {
  modelo?: string | null; cor?: string | null; material?: string | null; publico?: string | null
  total?: number | null; tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null
  estampado?: boolean | null; descricao?: string | null
}
type Detalhe = {
  id: string
  contato: { nome: string | null; telefone: string | null; email: string | null; cep: string | null; numero: string | null; complemento: string | null; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; prazoDias: number | null }
  linhas: LinhaDetalhe[]
  conversa: Array<{ role: 'user' | 'assistant'; texto: string }>
  mockups: Array<{ index: number; temLiso: boolean; temArte: boolean }>
}

function brl(centavos: number | null | undefined): string {
  if (centavos == null) return '—'
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function data(s: string): string {
  try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return s }
}

// Deep-link pro inbox oficial (/admin/whatsapp) já na conversa do cliente,
// com saudação pré-preenchida no composer. Abre/cria a conversa no sistema.
function linkWhatsCliente(telefone: string | null | undefined, nome: string | null): string | null {
  if (!telefone) return null
  const num = telefone.replace(/\D/g, '')
  if (!num) return null
  const primeiroNome = (nome || '').trim().split(/\s+/)[0] || ''
  const saud = primeiroNome ? `Olá ${primeiroNome}! ` : 'Olá! '
  const texto = `${saud}Aqui é da Confeccione 😊 Vi seu pedido e queria alinhar alguns detalhes antes de seguir com a produção. Tem um minutinho?`
  const q = new URLSearchParams({ abrir: num, ...(nome ? { nome } : {}), t: texto })
  return `/admin/whatsapp?${q.toString()}`
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

type FiltroChip = 'todos' | 'ofertar' | 'oferta' | 'aceitos' | 'pagos' | 'finalizados' | 'incompletos'
const FILTROS: { id: FiltroChip; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'ofertar', label: 'Para ofertar' },
  { id: 'oferta', label: 'Em oferta' },
  { id: 'aceitos', label: 'Aceitos' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'finalizados', label: 'Finalizados' },
  { id: 'incompletos', label: 'Incompletos' },
]

function casaFiltro(p: Pedido, f: FiltroChip): boolean {
  const temAceita = p.ofertas.some((o) => o.status === 'aceita')
  const temOfertada = p.ofertas.some((o) => o.status === 'ofertada')
  const pago = p.pagamento_status === 'pago'
  switch (f) {
    case 'todos': return true
    case 'ofertar': return !p.orcamento_status && !temAceita && !pago
    case 'oferta': return temOfertada
    case 'aceitos': return temAceita
    case 'pagos': return pago
    case 'finalizados': return p.finalizado_em != null
    case 'incompletos': return p.status !== 'completo'
    default: return true
  }
}

export default function PedidosPagosAdmin() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [selecao, setSelecao] = useState<Record<string, Set<string>>>({})
  const [filtroForn, setFiltroForn] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [chip, setChip] = useState<FiltroChip>('todos')

  // detalhe expansível (chat)
  const [aberto, setAberto] = useState<string | null>(null)
  const [det, setDet] = useState<Record<string, Detalhe>>({})
  const [agindo, setAgindo] = useState<string | null>(null)
  const [reabrindo, setReabrindo] = useState<string | null>(null)
  const [entregaEdit, setEntregaEdit] = useState<string | null>(null)
  const [entregaForm, setEntregaForm] = useState<{ cep: string; numero: string; complemento: string }>({ cep: '', numero: '', complemento: '' })
  const [salvandoEntrega, setSalvandoEntrega] = useState(false)
  // Deep-link ?pedido=<id> (vindo do popup do Funil): traz o card pro TOPO da
  // lista, já expandido e destacado (scroll programático não é confiável aqui).
  const [fixado, setFixado] = useState<string | null>(null)
  const deepLinkRef = useRef(false)

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

  // Deep-link do Funil: com a lista carregada, fixa o pedido da URL no topo
  // da lista, já expandido e com destaque. Roda uma única vez.
  useEffect(() => {
    if (deepLinkRef.current || pedidos.length === 0) return
    deepLinkRef.current = true
    let alvo: string | null = null
    try {
      alvo = new URLSearchParams(window.location.search).get('pedido')
    } catch {
      /* */
    }
    if (!alvo || !pedidos.some((p) => p.id === alvo)) return
    setChip('todos')
    void abrir(alvo)
    setFixado(alvo)
    try {
      window.history.replaceState(null, '', '/admin/pedidos-pagos')
    } catch {
      /* */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos])

  async function finalizar(id: string, desfazer: boolean) {
    if (!desfazer && !confirm('Marcar este pedido como finalizado (entregue ao cliente)?')) return
    setAgindo(id + 'finalizar')
    setAviso(null)
    try {
      const r = await fetch('/api/admin/pedidos-assistente/finalizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, desfazer }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao finalizar')
      setPedidos((ps) => ps.map((x) => (x.id === id ? { ...x, finalizado_em: j.finalizadoEm ?? null } : x)))
      setAviso(desfazer ? 'Pedido voltou pra "em produção".' : 'Pedido finalizado. 🎉')
    } catch (e: any) {
      setAviso(e.message || 'Erro')
    } finally {
      setAgindo(null)
    }
  }

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

  async function reabrir(pedidoId: string) {
    if (!confirm('Reabrir este pedido? As ofertas atuais serão canceladas e o orçamento zerado para ofertar de novo.')) return
    setReabrindo(pedidoId)
    setAviso(null)
    try {
      const r = await fetch('/api/admin/pedidos-pagos/reabrir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao reabrir')
      setAviso('Pedido reaberto — pode ofertar de novo.')
      await carregar()
    } catch (e: any) {
      setAviso(e.message || 'Erro')
    } finally {
      setReabrindo(null)
    }
  }

  async function abrir(id: string) {
    if (aberto === id) { setAberto(null); return }
    setAberto(id)
    if (!det[id]) {
      try {
        const r = await fetch(`/api/admin/pedidos-assistente/${id}`, { cache: 'no-store' })
        const j = await r.json()
        if (j.ok) setDet((m) => ({ ...m, [id]: j }))
      } catch {
        /* silencioso — detalhe é best-effort */
      }
    }
  }

  function abrirEntrega(p: Pedido) {
    const c = (det[p.id] as Detalhe | undefined)?.contato
    setEntregaForm({ cep: (c?.cep ?? p.cep ?? '') || '', numero: c?.numero ?? '', complemento: c?.complemento ?? '' })
    setEntregaEdit((cur) => (cur === p.id ? null : p.id))
  }
  async function salvarEntregaAdmin(id: string) {
    const cepDigs = entregaForm.cep.replace(/\D/g, '')
    if (cepDigs.length !== 8) { setAviso('CEP deve ter 8 dígitos.'); return }
    setSalvandoEntrega(true); setAviso(null)
    try {
      const r = await fetch(`/api/pedido/assistente/${id}/entrega`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cep: cepDigs, numero: entregaForm.numero.trim() || null, complemento: entregaForm.complemento.trim() || null }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setAviso(j.erro || 'Falha ao salvar endereço'); return }
      setPedidos((ps) => ps.map((x) => x.id === id ? { ...x, cep: cepDigs } : x))
      try { const rd = await fetch(`/api/admin/pedidos-assistente/${id}`, { cache: 'no-store' }); const jd = await rd.json(); if (jd.ok) setDet((m) => ({ ...m, [id]: jd })) } catch {}
      setEntregaEdit(null); setAviso('Endereço atualizado.')
    } finally { setSalvandoEntrega(false) }
  }

  async function acao(id: string, ac: 'excluir' | 'lembrete' | 'feedback') {
    if (ac === 'excluir' && !confirm('Excluir este pedido? Não dá pra desfazer.')) return
    setAgindo(id + ac); setAviso(null)
    try {
      const r = await fetch(`/api/admin/pedidos-assistente/${id}/acao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: ac }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha')
      if (ac === 'excluir') {
        setPedidos((ps) => ps.filter((x) => x.id !== id))
        if (aberto === id) setAberto(null)
        setAviso('Pedido excluído.')
      } else {
        setAviso(`${ac === 'lembrete' ? 'Lembrete' : 'Pedido de feedback'} enviado` + (j.whats || j.email ? ` (${[j.whats ? 'WhatsApp' : null, j.email ? 'e-mail' : null].filter(Boolean).join(' + ')}).` : ', mas nenhum canal disponível.'))
      }
    } catch (e: any) { setAviso(e.message || 'Erro') }
    finally { setAgindo(null) }
  }

  const filtrados = pedidos.filter((p) => casaFiltro(p, chip))
  // Pedido vindo do funil vai pro topo da lista (independente do filtro).
  const pedidoFixado = fixado ? pedidos.find((p) => p.id === fixado) ?? null : null
  const visiveis = pedidoFixado ? [pedidoFixado, ...filtrados.filter((p) => p.id !== fixado)] : filtrados

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedidos &amp; Ofertas</h1>
          <p className="text-sm text-gray-500">Todos os pedidos do chat: veja a conversa/mockups, oferte a fornecedores, gerencie o aceite e reabra pra ofertar de novo.</p>
        </div>
        <button onClick={carregar} className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50">Atualizar</button>
      </div>

      {/* filtros */}
      <div className="flex flex-wrap gap-1 mb-4">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setChip(f.id)}
            className={'text-sm px-3 py-1.5 rounded-md ' + (chip === f.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {aviso && <div className="mb-4 text-sm rounded-md bg-blue-50 text-blue-800 px-3 py-2">{aviso}</div>}
      {erro && <div className="mb-4 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro}</div>}
      {carregando && <p className="text-sm text-gray-500">Carregando…</p>}
      {!carregando && visiveis.length === 0 && <p className="text-sm text-gray-500">Nenhum pedido neste filtro.</p>}

      <div className="space-y-3">
        {visiveis.map((p) => {
          const totalPecas = p.linhas.reduce((s, l) => s + (typeof l.total === 'number' ? l.total : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0)), 0)
          const aceita = p.ofertas.find((o) => o.status === 'aceita')
          const f = (filtroForn[p.id] || '').toLowerCase()
          const listaForn = fornecedores.filter((x) =>
            !f || (x.nome || '').toLowerCase().includes(f) || (x.cidade || '').toLowerCase().includes(f) || (x.estado || '').toLowerCase().includes(f)
          )
          const sel = selecao[p.id] ?? new Set<string>()
          const jaOfertados = new Set(p.ofertas.filter((o) => o.status === 'ofertada' || o.status === 'aceita').map((o) => o.fornecedor_id))
          const temOfertada = p.ofertas.some((o) => o.status === 'ofertada')
          const podeReabrir = !!aceita || temOfertada || !!p.orcamento_status
          const d = det[p.id]
          const expandido = aberto === p.id
          return (
            <div
              key={p.id}
              id={`pedido-${p.id}`}
              className={
                'rounded-lg border bg-white p-3.5 transition-all scroll-mt-4 ' +
                (fixado === p.id
                  ? 'border-[#1D9E75] ring-2 ring-[#1D9E75]/40 shadow-lg'
                  : 'border-gray-200')
              }
            >
              {fixado === p.id && (
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[#0F6E56] bg-[#E1F5EE]/70 rounded-md px-2.5 py-1.5">
                  <span>📌 Pedido aberto pelo funil — trazido pro topo da lista.</span>
                  <button onClick={() => setFixado(null)} className="underline hover:no-underline shrink-0">voltar à ordem normal</button>
                </div>
              )}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-gray-500">{p.codigo ? <span className="font-semibold text-gray-700">Nº {p.codigo}</span> : null}{p.codigo ? ' · ' : ''}{data(p.criado_em)} · {p.nome || 'Sem nome'} · {p.cep || 'sem CEP'}</div>
                  <div className="font-medium text-gray-900">
                    {p.pagamento_status === 'pago'
                      ? `${totalPecas} peças · cliente pagou ${brl(p.valor_centavos)} · fornecedor recebe ${brl(repasse97(p.valor_centavos))}`
                      : p.orcamento_status === 'definido'
                        ? `${totalPecas} peças · orçamento enviado: ${brl(p.valor_centavos)} (aguardando pagamento)`
                        : `${totalPecas} peças · fornecedor define o orçamento ao aceitar`}
                  </div>
                  {p.prazo_dias ? <div className="text-sm text-[#0F6E56]">⏱️ Prazo: {p.prazo_dias} dias (a partir do pagamento)</div> : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={'text-xs px-2 py-1 rounded-full ' + (p.finalizado_em ? 'bg-[#0E1814] text-white' : p.pagamento_status === 'pago' ? 'bg-green-100 text-green-800' : p.orcamento_status === 'definido' ? 'bg-amber-100 text-amber-800' : p.orcamento_status === 'aguardando_fornecedor' ? 'bg-blue-100 text-blue-800' : p.status !== 'completo' ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-600')}>
                    {p.finalizado_em ? '✅ Finalizado' : p.pagamento_status === 'pago' ? 'Pago' : p.orcamento_status === 'definido' ? 'Orçamento enviado' : p.orcamento_status === 'aguardando_fornecedor' ? 'Com fornecedor' : p.status !== 'completo' ? 'Incompleto' : 'Aguardando oferta'}
                  </span>
                  {aceita && (
                    <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-800">
                      Aceito por {aceita.fornecedor_nome || 'fornecedor'}
                    </span>
                  )}
                </div>
              </div>

              <ul className="mt-2 text-sm text-gray-700 space-y-0.5">
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

              {/* Ações: detalhe + reabrir */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button onClick={() => abrir(p.id)} className="text-sm px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50">
                  {expandido ? 'Ocultar detalhes' : 'Ver conversa, mockups e contato'}
                </button>
                {podeReabrir && (
                  <button
                    onClick={() => reabrir(p.id)}
                    disabled={reabrindo === p.id}
                    className="text-sm px-3 py-1.5 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {reabrindo === p.id ? 'Reabrindo…' : 'Reabrir e ofertar novamente'}
                  </button>
                )}
                <button onClick={() => abrirEntrega(p)} className={'text-sm px-3 py-1.5 rounded-md border ' + (p.cep ? 'border-gray-200 text-gray-700 hover:bg-gray-50' : 'border-[#1D9E75]/40 text-[#0F6E56] hover:bg-[#E1F5EE]/60')}>
                  {p.cep ? '📍 Editar entrega' : '📍 Lançar CEP/endereço'}
                </button>
                {p.pagamento_status === 'pago' && !p.finalizado_em && (
                  <button
                    onClick={() => finalizar(p.id, false)}
                    disabled={agindo === p.id + 'finalizar'}
                    className="text-sm px-3 py-1.5 rounded-md bg-[#1D9E75] text-white hover:bg-[#178A64] disabled:opacity-50"
                  >
                    {agindo === p.id + 'finalizar' ? 'Finalizando…' : '✅ Marcar finalizado'}
                  </button>
                )}
                {p.finalizado_em && (
                  <button
                    onClick={() => finalizar(p.id, true)}
                    disabled={agindo === p.id + 'finalizar'}
                    className="text-sm px-2 py-1.5 text-gray-400 hover:text-gray-600 underline"
                  >
                    desfazer finalizado
                  </button>
                )}
              </div>
              {entregaEdit === p.id && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/70 p-3">
                  <div className="flex flex-wrap gap-2">
                    <input value={entregaForm.cep} onChange={(e) => setEntregaForm((d) => ({ ...d, cep: e.target.value.replace(/[^\d-]/g, '').slice(0, 9) }))} inputMode="numeric" placeholder="CEP" className="w-32 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900" />
                    <input value={entregaForm.numero} onChange={(e) => setEntregaForm((d) => ({ ...d, numero: e.target.value.slice(0, 20) }))} placeholder="Número" className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900" />
                    <input value={entregaForm.complemento} onChange={(e) => setEntregaForm((d) => ({ ...d, complemento: e.target.value.slice(0, 80) }))} placeholder="Complemento (opcional)" className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900" />
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => void salvarEntregaAdmin(p.id)} disabled={salvandoEntrega} className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-1.5 rounded-md disabled:opacity-50">{salvandoEntrega ? 'Salvando…' : 'Salvar endereço'}</button>
                    <button onClick={() => setEntregaEdit(null)} className="text-sm text-gray-500 hover:text-gray-700 px-2">Cancelar</button>
                    <span className="text-[11px] text-gray-400">Rua/cidade são preenchidas pelo CEP.</span>
                  </div>
                </div>
              )}

              {/* Detalhe expansível (chat) */}
              {expandido && (
                <div className="mt-3 border-t border-gray-100 pt-4 space-y-5">
                  {!d ? <p className="text-sm text-gray-400">Carregando detalhe…</p> : (
                    <>
                      {/* contato */}
                      <div className="text-sm text-gray-700">
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Contato</div>
                        <div>{d.contato.nome} · {d.contato.telefone} · {d.contato.email}</div>
                        <div className="text-gray-500">{[d.contato.logradouro, d.contato.numero, d.contato.bairro, [d.contato.cidade, d.contato.uf].filter(Boolean).join('/'), d.contato.cep, d.contato.complemento].filter(Boolean).join(', ')}</div>
                        {d.contato.prazoDias ? <div className="text-gray-500">Prazo: {d.contato.prazoDias} dias</div> : null}
                        {linkWhatsCliente(d.contato.telefone, d.contato.nome) && (
                          <a
                            href={linkWhatsCliente(d.contato.telefone, d.contato.nome)!}
                            className="inline-flex items-center gap-1.5 mt-2 bg-[#1D9E75] hover:bg-[#17845F] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.5-.7-2.5-1.3-3.5-3-.3-.5.3-.4.8-1.4.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.7.7-1 1.6-1 2.6.1 1.5 1.1 3 1.3 3.2.2.2 2.3 3.5 5.5 4.7 2.2.8 2.6.7 3.1.6.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.1-1.3c1.4.8 3.1 1.2 4.9 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>
                            Conversar no chat oficial
                            <span className="text-[10px] font-semibold bg-white/20 rounded px-1 py-px">no sistema</span>
                          </a>
                        )}
                      </div>

                      {/* produtos + mockups */}
                      <div>
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Produtos e mockups</div>
                        <div className="space-y-4">
                          {d.linhas.map((l, i) => {
                            const mk = d.mockups.find((m) => m.index === i)
                            return (
                              <div key={i} className="rounded-lg border border-gray-100 p-3">
                                <div className="text-sm font-medium text-gray-900">
                                  {l.total ?? '?'}× {l.modelo || 'peça'}{l.publico && l.publico !== 'unissex' ? ` ${l.publico}` : ''}{l.cor ? ` · ${l.cor}` : ''}{l.material ? ` · ${l.material}` : ''}{l.estampado ? ' (estampado)' : ''}
                                </div>
                                {l.descricao && <div className="text-xs text-gray-500 mt-0.5">{l.descricao}</div>}
                                <div className="flex flex-wrap gap-3 mt-2">
                                  {mk?.temLiso && (
                                    <figure className="text-center">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={`/api/admin/pedidos-assistente/${p.id}/img?linha=${i}&tipo=liso`} alt="liso" className="h-28 rounded border border-gray-200" />
                                      <figcaption className="text-[10px] text-gray-400 mt-0.5">liso</figcaption>
                                    </figure>
                                  )}
                                  {mk?.temArte && (
                                    <figure className="text-center">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={`/api/admin/pedidos-assistente/${p.id}/img?linha=${i}&tipo=arte`} alt="arte" className="h-28 rounded border border-[#1D9E75]/40" />
                                      <figcaption className="text-[10px] text-[#0F6E56] mt-0.5">com arte</figcaption>
                                    </figure>
                                  )}
                                  {!mk?.temLiso && !mk?.temArte && <span className="text-xs text-gray-400">sem mockup gerado</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* conversa */}
                      <div>
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Conversa</div>
                        {d.conversa.length === 0 ? <p className="text-xs text-gray-400">Sem transcrição (pedido anterior à gravação do chat).</p> : (
                          <div className="space-y-2 max-h-96 overflow-y-auto rounded-lg bg-gray-50 border border-gray-100 p-3">
                            {d.conversa.map((c, k) => (
                              <div key={k} className={c.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                                <div className={'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap ' + (c.role === 'user' ? 'bg-[#1D9E75] text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm')}>
                                  {c.texto}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                        <a href={`/visualizador/${p.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-[#0F6E56] underline mr-auto">Abrir visualizador do cliente ↗</a>
                        <button type="button" onClick={() => acao(p.id, 'lembrete')} disabled={agindo === p.id + 'lembrete'} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">{agindo === p.id + 'lembrete' ? '…' : 'Lembrar de continuar'}</button>
                        <button type="button" onClick={() => acao(p.id, 'feedback')} disabled={agindo === p.id + 'feedback'} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">{agindo === p.id + 'feedback' ? '…' : 'Pedir feedback do mockup'}</button>
                        <button type="button" onClick={() => acao(p.id, 'excluir')} disabled={agindo === p.id + 'excluir'} className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">Excluir</button>
                      </div>
                    </>
                  )}
                </div>
              )}

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
                        {o.valor_repasse_centavos != null && <span className="text-gray-500">repasse {brl(o.valor_repasse_centavos)}</span>}
                        {o.status === 'ofertada' && (
                          <span className="flex gap-1">
                            <button onClick={() => mudarStatus(o.id, 'aceita')} className="text-xs px-2 py-0.5 rounded border border-green-300 text-green-700 hover:bg-green-50">Marcar aceito</button>
                            <button onClick={() => mudarStatus(o.id, 'recusada')} className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">Recusou</button>
                            <button onClick={() => mudarStatus(o.id, 'cancelada')} className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50">Cancelar</button>
                          </span>
                        )}
                        {o.status === 'aceita' && (
                          <button onClick={() => mudarStatus(o.id, 'cancelada')} className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-50">Cancelar aceite</button>
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
                    <div className="text-xs font-medium text-gray-500">{temOfertada ? 'Reofertar a fornecedores' : 'Ofertar a fornecedores'}</div>
                    <input
                      value={filtroForn[p.id] || ''}
                      onChange={(e) => setFiltroForn((prev) => ({ ...prev, [p.id]: e.target.value }))}
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
                      {enviando === p.id ? 'Ofertando…' : `${temOfertada ? 'Reofertar' : 'Ofertar'} (${sel.size})`}
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
