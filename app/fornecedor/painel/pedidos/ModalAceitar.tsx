// app/fornecedor/painel/pedidos/ModalAceitar.tsx
'use client'

// ============================================================================
// Modal de confirmação antes de aceitar uma oferta.
// Reforça as implicações de aceitar (consume cota, libera contato direto).
// ============================================================================

import { useEffect } from 'react'

type Props = {
  tipo: string
  quantidade: number | null
  estado: string
  enviando: boolean
  onConfirmar: () => void
  onCancelar: () => void
}

export default function ModalAceitar({
  tipo,
  quantidade,
  estado,
  enviando,
  onConfirmar,
  onCancelar,
}: Props) {
  // Fecha com ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !enviando) onCancelar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enviando, onCancelar])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4"
      onClick={() => {
        if (!enviando) onCancelar()
      }}
    >
      <div
        className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-5">
          <div className="text-3xl mb-2">🤝</div>
          <h2 className="text-gray-900 text-lg font-medium mb-1">
            Aceitar este pedido?
          </h2>
          <p className="text-gray-600 text-sm">
            {tipo}
            {quantidade ? ` · ${quantidade} peças` : ''} · {estado}
          </p>
        </div>

        <ul className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 space-y-2 mb-5">
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 mt-0.5">✓</span>
            <span>Você verá o WhatsApp e e-mail do cliente para contato direto</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-500 mt-0.5">✓</span>
            <span>O cliente receberá seus dados também e pode te chamar</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-500 mt-0.5">!</span>
            <span>Ao aceitar, 1 pedido é descontado da sua cota mensal.</span>
          </li>
        </ul>

        <div className="flex gap-2">
          <button
            onClick={onCancelar}
            disabled={enviando}
            className="flex-1 px-4 py-3 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={enviando}
            className="flex-1 bg-emerald-500 text-white px-4 py-3 rounded-xl font-medium text-sm hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {enviando ? 'Aceitando...' : 'Sim, aceitar'}
          </button>
        </div>
      </div>
    </div>
  )
}
