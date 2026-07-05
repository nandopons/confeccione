'use client'

// ============================================================================
// Inbox do WhatsApp oficial (Meta Cloud API).
//
// Layout: lista de conversas à esquerda + thread à direita (desktop);
// mobile alterna lista ↔ thread. Atualização por polling: lista a cada 5s,
// thread ativa a cada 3s (incremental via ?after=).
//
// Janela de 24h: contada a partir da última mensagem RECEBIDA do contato.
// Dentro → texto/mídia livres (conversa de serviço, grátis).
// Fora   → só template aprovado (a UI troca o composer pelo seletor).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Contato = {
  id: string
  wa_id: string
  nome: string | null
  cliente_id: string | null
  fornecedor_id: string | null
}

type Conversa = {
  id: string
  preview: string | null
  nao_lidas: number
  arquivada: boolean
  ultima_mensagem_em: string | null
  ultima_msg_contato_em: string | null
  contato: Contato
}

type Mensagem = {
  id: string
  wamid: string | null
  direcao: 'entrada' | 'saida'
  tipo: string
  corpo: string | null
  midia_url: string | null
  midia_mime: string | null
  midia_nome: string | null
  status: string
  erro: string | null
  template_nome: string | null
  criado_em: string
}

type Template = { name: string; language: string; category: string; bodyPreview: string }

type PedidoResumo = {
  id: string
  tipo: string | null
  quantidade: number | null
  estado: string | null
  status: string | null
  criado_em: string | null
}

type Contexto = {
  contato: { id: string; wa_id: string; nome: string | null }
  cliente: { id: string; nome: string | null; email: string | null; cidade: string | null; uf: string | null; plano: string | null; criado_em: string | null } | null
  fornecedor: { id: string; nome: string | null; cidade: string | null; estado: string | null; status: string | null; aprovacao_status: string | null; tipos_produto: string[] | string | null; plano: string | null } | null
  pedidosVigentes: PedidoResumo[]
  pedidosAnteriores: PedidoResumo[]
}

type RapidaPreset = {
  id: string
  rotulo: string
  descricao: string
  corpo: string
  botoes?: { id: string; titulo: string }[]
  /** botão que abre um link (CTA URL) — texto ≤ 20 chars */
  urlBotao?: { texto: string; url: string }
  /** true → envia o texto direto, sem passar pelo composer */
  enviarDireto?: boolean
  /** true → só preenche o composer (deixa editar antes de enviar) */
  preencher?: boolean
}

// Mensagens rápidas do composer. Botões: máx 3, títulos ≤ 20 chars (limite Meta).
const RAPIDAS: RapidaPreset[] = [
  {
    id: 'sobre_confeccione',
    rotulo: 'O que é a Confeccione',
    descricao: 'Apresentação — envia direto',
    corpo:
      'A Confeccione é um marketplace que conecta quem precisa fabricar roupas a fornecedores de confecção qualificados. 🧵\n\nVocê conta o que quer produzir (tipo de peça, quantidade e prazo) e a gente encontra o fornecedor certo pra você — do orçamento até a entrega, com tudo acompanhado por aqui.\n\nSem caçar fábrica no escuro: você fala com a gente e a gente resolve.',
    enviarDireto: true,
  },
  {
    id: 'pedido_site',
    rotulo: 'Fazer pedido pelo site',
    descricao: 'Convite com botão pro site',
    corpo:
      'Bora tirar sua produção do papel? 🚀\n\nFaz teu pedido pelo nosso site — leva menos de 2 minutos e a gente já começa a buscar o fornecedor ideal pra sua peça.',
    urlBotao: { texto: 'Fazer meu pedido', url: 'https://www.confeccione.com.br/?utm_source=whatsapp&utm_medium=atendimento' },
  },
  {
    id: 'menu',
    rotulo: 'Menu de atendimento',
    descricao: 'Triagem com 3 botões',
    corpo: 'Oi! 👋 Aqui é a Confeccione. Como a gente pode te ajudar hoje?',
    botoes: [
      { id: 'menu_pedido', titulo: 'Fazer um pedido' },
      { id: 'menu_acompanhar', titulo: 'Acompanhar pedido' },
      { id: 'menu_atendente', titulo: 'Falar com atendente' },
    ],
  },
  {
    id: 'retomar_orcamento',
    rotulo: 'Retomar orçamento',
    descricao: 'Esquenta quem parou de responder',
    corpo: 'Ficou alguma dúvida sobre o orçamento que a gente conversou? Posso te mandar atualizado. 😉',
    botoes: [
      { id: 'orc_quero', titulo: 'Quero o orçamento' },
      { id: 'orc_duvida', titulo: 'Tenho uma dúvida' },
    ],
  },
  {
    id: 'confirmar_producao',
    rotulo: 'Confirmar produção',
    descricao: 'Fechamento com 2 botões',
    corpo: 'Podemos seguir com a produção do seu pedido? ✂️',
    botoes: [
      { id: 'prod_seguir', titulo: 'Pode seguir' },
      { id: 'prod_ajustar', titulo: 'Quero ajustar' },
    ],
  },
  {
    id: 'grade_tamanhos',
    rotulo: 'Pedir grade de tamanhos',
    descricao: 'Preenche o texto pra você editar',
    corpo: 'Pra fechar a produção, me confirma a grade de tamanhos? (ex.: 10 P, 20 M, 10 G) 📏',
    preencher: true,
  },
]

