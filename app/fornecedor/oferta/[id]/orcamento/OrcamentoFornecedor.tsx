'use client'

// Painel do fornecedor pra definir o ORÇAMENTO FINAL do pedido aceito.
// Ele digita o LÍQUIDO que quer receber por unidade de cada produto + frete;
// o sistema mostra ao vivo "você recebe X · cliente paga Y" e, ao enviar,
// o cliente é avisado por e-mail e WhatsApp pra aprovar e pagar.
//
// OS ITENS TAMBÉM SE EDITAM AQUI — 25/09/2026.
//
// Até aqui esta tela só sabia mudar PREÇO. Tirar uma cor, mudar a grade ou
// acrescentar uma peça era na página da oferta, com o próprio botão e o
// próprio aviso ao cliente — e quem já estava no orçamento (a Dom Santo, com o
// 20260900301 da Arabela: "tira uma das quatro cores") não tinha como. O
// caminho era voltar, editar, "Pronto, ajustado" (WhatsApp 1 pra cliente),
// voltar pro orçamento e reenviar (WhatsApp 2).
//
// Agora o mesmo editor da página da oferta (EditorPedidoFornecedor) vive aqui,
// com o preço embaixo de cada item, e o envio é UM: itens como ficaram, cada
// um com o seu preço, frete e prazo — o cliente recebe uma mensagem só, com o
// que mudou e o valor novo. O preço de cada linha é guardado pela `key` da
// linha, não pela posição: tirar a segunda cor não pode mover o preço da
// terceira pra cima.

