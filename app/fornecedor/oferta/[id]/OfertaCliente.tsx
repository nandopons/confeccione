'use client'

import { useState } from 'react'

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
  ofertaId: string
  pedidoId: string
  status: 'ofertada' | 'aceita' | 'recusada' | 'cancelada'
  fornecedorNome: string | null
  totalPecas: number
  linhas: Linha[]
  numImagens: number
  valorRepasseCentavos: number | null
  prazoDias: number | null
  cidade?: string | null
  uf?: string | null
  pago?: boolean
  orcamentoStatus?: string | null
  contatoCliente?: { nome: string | null; telefone: string | null; email: string | null; cidade: string | null; uf: string | null } | null
  linkOrcamento?: string | null
}

function brl(c: number | null | undefined): string {
  if (c == null) return '—'
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function OfertaCliente({ oferta }: { oferta: Oferta }) {
  const [status, setStatus] = useState(oferta.status)
  const [enviando, setEnviando] = useState<null | 'aceitar' | 'recusar'>(null)
  const [erro, setErro] = useState<string | null>(null)

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

      {/* Visualizadores enviados pelo cliente */}
      <div className="px-6 py-5 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Visualizadores do cliente</h2>
        {imgs.length > 0 ? (
          <div className="space-y-4">
            {imgs.map((i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`/api/pedido/assistente/${oferta.pedidoId}/imagem?i=${i}`}
                alt={`Visualizador ${i + 1}`}
                className="w-full rounded-lg border border-gray-200"
              />
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
                  {l.total ?? '?'}× {l.modelo || 'peça'}{l.cor ? ` · ${l.cor}` : ''}{l.material ? ` · ${l.material}` : ''}
                  {estampado && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">estampado</span>}
                </div>
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
    </div>
  )
}
