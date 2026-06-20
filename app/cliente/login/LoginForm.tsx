// app/cliente/login/LoginForm.tsx
// ============================================================================
// Form de login OTP de 2 etapas (email → código).
// ============================================================================

'use client'

import { useState } from 'react'

type Etapa = 'email' | 'codigo'

export default function LoginForm({ emailPrefill }: { emailPrefill: string }) {
  const [etapa, setEtapa] = useState<Etapa>('email')
  const [email, setEmail] = useState(emailPrefill)
  const [codigo, setCodigo] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [canais, setCanais] = useState<string[]>([])

  async function handleSolicitar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setLoading(true)
    try {
      const r = await fetch('/api/cliente/auth/solicitar-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
      })
      const j = await r.json()
      if (!r.ok) {
        setErro(j.erro ?? 'Erro ao enviar código')
        return
      }
      setCanais(j.canais_enviados ?? [])
      setCodigo('')
      setEtapa('codigo')
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerificar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setLoading(true)
    try {
      const r = await fetch('/api/cliente/auth/verificar-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, codigo }),
      })
      const j = await r.json()
      if (!r.ok) {
        const motivo = j.motivo as string | undefined
        const mensagens: Record<string, string> = {
          codigo_incorreto: 'Código incorreto. Confira o número e tente de novo.',
          codigo_nao_encontrado: 'Código expirado. Solicite um novo.',
          tentativas_excedidas:
            'Muitas tentativas erradas. Sua conta ficou bloqueada por 30 minutos.',
          bloqueado: 'Conta bloqueada. Tente novamente em alguns minutos.',
        }
        setErro(motivo ? (mensagens[motivo] ?? j.erro) : (j.erro ?? 'Erro'))
        return
      }
      // sucesso — redireciona
      window.location.href = '/cliente/painel'
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  function voltarParaEmail() {
    setEtapa('email')
    setCodigo('')
    setErro(null)
  }

  if (etapa === 'codigo') {
    const canalTxt =
      canais.length === 2
        ? 'no e-mail e no WhatsApp'
        : canais.includes('whatsapp')
          ? 'no WhatsApp'
          : canais.includes('email')
            ? 'no e-mail'
            : 'no e-mail'
    return (
      <form onSubmit={handleVerificar} className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-gray-700">
            Enviamos um código de 6 dígitos pra <strong>{email}</strong>{' '}
            {canalTxt}.
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Confira sua caixa de entrada (e a pasta de spam, por garantia).
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            Código
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={codigo}
            onChange={(e) =>
              setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="000000"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-center text-xl tracking-[0.5em] font-mono text-gray-900 placeholder:text-gray-400 placeholder:font-normal"
          />
        </label>

        {erro && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || codigo.length !== 6}
          className="w-full py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761] disabled:opacity-50"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>

        <button
          type="button"
          onClick={voltarParaEmail}
          className="text-sm text-gray-600 underline self-center"
        >
          Reenviar código ou usar outro e-mail
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSolicitar} className="flex flex-col gap-4">
      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">
          E-mail
        </span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder:text-gray-400 placeholder:font-normal"
        />
        <p className="text-xs text-gray-600 mt-1">
          Use o mesmo e-mail que você usou pra fazer o pedido.
        </p>
      </label>

      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !email}
        className="w-full py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761] disabled:opacity-50"
      >
        {loading ? 'Enviando…' : 'Receber código'}
      </button>
    </form>
  )
}
