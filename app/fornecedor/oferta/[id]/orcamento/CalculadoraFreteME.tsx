"use client"

// Calculadora de frete do Melhor Envio no orçamento do fornecedor.
// Volumetria didática: quantas caixas, medidas de UMA caixa (desenho com
// setas) e peso TOTAL — dividimos o peso entre as caixas. A última volumetria
// usada fica salva no aparelho (localStorage) como sugestão.
//
// REVISÃO DE 24/09/2026, a partir do que a confecção viu na tela:
//   • o modal fechava ao arrastar o mouse dentro de um campo — o clique de
//     "fechar" era o `click` do fundo, que dispara quando o botão SOLTA sobre
//     o fundo mesmo tendo APERTADO dentro do input. Agora só fecha quando o
//     aperto e a soltura foram os dois no fundo;
//   • "Too small: expected number to be >=13" era o zod falando inglês: o
//     piso dos Correios (13 × 8 × 1 cm) é validado aqui, em português, campo
//     a campo, e as caixas prontas P/M/G preenchem as medidas num toque;
//   • sem conta conectada não dava pra cotar nada (44 dos 47 aprovados), e o
//     CEP de origem só vinha do cadastro, vazio em todos. Agora ela informa o
//     CEP de onde despacha e cota pela conta da plataforma, como estimativa;
//     conectar a própria conta vira opção pra ver o preço da conta dela.

import { useEffect, useRef, useState } from 'react'
import type { FreteMeEscolhido } from '@/app/lib/pedido-assistente-oferta'
import { CAIXAS_PRONTAS, LIMIAR_MANUSEIO_CM, MIN_ALTURA_CM, MIN_COMPRIMENTO_CM, MIN_LARGURA_CM } from '@/app/lib/cotacao-frete'

type Servico = {
  id: number
  nome: string
  transportadora: string
  logo: string | null
  precoCentavos: number
  prazoDias: number
}

type Volumetria = { qtd: number; altura: string; largura: string; comprimento: string; pesoTotal: string }
type Status = { conectado: boolean; configurado: boolean; estimativaDisponivel: boolean; cepOrigem: string | null }

const VOLUMETRIA_PADRAO: Volumetria = { qtd: 1, altura: '', largura: '', comprimento: '', pesoTotal: '' }
const LS_KEY = 'confeccione_me_volumetria'
const LS_CEP = 'confeccione_me_cep_origem'

