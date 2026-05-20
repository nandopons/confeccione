// app/cliente/(painel)/LogoutButton.tsx
'use client'

import { useState } from 'react'

export default function LogoutButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      await fetch('/api/cliente/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      // ignora — vai redirecionar de qualquer jeito
    }
    window.location.href = '/cliente/login'
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="text-sm text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
    >
      {loading ? 'Saindo…' : 'Sair'}
    </button>
  )
}