import { useMemo, useState } from 'react'
import type { FreteMeEscolhido, OrcamentoFornecedorDados } from '@/app/lib/pedido-assistente-oferta'
import CalculadoraFreteME from './CalculadoraFreteME'
import PortfolioUploader from './PortfolioUploader'
import { QuadroLinhaEditavel, VistaLinhaDraft, totalDraft, useEditorLinhas } from '../EditorPedidoFornecedor'

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
  const linhasOriginais = useMemo(() => dados.itens.map((it) => it.linha), [dados.itens])
  const editor = useEditorLinhas(linhasOriginais)

  // Preço por linha, pela `key` da linha (ver LinhaDraft.key). No primeiro
  // render `editor.itens` é a lista original na mesma ordem de `dados.itens`,
  // então o índice ainda alinha — é o único momento em que alinha.
  const [precos, setPrecos] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      editor.itens.map((l, i) => [l.key, paraTexto(dados.itens[i]?.unitLiquidoAtualCentavos ?? dados.itens[i]?.unitLiquidoSugeridoCentavos ?? null)])
    )
  )
  const [frete, setFrete] = useState<string>(paraTexto(dados.freteLiquidoAtualCentavos))
  const [freteMe, setFreteMe] = useState<FreteMeEscolhido | null>(null)
  // PRAZO DE PRODUÇÃO — 12/09/2026.
  // Até aqui o orçamento tinha preço e frete, e a data ficava no acordo verbal:
  // o único prazo do sistema era o DESEJO do cliente (pedidos_assistente.
  // prazo_dias). Orçamento sem prazo não é orçamento, é preço.
  const [prazo, setPrazo] = useState<string>('')
  const [calculadoraAberta, setCalculadoraAberta] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState<{ valorCliente: number; repasse: number; itensAjustados: boolean } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const localDestino = [dados.cidade, dados.uf].filter(Boolean).join('/')
  const precoDe = (key: string) => paraCentavos(precos[key] ?? '')
  const sugestaoDe = (origIdx: number | null) => (origIdx != null ? dados.itens[origIdx]?.unitLiquidoSugeridoCentavos ?? null : null)

  const calc = useMemo(() => {
    let produtos = 0
    let pecas = 0
    let valido = editor.itens.length > 0
    for (const l of editor.itens) {
      const qtd = totalDraft(l)
      const u = paraCentavos(precos[l.key] ?? '')
      if (u <= 0 || qtd <= 0) valido = false
      produtos += qtd * u
      pecas += qtd
    }
    const freteC = paraCentavos(frete || '0')
    const liquido = produtos + freteC
    const cliente = liquido > 0 ? Math.round(liquido / (1 - TAXA)) : 0
    return { produtos, freteC, liquido, cliente, pecas, valido: valido && liquido > 0 }
  }, [editor.itens, precos, frete])

  const itemAberto = editor.editando !== null
  const nAjustes = editor.alteradas + editor.removidas

  async function enviar() {
    if (enviando || !calc.valido || itemAberto) return
    const dias = Number((prazo || '').replace(/\D/g, ''))
    if (!Number.isFinite(dias) || dias < 1 || dias > 180) {
      setErro('Informe em quantos dias você entrega a produção (1 a 180).')
      return
    }
    const linhaAjuste = editor.temMudanca
      ? `\nItens ajustados: ${nAjustes} (o cliente vê o que mudou na mesma mensagem).`
      : ''
    if (
      !window.confirm(
        `Enviar o orçamento ao cliente?\n\nVocê recebe: ${brl(calc.liquido)}\nCliente paga: ${brl(calc.cliente)}\nPrazo de produção: ${dias} dias${linhaAjuste}\n\nEle será avisado por e-mail e WhatsApp na hora.`
      )
    )
      return
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/fornecedor/oferta/${dados.ofertaId}/orcamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Sempre por linhas, mesmo sem edição: o preço vai colado no item, e
          // o servidor não precisa casar índice com uma lista que pode ter
          // mudado de tamanho.
          linhas: editor.itens.map((l) => ({
            lid: l.lid,
            origIdx: l.origIdx,
            modelo: l.modelo.trim() || null,
            cor: l.cor.trim() || null,
            material: l.material.trim() || null,
            total: parseInt(l.total, 10) || null,
            tamanhos: l.tamanhos.filter((t) => t.tamanho.trim()).map((t) => ({ tamanho: t.tamanho.trim().toUpperCase(), qtd: parseInt(t.qtd, 10) || 0 })),
            descricao: l.descricao.trim() || null,
            preco_unit_centavos: precoDe(l.key),
          })),
          freteCentavos: paraCentavos(frete || '0'),
          prazoProducaoDias: dias,
          freteMe,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar.')
      setFeito({ valorCliente: j.valorClienteCentavos, repasse: j.repasseCentavos, itensAjustados: Boolean(j.itensAjustados) })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar.')
    } finally {
      setEnviando(false)
    }
  }

  const inputPreco =
    'block mt-1 w-32 border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 focus:outline-none focus:border-emerald-600'

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
            Ele recebeu por e-mail e WhatsApp{feito.itensAjustados ? ', com os itens ajustados' : ''}. Cliente paga <strong>{brl(feito.valorCliente)}</strong> · você recebe <strong>{brl(feito.repasse)}</strong> após a entrega em conformidade.
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
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-700">Itens do pedido</h2>
              <span className="text-xs text-gray-400">o lápis muda cor, grade ou quantidade; o × tira o item</span>
            </div>

            {editor.itens.map((l, i) => (
              <div
                key={l.key}
                className={'rounded-lg border px-4 py-3 ' + (l.alterada ? 'bg-amber-50/40 border-amber-200' : 'bg-gray-50 border-gray-100')}
              >
                <QuadroLinhaEditavel editor={editor} i={i}>
                  <VistaLinhaDraft l={l} />
                </QuadroLinhaEditavel>
                {editor.editando !== i && (
                  <div className="mt-2 flex items-center gap-3 flex-wrap">
                    <label className="text-xs text-gray-500">
                      Você recebe por unidade (R$)
                      <input
                        value={precos[l.key] ?? ''}
                        onChange={(e) => setPrecos((p) => ({ ...p, [l.key]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={inputPreco}
                      />
                    </label>
                    <div className="text-xs text-gray-500 mt-4">
                      × {totalDraft(l) || '?'} un. = <strong className="text-gray-800">{brl(totalDraft(l) * precoDe(l.key))}</strong>
                      {sugestaoDe(l.origIdx) != null && (
                        <span className="block text-[11px] text-gray-400">sugestão da plataforma: {brl(sugestaoDe(l.origIdx) as number)}/un</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <button
                type="button"
                onClick={editor.adicionar}
                disabled={itemAberto}
                className="rounded-lg border-2 border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-emerald-500 hover:text-emerald-700 disabled:opacity-50"
              >
                + Adicionar produto
              </button>
              {editor.temMudanca && (
                <button type="button" onClick={editor.desfazerTudo} className="text-sm text-gray-500 hover:underline sm:ml-auto">
                  Desfazer ajustes nos itens
                </button>
              )}
            </div>
            {editor.temMudanca && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {nAjustes} {nAjustes === 1 ? 'item ajustado' : 'itens ajustados'} · {calc.pecas} peças no total. Nada foi enviado ainda: o cliente vê os itens como ficaram, junto com o valor, quando você reenviar.
              </p>
            )}

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
                  className={inputPreco}
                />
              </label>
              <label className="text-xs text-gray-500 block mt-3">
                Prazo de produção — em quantos dias você entrega
                <input
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  inputMode="numeric"
                  placeholder="dias"
                  className={inputPreco}
                />
                <span className="block mt-1 text-[11px] text-gray-400">Conta a partir da confirmação do pagamento. Não inclui o transporte.</span>
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
              disabled={enviando || !calc.valido || itemAberto}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl"
            >
              {enviando ? 'Enviando…' : dados.jaDefinido || editor.temMudanca ? 'Atualizar e reenviar ao cliente →' : 'Enviar orçamento ao cliente →'}
            </button>
            {itemAberto ? (
              <p className="text-[11px] text-amber-700 text-center">Salve ou cancele o item aberto antes de enviar.</p>
            ) : (
              <p className="text-[11px] text-gray-400 text-center">O cliente recebe e-mail + WhatsApp na hora com o valor e o link pra pagar.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
