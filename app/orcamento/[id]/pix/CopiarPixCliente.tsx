'use client'

// app/orcamento/[id]/pix/CopiarPixCliente.tsx
// ============================================================================
// UI da página pública de PIX do orçamento: valor com desconto, QR e o botão
// "Copiar código PIX" (navigator.clipboard com fallback execCommand pra
// webviews antigas). Mobile-first — é onde o copia-e-cola importa.
// ============================================================================

import { useState } from 'react'

/** Espelha DESCONTO_PIX_PERCENTUAL de orcamento-cobranca.ts (módulo server). */
const DESCONTO_PERCENTUAL = 3

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

type Props = {
  numero: string
  clienteNome: string | null
  totalCentavos: number
  copiaCola: string
  qrImagem: string | null
  vencimento: string | null
  invoiceUrl: string | null
}

export default function CopiarPixCliente({
  numero,
  clienteNome,
  totalCentavos,
  copiaCola,
  qrImagem,
  vencimento,
  invoiceUrl,
}: Props) {
  const [copiado, setCopiado] = useState(false)

  const valorPix = Math.round(totalCentavos * (1 - DESCONTO_PERCENTUAL / 100))

  async function copiar() {
    let ok = false
    try {
      await navigator.clipboard.writeText(copiaCola)
      ok = true
    } catch {
      // Fallback pra webviews sem Clipboard API (ex.: navegador embutido)
      try {
        const area = document.createElement('textarea')
        area.value = copiaCola
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        ok = document.execCommand('copy')
        document.body.removeChild(area)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 3000)
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-6 text-center">
        <div className="text-xs tracking-widest font-medium text-gray-900">CONFECCIONE</div>
        <h1 className="text-lg font-semibold text-gray-900 mt-3">
          Pagamento do orçamento {numero}
        </h1>
        {clienteNome ? <p className="text-sm text-gray-500 mt-1">{clienteNome}</p> : null}

        <div className="mt-4">
          <div className="text-3xl font-semibold text-[#1D9E75]">{brl(valorPix)}</div>
          <div className="text-xs text-gray-500 mt-1">
            no PIX ({DESCONTO_PERCENTUAL}% de desconto
            {vencimento ? ` até ${dataBR(vencimento)}` : ''}) · valor original{' '}
            {brl(totalCentavos)}
          </div>
        </div>

        {qrImagem ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${qrImagem}`}
            alt={`QR code PIX do orçamento ${numero}`}
            className="w-48 h-48 mx-auto mt-5 border border-gray-100 rounded-xl"
          />
        ) : null}

        <button
          type="button"
          onClick={copiar}
          className={`w-full mt-5 rounded-xl px-4 py-3.5 text-sm font-medium transition-colors ${
            copiado
              ? 'bg-gray-100 text-[#1D9E75]'
              : 'bg-[#1D9E75] hover:bg-[#188a65] text-white'
          }`}
        >
          {copiado ? 'Código copiado ✓ — cole no app do seu banco' : 'Copiar código PIX'}
        </button>

        <details className="mt-4 text-left">
          <summary className="text-xs text-gray-400 cursor-pointer text-center">
            Ver código copia e cola
          </summary>
          <code className="block mt-2 text-[10px] leading-relaxed text-gray-500 break-all bg-gray-50 border border-gray-100 rounded-xl p-3">
            {copiaCola}
          </code>
        </details>

        {invoiceUrl ? (
          <a
            href={invoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-4 text-xs text-gray-400 underline hover:text-gray-600"
          >
            Ver fatura no Asaas
          </a>
        ) : null}

        <p className="mt-5 text-[10px] text-gray-400">
          Empresa embarcada no Porto Digital. · confeccione.com.br
        </p>
      </div>
    </main>
  )
}