const STATUS_PEDIDO_LABEL: Record<string, { rotulo: string; cor: string }> = {
  buscando_fornecedor: { rotulo: 'Buscando fornecedor', cor: 'bg-amber-50 text-amber-700' },
  em_negociacao: { rotulo: 'Em negociação', cor: 'bg-sky-50 text-sky-700' },
  concluido: { rotulo: 'Concluído', cor: 'bg-emerald-50 text-emerald-700' },
  expirado_sem_resposta: { rotulo: 'Expirado', cor: 'bg-neutral-100 text-neutral-500' },
}

const JANELA_MS = 24 * 60 * 60 * 1000

function formatarTelefone(waId: string): string {
  const m = waId.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${waId}`
}

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function dataLegivel(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(hoje.getDate() - 1)
  if (d.toDateString() === hoje.toDateString()) return 'Hoje'
  if (d.toDateString() === ontem.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function idadeCurta(iso: string | null): string {
  if (!iso) return ''
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'há 1 dia'
  if (dias < 30) return `há ${dias} dias`
  const meses = Math.floor(dias / 30)
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`
}

function restanteJanela(ultimaMsgContato: string | null): { aberta: boolean; rotulo: string } {
  if (!ultimaMsgContato) return { aberta: false, rotulo: 'Cliente ainda não escreveu' }
  const fim = new Date(ultimaMsgContato).getTime() + JANELA_MS
  const resta = fim - Date.now()
  if (resta <= 0) return { aberta: false, rotulo: 'Janela de 24h encerrada' }
  const h = Math.floor(resta / 3_600_000)
  const min = Math.floor((resta % 3_600_000) / 60_000)
  return { aberta: true, rotulo: h > 0 ? `Janela aberta · ${h}h${min ? ` ${min}min` : ''} restantes` : `Janela aberta · ${min}min restantes` }
}

