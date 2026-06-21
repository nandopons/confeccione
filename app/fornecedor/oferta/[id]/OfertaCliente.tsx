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
  acabamentos?: string[] | null
  objetivo_material?: string | null
  descricao?: string | null
}
type Oferta = {
  ofertaId: string
  pedidoId: string
  status: 'ofertada' | 'aceita' | 'recusada' | 'cancelada'
  fornecedorNome: string | null
  totalPecas: number
  linhas: Linha[]
  numImagens: number
  fotosPorLinha: number[] | null
  valorRepasseCentavos: number | null
  prazoDias: number | null
  cidade?: string | null
  uf?: string | null
  pago?: boolean
  orcamentoStatus?: string | null
  contatoCliente?: { nome: string | null; telefone: string | null; email: string | null; cidade: string | null; uf: string | null } | null
  linkOrcamento?: string | null
  temListaAberta?: boolean
}

function corLimpa(s: string | null | undefined): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}

const OBJ_MATERIAL_LABEL: Record<string, string> = { economica: 'Econômica', padrao: 'Padrão', premium: 'Premium', performance: 'Performance / Dry', indefinido: 'A definir (cliente quer sugestão)' }
function tecidoLabel(l: { objetivo_material?: string | null; material?: string | null }): string {
  return [OBJ_MATERIAL_LABEL[(l.objetivo_material || '').trim()], l.material].filter(Boolean).join(' · ')
}

function acabamentoLabel(l: { acabamentos?: string[] | null; estampas?: Estampa[] | null }): string {
  const a = Array.isArray(l.acabamentos) ? l.acabamentos : []
  if (a.length > 0) return a.map((x) => (x === 'bordada' ? 'Bordada' : 'Estampada')).join(' + ')
  if ((l.estampas?.length ?? 0) > 0) return 'Estampado / bordado'
  return ''
}

