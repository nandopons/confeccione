"use client"

// Calculadora de frete do Melhor Envio no orçamento do fornecedor.
// Volumetria didática: quantas caixas, medidas de UMA caixa (desenho com
// setas) e peso TOTAL — dividimos o peso entre as caixas. A última volumetria
// usada fica salva no aparelho (localStorage) como sugestão.

import { useEffect, useState } from 'react'
import type { FreteMeEscolhido } from '@/app/lib/pedido-assistente-oferta'

type Servico = {
  id: number
  nome: string
  transportadora: string
  logo: string | null
  precoCentavos: number
  prazoDias: number
}

type Volumetria = { qtd: number; altura: string; largura: string; comprimento: string; pesoTotal: string }

const VOLUMETRIA_PADRAO: Volumetria = { qtd: 1, altura: '', largura: '', comprimento: '', pesoTotal: '' }
const LS_KEY = 'confeccione_me_volumetria'

function brl(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function num(s: string): number {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Desenho didático da caixa com as três medidas. */
function CaixaSvg() {
  return (
    <svg viewBox="0 0 220 150" className="w-48 mx-auto" aria-hidden>
      <g stroke="#94a3b8" strokeWidth="1.6" fill="#f8fafc">
        <path d="M40 55 L110 30 L180 55 L180 110 L110 138 L40 110 Z" />
        <path d="M40 55 L110 80 L180 55" fill="none" />
        <path d="M110 80 L110 138" fill="none" />
      </g>
      <g fontSize="11" fill="#0f766e" fontWeight="600">
        <text x="8" y="88">Altura</text>
        <line x1="34" y1="60" x2="34" y2="112" stroke="#0f766e" strokeWidth="1.2" markerEnd="url(#seta)" markerStart="url(#seta)" />
        <text x="52" y="132" transform="rotate(12 62 132)">Largura</text>
        <line x1="44" y1="116" x2="106" y2="140" stroke="#0f766e" strokeWidth="1.2" />
        <text x="146" y="136" transform="rotate(-14 156 132)">Comprim.</text>
        <line x1="114" y1="140" x2="176" y2="116" stroke="#0f766e" strokeWidth="1.2" />
      </g>
    </svg>
  )
}

export default function CalculadoraFreteME({
  ofertaId,
  seguroCentavos,
  aberto,
  onFechar,
  onEscolher,
}: {
  ofertaId: string
  seguroCentavos: number
  aberto: boolean
  onFechar: () => void
  onEscolher: (f: FreteMeEscolhido) => void
}) {
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [vol, setVol] = useState<Volumetria>(VOLUMETRIA_PADRAO)
  const [cotando, setCotando] = useState(false)
  const [servicos, setServicos] = useState<Servico[] | null>(null)
  const [ceps, setCeps] = useState<{ origem: string; destino: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [reconectar, setReconectar] = useState(false)

  // status da conexão + volumetria lembrada, ao abrir
  useEffect(() => {
    if (!aberto) return
    setErro(null)
    setServicos(null)
    try {
      const salva = localStorage.getItem(LS_KEY)
      if (salva) setVol({ ...VOLUMETRIA_PADRAO, ...JSON.parse(salva) })
    } catch { /* volumetria lembrada é só conveniência */ }
    fetch(`/api/fornecedor/melhorenvio/status?oferta=${ofertaId}`)
      .then((r) => r.json())
      .then((j) => setConectado(Boolean(j?.conectado)))
      .catch(() => setConectado(false))
  }, [aberto, ofertaId])

  if (!aberto) return null

  const urlConectar = `/api/fornecedor/melhorenvio/conectar?oferta=${ofertaId}&voltar=${encodeURIComponent(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  )}`

  const volumetriaValida =
    vol.qtd >= 1 && num(vol.altura) > 0 && num(vol.largura) > 0 && num(vol.comprimento) > 0 && num(vol.pesoTotal) > 0

  async function cotar() {
    if (cotando || !volumetriaValida) return
    setCotando(true)
    setErro(null)
    setServicos(null)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(vol))
      const pesoPorCaixa = num(vol.pesoTotal) / vol.qtd
      const volumes = Array.from({ length: vol.qtd }, () => ({
        altura: num(vol.altura),
        largura: num(vol.largura),
        comprimento: num(vol.comprimento),
        peso: Number(pesoPorCaixa.toFixed(2)),
      }))
      const r = await fetch('/api/fornecedor/frete/cotar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ofertaId, volumes, seguroCentavos }),
      })
      const j = await r.json()
      if (!r.ok) {
        setReconectar(Boolean(j?.reconectar))
        throw new Error(j?.erro || 'Não deu pra cotar agora.')
      }
      setServicos(j.servicos as Servico[])
      setCeps({ origem: j.cepOrigem, destino: j.cepDestino })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na cotação.')
    } finally {
      setCotando(false)
    }
  }

  function escolher(s: Servico) {
    const pesoPorCaixa = num(vol.pesoTotal) / vol.qtd
    onEscolher({
      servicoId: s.id,
      servico: s.nome,
      transportadora: s.transportadora,
      precoCentavos: s.precoCentavos,
      prazoDias: s.prazoDias,
      volumes: Array.from({ length: vol.qtd }, () => ({
        altura: num(vol.altura),
        largura: num(vol.largura),
        comprimento: num(vol.comprimento),
        peso: Number(pesoPorCaixa.toFixed(2)),
      })),
      cepOrigem: ceps?.origem ?? '',
      cepDestino: ceps?.destino ?? '',
    })
    onFechar()
  }

  const inputCls =
    'block mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 focus:outline-none focus:border-emerald-600'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[92dvh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-[15px] font-semibold text-gray-900">📦 Calcular frete — Melhor Envio</h2>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-700" aria-label="Fechar">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {conectado === null && <p className="text-sm text-gray-500">Verificando sua conta…</p>}

          {conectado === false && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
              <p className="text-sm text-gray-800 font-medium mb-1">Conecte sua conta do Melhor Envio</p>
              <p className="text-[13px] text-gray-600 mb-3">
                É rapidinho e só precisa uma vez: você autoriza a Confeccione a cotar fretes com os preços da SUA conta.
                Não tem conta ainda? Dá pra criar grátis no caminho.
              </p>
              <a
                href={urlConectar}
                className="inline-block bg-[#1D9E75] text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-[#178761]"
              >
                Conectar Melhor Envio
              </a>
            </div>
          )}

          {conectado && (
            <>
              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label className="text-xs text-gray-500">
                    Quantos volumes (caixas)?
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setVol((v) => ({ ...v, qtd: Math.max(1, v.qtd - 1) }))}
                        className="w-9 h-9 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >−</button>
                      <span className="w-10 text-center text-lg font-semibold text-gray-900">{vol.qtd}</span>
                      <button
                        type="button"
                        onClick={() => setVol((v) => ({ ...v, qtd: Math.min(20, v.qtd + 1) }))}
                        className="w-9 h-9 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >+</button>
                    </div>
                  </label>
                  <label className="text-xs text-gray-500 block mt-3">
                    Peso total da mercadoria (kg)
                    <input
                      value={vol.pesoTotal}
                      onChange={(e) => setVol((v) => ({ ...v, pesoTotal: e.target.value }))}
                      inputMode="decimal"
                      placeholder="ex.: 12,5"
                      className={inputCls}
                    />
                  </label>
                </div>
                <CaixaSvg />
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-2">Medidas de cada caixa (cm){vol.qtd > 1 ? ' — considere caixas iguais' : ''}:</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs text-gray-500">
                    Altura
                    <input value={vol.altura} onChange={(e) => setVol((v) => ({ ...v, altura: e.target.value }))} inputMode="decimal" placeholder="cm" className={inputCls} />
                  </label>
                  <label className="text-xs text-gray-500">
                    Largura
                    <input value={vol.largura} onChange={(e) => setVol((v) => ({ ...v, largura: e.target.value }))} inputMode="decimal" placeholder="cm" className={inputCls} />
                  </label>
                  <label className="text-xs text-gray-500">
                    Comprimento
                    <input value={vol.comprimento} onChange={(e) => setVol((v) => ({ ...v, comprimento: e.target.value }))} inputMode="decimal" placeholder="cm" className={inputCls} />
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void cotar()}
                disabled={cotando || !volumetriaValida}
                className="w-full bg-[#111] text-white text-sm font-medium rounded-xl px-4 py-2.5 disabled:opacity-40 hover:bg-black"
              >
                {cotando ? 'Cotando…' : 'Ver preços das transportadoras'}
              </button>

              {erro && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {erro}
                  {reconectar && (
                    <a href={urlConectar} className="block mt-1 font-medium text-[#0F6E56] underline">Reconectar minha conta</a>
                  )}
                </div>
              )}

              {servicos && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Escolha a transportadora — o valor entra como o seu frete no orçamento:</p>
                  {servicos.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => escolher(s)}
                      className="w-full flex items-center gap-3 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/40 px-3 py-2.5 text-left"
                    >
                      {s.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.logo} alt={s.transportadora} className="w-9 h-9 rounded object-contain bg-white border border-gray-100" />
                      ) : (
                        <span className="w-9 h-9 rounded bg-gray-100 flex items-center justify-center">🚚</span>
                      )}
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-gray-900">{s.transportadora} · {s.nome}</span>
                        <span className="block text-[12px] text-gray-500">até {s.prazoDias} dias úteis pra entrega</span>
                      </span>
                      <strong className="text-emerald-700 text-sm">{brl(s.precoCentavos)}</strong>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