function brl(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function num(s: string): number {
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function mascaraCep(s: string): string {
  const d = s.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
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

/**
 * O que está errado na volumetria, dito em português e nomeando o campo. A
 * lista vazia é o que libera o botão; a primeira frase é o que a tela mostra.
 */
function problemasDaVolumetria(vol: Volumetria, cepOrigem: string): string[] {
  const p: string[] = []
  const a = num(vol.altura)
  const l = num(vol.largura)
  const c = num(vol.comprimento)
  const kg = num(vol.pesoTotal)
  if (cepOrigem.replace(/\D/g, '').length !== 8) p.push('Informe o CEP de onde a encomenda sai (8 dígitos).')
  if (vol.altura && a > 0 && a < MIN_ALTURA_CM) p.push(`Altura mínima dos Correios: ${MIN_ALTURA_CM} cm.`)
  if (vol.largura && l > 0 && l < MIN_LARGURA_CM) p.push(`Largura mínima dos Correios: ${MIN_LARGURA_CM} cm.`)
  if (vol.comprimento && c > 0 && c < MIN_COMPRIMENTO_CM) p.push(`Comprimento mínimo dos Correios: ${MIN_COMPRIMENTO_CM} cm — é o lado maior da caixa.`)
  if ([a, l, c].some((x) => x > 150)) p.push('Nenhum lado pode passar de 150 cm.')
  if (!(a > 0 && l > 0 && c > 0)) p.push('Preencha altura, largura e comprimento da caixa (cm).')
  if (!(kg > 0)) p.push('Informe o peso total da mercadoria (kg).')
  else if (kg / Math.max(vol.qtd, 1) > 300) p.push('Cada caixa pode ter no máximo 300 kg.')
  return p
}

type Props = {
  ofertaId: string
  seguroCentavos: number
  aberto: boolean
  onFechar: () => void
  onEscolher: (f: FreteMeEscolhido) => void
}

/** Fechado não monta nada; cada abertura monta a calculadora do zero (estado limpo, lembranças relidas). */
export default function CalculadoraFreteME(props: Props) {
  if (!props.aberto) return null
  return <Calculadora {...props} />
}

function lembrada<T>(chave: string, ler: (bruto: string) => T, padrao: T): T {
  try {
    const bruto = localStorage.getItem(chave)
    return bruto ? ler(bruto) : padrao
  } catch {
    return padrao
  }
}

function Calculadora({ ofertaId, seguroCentavos, onFechar, onEscolher }: Props) {
  const [status, setStatus] = useState<Status | null>(null)
  const [statusFalhou, setStatusFalhou] = useState(false)
  const [vol, setVol] = useState<Volumetria>(() => lembrada(LS_KEY, (b) => ({ ...VOLUMETRIA_PADRAO, ...JSON.parse(b) }), VOLUMETRIA_PADRAO))
  const [cepOrigem, setCepOrigem] = useState(() => lembrada(LS_CEP, mascaraCep, ''))
  const [cotando, setCotando] = useState(false)
  const [servicos, setServicos] = useState<Servico[] | null>(null)
  const [ceps, setCeps] = useState<{ origem: string; destino: string } | null>(null)
  const [estimativa, setEstimativa] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [reconectar, setReconectar] = useState(false)
  // Onde o botão do mouse foi APERTADO. Ver o comentário no topo.
  const apertouNoFundo = useRef(false)

  // status da conexão (e o CEP do cadastro), ao abrir
  useEffect(() => {
    let vivo = true
    fetch(`/api/fornecedor/melhorenvio/status?oferta=${ofertaId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!vivo) return
        const s: Status = {
          conectado: Boolean(j?.conectado),
          configurado: Boolean(j?.configurado),
          estimativaDisponivel: Boolean(j?.estimativaDisponivel),
          cepOrigem: typeof j?.cepOrigem === 'string' ? j.cepOrigem : null,
        }
        setStatus(s)
        // O do cadastro manda; o lembrado no aparelho é o plano B.
        if (s.cepOrigem) setCepOrigem(mascaraCep(s.cepOrigem))
      })
      .catch(() => { if (vivo) setStatusFalhou(true) })
    return () => { vivo = false }
  }, [ofertaId])

  const urlConectar = `/api/fornecedor/melhorenvio/conectar?oferta=${ofertaId}&voltar=${encodeURIComponent(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  )}`

  const problemas = problemasDaVolumetria(vol, cepOrigem)
  const podeCotar = problemas.length === 0
  // Medida digitada e fora do limite: avisa em âmbar junto dos campos. O resto
  // (campo vazio, CEP faltando) é lembrete em cinza embaixo do botão.
  const foraDoLimite = problemas.find((p) => /mínim|máxim|150 cm|300 kg/.test(p)) ?? null
  const maiorLado = Math.max(num(vol.altura), num(vol.largura), num(vol.comprimento))
  const daParaUsar = Boolean(status && (status.conectado || status.estimativaDisponivel))

  function volumes() {
    const pesoPorCaixa = num(vol.pesoTotal) / vol.qtd
    return Array.from({ length: vol.qtd }, () => ({
      altura: num(vol.altura),
      largura: num(vol.largura),
      comprimento: num(vol.comprimento),
      peso: Number(pesoPorCaixa.toFixed(2)),
    }))
  }

  function usarCaixaPronta(t: 'P' | 'M' | 'G') {
    const c = CAIXAS_PRONTAS[t]
    setVol((v) => ({ ...v, altura: String(c.altura), largura: String(c.largura), comprimento: String(c.comprimento) }))
  }

  async function cotar() {
    if (cotando || !podeCotar) return
    setCotando(true)
    setErro(null)
    setServicos(null)
    setEstimativa(null)
    try {
      const cep = cepOrigem.replace(/\D/g, '')
      localStorage.setItem(LS_KEY, JSON.stringify(vol))
      localStorage.setItem(LS_CEP, cep)
      const r = await fetch('/api/fornecedor/frete/cotar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ofertaId, volumes: volumes(), seguroCentavos, cepOrigem: cep }),
      })
      const j = await r.json()
      if (!r.ok) {
        setReconectar(Boolean(j?.reconectar))
        throw new Error(j?.erro || 'Não deu pra cotar agora.')
      }
      setServicos(j.servicos as Servico[])
      setCeps({ origem: j.cepOrigem, destino: j.cepDestino })
      setEstimativa(j.estimativa ? (typeof j.aviso === 'string' ? j.aviso : 'Estimativa pela conta da Confeccione.') : null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na cotação.')
    } finally {
      setCotando(false)
    }
  }

  function escolher(s: Servico) {
    onEscolher({
      servicoId: s.id,
      servico: s.nome,
      transportadora: s.transportadora,
      precoCentavos: s.precoCentavos,
      prazoDias: s.prazoDias,
      volumes: volumes(),
      cepOrigem: ceps?.origem ?? cepOrigem.replace(/\D/g, ''),
      cepDestino: ceps?.destino ?? '',
    })
    onFechar()
  }

  const inputCls =
    'block mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 focus:outline-none focus:border-emerald-600'
  const campoAbaixoDoMinimo = (valor: string, min: number) => Boolean(valor) && num(valor) > 0 && num(valor) < min
  const inputMedida = (valor: string, min: number) =>
    `${inputCls} ${campoAbaixoDoMinimo(valor, min) ? 'border-amber-400 bg-amber-50' : ''}`

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onPointerDown={(e) => { apertouNoFundo.current = e.target === e.currentTarget }}
      onClick={(e) => {
        // Só fecha se apertou E soltou no fundo. Arrastar de dentro de um campo
        // pra fora termina o click aqui, e isso não é "quero fechar".
        if (apertouNoFundo.current && e.target === e.currentTarget) onFechar()
        apertouNoFundo.current = false
      }}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[92dvh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-[15px] font-semibold text-gray-900">📦 Calcular frete — Melhor Envio</h2>
          <button type="button" onClick={onFechar} className="text-gray-400 hover:text-gray-700" aria-label="Fechar">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {status === null && !statusFalhou && <p className="text-sm text-gray-500">Verificando sua conta…</p>}
          {statusFalhou && status === null && (
            <p className="text-sm text-red-700">Não deu pra verificar a conexão agora. Feche e abra de novo.</p>
          )}

          {status && !daParaUsar && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
              <p className="text-sm text-gray-800 font-medium mb-1">Conecte sua conta do Melhor Envio</p>
              <p className="text-[13px] text-gray-600 mb-3">
                É rapidinho e só precisa uma vez: você autoriza a Confeccione a cotar fretes com os preços da SUA conta.
                Não tem conta ainda? Dá pra criar grátis no caminho.
              </p>
              <a href={urlConectar} className="inline-block bg-[#1D9E75] text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-[#178761]">
                Conectar Melhor Envio
              </a>
            </div>
          )}

          {status && daParaUsar && (
            <>
              {!status.conectado && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-gray-700">
                  Você ainda não conectou sua conta do Melhor Envio, então a cotação aqui é uma <strong>estimativa</strong> pela conta da Confeccione.
                  A etiqueta você emite e paga na sua conta; o preço final é o de lá.{' '}
                  <a href={urlConectar} className="font-medium text-[#0F6E56] underline">Conectar minha conta</a> mostra os preços da sua.
                </div>
              )}

              <label className="text-xs text-gray-500 block">
                CEP de onde a encomenda sai (remetente)
                <input
                  value={cepOrigem}
                  onChange={(e) => setCepOrigem(mascaraCep(e.target.value))}
                  inputMode="numeric"
                  placeholder="00000-000"
                  autoComplete="postal-code"
                  className={`${inputCls} w-40`}
                />
                {status.cepOrigem && cepOrigem.replace(/\D/g, '') === status.cepOrigem && (
                  <span className="block mt-1 text-[11px] text-gray-400">Do seu cadastro. Pode corrigir aqui se mudou.</span>
                )}
              </label>

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
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(['P', 'M', 'G'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => usarCaixaPronta(t)}
                      className="text-[12px] rounded-full border border-gray-300 px-2.5 py-1 text-gray-700 hover:border-emerald-500 hover:bg-emerald-50"
                      title={CAIXAS_PRONTAS[t].rotulo}
                    >
                      Caixa {CAIXAS_PRONTAS[t].rotulo}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs text-gray-500">
                    Altura
                    <input value={vol.altura} onChange={(e) => setVol((v) => ({ ...v, altura: e.target.value }))} inputMode="decimal" placeholder={`mín. ${MIN_ALTURA_CM}`} className={inputMedida(vol.altura, MIN_ALTURA_CM)} />
                  </label>
                  <label className="text-xs text-gray-500">
                    Largura
                    <input value={vol.largura} onChange={(e) => setVol((v) => ({ ...v, largura: e.target.value }))} inputMode="decimal" placeholder={`mín. ${MIN_LARGURA_CM}`} className={inputMedida(vol.largura, MIN_LARGURA_CM)} />
                  </label>
                  <label className="text-xs text-gray-500">
                    Comprimento
                    <input value={vol.comprimento} onChange={(e) => setVol((v) => ({ ...v, comprimento: e.target.value }))} inputMode="decimal" placeholder={`mín. ${MIN_COMPRIMENTO_CM}`} className={inputMedida(vol.comprimento, MIN_COMPRIMENTO_CM)} />
                  </label>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Piso dos Correios: {MIN_COMPRIMENTO_CM} × {MIN_LARGURA_CM} × {MIN_ALTURA_CM} cm (comprimento × largura × altura), caixa fechada.
                  {maiorLado > LIMIAR_MANUSEIO_CM ? ` Acima de ${LIMIAR_MANUSEIO_CM} cm só os Correios cotam, com taxa de manuseio.` : ''}
                </p>
                {foraDoLimite && <p className="text-[12px] text-amber-700 mt-1">{foraDoLimite}</p>}
              </div>

              <button
                type="button"
                onClick={() => void cotar()}
                disabled={cotando || !podeCotar}
                className="w-full bg-[#111] text-white text-sm font-medium rounded-xl px-4 py-2.5 disabled:opacity-40 hover:bg-black"
              >
                {cotando ? 'Cotando…' : 'Ver preços das transportadoras'}
              </button>
              {!podeCotar && !foraDoLimite && <p className="text-[12px] text-gray-500 -mt-2">{problemas[0]}</p>}

              {erro && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {erro}
                  {reconectar && (
                    <a href={urlConectar} className="block mt-1 font-medium text-[#0F6E56] underline">
                      {status.conectado ? 'Reconectar minha conta' : 'Conectar minha conta'}
                    </a>
                  )}
                </div>
              )}

              {servicos && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Escolha a transportadora — o valor entra como o seu frete no orçamento:</p>
                  {servicos.length === 0 && (
                    <p className="text-[13px] text-gray-600">Nenhuma transportadora cotou essa caixa. Confira as medidas e o peso.</p>
                  )}
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
                  {estimativa && <p className="text-[11px] text-amber-700">{estimativa}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
