'use client'

// app/admin/(painel)/orcamentos/OrcamentosAdmin.tsx
// ============================================================================
// Form do gerador de orçamentos avulsos.
//
// Fluxo: preenche itens dinâmicos → "Gerar orçamento" → POST
// /api/admin/orcamentos → sucesso mostra o número gerado + botão de download
// do PDF (BaixarOrcamentoPDF via next/dynamic ssr:false — @react-pdf/renderer
// não roda no server).
//
// Dinheiro: inputs em R$ (texto pt-BR), convertidos pra CENTAVOS antes do
// POST — o server recalcula subtotal/total e é a fonte da verdade.
// ============================================================================

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import type { OrcamentoPDFDados } from '@/app/components/pdf/OrcamentoPDF'

const BaixarPDF = dynamic(() => import('./BaixarOrcamentoPDF'), {
  ssr: false,
  loading: () => (
    <span className="inline-flex items-center bg-gray-100 text-gray-400 text-sm rounded-xl px-4 py-2.5">
      Preparando PDF…
    </span>
  ),
})

type TipoItem = 'produto' | 'servico'

type LinhaItem = {
  tipo: TipoItem
  descricao: string
  quantidade: string // input cru
  valorUnitario: string // input cru em R$ (pt-BR)
}

const LINHA_VAZIA: LinhaItem = { tipo: 'produto', descricao: '', quantidade: '1', valorUnitario: '' }

/** "1.234,56" | "1234,56" | "1234.56" → centavos (int) ou null se inválido. */
function paraCentavos(cru: string): number | null {
  const limpo = cru.trim().replace(/R\$\s?/, '')
  if (!limpo) return null
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo
  const valor = Number(normalizado)
  if (!Number.isFinite(valor) || valor < 0) return null
  return Math.round(valor * 100)
}

function paraQuantidade(cru: string): number | null {
  const valor = Number(cru.replace(',', '.'))
  if (!Number.isFinite(valor) || valor <= 0) return null
  return valor
}

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Data local (America/Recife na prática) em YYYY-MM-DD, sem sustos de UTC. */
function hojeISO(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

const inputCls =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75] bg-white'
const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

