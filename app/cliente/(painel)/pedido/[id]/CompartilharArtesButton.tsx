// app/cliente/(painel)/pedido/[id]/CompartilharArtesButton.tsx
// ============================================================================
// Botão + modal "Compartilhar arquivos". Gera o link público e dispara pro
// WhatsApp do fornecedor. Mostra o link gerado pro cliente copiar também.
// Client Component.
// ============================================================================

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  pedidoId: string
  fornecedorNome: string | null
}

export default function CompartilharArtesButton({ pedidoId, fornecedorNome }: Props) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{
    link: string
    whatsappEnviado: boolean
    arquivosCount: number
  } | null>(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !enviando) setAberto(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [aberto, enviando])

  async function handleConfirmar() {
    setEnviando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/cliente/pedido/${pedidoId}/compartilhar-artes`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(j.erro ?? 'Erro ao compartilhar')
        return
      }
      setResultado({
        link: `${window.location.origin}/artes/${j.link_token}`,
        whatsappEnviado: !!j.whatsapp_enviado,
        arquivosCount: j.arquivos_count ?? 0,
      })
      router.refresh()
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  async function copiar() {
    if (!resultado) return
    try {
      await navigator.clipboard.writeText(resultado.link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // clipboard pode falhar sem https/permissão — link continua visível
    }
  }

  function abrir() {
    setResultado(null)
    setErro(null)
    setCopiado(false)
    setAberto(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="mt-3 ml-0 sm:ml-3 inline-block px-5 py-2.5 rounded-md border border-[#1D9E75] text-[#1D9E75] text-sm font-medium hover:bg-green-50"
      >
        Compartilhar arquivos
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-artes-titulo"
          className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !enviando && setAberto(false)}
          />

          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            {resultado ? (
              <div>
                <div className="text-center mb-4">
                  <div className="text-3xl mb-2">✓</div>
                  <p className="text-gray-900 font-medium">
                    {resultado.arquivosCount}{' '}
                    {resultado.arquivosCount === 1 ? 'arquivo' : 'arquivos'}{' '}
                    compartilhado{resultado.arquivosCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {resultado.whatsappEnviado
                      ? 'Enviamos o link pelo WhatsApp do fornecedor.'
                      : 'Não conseguimos enviar pelo WhatsApp — copie o link e mande você mesmo.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    readOnly
                    value={resultado.link}
                    className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-xs text-gray-700"
                  />
                  <button
                    type="button"
                    onClick={copiar}
                    className="px-3 py-1.5 rounded bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 shrink-0"
                  >
                    {copiado ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAberto(false)}
                    className="px-4 py-2 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2
                  id="modal-artes-titulo"
                  className="text-lg font-semibold text-gray-900 mb-2"
                >
                  Compartilhar seus arquivos?
                </h2>
                <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                  Vamos gerar um link temporário (válido por 7 dias) com os
                  arquivos do seu repositório e enviar pelo WhatsApp{' '}
                  {fornecedorNome ? `de ${fornecedorNome}` : 'do fornecedor'}. O
                  link não expõe seus dados de contato.
                </p>

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
                    className="px-4 py-2 rounded-md bg-[#1D9E75] hover:bg-[#178761] text-white text-sm font-medium disabled:opacity-50"
                  >
                    {enviando ? 'Compartilhando…' : 'Compartilhar'}
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
