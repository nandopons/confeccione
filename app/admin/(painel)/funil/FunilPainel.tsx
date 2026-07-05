'use client'

// app/admin/(painel)/funil/FunilPainel.tsx
// ============================================================================
// Mapa do funil da Confeccione (estilo Funnelytics): nós e setas com números
// vivos do banco — tráfego → ações no site → pedidos → status → fornecedor.
// Clique num nó com lista abre o drawer de drill-down (com "Conversar" que
// cai direto no inbox oficial: /admin/whatsapp?abrir=<tel>&nome=<nome>).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

// ----------------------------------------------------------------- tipos
type ItemLista = {
  id: string
  nome: string
  telefone?: string | null
  email?: string | null
  resumo?: string | null
  fornecedor?: string | null
  cliente?: string | null
  valorCentavos?: number | null
  pecas?: number | null
  status?: string
  criadoEm: string
}

type Dados = {
  dias: number
  site: { sessoes: number; pageviews: number; origens: { fonte: string; sessoes: number }[] }
  acoes: { assistenteIniciado: number; pedidoEnviadoEventos: number; whatsapp: number; cadastros: number }
  assistido: {
    criados: number
    pelaMetade: ItemLista[]
    confirmados: ItemLista[]
    cancelados: number
    receitaCentavos: number
  }
  classico: {
    criados: number
    buscando: ItemLista[]
    negociacao: ItemLista[]
    expirados: number
    concluidos: ItemLista[]
    ofertas: { enviadas: number; aceitas: number; recusadas: number; expiradas: number }
  }
  fornecedor: { encaminhados: ItemLista[]; aceitos: ItemLista[]; perdidos: number }
  contato: { waConversas: ItemLista[]; cadastros: ItemLista[] }
}

type No = {
  id: string
  col: number
  y: number
  titulo: string
  valor: number
  sub?: string
  tom: 'verde' | 'ambar' | 'cinza' | 'neutro' | 'escuro'
  mini?: boolean
  drill?: { titulo: string; itens: ItemLista[]; vazio: string; verHref?: string }
}

type Aresta = { de: string; para: string; n?: number; tom?: 'verde' | 'ambar' | 'cinza' }

// -------------------------------------------------------------- helpers
const COL_X = [15, 220, 425, 630, 835, 1046]
const W = 176
const W_MINI = 176