function Ticks({ status }: { status: string }) {
  if (status === 'falhou') return <span title="Falhou" className="text-red-500">⚠</span>
  if (status === 'enviando') return <span title="Enviando" className="text-neutral-400">🕓</span>
  const cor = status === 'lido' ? 'text-sky-500' : 'text-neutral-400'
  const duplo = status === 'entregue' || status === 'lido'
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" fill="none" className={cor} aria-label={status}>
      <path d="M1 5.5L4 8.5L9.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {duplo && <path d="M6.5 5.5L9.5 8.5L15 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

function CorpoMensagem({ m }: { m: Mensagem }) {
  const legenda = m.corpo ? <p className="whitespace-pre-wrap break-words">{m.corpo}</p> : null

  if (m.tipo === 'image' || m.tipo === 'sticker') {
    return (
      <div className="space-y-1.5">
        {m.midia_url ? (
          <a href={m.midia_url} target="_blank" rel="noopener noreferrer">
            <img
              src={m.midia_url}
              alt={m.corpo ?? 'Imagem'}
              className={m.tipo === 'sticker' ? 'w-28 h-28 object-contain' : 'rounded-lg max-h-72 max-w-full object-contain'}
            />
          </a>
        ) : (
          <p className="italic text-neutral-500">📷 Imagem indisponível</p>
        )}
        {legenda}
      </div>
    )
  }
  if (m.tipo === 'audio') {
    return m.midia_url ? (
      <audio controls preload="none" src={m.midia_url} className="max-w-full" style={{ width: 260 }} />
    ) : (
      <p className="italic text-neutral-500">🎤 Áudio indisponível</p>
    )
  }
  if (m.tipo === 'video') {
    return (
      <div className="space-y-1.5">
        {m.midia_url ? (
          <video controls preload="none" src={m.midia_url} className="rounded-lg max-h-72 max-w-full" />
        ) : (
          <p className="italic text-neutral-500">🎬 Vídeo indisponível</p>
        )}
        {legenda}
      </div>
    )
  }
  if (m.tipo === 'document') {
    return (
      <div className="space-y-1.5">
        <a
          href={m.midia_url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/60 px-3 py-2 text-[13px] font-medium hover:bg-white"
        >
          <span aria-hidden>📄</span>
          <span className="truncate max-w-[220px]">{m.midia_nome ?? 'Documento'}</span>
        </a>
        {legenda}
      </div>
    )
  }
  if (m.tipo === 'template') {
    return <p className="italic">{m.corpo ?? `Template: ${m.template_nome}`}</p>
  }
  if (m.tipo === 'interactive' && m.direcao === 'saida' && m.corpo) {
    // Corpo gravado como texto + linhas "▸ Botão" → renderiza os botões como chips.
    const linhas = m.corpo.split('\n')
    const chips = linhas.filter((l) => l.startsWith('▸ ')).map((l) => l.slice(2))
    const textoCorpo = linhas.filter((l) => !l.startsWith('▸ ')).join('\n').trim()
    return (
      <div className="space-y-2">
        {textoCorpo && <p className="whitespace-pre-wrap break-words">{textoCorpo}</p>}
        {chips.length > 0 && (
          <div className="flex flex-col gap-1 pt-1 border-t border-black/5">
            {chips.map((c) => (
              <span key={c} className="text-center text-[12.5px] font-medium text-[#1D9E75] bg-white/70 rounded-lg px-2 py-1.5">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }
  return legenda ?? <p className="italic text-neutral-500">[{m.tipo}]</p>
}

function CardPedido({ p, esmaecido }: { p: PedidoResumo; esmaecido?: boolean }) {
  const st = STATUS_PEDIDO_LABEL[p.status ?? ''] ?? { rotulo: p.status ?? '—', cor: 'bg-neutral-100 text-neutral-500' }
  const aba = p.status === 'em_negociacao' ? 'em_negociacao' : p.status === 'concluido' ? 'concluido' : 'precisa_atencao'
  return (
    <a
      href={`/admin/pedidos?aba=${aba}`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        'block rounded-xl border border-neutral-200 px-3 py-2.5 hover:border-[#1D9E75] hover:shadow-sm transition ' +
        (esmaecido ? 'opacity-60' : 'bg-white')
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-neutral-900 truncate">
          {p.tipo ?? 'Pedido'}{p.quantidade ? ` · ${p.quantidade} un` : ''}
        </span>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cor}`}>{st.rotulo}</span>
      </div>
      <p className="text-[11.5px] text-neutral-500 mt-0.5">
        {p.estado ? `${p.estado} · ` : ''}{idadeCurta(p.criado_em)}
      </p>
    </a>
  )
}

function PainelContexto({ ctx }: { ctx: Contexto | null }) {
  if (!ctx) {
    return <p className="p-4 text-[12.5px] text-neutral-400">Carregando contexto…</p>
  }
  const tiposProduto = Array.isArray(ctx.fornecedor?.tipos_produto)
    ? ctx.fornecedor?.tipos_produto.join(', ')
    : ctx.fornecedor?.tipos_produto ?? null
  return (
    <div className="p-4 space-y-5 overflow-y-auto">
      {/* perfil */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">Contato</h3>
        {ctx.cliente && (
          <div className="rounded-xl bg-sky-50/60 border border-sky-100 px-3 py-2.5 mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 mb-0.5">Cliente</p>
            <p className="text-[13px] font-medium text-neutral-900 truncate">{ctx.cliente.nome ?? '—'}</p>
            <p className="text-[11.5px] text-neutral-500 truncate">
              {[ctx.cliente.cidade && ctx.cliente.uf ? `${ctx.cliente.cidade}/${ctx.cliente.uf}` : ctx.cliente.cidade, ctx.cliente.plano ? `plano ${ctx.cliente.plano}` : null].filter(Boolean).join(' · ') || ctx.cliente.email || '—'}
            </p>
          </div>
        )}
        {ctx.fornecedor && (
          <div className="rounded-xl bg-violet-50/60 border border-violet-100 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 mb-0.5">Fornecedor</p>
            <p className="text-[13px] font-medium text-neutral-900 truncate">{ctx.fornecedor.nome ?? '—'}</p>
            <p className="text-[11.5px] text-neutral-500 truncate">
              {[ctx.fornecedor.cidade && ctx.fornecedor.estado ? `${ctx.fornecedor.cidade}/${ctx.fornecedor.estado}` : ctx.fornecedor.cidade, tiposProduto].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        )}
        {!ctx.cliente && !ctx.fornecedor && (
          <p className="text-[12.5px] text-neutral-500">
            Sem cadastro vinculado — contato novo, só do WhatsApp.
          </p>
        )}
      </div>

      {/* pedidos vigentes */}
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
          Pedidos vigentes {ctx.pedidosVigentes.length > 0 && `(${ctx.pedidosVigentes.length})`}
        </h3>
        {ctx.pedidosVigentes.length === 0 ? (
          <p className="text-[12.5px] text-neutral-400">Nenhum pedido em andamento.</p>
        ) : (
          <div className="space-y-2">
            {ctx.pedidosVigentes.map((p) => <CardPedido key={p.id} p={p} />)}
          </div>
        )}
      </div>

      {/* anteriores */}
      {ctx.pedidosAnteriores.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">Anteriores</h3>
          <div className="space-y-2">
            {ctx.pedidosAnteriores.map((p) => <CardPedido key={p.id} p={p} esmaecido />)}
          </div>
        </div>
      )}
    </div>
  )
}

export function WhatsAppInbox() {
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [carregouLista, setCarregouLista] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativaId, setAtivaId] = useState<string | null>(null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregandoThread, setCarregandoThread] = useState(false)
  const [texto, setTexto] = useState('')
  const [anexo, setAnexo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [modalTemplates, setModalTemplates] = useState(false)
  const [contexto, setContexto] = useState<Contexto | null>(null)
  const [painelMobileAberto, setPainelMobileAberto] = useState(false)
  const [rapidasAberto, setRapidasAberto] = useState(false)

  const fimRef = useRef<HTMLDivElement>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  const ativaIdRef = useRef<string | null>(null)
  ativaIdRef.current = ativaId

  const ativa = useMemo(() => conversas.find((c) => c.id === ativaId) ?? null, [conversas, ativaId])
  const janela = useMemo(() => restanteJanela(ativa?.ultima_msg_contato_em ?? null), [ativa, mensagens.length])

  // ---------------------------------------------------------------- lista
  const carregarConversas = useCallback(async (q?: string) => {
    try {
      const res = await fetch(`/api/admin/whatsapp/conversas${q ? `?q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setConversas(data.conversas ?? [])
      setCarregouLista(true)
    } catch { /* rede oscilou — próximo tick resolve */ }
  }, [])

  useEffect(() => {
    carregarConversas(busca || undefined)
    const t = setInterval(() => carregarConversas(busca || undefined), 5000)
    return () => clearInterval(t)
  }, [busca, carregarConversas])

  // ---------------------------------------------------------------- thread
  const carregarMensagens = useCallback(async (conversaId: string, after?: string) => {
    try {
      const url = `/api/admin/whatsapp/conversas/${conversaId}/mensagens${after ? `?after=${encodeURIComponent(after)}` : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok || ativaIdRef.current !== conversaId) return
      const data = await res.json()
      const novas: Mensagem[] = data.mensagens ?? []
      if (after) {
        if (novas.length > 0) {
          setMensagens((prev) => {
            const ids = new Set(prev.map((m) => m.id))
            return [...prev, ...novas.filter((m) => !ids.has(m.id))]
          })
        }
      } else {
        setMensagens(novas)
      }
    } catch { /* idem */ }
  }, [])

  useEffect(() => {
    if (!ativaId) return
    setMensagens([])
    setCarregandoThread(true)
    setErro(null)
    carregarMensagens(ativaId).finally(() => setCarregandoThread(false))
  }, [ativaId, carregarMensagens])

  // ------------------------------------------------------------- contexto
  useEffect(() => {
    if (!ativaId) {
      setContexto(null)
      return
    }
    setContexto(null)
    setPainelMobileAberto(false)
    let cancelado = false
    fetch(`/api/admin/whatsapp/conversas/${ativaId}/contexto`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelado && data && ativaIdRef.current === ativaId) setContexto(data)
      })
      .catch(() => { /* painel fica vazio; não bloqueia o chat */ })
    return () => {
      cancelado = true
    }
  }, [ativaId])

  useEffect(() => {
    if (!ativaId) return
    const t = setInterval(() => {
      const ultima = mensagens[mensagens.length - 1]
      carregarMensagens(ativaId, ultima?.criado_em)
    }, 3000)
    return () => clearInterval(t)
  }, [ativaId, mensagens, carregarMensagens])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens.length, ativaId, carregandoThread])

  // ---------------------------------------------------------------- envio
  async function enviar() {
    if (!ativaId || enviando) return
    if (!texto.trim() && !anexo) return
    setEnviando(true)
    setErro(null)
    try {
      let res: Response
      if (anexo) {
        const form = new FormData()
        form.append('conversaId', ativaId)
        form.append('arquivo', anexo)
        if (texto.trim()) form.append('caption', texto.trim())
        res = await fetch('/api/admin/whatsapp/enviar', { method: 'POST', body: form })
      } else {
        res = await fetch('/api/admin/whatsapp/enviar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversaId: ativaId, texto: texto.trim() }),
        })
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setErro(data?.erro ?? 'Falha ao enviar')
      } else {
        setTexto('')
        setAnexo(null)
        if (inputArquivoRef.current) inputArquivoRef.current.value = ''
      }
      await carregarMensagens(ativaId)
      await carregarConversas(busca || undefined)
    } finally {
      setEnviando(false)
    }
  }

  async function enviarTemplate(t: Template) {
    if (!ativaId || enviando) return
    setEnviando(true)
    setErro(null)
    setModalTemplates(false)
    try {
      const res = await fetch('/api/admin/whatsapp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversaId: ativaId, template: { nome: t.name, idioma: t.language } }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) setErro(data?.erro ?? 'Falha ao enviar template')
      await carregarMensagens(ativaId)
    } finally {
      setEnviando(false)
    }
  }

  async function enviarRapida(preset: RapidaPreset) {
    setRapidasAberto(false)
    if (!ativaId || enviando) return

    // Sem envio automático → só preenche o composer pra editar.
    if (preset.preencher || (!preset.botoes && !preset.urlBotao && !preset.enviarDireto)) {
      setTexto(preset.corpo)
      return
    }

    const payload: Record<string, unknown> = { conversaId: ativaId }
    if (preset.urlBotao) {
      payload.botaoUrl = { corpo: preset.corpo, texto: preset.urlBotao.texto, url: preset.urlBotao.url }
    } else if (preset.botoes) {
      payload.botoes = { corpo: preset.corpo, botoes: preset.botoes }
    } else {
      payload.texto = preset.corpo
    }

    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch('/api/admin/whatsapp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) setErro(data?.erro ?? 'Falha ao enviar mensagem rápida')
      await carregarMensagens(ativaId)
      await carregarConversas(busca || undefined)
    } finally {
      setEnviando(false)
    }
  }

  async function abrirModalTemplates() {
    setModalTemplates(true)
    if (templates === null) {
      try {
        const res = await fetch('/api/admin/whatsapp/templates', { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        setTemplates(data?.templates ?? [])
      } catch {
        setTemplates([])
      }
    }
  }

  // ---------------------------------------------------------------- render
  const grupos = useMemo(() => {
    const out: { data: string; itens: Mensagem[] }[] = []
    for (const m of mensagens) {
      const rotulo = dataLegivel(m.criado_em)
      const ultimo = out[out.length - 1]
      if (ultimo?.data === rotulo) ultimo.itens.push(m)
      else out.push({ data: rotulo, itens: [m] })
    }
    return out
  }, [mensagens])

  return (
    <div className="h-[calc(100dvh-56px)] lg:h-dvh flex flex-col">
      <div className="flex-1 flex min-h-0">
        {/* ------------------------------------------------ lista */}
        <aside
          className={
            'w-full lg:w-[340px] lg:shrink-0 border-r border-neutral-200 bg-white flex-col min-h-0 ' +
            (ativaId ? 'hidden lg:flex' : 'flex')
          }
        >
          <div className="p-4 pb-3 border-b border-neutral-100">
            <h1 className="text-[17px] font-semibold text-neutral-900">WhatsApp</h1>
            <p className="text-[12px] text-neutral-500 mb-3">Atendimento oficial (Cloud API)</p>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou número…"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[13.5px] outline-none focus:border-[#1D9E75] focus:bg-white placeholder:text-neutral-500"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {!carregouLista && <p className="p-4 text-[13px] text-neutral-400">Carregando…</p>}
            {carregouLista && conversas.length === 0 && (
              <div className="p-6 text-center text-[13px] text-neutral-400">
                Nenhuma conversa ainda.
                <br />
                Quando alguém mandar mensagem pro número, ela aparece aqui.
              </div>
            )}
            <ul>
              {conversas.map((c) => {
                const selecionada = c.id === ativaId
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setAtivaId(c.id)}
                      className={
                        'w-full text-left px-4 py-3 border-b border-neutral-50 transition-colors ' +
                        (selecionada ? 'bg-[#1D9E75]/8' : 'hover:bg-neutral-50')
                      }
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[14px] font-medium text-neutral-900 truncate">
                          {c.contato.nome || formatarTelefone(c.contato.wa_id)}
                        </span>
                        {c.ultima_mensagem_em && (
                          <span className="text-[11px] text-neutral-400 shrink-0">
                            {dataLegivel(c.ultima_mensagem_em) === 'Hoje'
                              ? horaCurta(c.ultima_mensagem_em)
                              : dataLegivel(c.ultima_mensagem_em)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-[12.5px] text-neutral-500 truncate">{c.preview ?? '—'}</span>
                        {c.nao_lidas > 0 && (
                          <span className="shrink-0 min-w-[19px] h-[19px] px-1.5 rounded-full bg-[#1D9E75] text-white text-[11px] font-semibold flex items-center justify-center">
                            {c.nao_lidas}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5 mt-1">
                        {c.contato.cliente_id && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">Cliente</span>
                        )}
                        {c.contato.fornecedor_id && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">Fornecedor</span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>

        {/* ------------------------------------------------ thread */}
        <section className={'flex-1 min-w-0 flex-col min-h-0 bg-[#efeae2] ' + (ativaId ? 'flex' : 'hidden lg:flex')}>
          {!ativa ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[14px] text-neutral-500">Selecione uma conversa</p>
            </div>
          ) : (
            <>
              {/* topo */}
              <header className="bg-white border-b border-neutral-200 px-4 py-2.5 flex items-center gap-3">
                <button onClick={() => setAtivaId(null)} className="lg:hidden text-neutral-500 -ml-1 p-1" aria-label="Voltar">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold text-neutral-900 truncate">
                    {ativa.contato.nome || formatarTelefone(ativa.contato.wa_id)}
                  </p>
                  <p className="text-[12px] text-neutral-500">{formatarTelefone(ativa.contato.wa_id)}</p>
                </div>
                <span
                  className={
                    'text-[11px] font-medium px-2 py-1 rounded-full ' +
                    (janela.aberta ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')
                  }
                >
                  {janela.rotulo}
                </span>
                <button
                  onClick={() => setPainelMobileAberto(true)}
                  className="xl:hidden shrink-0 w-9 h-9 rounded-full text-neutral-500 hover:bg-neutral-100 flex items-center justify-center"
                  title="Contexto do contato"
                  aria-label="Contexto do contato"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5M12 8v.01" />
                  </svg>
                </button>
              </header>

              {/* mensagens */}
              <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4 space-y-1.5">
                {carregandoThread && <p className="text-center text-[12px] text-neutral-500 py-4">Carregando…</p>}
                {grupos.map((g) => (
                  <div key={g.data}>
                    <div className="flex justify-center my-3">
                      <span className="text-[11px] font-medium text-neutral-500 bg-white/80 rounded-lg px-2.5 py-1 shadow-sm">{g.data}</span>
                    </div>
                    {g.itens.map((m) => {
                      const saida = m.direcao === 'saida'
                      return (
                        <div key={m.id} className={'flex mb-1.5 ' + (saida ? 'justify-end' : 'justify-start')}>
                          <div
                            className={
                              'max-w-[85%] lg:max-w-[65%] rounded-lg px-3 py-2 text-[13.5px] shadow-sm ' +
                              (saida ? 'bg-[#d9fdd3] text-neutral-900' : 'bg-white text-neutral-900')
                            }
                          >
                            <CorpoMensagem m={m} />
                            <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5">
                              {m.erro && <span className="text-[11px] text-red-500 mr-1">{m.erro}</span>}
                              <span className="text-[10.5px] text-neutral-400">{horaCurta(m.criado_em)}</span>
                              {saida && <Ticks status={m.status} />}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
                <div ref={fimRef} />
              </div>

              {/* composer */}
              <footer className="bg-white border-t border-neutral-200 p-3">
                {erro && (
                  <p className="mb-2 text-[12.5px] text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {erro}
                    <button className="ml-2 underline" onClick={() => setErro(null)}>fechar</button>
                  </p>
                )}
                {!janela.aberta ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="flex-1 text-[13px] text-amber-800">
                      Fora da janela de 24h — o WhatsApp só permite <strong>template aprovado</strong> pra reabrir a conversa.
                    </p>
                    <button
                      onClick={abrirModalTemplates}
                      disabled={enviando}
                      className="shrink-0 rounded-lg bg-[#1D9E75] text-white text-[13px] font-semibold px-4 py-2 hover:brightness-95 disabled:opacity-50"
                    >
                      Enviar template
                    </button>
                  </div>
                ) : (
                  <>
                    {anexo && (
                      <div className="mb-2 flex items-center gap-2 rounded-lg bg-neutral-50 border border-neutral-200 px-3 py-2 text-[12.5px]">
                        <span aria-hidden>📎</span>
                        <span className="truncate flex-1">{anexo.name} · {(anexo.size / 1024 / 1024).toFixed(1)}MB</span>
                        <button
                          onClick={() => { setAnexo(null); if (inputArquivoRef.current) inputArquivoRef.current.value = '' }}
                          className="text-neutral-400 hover:text-red-500"
                          aria-label="Remover anexo"
                        >✕</button>
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <input
                        ref={inputArquivoRef}
                        type="file"
                        className="hidden"
                        accept="image/*,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                        onChange={(e) => setAnexo(e.target.files?.[0] ?? null)}
                      />
                      <button
                        onClick={() => inputArquivoRef.current?.click()}
                        className="shrink-0 w-10 h-10 rounded-full text-neutral-500 hover:bg-neutral-100 flex items-center justify-center"
                        title="Anexar arquivo"
                        aria-label="Anexar arquivo"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48" />
                        </svg>
                      </button>
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setRapidasAberto((v) => !v)}
                          className={
                            'w-10 h-10 rounded-full flex items-center justify-center transition-colors ' +
                            (rapidasAberto ? 'bg-[#1D9E75]/10 text-[#1D9E75]' : 'text-neutral-500 hover:bg-neutral-100')
                          }
                          title="Mensagens rápidas"
                          aria-label="Mensagens rápidas"
                        >
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2L4.09 12.35a.6.6 0 0 0 .46.99H11l-1 8.66L18.91 11.65a.6.6 0 0 0-.46-.99H13l1-8.66z" />
                          </svg>
                        </button>
                        {rapidasAberto && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setRapidasAberto(false)} />
                            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 lg:left-0 lg:translate-x-0 z-40 w-[290px] rounded-2xl bg-white border border-neutral-200 shadow-xl overflow-hidden">
                              <p className="px-3.5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Mensagens rápidas</p>
                              {RAPIDAS.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => enviarRapida(r)}
                                  disabled={enviando}
                                  className="w-full text-left px-3.5 py-2.5 hover:bg-neutral-50 disabled:opacity-50"
                                >
                                  <span className="block text-[13px] font-medium text-neutral-900">
                                    {r.rotulo}
                                    {r.botoes && <span className="ml-1.5 text-[10px] font-semibold text-[#1D9E75]">{r.botoes.length} botões</span>}
                                    {r.urlBotao && <span className="ml-1.5 text-[10px] font-semibold text-[#1D9E75]">🔗 link</span>}
                                  </span>
                                  <span className="block text-[11.5px] text-neutral-500">{r.descricao}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                      <textarea
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
                        }}
                        placeholder={anexo ? 'Legenda (opcional)…' : 'Escreva uma mensagem…'}
                        rows={1}
                        className="flex-1 resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-[13.5px] text-neutral-900 outline-none focus:border-[#1D9E75] focus:bg-white max-h-32 placeholder:text-neutral-500"
                        style={{ minHeight: 42 }}
                      />
                      <button
                        onClick={enviar}
                        disabled={enviando || (!texto.trim() && !anexo)}
                        className="shrink-0 w-10 h-10 rounded-full bg-[#1D9E75] text-white flex items-center justify-center hover:brightness-95 disabled:opacity-40"
                        title="Enviar"
                        aria-label="Enviar"
                      >
                        {enviando ? (
                          <span className="animate-pulse text-[11px]">…</span>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" /></svg>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </footer>
            </>
          )}
        </section>

        {/* ------------------------------------------------ contexto (desktop) */}
        {ativa && (
          <aside className="hidden xl:flex w-[290px] shrink-0 border-l border-neutral-200 bg-white flex-col min-h-0">
            <div className="px-4 pt-4 pb-2 border-b border-neutral-100">
              <h2 className="text-[13px] font-semibold text-neutral-900">Contexto</h2>
            </div>
            <PainelContexto ctx={contexto} />
          </aside>
        )}
      </div>

      {/* ------------------------------------------------ contexto (mobile/tablet) */}
      {painelMobileAberto && ativa && (
        <div className="fixed inset-0 z-50 xl:hidden bg-black/40 flex justify-end" onClick={() => setPainelMobileAberto(false)}>
          <div className="bg-white w-full max-w-[340px] h-full flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Contexto</h2>
              <button onClick={() => setPainelMobileAberto(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Fechar">✕</button>
            </div>
            <PainelContexto ctx={contexto} />
          </div>
        </div>
      )}

      {/* ------------------------------------------------ modal templates */}
      {modalTemplates && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModalTemplates(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[70dvh] flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Templates aprovados</h2>
              <button onClick={() => setModalTemplates(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Fechar">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {templates === null && <p className="p-4 text-[13px] text-neutral-400">Carregando…</p>}
              {templates?.length === 0 && (
                <p className="p-4 text-[13px] text-neutral-500">
                  Nenhum template aprovado na WABA ainda. Crie em <strong>WhatsApp Manager → Templates de mensagem</strong>.
                </p>
              )}
              {templates?.map((t) => (
                <button
                  key={`${t.name}-${t.language}`}
                  onClick={() => enviarTemplate(t)}
                  className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-neutral-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium">{t.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-neutral-400">{t.language} · {t.category}</span>
                  </div>
                  {t.bodyPreview && <p className="text-[12px] text-neutral-500 line-clamp-2 mt-0.5">{t.bodyPreview}</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
