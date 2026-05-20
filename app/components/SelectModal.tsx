// app/components/SelectModal.tsx
// ============================================================================
// Select em MODAL centralizado (substitui o dropdown ancorado). Abre overlay
// fixo cobrindo a tela inteira, card branco no centro com lista scrollável.
// Comportamento idêntico em desktop e mobile — sem problemas de ancoragem,
// flow ou overflow do dropdown anterior.
// ============================================================================

'use client'

import { useEffect, useState } from 'react'

export type Option = { value: string; label: string }

type Props = {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
}

export default function SelectModal({
  options,
  value,
  onChange,
  placeholder,
  label,
}: Props) {
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find((o) => o.value === value)?.label

  // ESC fecha
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Bloqueia scroll do body enquanto o modal está aberto
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(true)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-left flex items-center justify-between gap-2 bg-white focus:outline-none focus:border-[#1D9E75]"
      >
        <span className={selectedLabel ? 'text-gray-800' : 'text-gray-400'}>
          {selectedLabel ?? placeholder}
        </span>
        <span aria-hidden="true" className="text-gray-400 text-xs">
          ▼
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700 text-2xl leading-none"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="overflow-y-auto flex-1 py-2">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`w-full text-left px-5 py-3 text-sm transition-colors ${
                    value === opt.value
                      ? 'bg-[#E1F5EE] text-[#0F6E56] font-medium'
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
