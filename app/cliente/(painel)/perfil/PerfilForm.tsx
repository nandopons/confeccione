// app/cliente/(painel)/perfil/PerfilForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PerfilForm({
  email,
  nomeInicial,
  whatsappInicial,
}: {
  email: string
  nomeInicial: string
  whatsappInicial: string
}) {
  const router = useRouter()
  const [nome, setNome] = useState(nomeInicial)
  const [whatsapp, setWhatsapp] = useState(formatarMascaraBR(whatsappInicial))
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{
    tipo: 'sucesso' | 'erro'
    texto: string
  } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true)
    setMsg(null)
    try {
      const r = await fetch('/api/cliente/perfil', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          whatsapp: whatsapp.replace(/\D/g, ''),
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: j.erro ?? 'Erro ao salvar' })
        return
      }
      setMsg({ tipo: 'sucesso', texto: 'Perfil salvo!' })
      // refresh server component (layout vai re-renderizar saudação)
      router.refresh()
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão. Tente novamente.' })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">
          E-mail
        </span>
        <input
          type="email"
          value={email}
          readOnly
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-600"
        />
        <p className="text-xs text-gray-500 mt-1">
          O e-mail identifica sua conta e não pode ser alterado.
        </p>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">
          Nome
        </span>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={100}
          placeholder="Seu nome (opcional)"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">
          WhatsApp
        </span>
        <input
          type="tel"
          inputMode="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(formatarMascaraBR(e.target.value))}
          maxLength={16}
          placeholder="(11) 99999-9999"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">
          DDD + número. Se preenchido, o código de login também será enviado aqui.
        </p>
      </label>

      {msg && (
        <div
          className={`rounded-md p-3 text-sm ${
            msg.tipo === 'sucesso'
              ? 'border border-green-200 bg-green-50 text-green-800'
              : 'border border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {msg.texto}
        </div>
      )}

      <button
        type="submit"
        disabled={salvando}
        className="w-full py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761] disabled:opacity-50"
      >
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  )
}

function formatarMascaraBR(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
