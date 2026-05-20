// app/cliente/(painel)/pedido/[id]/SolicitarOutroFornecedorButton.tsx
// ============================================================================
// Botão + modal "Pedir outro fornecedor". Client Component.
//
// Props:
//   pedidoId       — UUID do pedido atual
//   trocasRealizadas — quantas vezes o cliente já trocou neste pedido
//   limiteTrocas     — total permitido pelo plano (Free = 2)
//   podeTrocar       — se false, mostra mensagem de limite atingido
// ============================================================================

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  pedidoId: string
  trocasRealizadas: number
  limiteTrocas: number
  podeTrocar: boolean
}

export default function SolicitarOutroFornecedorButton({
  pedidoId,
  trocasRealizadas,
  limiteTrocas,
  podeTrocar,
}: Props) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)

  // ESC fecha
  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aberto])

  async function handleConfirmar() {
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch(
        `/api/cliente/pedido/${pedidoId}/solicitar-outro`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo: motivo.trim() || undefined }),
        },
      )
      const j = await r.json()
      if (!r.ok) {
        setErro(j.erro ?? 'Erro ao processar')
        return
      }
      setSucesso(true)
      setTimeout(() => {
        setAberto(false)
        router.refresh()
      }, 600)
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  // Mensagem de limite — quando já estourou as trocas
  if (!podeTrocar) {
    return (
      <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-600">
        Trocas usadas: <strong>{trocasRealizadas} de {limiteTrocas}</strong> no
        plano atual.
      </div>
    )
  }

  return (
    <>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            setMotivo('')
            setErro(null)
            setSucesso(false)
            setAberto(true)
          }}
          className="text-sm text-orange-700 hover:text-orange-900 underline"
        >
          Pedir outro fornecedor
        </button>
      </div>

      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-trocar-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !enviando && setAberto(false)}
          />

          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            {sucesso ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-2">✓</div>
                <p className="text-gray-900 font-medium">
                  Buscando outro fornecedor pra você
                </p>
              </div>
            ) : (
              <>
                <h2
                  id="modal-trocar-titulo"
                  className="text-lg font-semibold text-gray-900 mb-2"
                >
                  Quer trocar de fornecedor?
                </h2>
                <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                  Vamos buscar outro fornecedor compatível com seu pedido. O
                  fornecedor atual deixa de receber atualizações deste pedido.{' '}
                  Trocas restantes neste pedido:{' '}
                  <strong>
                    {limiteTrocas - trocasRealizadas} de {limiteTrocas}
                  </strong>{' '}
                  (plano atual).
                </p>

                <label className="block mb-4">
                  <span className="text-sm font-medium text-gray-700 block mb-1">
                    Motivo (opcional)
                  </span>
                  <textarea
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
                    maxLength={500}
                    rows={3}
                    placeholder="Ajuda a gente a melhorar..."
                    disabled={enviando}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none disabled:opacity-50 placeholder:text-gray-400 placeholder:font-normal"
                  />
                  <div className="text-xs text-gray-400 text-right mt-1">
                    {motivo.length}/500
                  </div>
                </label>

                {erro && (
                  <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {erro}
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setAberto(false)}
                    disabled={enviando}
                    className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmar}
                    disabled={enviando}
                    className="px-4 py-2 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {enviando ? 'Trocando…' : 'Confirmar troca'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
