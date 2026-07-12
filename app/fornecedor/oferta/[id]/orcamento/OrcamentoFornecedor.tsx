'use client'

// Painel do fornecedor pra definir o ORÇAMENTO FINAL do pedido aceito.
// Ele digita o LÍQUIDO que quer receber por unidade de cada produto + frete;
// o sistema mostra ao vivo "você recebe X · cliente paga Y" e, ao enviar,
// o cliente é avisado por e-mail e WhatsApp pra aprovar e pagar.

import { useMemo, useState } from 'react'
import type { FreteMeEscolhido, OrcamentoFornecedorDados } from '@/app/lib/pedido-assistente-oferta'
import CalculadoraFreteME from './CalculadoraFreteME'
import PortfolioUploader from './PortfolioUploader'

const TAXA = 0.03

function brl(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function paraCentavos(s: string): number {
  const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
function paraTexto(c: number | null): string {
  return c != null && c > 0 ? (c / 100).toFixed(2).replace('.', ',') : ''
}
function dataBR(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function OrcamentoFornecedor({ dados }: { dados: OrcamentoFornecedorDados }) {
  const [unit, setUnit] = useState<string[]>(
    dados.itens.map((it) => paraTexto(it.unitLiquidoAtualCentavos ?? it.unitLiquidoSugeridoCentavos))
  )
  const [frete, setFrete] = useState<string>(paraTexto(dados.freteLiquidoAtualCentavos))
  const [freteMe, setFreteMe] = useState<FreteMeEscolhido | null>(null)
  const [calculadoraAberta, setCalculadoraAberta] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState<{ valorCliente: number; repasse: number } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const localDestino = [dados.cidade, dados.uf].filter(Boolean).join('/')

  const calc = useMemo(() => {
    let produtos = 0
    let valido = dados.itens.length > 0
    dados.itens.forEach((it, i) => {
      const u = paraCentavos(unit[i] ?? '')
      if (u <= 0) valido = false
      produtos += it.qtd * u
    })
    const freteC = paraCentavos(frete || '0')
    const liquido = produtos + freteC
    const cliente = liquido > 0 ? Math.round(liquido / (1 - TAXA)) : 0
    return { produtos, freteC, liquido, cliente, valido: valido && liquido > 0 }
  }, [unit, frete, dados.itens])

  async function enviar() {
    if (enviando || !calc.valido) return
    if (!window.confirm(`Enviar o orçamento ao cliente?\n\nVocê recebe: ${brl(calc.liquido)}\nCliente paga: ${brl(calc.cliente)}\n\nEle será avisado por e-mail e WhatsApp na hora.`)) return
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/fornecedor/oferta/${dados.ofertaId}/orcamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitCentavos: dados.itens.map((_, i) => paraCentavos(unit[i] ?? '')),
          freteCentavos: paraCentavos(frete || '0'),
          freteMe,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar.')
      setFeito({ valorCliente: j.valorClienteCentavos, repasse: j.repasseCentavos })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Confeccione · orçamento do pedido</div>
        <h1 className="text-xl font-bold text-gray-900 mt-1">Defina o orçamento final</h1>
        <p className="text-sm text-gray-500 mt-1">
          Informe quanto <strong>você quer receber</strong> por unidade de cada produto e o frete. A taxa da plataforma já entra na conta — o cliente{dados.clienteNome ? ` (${dados.clienteNome.split(' ')[0]})` : ''} recebe o valor final por e-mail e WhatsApp pra aprovar e pagar.
        </p>
        {dados.prazoDias ? (
          <p className="text-xs text-[#0F6E56] font-medium mt-2">⏱️ Prazo de produção combinado: {dados.prazoDias} dias (a partir do pagamento).</p>
        ) : null}
        {(dados.cep || localDestino) && (
          <p className="text-xs text-gray-600 font-medium mt-2">📍 Destino do frete: {[localDestino, dados.bairro, dados.cep ? `CEP ${dados.cep}` : ''].filter(Boolean).join(' — ')}</p>
        )}
      </div>

      {dados.pago ? (
        <div className="px-6 py-8 text-center">
          <p className="text-emerald-700 font-semibold">✅ Este pedido já foi pago.</p>
          <p className="text-sm text-gray-500 mt-1">O orçamento não pode mais ser alterado — pode iniciar a produção.</p>
        </div>
      ) : feito ? (
        <div className="px-6 py-8 text-center">
          <p className="text-emerald-700 text-lg font-semibold">✓ Orçamento enviado ao cliente!</p>
          <p className="text-sm text-gray-600 mt-2">
            Ele recebeu por e-mail e WhatsApp. Cliente paga <strong>{brl(feito.valorCliente)}</strong> · você recebe <strong>{brl(feito.repasse)}</strong> após a entrega em conformidade.
          </p>
          <p className="text-xs text-gray-400 mt-3">Precisa ajustar? É só voltar nesta página enquanto o pedido não for pago.</p>
        </div>
      ) : (
        <>
          {dados.jaDefinido && (
            <div className="mx-6 mt-4 text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
              Você já enviou um orçamento{dados.definidoEm ? ` em ${dataBR(dados.definidoEm)}` : ''}. Ajustar e reenviar atualiza o valor pro cliente (enquanto ele não pagar).
            </div>
          )}

          <div className="px-6 py-5 space-y-4">
            {dados.itens.map((it, i) => (
              <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
                <p className="font-medium text-gray-900 capitalize">{it.label}</p>
                <div className="mt-2 flex items-center gap-3 flex-wrap">
                  <label className="text-xs text-gray-500">
                    Você recebe por unidade (R$)
                    <input
                      value={unit[i] ?? ''}
                      onChange={(e) => setUnit((u) => u.map((v, k) => (k === i ? e.target.value : v)))}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="block mt-1 w-32 border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 focus:outline-none focus:border-emerald-600"
                    />
                  </label>
                  <div className="text-xs text-gray-500 mt-4">
                    × {it.qtd} un. = <strong className="text-gray-800">{brl(it.qtd * paraCentavos(unit[i] ?? ''))}</strong>
                    {it.unitLiquidoSugeridoCentavos != null && (
                      <span className="block text-[11px] text-gray-400">sugestão da plataforma: {brl(it.unitLiquidoSugeridoCentavos)}/un</span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
              {(dados.cep || localDestino) && (
                <p className="text-[11px] text-gray-600 font-medium mb-2">📍 Destino do frete: {[localDestino, dados.bairro, dados.cep ? `CEP ${dados.cep}` : ''].filter(Boolean).join(' — ')}</p>
              )}
              <label className="text-xs text-gray-500">
                Frete — quanto você quer receber pelo envio (R$)
                <input
                  value={frete}
                  onChange={(e) => { setFrete(e.target.value); setFreteMe(null) }}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="block mt-1 w-32 border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 focus:outline-none focus:border-emerald-600"
                />
              </label>
              <button
                type="button"
                onClick={() => setCalculadoraAberta(true)}
                className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0F6E56] border border-[#1D9E75]/40 rounded-lg px-3 py-1.5 hover:bg-[#E1F5EE]"
              >
                📦 Calcular com Melhor Envio
              </button>
              {freteMe ? (
                <p className="text-[11px] text-emerald-700 mt-1.5">
                  ✓ {freteMe.transportadora} · {freteMe.servico} — até {freteMe.prazoDias} dias úteis. A etiqueta vai custar isso na sua conta Melhor Envio.
                </p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1">Deixe 0,00 se o frete já está embutido nos produtos.</p>
              )}
            </div>

            <PortfolioUploader ofertaId={dados.ofertaId} inicial={dados.portfolio} />

            <CalculadoraFreteME
              ofertaId={dados.ofertaId}
              seguroCentavos={calc.produtos}
              aberto={calculadoraAberta}
              onFechar={() => setCalculadoraAberta(false)}
              onEscolher={(f) => { setFreteMe(f); setFrete(paraTexto(f.precoCentavos)) }}
            />

            <div className="rounded-xl border-2 border-emerald-600/30 bg-emerald-50/50 px-4 py-3.5">
              <div className="flex justify-between text-sm text-gray-700"><span>Você recebe (produtos + frete)</span><strong>{brl(calc.liquido)}</strong></div>
              <div className="flex justify-between text-sm text-gray-700 mt-1"><span>Cliente paga (taxa da plataforma inclusa)</span><strong className="text-emerald-700">{brl(calc.cliente)}</strong></div>
              <p className="text-[11px] text-gray-400 mt-2">Pagamento garantido pela Confeccione — liberado após a entrega em conformidade.</p>
            </div>

            {erro && <p className="text-sm text-red-600">{erro}</p>}

            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || !calc.valido}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl"
            >
              {enviando ? 'Enviando…' : dados.jaDefinido ? 'Atualizar e reenviar ao cliente →' : 'Enviar orçamento ao cliente →'}
            </button>
            <p className="text-[11px] text-gray-400 text-center">O cliente recebe e-mail + WhatsApp na hora com o valor e o link pra pagar.</p>
          </div>
        </>
      )}
    </div>
  )
}
