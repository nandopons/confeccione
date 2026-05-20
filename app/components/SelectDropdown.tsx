// app/components/SelectDropdown.tsx
// ============================================================================
// Dropdown custom reutilizável (substitui <select> nativo). Painel abre ABAIXO
// do botão, com lista scrollável (~7 itens visíveis) — nunca fullscreen no
// mobile. Click-fora fecha; teclado: ↑↓ navega, Enter seleciona, Esc fecha.
// ============================================================================

'use client'

import { useEffect, useRef, useState } from 'react'

type Option = { value: string; label: string }

type Props = {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
}

export default function SelectDropdown({
  options,
  value,
  onChange,
  placeholder = 'Selecione...',
  ariaLabel,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [destaque, setDestaque] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const selecionado = options.find((o) => o.value === value)

  useEffect(() => {
    if (!aberto) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aberto])

  function abrir() {
    setDestaque(options.findIndex((o) => o.value === value))
    setAberto(true)
  }

  function escolher(v: string) {
    onChange(v)
    setAberto(false)
  }

  function onKey(e: React.KeyboardEvent) {
    if (!aberto) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault()
        abrir()
      }
      return
    }
    if (e.key === 'Escape') {
      setAberto(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDestaque((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (destaque >= 0) escolher(options[destaque].value)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-label={ariaLabel}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        onKeyDown={onKey}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-left flex items-center justify-between gap-2 bg-white focus:outline-none focus:border-[#1D9E75]"
      >
        <span className={selecionado ? 'text-gray-800' : 'text-gray-400'}>
          {selecionado ? selecionado.label : placeholder}
        </span>
        <span
          aria-hidden="true"
          className={`text-gray-400 text-xs transition-transform ${aberto ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {aberto && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg py-1"
        >
          {options.map((o, i) => {
            const selecionadoItem = o.value === value
            return (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selecionadoItem}
                  onClick={() => escolher(o.value)}
                  onMouseEnter={() => setDestaque(i)}
                  className={`w-full text-left px-3 py-2 text-sm ${
                    selecionadoItem
                      ? 'bg-[#E1F5EE] text-[#0F6E56] font-medium'
                      : i === destaque
                        ? 'bg-gray-50 text-gray-800'
                        : 'text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {o.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