function brl(c: number | null | undefined): string {
  if (c == null) return '—'
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function OfertaCliente({ oferta }: { oferta: Oferta }) {
  const [status, setStatus] = useState(oferta.status)
  const [enviando, setEnviando] = useState<null | 'aceitar' | 'recusar'>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)

  async function responder(acao: 'aceitar' | 'recusar') {
    setEnviando(acao)
    setErro(null)
    try {
      const r = await fetch(`/api/fornecedor/oferta/${oferta.ofertaId}/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      const j = await r.json()
      if (!r.ok) {
        if (j.status) setStatus(j.status)
        throw new Error(j.erro || 'Não foi possível registrar a resposta.')
      }
      setStatus(j.status)
      if (j.status === 'aceita') setTimeout(() => window.location.reload(), 700)
    } catch (e: any) {
      setErro(e.message || 'Erro')
    } finally {
      setEnviando(null)
    }
  }

  const imgs = Array.from({ length: oferta.numImagens }, (_, i) => i)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Confeccione · oferta de pedido</div>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">
          {oferta.totalPecas} peças · {brl(oferta.valorRepasseCentavos)}
          {!oferta.pago && <span className="text-sm font-medium text-gray-400"> (repasse estimado)</span>}
        </h1>
        {oferta.prazoDias ? (
          <p className="text-sm text-[#0F6E56] font-medium mt-1">⏱️ Prazo de produção: {oferta.prazoDias} dias — a partir da confirmação do pagamento.</p>
        ) : null}
        {(oferta.cidade || oferta.uf) && (
          <p className="text-sm text-gray-600 mt-1">📍 Local do pedido: <span className="font-medium text-gray-800">{[oferta.cidade, oferta.uf].filter(Boolean).join('/')}</span></p>
        )}
        <p className="text-sm text-gray-500 mt-1">
          {oferta.pago
            ? 'Pedido já pago. Pagamento garantido pela Confeccione, liberado após a entrega em conformidade.'
            : 'Ao assumir, VOCÊ define o orçamento final (produtos + frete). Pagamento garantido pela Confeccione, liberado após a entrega em conformidade.'}
        </p>
      </div>

      {oferta.temListaAberta && (
        <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">⚠️ Lista de tamanhos em aberto com o cliente</p>
          <p className="text-xs text-amber-800 mt-1 leading-snug">
            As quantidades por tamanho deste pedido ainda podem mudar (o total de peças não muda, só a distribuição). Confirme os tamanhos com o cliente antes de liberar a produção.
          </p>
        </div>
      )}

      {/* Modelos do pedido — visual igual ao da página do cliente */}
      {oferta.fotosPorLinha ? (
        <div className="px-6 py-5 border-b border-gray-100 space-y-6">
          <h2 className="text-sm font-semibold text-gray-700">Pedido do cliente</h2>
          {oferta.linhas.map((l, idx) => {
            const fpl = oferta.fotosPorLinha as number[]
            const count = fpl[idx] ?? 0
            const offset = fpl.slice(0, idx).reduce((a, b) => a + b, 0)
            const tam = (l.tamanhos || []).filter((t) => t.tamanho).map((t) => `${String(t.tamanho).toUpperCase()}: ${t.qtd ?? '?'}`).join('   ·   ')
            const estampado = (l.estampas?.length ?? 0) > 0
            const subtitulo = [l.modelo, corLimpa(l.cor)].filter(Boolean).join(' · ')
            return (
              <div key={idx} className="rounded-2xl border border-gray-200 shadow-sm ring-1 ring-gray-900/5 overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#0F6E56] text-white">
                  <span className="inline-flex items-center gap-2 font-semibold text-sm">
                    <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-white/20 text-[11px] font-bold">{idx + 1}</span>
                    Modelo {idx + 1}
                  </span>
                  <span className="text-xs text-white/85 truncate max-w-[55%] capitalize">{subtitulo}</span>
                </div>
                <div className="p-4">
                  {count > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {Array.from({ length: count }).map((_, j) => {
                        const gi = offset + j
                        return (
                          <button
                            key={j}
                            type="button"
                            onClick={() => setLightbox(gi)}
                            className="group relative block aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                            aria-label={`Ampliar foto ${j + 1} do modelo ${idx + 1}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/pedido/assistente/${oferta.pedidoId}/imagem?i=${gi}`} alt={`Modelo ${idx + 1} — foto ${j + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                              <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium bg-black/50 rounded-full px-2.5 py-1 transition-opacity">Ampliar</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Sem foto enviada para este modelo.</p>
                  )}
                  <div className="mt-3 text-sm">
                    <div className="font-medium text-gray-900">
                      {l.total ?? '?'}× {l.modelo || 'peça'}
                      {acabamentoLabel(l) && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{acabamentoLabel(l)}</span>}
                    </div>
                    {tecidoLabel(l) && <div className="text-gray-600 mt-1">Tecido: {tecidoLabel(l)}</div>}
                    {tam && <div className="text-gray-600 mt-1">{tam}</div>}
                    {l.estampas && l.estampas.length > 0 && (
                      <div className="text-gray-600 mt-1">Estampa: {l.estampas.map((e) => [e.posicao, e.tamanho].filter(Boolean).join(' ')).join(', ')}</div>
                    )}
                    {l.descricao && <div className="text-gray-500 mt-1">{l.descricao}</div>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
      <>
      {/* Visualizadores enviados pelo cliente (legado / grade única) */}
      <div className="px-6 py-5 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Visualizadores do cliente</h2>
        {imgs.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {imgs.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(i)}
                className="group relative block aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
                aria-label={`Abrir visualizador ${i + 1} em tela cheia`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/pedido/assistente/${oferta.pedidoId}/imagem?i=${i}`}
                  alt={`Visualizador ${i + 1}`}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                  <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium bg-black/50 rounded-full px-2.5 py-1 transition-opacity">Ampliar</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">O cliente ainda não enviou um visualizador/arte para este pedido.</p>
        )}
      </div>

      {/* Detalhes */}
      <div className="px-6 py-5 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Itens do pedido</h2>
        <ul className="space-y-3">
          {oferta.linhas.map((l, idx) => {
            const tam = (l.tamanhos || []).filter((t) => t.tamanho).map((t) => `${t.tamanho}: ${t.qtd ?? '?'}`).join('  ·  ')
            const estampado = (l.estampas?.length ?? 0) > 0
            return (
              <li key={idx} className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
                <div className="font-medium text-gray-900">
                  {l.total ?? '?'}× {l.modelo || 'peça'}{l.cor ? ` · ${l.cor}` : ''}
                  {acabamentoLabel(l) && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{acabamentoLabel(l)}</span>}
                </div>
                {tecidoLabel(l) && <div className="text-sm text-gray-600 mt-1">Tecido: {tecidoLabel(l)}</div>}
                {tam && <div className="text-sm text-gray-600 mt-1">{tam}</div>}
                {l.estampas && l.estampas.length > 0 && (
                  <div className="text-sm text-gray-600 mt-1">
                    Estampa: {l.estampas.map((e) => [e.posicao, e.tamanho].filter(Boolean).join(' ')).join(', ')}
                  </div>
                )}
                {l.descricao && <div className="text-sm text-gray-500 mt-1">{l.descricao}</div>}
              </li>
            )
          })}
        </ul>
      </div>
      </>
      )}

      {/* Ação */}
      <div className="px-6 py-5">
        {status === 'ofertada' && (
          <>
            {erro && <div className="mb-3 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro}</div>}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => responder('aceitar')}
                disabled={enviando !== null}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
              >
                {enviando === 'aceitar' ? 'Confirmando…' : 'Assumir este pedido'}
              </button>
              <button
                onClick={() => responder('recusar')}
                disabled={enviando !== null}
                className="flex-1 sm:flex-none sm:px-6 border border-gray-300 text-gray-700 font-medium py-3 rounded-xl hover:bg-gray-50 disabled:opacity-50"
              >
                {enviando === 'recusar' ? '…' : 'Recusar'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">
              Ao assumir, a Confeccione entra em contato com os detalhes de produção e entrega.
            </p>
          </>
        )}

        {status === 'aceita' && (
          <div className="py-2">
            <div className="text-emerald-700 text-lg font-semibold text-center">✓ Você assumiu este pedido!</div>
            {oferta.contatoCliente ? (
              <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Contato do cliente</p>
                <p className="text-sm text-gray-900 font-medium">{oferta.contatoCliente.nome ?? 'Cliente Confeccione'}</p>
                {oferta.contatoCliente.telefone && <p className="text-sm text-gray-700">📱 {oferta.contatoCliente.telefone}</p>}
                {oferta.contatoCliente.email && <p className="text-sm text-gray-700 break-all">✉️ {oferta.contatoCliente.email}</p>}
                {(oferta.contatoCliente.cidade || oferta.contatoCliente.uf) && (
                  <p className="text-sm text-gray-700">📍 {[oferta.contatoCliente.cidade, oferta.contatoCliente.uf].filter(Boolean).join('/')}</p>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm text-amber-800">🔒 Os dados de contato do cliente são liberados <strong>após o pagamento</strong>. Defina o orçamento — assim que o cliente pagar, nome, telefone e e-mail aparecem aqui. Até lá, use o canal de perguntas (mediado pela Confeccione).</p>
                {(oferta.cidade || oferta.uf) && (
                  <p className="text-sm text-amber-800 mt-1">📍 Local do pedido: <strong>{[oferta.cidade, oferta.uf].filter(Boolean).join('/')}</strong></p>
                )}
              </div>
            )}
            {!oferta.pago && oferta.linkOrcamento && (
              <a href={oferta.linkOrcamento} className="mt-4 block w-full text-center bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl">
                💰 {oferta.orcamentoStatus === 'definido' ? 'Ajustar orçamento enviado' : 'Definir orçamento final'} →
              </a>
            )}
            {oferta.pago && <p className="text-sm text-gray-600 mt-3 text-center">✅ Pedido já pago — pode iniciar a produção.</p>}
          </div>
        )}
        {status === 'recusada' && (
          <div className="text-center py-4 text-gray-500">Você recusou esta oferta. Obrigado por avisar!</div>
        )}
        {status === 'cancelada' && (
          <div className="text-center py-4 text-gray-500">Esta oferta não está mais disponível — o pedido já foi assumido por outro fornecedor.</div>
        )}
      </div>

      {(status === 'ofertada' || status === 'aceita') && (
        <PerguntasFornecedor ofertaId={oferta.ofertaId} />
      )}

      {lightbox !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl leading-none"
            aria-label="Fechar"
          >
            ×
          </button>
          {imgs.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + imgs.length) % imgs.length) }}
                className="absolute left-3 sm:left-6 h-11 w-11 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl"
                aria-label="Anterior"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % imgs.length) }}
                className="absolute right-3 sm:right-6 h-11 w-11 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl"
                aria-label="Próximo"
              >
                ›
              </button>
            </>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/pedido/assistente/${oferta.pedidoId}/imagem?i=${lightbox}`}
            alt={`Visualizador ${lightbox + 1}`}
            className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {imgs.length > 1 && (
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs bg-black/40 rounded-full px-3 py-1">
              {lightbox + 1} / {imgs.length}
            </span>
          )}
        </div>
      )}
    </div>
  )
}


type MensagemPergunta = { id: string; autor: 'fornecedor' | 'cliente'; texto: string; criadoEm: string }

function PerguntasFornecedor({ ofertaId }: { ofertaId: string }) {
  const [mensagens, setMensagens] = useState<MensagemPergunta[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const carregouRef = useRef(false)

  async function carregar() {
    try {
      const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/perguntas`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && Array.isArray(j.mensagens)) setMensagens(j.mensagens)
    } catch {
      // silencioso — tenta de novo no próximo poll
    } finally {
      carregouRef.current = true
    }
  }

  useEffect(() => {
    void carregar()
    const t = setInterval(() => { void carregar() }, 20000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ofertaId])

  async function enviar() {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/pergunta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: t }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar a pergunta.')
      setTexto('')
      await carregar()
    } catch (e: any) {
      setErro(e.message || 'Erro ao enviar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="px-6 py-5 border-t border-gray-100">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">💬 Perguntas ao cliente (via Confeccione)</h2>
      <p className="text-xs text-gray-500 mb-3">
        O cliente recebe por WhatsApp e e-mail e responde por aqui. Sem troca de contato.
      </p>

      {carregouRef.current && mensagens.length === 0 && (
        <p className="text-sm text-gray-400 mb-3">Nenhuma pergunta ainda. Faça a primeira abaixo.</p>
      )}

      {mensagens.length > 0 && (
        <ul className="space-y-2 mb-4">
          {mensagens.map((m) => {
            const meu = m.autor === 'fornecedor'
            return (
              <li key={m.id} className={`flex ${meu ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${meu ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <div className={`text-[11px] font-semibold mb-0.5 ${meu ? 'text-emerald-50' : 'text-gray-500'}`}>{meu ? 'Você' : 'Cliente'}</div>
                  <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {erro && <div className="mb-2 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro}</div>}

      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Escreva uma pergunta para o cliente…"
        maxLength={1000}
        rows={3}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => void enviar()}
          disabled={enviando || !texto.trim()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl disabled:opacity-50"
        >
          {enviando ? 'Enviando…' : 'Enviar pergunta'}
        </button>
      </div>
    </div>
  )
}

