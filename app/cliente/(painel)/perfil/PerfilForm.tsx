// app/cliente/(painel)/perfil/PerfilForm.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Modo = 'leitura' | 'edicao'

export default function PerfilForm({
  email,
  nomeInicial,
  whatsappInicial,
  cepInicial = '',
  numeroInicial = '',
  complementoInicial = '',
  logradouroInicial = '',
  bairroInicial = '',
  cidadeInicial = '',
  ufInicial = '',
  completar = false,
}: {
  email: string
  nomeInicial: string
  whatsappInicial: string
  cepInicial?: string
  numeroInicial?: string
  complementoInicial?: string
  logradouroInicial?: string
  bairroInicial?: string
  cidadeInicial?: string
  ufInicial?: string
  completar?: boolean
}) {
  const router = useRouter()
  const [nome, setNome] = useState(nomeInicial)
  const [whatsapp, setWhatsapp] = useState(formatarMascaraBR(whatsappInicial))
  const [cep, setCep] = useState(formatarCep(cepInicial))
  const [numero, setNumero] = useState(numeroInicial)
  const [complemento, setComplemento] = useState(complementoInicial)
  const [logradouro, setLogradouro] = useState(logradouroInicial)
  const [bairro, setBairro] = useState(bairroInicial)
  const [cidade, setCidade] = useState(cidadeInicial)
  const [uf, setUf] = useState(ufInicial)
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{
    tipo: 'sucesso' | 'erro'
    texto: string
  } | null>(null)
  // Onboarding (completar) entra direto em edição; fora dele, começa em leitura.
  const [modo, setModo] = useState<Modo>(completar ? 'edicao' : 'leitura')

  // Auto-lookup de CEP no blur: ViaCEP → fallback BrasilAPI. Nunca lança.
  async function buscarCep() {
    const digitos = cep.replace(/\D/g, '')
    if (digitos.length !== 8) return
    setBuscandoCep(true)
    try {
      const via = await buscarViaCep(digitos)
      const dados = via ?? (await buscarBrasilApi(digitos))
      if (dados) {
        if (dados.logradouro) setLogradouro(dados.logradouro)
        if (dados.bairro) setBairro(dados.bairro)
        if (dados.cidade) setCidade(dados.cidade)
        if (dados.uf) setUf(dados.uf)
      }
    } catch {
      // silencioso — preenchimento de CEP é best-effort
    } finally {
      setBuscandoCep(false)
    }
  }

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
          cep: cep.replace(/\D/g, ''),
          numero: numero.trim(),
          complemento: complemento.trim(),
          logradouro: logradouro.trim(),
          bairro: bairro.trim(),
          cidade: cidade.trim(),
          uf: uf.trim(),
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setMsg({ tipo: 'erro', texto: j.erro ?? 'Erro ao salvar' })
        return
      }
      // No modo "completar", manda pro painel assim que salvar.
      if (completar) {
        router.push('/cliente/painel')
        router.refresh()
        return
      }
      setMsg({ tipo: 'sucesso', texto: 'Perfil salvo!' })
      // Volta pra leitura mostrando os valores salvos (estão no state).
      setModo('leitura')
      // refresh server component (layout vai re-renderizar saudação)
      router.refresh()
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão. Tente novamente.' })
    } finally {
      setSalvando(false)
    }
  }

  function cancelarEdicao() {
    // Descarta mudanças não salvas e volta pra leitura.
    setNome(nomeInicial)
    setWhatsapp(formatarMascaraBR(whatsappInicial))
    setCep(formatarCep(cepInicial))
    setNumero(numeroInicial)
    setComplemento(complementoInicial)
    setLogradouro(logradouroInicial)
    setBairro(bairroInicial)
    setCidade(cidadeInicial)
    setUf(ufInicial)
    setMsg(null)
    setModo('leitura')
  }

  const enderecoLinha = montarEnderecoLinha(logradouro, bairro, cidade, uf)

  // ===================== MODO LEITURA =====================
  if (modo === 'leitura') {
    return (
      <div className="flex flex-col gap-4">
        <CampoLeitura rotulo="E-mail" valor={email} />
        <CampoLeitura rotulo="Nome" valor={nome} />
        <CampoLeitura rotulo="WhatsApp" valor={whatsapp} />
        <CampoLeitura rotulo="CEP" valor={cep} />
        <CampoLeitura rotulo="Número" valor={numero} />
        <CampoLeitura rotulo="Complemento" valor={complemento} />
        <CampoLeitura rotulo="Endereço" valor={enderecoLinha} />

        {msg && msg.tipo === 'sucesso' && (
          <div className="rounded-md p-3 text-sm border border-green-200 bg-green-50 text-green-800">
            {msg.texto}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setMsg(null)
            setModo('edicao')
          }}
          className="self-start px-4 py-2 rounded-md border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Editar
        </button>
      </div>
    )
  }

  // ===================== MODO EDIÇÃO =====================
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
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-700"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder:text-gray-600 placeholder:font-normal"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">
          WhatsApp{completar ? ' *' : ''}
        </span>
        <input
          type="tel"
          inputMode="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(formatarMascaraBR(e.target.value))}
          maxLength={16}
          placeholder="(11) 99999-9999"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder:text-gray-600 placeholder:font-normal"
        />
        <p className="text-xs text-gray-500 mt-1">
          DDD + número. Se preenchido, o código de login também será enviado aqui.
        </p>
      </label>

      {/* ===================== ENDEREÇO ===================== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block sm:col-span-1">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            CEP
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={cep}
            onChange={(e) => setCep(formatarCep(e.target.value))}
            onBlur={buscarCep}
            maxLength={9}
            placeholder="00000-000"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder:text-gray-600 placeholder:font-normal"
          />
          <p className="text-xs text-gray-500 mt-1">
            {buscandoCep ? 'Buscando endereço…' : 'Preenchemos o resto pra você.'}
          </p>
        </label>

        <label className="block sm:col-span-1">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            Número
          </span>
          <input
            type="text"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            maxLength={120}
            placeholder="123"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder:text-gray-600 placeholder:font-normal"
          />
        </label>

        <label className="block sm:col-span-1">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            Complemento
          </span>
          <input
            type="text"
            value={complemento}
            onChange={(e) => setComplemento(e.target.value)}
            maxLength={120}
            placeholder="Apto, bloco… (opcional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder:text-gray-600 placeholder:font-normal"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700 block mb-1">
          Logradouro
        </span>
        <input
          type="text"
          value={logradouro}
          onChange={(e) => setLogradouro(e.target.value)}
          maxLength={120}
          placeholder="Rua, avenida…"
          className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-900 placeholder:text-gray-500"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block sm:col-span-1">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            Bairro
          </span>
          <input
            type="text"
            value={bairro}
            onChange={(e) => setBairro(e.target.value)}
            maxLength={120}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-900 placeholder:text-gray-500"
          />
        </label>

        <label className="block sm:col-span-1">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            Cidade
          </span>
          <input
            type="text"
            value={cidade}
            onChange={(e) => setCidade(e.target.value)}
            maxLength={120}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-900 placeholder:text-gray-500"
          />
        </label>

        <label className="block sm:col-span-1">
          <span className="text-sm font-medium text-gray-700 block mb-1">
            UF
          </span>
          <input
            type="text"
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
            maxLength={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-900 placeholder:text-gray-500"
          />
        </label>
      </div>

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

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={salvando}
          className="flex-1 py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761] disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        {!completar && (
          <button
            type="button"
            onClick={cancelarEdicao}
            disabled={salvando}
            className="px-4 py-2.5 rounded-md border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

// Linha de dado em modo leitura. Vazio → "Não informado" discreto.
function CampoLeitura({ rotulo, valor }: { rotulo: string; valor: string }) {
  const vazio = valor.trim().length === 0
  return (
    <div>
      <span className="text-sm font-medium text-gray-700 block mb-1">
        {rotulo}
      </span>
      <p
        className={`text-sm ${vazio ? 'text-gray-500 italic' : 'text-gray-900'}`}
      >
        {vazio ? 'Não informado' : valor}
      </p>
    </div>
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

function formatarCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

// "[logradouro], [bairro], [cidade]/[uf]" — partes ausentes são omitidas.
function montarEnderecoLinha(
  logradouro: string,
  bairro: string,
  cidade: string,
  uf: string,
): string {
  const partes: string[] = []
  if (logradouro.trim()) partes.push(logradouro.trim())
  if (bairro.trim()) partes.push(bairro.trim())
  const cid = cidade.trim()
  const ufT = uf.trim()
  if (cid && ufT) partes.push(`${cid}/${ufT}`)
  else if (cid) partes.push(cid)
  else if (ufT) partes.push(ufT)
  return partes.join(', ')
}

type EnderecoCep = {
  logradouro?: string
  bairro?: string
  cidade?: string
  uf?: string
}

async function buscarViaCep(digitos: string): Promise<EnderecoCep | null> {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${digitos}/json/`)
    if (!r.ok) return null
    const j = await r.json()
    if (j?.erro) return null
    return {
      logradouro: j.logradouro || undefined,
      bairro: j.bairro || undefined,
      cidade: j.localidade || undefined,
      uf: j.uf || undefined,
    }
  } catch {
    return null
  }
}

async function buscarBrasilApi(digitos: string): Promise<EnderecoCep | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${digitos}`)
    if (!r.ok) return null
    const j = await r.json()
    return {
      logradouro: j.street || undefined,
      bairro: j.neighborhood || undefined,
      cidade: j.city || undefined,
      uf: j.state || undefined,
    }
  } catch {
    return null
  }
}