export default function OrcamentosAdmin() {
  const [clienteNome, setClienteNome] = useState('')
  const [clienteDocumento, setClienteDocumento] = useState('')
  const [dataOrcamento, setDataOrcamento] = useState(hojeISO())
  const [validade, setValidade] = useState('')
  const [itens, setItens] = useState<LinhaItem[]>([{ ...LINHA_VAZIA }])
  const [frete, setFrete] = useState('')
  const [observacoes, setObservacoes] = useState('')
  const [gerarCobranca, setGerarCobranca] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [cobrancaAviso, setCobrancaAviso] = useState<string | null>(null)
  const [gerado, setGerado] = useState<OrcamentoPDFDados | null>(null)

  function atualizarItem(indice: number, mudanca: Partial<LinhaItem>) {
    setItens((atual) => atual.map((linha, i) => (i === indice ? { ...linha, ...mudanca } : linha)))
  }

  function adicionarItem() {
    setItens((atual) => [...atual, { ...LINHA_VAZIA }])
  }

  function removerItem(indice: number) {
    setItens((atual) => (atual.length > 1 ? atual.filter((_, i) => i !== indice) : atual))
  }

  const calculo = useMemo(() => {
    const linhas = itens.map((linha) => {
      const quantidade = paraQuantidade(linha.quantidade)
      const unitario = paraCentavos(linha.valorUnitario)
      const subtotal =
        quantidade !== null && unitario !== null ? Math.round(quantidade * unitario) : null
      return { quantidade, unitario, subtotal }
    })
    const subtotal = linhas.reduce((soma, l) => soma + (l.subtotal ?? 0), 0)
    const freteCentavos = paraCentavos(frete) ?? 0
    return { linhas, subtotal, freteCentavos, total: subtotal + freteCentavos }
  }, [itens, frete])

  async function gerar() {
    setErro(null)

    const itensCorpo = []
    for (let i = 0; i < itens.length; i++) {
      const linha = itens[i]
      const quantidade = paraQuantidade(linha.quantidade)
      const unitario = paraCentavos(linha.valorUnitario)
      if (!linha.descricao.trim()) {
        setErro(`Item ${i + 1}: preencha a descrição.`)
        return
      }
      if (quantidade === null) {
        setErro(`Item ${i + 1}: quantidade inválida.`)
        return
      }
      if (unitario === null) {
        setErro(`Item ${i + 1}: valor unitário inválido.`)
        return
      }
      itensCorpo.push({
        tipo: linha.tipo,
        descricao: linha.descricao.trim(),
        quantidade,
        valor_unitario_centavos: unitario,
      })
    }

    if (gerarCobranca) {
      const doc = clienteDocumento.replace(/\D/g, '')
      if (!clienteNome.trim()) {
        setErro('Pra gerar a cobrança, informe o nome do cliente.')
        return
      }
      if (doc.length !== 11 && doc.length !== 14) {
        setErro('Pra gerar a cobrança, informe CPF (11 dígitos) ou CNPJ (14).')
        return
      }
    }

    setEnviando(true)
    try {
      const resposta = await fetch('/api/admin/orcamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nome: clienteNome.trim() || undefined,
          cliente_documento: clienteDocumento.trim() || undefined,
          itens: itensCorpo,
          frete_centavos: paraCentavos(frete) ?? 0,
          observacoes: observacoes.trim() || undefined,
          data_orcamento: dataOrcamento || undefined,
          validade: validade || undefined,
          gerar_cobranca: gerarCobranca,
        }),
      })
      const corpo = await resposta.json().catch(() => null)
      if (!resposta.ok || !corpo?.orcamento) {
        setErro(corpo?.erro ?? `Erro ao gerar orçamento (HTTP ${resposta.status}).`)
        return
      }
      setCobrancaAviso(typeof corpo.cobranca_erro === 'string' ? corpo.cobranca_erro : null)
      setGerado(corpo.orcamento as OrcamentoPDFDados)
    } catch {
      setErro('Falha de rede ao gerar o orçamento. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  function novoOrcamento() {
    setGerado(null)
    setErro(null)
    setCobrancaAviso(null)
    setGerarCobranca(true)
    setClienteNome('')
    setClienteDocumento('')
    setDataOrcamento(hojeISO())
    setValidade('')
    setItens([{ ...LINHA_VAZIA }])
    setFrete('')
    setObservacoes('')
  }

  // ---- tela de sucesso ----------------------------------------------------
  if (gerado) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
        <div className="text-sm text-gray-500">Orçamento gerado</div>
        <div className="text-2xl font-semibold text-gray-900 mt-1">{gerado.numero}</div>
        <div className="text-sm text-gray-500 mt-1">
          Total <strong className="text-gray-800">{brl(gerado.total_centavos)}</strong>
          {gerado.cliente_nome ? <> · {gerado.cliente_nome}</> : null}
        </div>
        {cobrancaAviso ? (
          <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {cobrancaAviso}
          </div>
        ) : null}
        {gerado.asaas_invoice_url ? (
          <div className="mt-2 text-xs text-gray-500">
            Cobrança criada no Asaas —{' '}
            <a
              href={gerado.asaas_invoice_url}
              target="_blank"
              rel="noreferrer"
              className="text-[#1D9E75] underline"
            >
              link de pagamento
            </a>
          </div>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-3">
          <BaixarPDF orcamento={gerado} />
          <button
            type="button"
            onClick={novoOrcamento}
            className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl px-4 py-2.5 transition-colors"
          >
            Novo orçamento
          </button>
        </div>
      </div>
    )
  }

  // ---- form ---------------------------------------------------------------
  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900">Orçamentos</h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Gere um orçamento avulso em PDF com a identidade da Confeccione.
      </p>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
        {/* Cliente */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Cliente (opcional)</label>
            <input
              value={clienteNome}
              onChange={(e) => setClienteNome(e.target.value)}
              placeholder="Nome ou razão social"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>CPF / CNPJ (opcional)</label>
            <input
              value={clienteDocumento}
              onChange={(e) => setClienteDocumento(e.target.value)}
              placeholder="Documento"
              className={inputCls}
            />
          </div>
        </div>

        {/* Datas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Data do orçamento</label>
            <input
              type="date"
              value={dataOrcamento}
              onChange={(e) => setDataOrcamento(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Validade (opcional)</label>
            <input
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Itens */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">Itens</span>
            <button
              type="button"
              onClick={adicionarItem}
              className="text-xs font-medium text-[#1D9E75] hover:text-[#188a65]"
            >
              + Adicionar item
            </button>
          </div>

          <div className="space-y-3">
            {itens.map((linha, i) => {
              const subtotal = calculo.linhas[i]?.subtotal
              return (
                <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50/50">
                  <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
                    <div className="col-span-2 sm:col-span-3">
                      <label className={labelCls}>Tipo</label>
                      <select
                        value={linha.tipo}
                        onChange={(e) => atualizarItem(i, { tipo: e.target.value as TipoItem })}
                        className={inputCls}
                      >
                        <option value="produto">Produto</option>
                        <option value="servico">Serviço</option>
                      </select>
                    </div>
                    <div className="col-span-2 sm:col-span-9">
                      <label className={labelCls}>Descrição</label>
                      <input
                        value={linha.descricao}
                        onChange={(e) => atualizarItem(i, { descricao: e.target.value })}
                        placeholder="Ex.: Camiseta algodão 30.1 com estampa frente"
                        className={inputCls}
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-3">
                      <label className={labelCls}>Qtd</label>
                      <input
                        value={linha.quantidade}
                        onChange={(e) => atualizarItem(i, { quantidade: e.target.value })}
                        inputMode="decimal"
                        placeholder="1"
                        className={inputCls}
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-4">
                      <label className={labelCls}>Valor unit. (R$)</label>
                      <input
                        value={linha.valorUnitario}
                        onChange={(e) => atualizarItem(i, { valorUnitario: e.target.value })}
                        inputMode="decimal"
                        placeholder="0,00"
                        className={inputCls}
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-5 flex items-end justify-between gap-2">
                      <div className="text-sm text-gray-700 py-2.5">
                        Subtotal:{' '}
                        <strong>{subtotal !== null && subtotal !== undefined ? brl(subtotal) : '—'}</strong>
                      </div>
                      {itens.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removerItem(i)}
                          className="text-xs text-red-400 hover:text-red-600 py-2.5"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Frete + Observações */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Frete (R$)</label>
            <input
              value={frete}
              onChange={(e) => setFrete(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Observações (opcional)</label>
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
            placeholder="Condições de pagamento, prazo de produção, etc."
            className={inputCls}
          />
        </div>

        {/* Cobrança Asaas */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={gerarCobranca}
            onChange={(e) => setGerarCobranca(e.target.checked)}
            className="mt-0.5 accent-[#1D9E75]"
          />
          <span className="text-sm text-gray-700">
            Gerar cobrança no Asaas (QR PIX no PDF + link PIX/cartão)
            <span className="block text-xs text-gray-400">
              Exige nome e CPF/CNPJ do cliente. Pagamento até o vencimento tem 3% de desconto.
            </span>
          </span>
        </label>

        {/* Totais + ação */}
        <div className="border-t border-gray-100 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-sm text-gray-600">
            Subtotal <strong className="text-gray-800">{brl(calculo.subtotal)}</strong>
            {' · '}Frete <strong className="text-gray-800">{brl(calculo.freteCentavos)}</strong>
            {' · '}Total{' '}
            <strong className="text-[#1D9E75] text-base">{brl(calculo.total)}</strong>
          </div>
          <button
            type="button"
            onClick={gerar}
            disabled={enviando}
            className="bg-[#1D9E75] hover:bg-[#188a65] disabled:opacity-50 text-white text-sm font-medium rounded-xl px-5 py-2.5 transition-colors"
          >
            {enviando ? 'Gerando…' : 'Gerar orçamento'}
          </button>
        </div>

        {erro && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {erro}
          </div>
        )}
      </div>
    </div>
  )
}
