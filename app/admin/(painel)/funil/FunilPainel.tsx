'use client'

// app/admin/(painel)/funil/FunilPainel.tsx
// ============================================================================
// Mapa do funil da Confeccione (estilo Funnelytics): nós e setas com números
// vivos do banco — tráfego → ações no site → pedidos → status → fornecedor.
// Clique num nó com lista abre o drawer de drill-down (com "Conversar" que
// cai direto no inbox oficial: /admin/whatsapp?abrir=<tel>&nome=<nome>).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  site: {
    sessoes: number
    pageviews: number
    origens: { fonte: string; sessoes: number }[]
    visitasPorDia: { dia: string; sessoes: number }[]
    hoje: number
  }
  acoes: { assistenteIniciado: number; pedidoEnviadoEventos: number; whatsapp: number; cadastros: number }
  assistido: {
    criados: number
    pelaMetade: ItemLista[]
    aguardandoPagamento: ItemLista[]
    pagos: ItemLista[]
    cancelados: number
    receitaPagaCentavos: number
    receitaAguardandoCentavos: number
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
// Coordenadas do "mundo" do canvas (pan/zoom livre — margens generosas).
const COL_X = [20, 260, 500, 740, 980, 1220]
const W = 200
const W_MINI = 200
const MUNDO_W = 1440
const MUNDO_H = 1000

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

/** Barras de visitantes por dia (mostra até os últimos 30 dias do período). */
function SparklineVisitas({ serie }: { serie: { dia: string; sessoes: number }[] }) {
  const dadosSerie = serie.slice(-30)
  if (dadosSerie.length === 0) return null
  const max = Math.max(1, ...dadosSerie.map((d) => d.sessoes))
  const lg = 100 / dadosSerie.length
  const rotulo = (d: string) => {
    const [, m, dia] = d.split('-')
    return `${dia}/${m}`
  }
  return (
    <svg viewBox="0 0 100 30" className="w-full h-9 mt-1.5" preserveAspectRatio="none" aria-hidden>
      {dadosSerie.map((d, i) => {
        const h = d.sessoes === 0 ? 1.5 : Math.max(3, (d.sessoes / max) * 28)
        return (
          <rect
            key={d.dia}
            x={i * lg + lg * 0.15}
            y={30 - h}
            width={lg * 0.7}
            height={h}
            rx={0.8}
            fill={d.sessoes === 0 ? '#E2E8F0' : '#1D9E75'}
          >
            <title>{`${rotulo(d.dia)}: ${d.sessoes} visitante${d.sessoes === 1 ? '' : 's'}`}</title>
          </rect>
        )
      })}
    </svg>
  )
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

  // ----------------------------------------------- canvas pan/zoom
  // vista = translate(x,y) + scale(k) do mundo dentro do container.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [vista, setVista] = useState<{ x: number; y: number; k: number } | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const ponteiros = useRef(new Map<number, { x: number; y: number }>())
  const arrasto = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)
  const moveu = useRef(false)
  const pinchDist = useRef<number | null>(null)

  const encaixar = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const k = Math.min(el.clientWidth / (MUNDO_W + 60), el.clientHeight / (MUNDO_H + 60))
    const kk = Math.min(Math.max(k, 0.25), 1.4)
    setVista({ k: kk, x: (el.clientWidth - MUNDO_W * kk) / 2, y: (el.clientHeight - MUNDO_H * kk) / 2 })
  }, [])

  // Fit inicial (e quando os dados chegam pela primeira vez).
  useEffect(() => {
    if (dados && !vista) encaixar()
  }, [dados, vista, encaixar])

  // Zoom no scroll, centrado no cursor (listener não-passivo pra travar o scroll da página).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault()
      setVista((v) => {
        if (!v) return v
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const k = Math.min(Math.max(v.k * Math.exp(-e.deltaY * 0.0016), 0.2), 3)
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }
      })
    }
    el.addEventListener('wheel', aoRolar, { passive: false })
    return () => el.removeEventListener('wheel', aoRolar)
  }, [])

  function zoomBotao(fator: number) {
    setVista((v) => {
      const el = wrapRef.current
      if (!v || !el) return v
      const cx = el.clientWidth / 2
      const cy = el.clientHeight / 2
      const k = Math.min(Math.max(v.k * fator, 0.2), 3)
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
    })
  }

  function aoPressionar(e: React.PointerEvent<HTMLDivElement>) {
    wrapRef.current?.setPointerCapture?.(e.pointerId)
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ponteiros.current.size === 1 && vista) {
      moveu.current = false
      arrasto.current = { px: e.clientX, py: e.clientY, vx: vista.x, vy: vista.y }
      setArrastando(true)
    } else {
      arrasto.current = null // dois dedos = pinch
    }
  }

  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    if (!ponteiros.current.has(e.pointerId)) return
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...ponteiros.current.values()]
    if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (pinchDist.current !== null && dist > 0) {
        const fator = dist / pinchDist.current
        setVista((v) => {
          const el = wrapRef.current
          if (!v || !el) return v
          const rect = el.getBoundingClientRect()
          const cx = (pts[0].x + pts[1].x) / 2 - rect.left
          const cy = (pts[0].y + pts[1].y) / 2 - rect.top
          const k = Math.min(Math.max(v.k * fator, 0.2), 3)
          return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k }
        })
      }
      pinchDist.current = dist
      moveu.current = true
      return
    }
    const a = arrasto.current
    if (a) {
      const dx = e.clientX - a.px
      const dy = e.clientY - a.py
      if (Math.abs(dx) + Math.abs(dy) > 4) moveu.current = true
      setVista((v) => (v ? { ...v, x: a.vx + dx, y: a.vy + dy } : v))
    }
  }

  function aoSoltar(e: React.PointerEvent<HTMLDivElement>) {
    // Clique (sem arrasto) → hit-test manual nos nós. Necessário porque o
    // setPointerCapture do canvas redireciona o evento de click pro wrapper,
    // então o onClick dos <g> nunca dispararia.
    if (ponteiros.current.size === 1 && !moveu.current && vista && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect()
      const wx = (e.clientX - rect.left - vista.x) / vista.k
      const wy = (e.clientY - rect.top - vista.y) / vista.k
      const alvo = nos.find((n) => {
        const h = n.mini ? 46 : 84
        return wx >= COL_X[n.col] && wx <= COL_X[n.col] + W && wy >= n.y && wy <= n.y + h
      })
      if (alvo?.drill) setDrill(alvo.drill)
    }
    ponteiros.current.delete(e.pointerId)
    if (ponteiros.current.size < 2) pinchDist.current = null
    if (ponteiros.current.size === 0) {
      arrasto.current = null
      setArrastando(false)
    }
  }

  // Esc fecha o popup de detalhe.
  useEffect(() => {
    if (!drill) return
    const f = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrill(null)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [drill])

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

  const { nos, arestas } = useMemo(() => {
    const vazio = { nos: [] as No[], arestas: [] as Aresta[], alturaSvg: 640 }
    if (!dados) return vazio

    const origens = dados.site.origens.slice(0, 5)
    const nos: No[] = []

    // C0 — origens de tráfego
    origens.forEach((o, i) => {
      nos.push({
        id: `o_${o.fonte}`,
        col: 0,
        y: 200 + i * 74,
        titulo: rotuloFonte(o.fonte),
        valor: o.sessoes,
        tom: 'cinza',
        mini: true,
      })
    })
    if (origens.length === 0) {
      nos.push({ id: 'o_nada', col: 0, y: 340, titulo: 'Aguardando visitas…', valor: 0, tom: 'cinza', mini: true })
    }

    // C1 — site
    nos.push({
      id: 'visitantes',
      col: 1,
      y: 300,
      titulo: 'Visitantes',
      valor: dados.site.sessoes,
      sub: `${dados.site.pageviews} pág. vistas · hoje ${dados.site.hoje}`,
      tom: 'escuro',
    })

    // C2 — ações
    nos.push({
      id: 'assistente',
      col: 2,
      y: 100,
      titulo: 'Assistente iniciado',
      valor: dados.acoes.assistenteIniciado,
      sub: 'começou a montar pedido',
      tom: 'neutro',
    })
    nos.push({
      id: 'whatsapp',
      col: 2,
      y: 380,
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
      y: 630,
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
      y: 100,
      titulo: 'Pedido montado (chat)',
      valor: dados.assistido.criados,
      sub: 'salvos pelo assistente',
      tom: 'neutro',
      drill: {
        titulo: 'Pedidos montados no chat',
        itens: [...dados.assistido.pelaMetade, ...dados.assistido.aguardandoPagamento, ...dados.assistido.pagos],
        vazio: 'Nenhum pedido montado no período.',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'classico',
      col: 3,
      y: 630,
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
      y: 76,
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
      id: 'aguardando_pgto',
      col: 4,
      y: 236,
      titulo: '💳 Aguardando pgto',
      valor: dados.assistido.aguardandoPagamento.length,
      sub: `${brl(dados.assistido.receitaAguardandoCentavos)} em aberto`,
      tom: 'ambar',
      drill: {
        titulo: 'Confirmaram e ainda não pagaram — cobre!',
        itens: dados.assistido.aguardandoPagamento,
        vazio: 'Ninguém aguardando pagamento. 🎉',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'pa_pago',
      col: 4,
      y: 396,
      titulo: '💰 Pago (Asaas)',
      valor: dados.assistido.pagos.length,
      sub: brl(dados.assistido.receitaPagaCentavos),
      tom: 'verde',
      drill: {
        titulo: 'Pagamentos confirmados pelo Asaas',
        itens: dados.assistido.pagos,
        vazio: 'Nenhum pagamento confirmado no período.',
        verHref: '/admin/pedidos-pagos',
      },
    })
    nos.push({
      id: 'pa_cancel',
      col: 4,
      y: 532,
      titulo: 'Cancelados',
      valor: dados.assistido.cancelados,
      tom: 'cinza',
      mini: true,
    })
    nos.push({
      id: 'negociacao',
      col: 4,
      y: 630,
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
      y: 780,
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
      y: 916,
      titulo: 'Expirados',
      valor: dados.classico.expirados,
      tom: 'cinza',
      mini: true,
    })

    // C5 — fornecedor / desfecho
    nos.push({
      id: 'encaminhado',
      col: 5,
      y: 100,
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
      y: 264,
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
      y: 649,
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
      { de: 'pa_criados', para: 'aguardando_pgto', n: dados.assistido.aguardandoPagamento.length, tom: 'ambar' },
      { de: 'aguardando_pgto', para: 'pa_pago', n: dados.assistido.pagos.length, tom: 'verde' },
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

    return { nos, arestas, alturaSvg: MUNDO_H }
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
          {/* Visitantes — destaque com barras por dia */}
          <div className="col-span-2 bg-[#0E1814] border border-black/40 rounded-xl px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] uppercase tracking-wide text-white/40 font-medium">Visitantes no site</p>
              <p className="text-[11px] text-[#6EE7B7] font-medium shrink-0">hoje: {dados.site.hoje}</p>
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <p className="text-2xl font-semibold text-white leading-none">{dados.site.sessoes}</p>
              <p className="text-[11px] text-white/40">{dados.site.pageviews} páginas vistas · {dados.dias}d</p>
            </div>
            <SparklineVisitas serie={dados.site.visitasPorDia} />
          </div>
          {[
            { r: 'Pedidos criados', v: String(dados.assistido.criados + dados.classico.criados) },
            { r: 'Pela metade', v: String(dados.assistido.pelaMetade.length), tom: 'ambar' },
            { r: 'Aguardando pgto', v: brl(dados.assistido.receitaAguardandoCentavos), tom: 'ambar' },
            { r: 'Receita paga (Asaas)', v: brl(dados.assistido.receitaPagaCentavos), tom: 'verde' },
            { r: 'Em produção', v: String(dados.fornecedor.aceitos.length), tom: 'verde' },
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

      {/* ------------------------------------------------ mapa (canvas pan/zoom) */}
      <div
        ref={wrapRef}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        className={
          'border border-gray-200 rounded-2xl shadow-sm relative overflow-hidden select-none ' +
          (arrastando ? 'cursor-grabbing' : 'cursor-grab')
        }
        style={{
          height: 'min(76vh, 840px)',
          minHeight: 460,
          touchAction: 'none',
          background: 'radial-gradient(#E2E8F0 1.1px, transparent 1.1px) 0 0 / 22px 22px, #FFFFFF',
        }}
      >
        {carregando && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10 text-sm text-gray-500">
            Carregando funil…
          </div>
        )}
        {erro && !carregando && <div className="p-6 text-sm text-red-600">{erro}</div>}
        {dados && vista && (
          <svg className="w-full h-full block">
            <style>{`
              .fluxo { animation: fluir 1.4s linear infinite; }
              @keyframes fluir { to { stroke-dashoffset: -18; } }
              .no-clicavel { cursor: pointer; }
              .no-clicavel:hover rect { filter: brightness(0.97); }
            `}</style>
            <g transform={`translate(${vista.x} ${vista.y}) scale(${vista.k})`}>

            {/* títulos das colunas — faixa própria, nenhum cartão sobe até aqui */}
            {['ORIGEM', 'SITE', 'AÇÃO', 'PEDIDO', 'STATUS', 'FORNECEDOR'].map((t, i) => (
              <g key={t}>
                <text x={COL_X[i] + W / 2} y={34} textAnchor="middle" fontSize="11" letterSpacing="2.5" fill="#94A3B8" fontWeight="700">
                  {t}
                </text>
                <line x1={COL_X[i] + 24} y1={46} x2={COL_X[i] + W - 24} y2={46} stroke="#E2E8F0" strokeWidth="1.5" strokeLinecap="round" />
              </g>
            ))}

            {/* arestas — fluxo zerado fica sutil (sem pill, sem animação) */}
            {arestas.map((a, i) => {
              const de = mapaNos.get(a.de)
              const para = mapaNos.get(a.para)
              if (!de || !para) return null
              const p1 = centroDireita(de)
              const p2 = centroEsquerda(para)
              const midX = (p1.x + p2.x) / 2
              const cor = COR_ARESTA[a.tom ?? 'cinza']
              const vazia = typeof a.n === 'number' && a.n === 0
              const d = `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`
              return (
                <g key={i}>
                  <path
                    d={d}
                    fill="none"
                    stroke={vazia ? '#CBD5E1' : cor}
                    strokeWidth={vazia ? 1.6 : 2.4}
                    strokeLinecap="round"
                    strokeDasharray="0.1 9"
                    className={vazia ? undefined : 'fluxo'}
                    opacity={vazia ? 0.45 : 0.9}
                  />
                  {typeof a.n === 'number' && a.n > 0 && (
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
                // clique real é resolvido por hit-test no pointerup do canvas
                <g key={n.id} className={clicavel ? 'no-clicavel' : undefined}>
                  <rect x={COL_X[n.col]} y={n.y} width={n.mini ? W_MINI : W} height={h} rx="14" fill={c.fundo} stroke={c.borda} strokeWidth={n.tom === 'cinza' ? 1.2 : 1.8} />
                  {n.mini ? (
                    <>
                      <text x={COL_X[n.col] + 14} y={n.y + 28} fontSize="11.5" fill={c.texto} fontWeight="500">
                        {n.titulo.slice(0, 21)}
                      </text>
                      <text x={COL_X[n.col] + W - 14} y={n.y + 30} fontSize="16" fill={c.texto} fontWeight="700" textAnchor="end">
                        {n.valor}
                      </text>
                    </>
                  ) : (
                    <>
                      <text x={COL_X[n.col] + 14} y={n.y + 23} fontSize="11.5" fill={n.tom === 'escuro' ? '#9DB4AA' : '#64748B'} fontWeight="600">
                        {n.titulo.slice(0, 24)}
                      </text>
                      <text x={COL_X[n.col] + 14} y={n.y + 55} fontSize="28" fill={c.texto} fontWeight="700">
                        {n.valor}
                      </text>
                      {n.sub && (
                        <text x={COL_X[n.col] + 14} y={n.y + 73} fontSize="10.5" fill={n.tom === 'escuro' ? '#9DB4AA' : '#94A3B8'}>
                          {n.sub.slice(0, 30)}
                        </text>
                      )}
                      {clicavel && (
                        <text x={COL_X[n.col] + W - 11} y={n.y + 57} fontSize="15" fill={n.tom === 'escuro' ? '#9DB4AA' : '#B4C0CC'} textAnchor="end" fontWeight="700">
                          ›
                        </text>
                      )}
                    </>
                  )}
                </g>
              )
            })}
            </g>
          </svg>
        )}

        {/* controles de zoom */}
        {dados && (
          <div
            className="absolute bottom-3 right-3 z-10 flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => zoomBotao(1.3)}
              aria-label="Aproximar"
              className="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-semibold"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomBotao(1 / 1.3)}
              aria-label="Afastar"
              className="w-9 h-9 flex items-center justify-center text-gray-600 hover:bg-gray-50 text-lg font-semibold border-t border-gray-100"
            >
              −
            </button>
            <button
              type="button"
              onClick={encaixar}
              aria-label="Encaixar na tela"
              title="Encaixar na tela"
              className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 border-t border-gray-100"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>
          </div>
        )}
        <p className="absolute bottom-3 left-4 z-10 text-[11px] text-gray-400 pointer-events-none">
          scroll = zoom · arraste = mover · clique no cartão = detalhe
        </p>
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        Tráfego e origem via tracker próprio (novo — começa a contar a partir de agora). Pedidos, ofertas, WhatsApp e
        cadastros vêm direto do banco no período selecionado.
      </p>

      {/* ------------------------------------------------ popup drill-down */}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrill(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[82vh] flex flex-col overflow-hidden">
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