function brl(centavos: number | null | undefined): string {
  if (!centavos) return '—'
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function tempoRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return 'agora há pouco'
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

function rotuloFonte(f: string): string {
  const m: Record<string, string> = {
    direto: 'Direto',
    google: 'Google',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    whatsapp: 'WhatsApp',
    bing: 'Bing',
    outros: 'Outros',
  }
  return m[f] ?? f.charAt(0).toUpperCase() + f.slice(1)
}

const CORES: Record<No['tom'], { borda: string; texto: string; fundo: string }> = {
  verde: { borda: '#1D9E75', texto: '#0F6E56', fundo: '#F0FBF7' },
  ambar: { borda: '#D97706', texto: '#92400E', fundo: '#FFFBEB' },
  cinza: { borda: '#CBD5E1', texto: '#64748B', fundo: '#F8FAFC' },
  neutro: { borda: '#CBD5E1', texto: '#0F172A', fundo: '#FFFFFF' },
  escuro: { borda: '#0E1814', texto: '#FFFFFF', fundo: '#0E1814' },
}

const COR_ARESTA = { verde: '#1D9E75', ambar: '#D97706', cinza: '#A8B8C8' }

// ------------------------------------------------------------ componente
export default function FunilPainel() {
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [drill, setDrill] = useState<NonNullable<No['drill']> | null>(null)

  const carregar = useCallback(async (d: number) => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/admin/funil?dias=${d}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setDados((await res.json()) as Dados)
    } catch {
      setErro('Não consegui carregar o funil. Tente recarregar.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar(dias)
  }, [dias, carregar])

  const { nos, arestas, alturaSvg } = useMemo(() => {
    const vazio = { nos: [] as No[], arestas: [] as Aresta[], alturaSvg: 640 }
    if (!dados) return vazio

    const origens = dados.site.origens.slice(0, 5)
    const nos: No[] = []

    // C0 — origens de tráfego
    origens.forEach((o, i) => {
      nos.push({
        id: `o_${o.fonte}`,
        col: 0,
        y: 128 + i * 62,
        titulo: rotuloFonte(o.fonte),
        valor: o.sessoes,
        tom: 'cinza',
        mini: true,
      })
    })
    if (origens.length === 0) {
      nos.push({ id: 'o_nada', col: 0, y: 200, titulo: 'Sem tráfego ainda', valor: 0, tom: 'cinza', mini: true })
    }

    // C1 — site
    nos.push({
      id: 'visitantes',
      col: 1,
      y: 208,
      titulo: 'Visitantes',
      valor: dados.site.sessoes,
      sub: `${dados.site.pageviews} páginas vistas`,
      tom: 'escuro',
    })

    // C2 — ações
    nos.push({
      id: 'assistente',
      col: 2,
      y: 52,
      titulo: 'Assistente iniciado',
      valor: dados.acoes.assistenteIniciado,
      sub: 'começou a montar pedido',
      tom: 'neutro',
    })
    nos.push({
      id: 'whatsapp',
      col: 2,
      y: 252,
      titulo: 'Conversas WhatsApp',
      valor: dados.acoes.whatsapp,
      sub: 'novas no inbox oficial',
      tom: 'neutro',
      drill: {
        titulo: 'Conversas novas no WhatsApp',
        itens: dados.contato.waConversas,
        vazio: 'Nenhuma conversa nova no período.',
      },
    })
    nos.push({
      id: 'cadastros',
      col: 2,
      y: 430,
      titulo: 'Cadastros',
      valor: dados.acoes.cadastros,
      sub: 'contas de cliente criadas',
      tom: 'neutro',
      drill: {
        titulo: 'Contas criadas',
        itens: dados.contato.cadastros,
        vazio: 'Nenhum cadastro no período.',
      },
    })

    // C3 — pedidos
    nos.push({
      id: 'pa_criados',
      col: 3,
      y: 52,
      titulo: 'Pedido montado (chat)',
      valor: dados.assistido.criados,
      sub: 'salvos pelo assistente',
      tom: 'neutro',
      drill: {
        titulo: 'Pedidos montados no chat',
        itens: [...dados.assistido.pelaMetade, ...dados.assistido.confirmados],
        vazio: 'Nenhum pedido montado no período.',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'classico',
      col: 3,
      y: 430,
      titulo: 'Pedido direto',
      valor: dados.classico.criados,
      sub: 'formulário / painel cliente',
      tom: 'neutro',
      drill: {
        titulo: 'Pedidos diretos criados',
        itens: [...dados.classico.buscando, ...dados.classico.negociacao, ...dados.classico.concluidos],
        vazio: 'Nenhum pedido direto no período.',
        verHref: '/admin/pedidos',
      },
    })

    // C4 — status
    nos.push({
      id: 'pela_metade',
      col: 4,
      y: 6,
      titulo: '⚠ Pela metade',
      valor: dados.assistido.pelaMetade.length,
      sub: 'montou e não pagou',
      tom: 'ambar',
      drill: {
        titulo: 'Pedidos pela metade — dá pra resgatar',
        itens: dados.assistido.pelaMetade,
        vazio: 'Ninguém largou pedido no meio. 🎉',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'pa_pago',
      col: 4,
      y: 140,
      titulo: 'Pago / confirmado',
      valor: dados.assistido.confirmados.length,
      sub: brl(dados.assistido.receitaCentavos),
      tom: 'verde',
      drill: {
        titulo: 'Pedidos confirmados (pagos)',
        itens: dados.assistido.confirmados,
        vazio: 'Nenhum pagamento no período.',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'pa_cancel',
      col: 4,
      y: 262,
      titulo: 'Cancelados',
      valor: dados.assistido.cancelados,
      tom: 'cinza',
      mini: true,
    })
    nos.push({
      id: 'negociacao',
      col: 4,
      y: 356,
      titulo: 'Em negociação',
      valor: dados.classico.negociacao.length,
      sub: 'fornecedor aceitou',
      tom: 'verde',
      drill: {
        titulo: 'Pedidos em negociação',
        itens: dados.classico.negociacao,
        vazio: 'Nenhum pedido em negociação no período.',
        verHref: '/admin/pedidos',
      },
    })
    nos.push({
      id: 'buscando',
      col: 4,
      y: 476,
      titulo: '⏳ Buscando fornecedor',
      valor: dados.classico.buscando.length,
      sub: 'aguardando aceite',
      tom: 'ambar',
      drill: {
        titulo: 'Pedidos buscando fornecedor',
        itens: dados.classico.buscando,
        vazio: 'Nenhum pedido esperando fornecedor.',
        verHref: '/admin/pedidos',
      },
    })
    nos.push({
      id: 'expirado',
      col: 4,
      y: 588,
      titulo: 'Expirados',
      valor: dados.classico.expirados,
      tom: 'cinza',
      mini: true,
    })

    // C5 — fornecedor / desfecho
    nos.push({
      id: 'encaminhado',
      col: 5,
      y: 52,
      titulo: 'Enviado a fornecedor',
      valor: dados.fornecedor.encaminhados.length,
      sub: 'aguardando aceite',
      tom: 'neutro',
      drill: {
        titulo: 'Ofertas aguardando o fornecedor',
        itens: dados.fornecedor.encaminhados,
        vazio: 'Nenhuma oferta pendente com fornecedor.',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'aceito',
      col: 5,
      y: 186,
      titulo: '✓ Em produção',
      valor: dados.fornecedor.aceitos.length,
      sub: 'fornecedor aceitou',
      tom: 'verde',
      drill: {
        titulo: 'Fechados — quem está produzindo',
        itens: dados.fornecedor.aceitos,
        vazio: 'Nenhum fechamento com fornecedor no período.',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'concluido',
      col: 5,
      y: 356,
      titulo: 'Concluídos',
      valor: dados.classico.concluidos.length,
      tom: 'verde',
      mini: true,
      drill: {
        titulo: 'Pedidos concluídos',
        itens: dados.classico.concluidos,
        vazio: 'Nenhum pedido concluído no período.',
        verHref: '/admin/pedidos',
      },
    })

    const arestas: Aresta[] = [
      ...origens.map((o) => ({ de: `o_${o.fonte}`, para: 'visitantes' as const, tom: 'cinza' as const })),
      { de: 'visitantes', para: 'assistente', n: dados.acoes.assistenteIniciado },
      { de: 'visitantes', para: 'whatsapp', n: dados.acoes.whatsapp },
      { de: 'visitantes', para: 'cadastros', n: dados.acoes.cadastros },
      { de: 'assistente', para: 'pa_criados', n: dados.assistido.criados },
      { de: 'pa_criados', para: 'pela_metade', n: dados.assistido.pelaMetade.length, tom: 'ambar' },
      { de: 'pa_criados', para: 'pa_pago', n: dados.assistido.confirmados.length, tom: 'verde' },
      { de: 'pa_criados', para: 'pa_cancel', n: dados.assistido.cancelados, tom: 'cinza' },
      { de: 'cadastros', para: 'classico', n: dados.classico.criados },
      { de: 'classico', para: 'negociacao', n: dados.classico.negociacao.length, tom: 'verde' },
      { de: 'classico', para: 'buscando', n: dados.classico.buscando.length, tom: 'ambar' },
      { de: 'classico', para: 'expirado', n: dados.classico.expirados, tom: 'cinza' },
      {
        de: 'pa_pago',
        para: 'encaminhado',
        n: dados.fornecedor.encaminhados.length + dados.fornecedor.aceitos.length + dados.fornecedor.perdidos,
      },
      { de: 'encaminhado', para: 'aceito', n: dados.fornecedor.aceitos.length, tom: 'verde' },
      { de: 'negociacao', para: 'concluido', n: dados.classico.concluidos.length, tom: 'verde' },
    ]

    return { nos, arestas, alturaSvg: 656 }
  }, [dados])

  const mapaNos = useMemo(() => new Map(nos.map((n) => [n.id, n])), [nos])

  function centroDireita(n: No): { x: number; y: number } {
    const h = n.mini ? 46 : 84
    return { x: COL_X[n.col] + W, y: n.y + h / 2 }
  }
  function centroEsquerda(n: No): { x: number; y: number } {
    const h = n.mini ? 46 : 84
    return { x: COL_X[n.col], y: n.y + h / 2 }
  }

  const taxaPedido =
    dados && dados.site.sessoes > 0
      ? Math.round(((dados.assistido.criados + dados.classico.criados) / dados.site.sessoes) * 100)
      : null

  return (
    <div>
      {/* ------------------------------------------------ cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Funil</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Do clique ao fornecedor — clique nos cartões pra ver quem está em cada etapa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDias(d)}
              className={
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ' +
                (dias === d
                  ? 'bg-[#1D9E75] border-[#1D9E75] text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')
              }
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------ KPIs */}
      {dados && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {[
            { r: 'Visitantes', v: String(dados.site.sessoes) },
            { r: 'Pedidos criados', v: String(dados.assistido.criados + dados.classico.criados) },
            { r: 'Visita → pedido', v: taxaPedido === null ? '—' : `${taxaPedido}%` },
            { r: 'Pela metade', v: String(dados.assistido.pelaMetade.length), tom: 'ambar' },
            { r: 'Em produção', v: String(dados.fornecedor.aceitos.length), tom: 'verde' },
            { r: 'Receita confirmada', v: brl(dados.assistido.receitaCentavos), tom: 'verde' },
          ].map((k, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{k.r}</p>
              <p
                className={
                  'text-lg font-semibold mt-0.5 ' +
                  (k.tom === 'verde' ? 'text-[#0F6E56]' : k.tom === 'ambar' ? 'text-amber-600' : 'text-gray-900')
                }
              >
                {k.v}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------ mapa */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-x-auto relative">
        {carregando && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10 text-sm text-gray-500">
            Carregando funil…
          </div>
        )}
        {erro && !carregando && <div className="p-6 text-sm text-red-600">{erro}</div>}
        {dados && (
          <svg
            viewBox={`0 0 1240 ${alturaSvg}`}
            className="min-w-[1080px] w-full h-auto block"
            style={{ background: 'radial-gradient(#E2E8F0 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          >
            <style>{`
              .fluxo { animation: fluir 1.4s linear infinite; }
              @keyframes fluir { to { stroke-dashoffset: -18; } }
              .no-clicavel { cursor: pointer; }
              .no-clicavel:hover rect { filter: brightness(0.97); }
            `}</style>

            {/* títulos das colunas */}
            {['ORIGEM', 'SITE', 'AÇÃO', 'PEDIDO', 'STATUS', 'FORNECEDOR'].map((t, i) => (
              <text key={t} x={COL_X[i] + W / 2} y={26} textAnchor="middle" fontSize="10.5" letterSpacing="2" fill="#94A3B8" fontWeight="600">
                {t}
              </text>
            ))}

            {/* arestas */}
            {arestas.map((a, i) => {
              const de = mapaNos.get(a.de)
              const para = mapaNos.get(a.para)
              if (!de || !para) return null
              const p1 = centroDireita(de)
              const p2 = centroEsquerda(para)
              const midX = (p1.x + p2.x) / 2
              const cor = COR_ARESTA[a.tom ?? 'cinza']
              const d = `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`
              return (
                <g key={i}>
                  <path d={d} fill="none" stroke={cor} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0.1 9" className="fluxo" opacity="0.9" />
                  {typeof a.n === 'number' && (
                    <g>
                      <rect x={midX - 17} y={(p1.y + p2.y) / 2 - 11} width="34" height="20" rx="10" fill="white" stroke={cor} strokeWidth="1.2" />
                      <text x={midX} y={(p1.y + p2.y) / 2 + 3.5} textAnchor="middle" fontSize="11" fontWeight="700" fill={cor === COR_ARESTA.cinza ? '#64748B' : cor}>
                        {a.n}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* nós */}
            {nos.map((n) => {
              const c = CORES[n.tom]
              const h = n.mini ? 46 : 84
              const clicavel = !!n.drill
              return (
                <g
                  key={n.id}
                  className={clicavel ? 'no-clicavel' : undefined}
                  onClick={() => n.drill && setDrill(n.drill)}
                >
                  <rect x={COL_X[n.col]} y={n.y} width={n.mini ? W_MINI : W} height={h} rx="14" fill={c.fundo} stroke={c.borda} strokeWidth={n.tom === 'cinza' ? 1.2 : 1.8} />
                  {n.mini ? (
                    <>
                      <text x={COL_X[n.col] + 14} y={n.y + 28} fontSize="12" fill={c.texto} fontWeight="500">
                        {n.titulo}
                      </text>
                      <text x={COL_X[n.col] + W - 14} y={n.y + 30} fontSize="16" fill={c.texto} fontWeight="700" textAnchor="end">
                        {n.valor}
                      </text>
                    </>
                  ) : (
                    <>
                      <text x={COL_X[n.col] + 14} y={n.y + 24} fontSize="12" fill={n.tom === 'escuro' ? '#9DB4AA' : '#64748B'} fontWeight="500">
                        {n.titulo}
                      </text>
                      <text x={COL_X[n.col] + 14} y={n.y + 54} fontSize="26" fill={c.texto} fontWeight="700">
                        {n.valor}
                      </text>
                      {n.sub && (
                        <text x={COL_X[n.col] + 14} y={n.y + 72} fontSize="10.5" fill={n.tom === 'escuro' ? '#9DB4AA' : '#94A3B8'}>
                          {n.sub}
                        </text>
                      )}
                      {clicavel && (
                        <text x={COL_X[n.col] + W - 12} y={n.y + 24} fontSize="11" fill={n.tom === 'escuro' ? '#9DB4AA' : '#94A3B8'} textAnchor="end">
                          ver ›
                        </text>
                      )}
                    </>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        Tráfego e origem via tracker próprio (novo — começa a contar a partir de agora). Pedidos, ofertas, WhatsApp e
        cadastros vêm direto do banco no período selecionado.
      </p>

      {/* ------------------------------------------------ drawer drill-down */}
      {drill && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrill(null)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-900">{drill.titulo}</p>
              <button
                type="button"
                onClick={() => setDrill(null)}
                aria-label="Fechar"
                className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {drill.itens.length === 0 && <p className="text-sm text-gray-400">{drill.vazio}</p>}
              {drill.itens.map((it) => {
                const telDigits = (it.telefone ?? '').replace(/\D/g, '')
                return (
                  <div key={it.id} className="border border-gray-100 rounded-xl p-3 bg-gray-50/60">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {it.cliente ?? it.nome}
                        {it.fornecedor && <span className="text-gray-400 font-normal"> → {it.fornecedor}</span>}
                      </p>
                      <span className="text-[11px] text-gray-400 shrink-0">{tempoRelativo(it.criadoEm)}</span>
                    </div>
                    {(it.resumo || it.pecas || it.valorCentavos) && (
                      <p className="text-xs text-gray-500 mt-1">
                        {[it.resumo, it.pecas ? `${it.pecas} pçs` : null, it.valorCentavos ? brl(it.valorCentavos) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {it.email && !it.resumo && <p className="text-xs text-gray-500 mt-1">{it.email}</p>}
                    <div className="flex items-center gap-2 mt-2.5">
                      {telDigits.length >= 10 && (
                        <a
                          href={`/admin/whatsapp?abrir=${encodeURIComponent(telDigits)}&nome=${encodeURIComponent((it.cliente ?? it.nome).split(' ')[0])}`}
                          className="inline-flex items-center gap-1.5 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                          </svg>
                          Conversar
                        </a>
                      )}
                      {drill.verHref && (
                        <a
                          href={drill.verHref}
                          className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 bg-white transition-colors"
                        >
                          Ver na tela de pedidos
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
