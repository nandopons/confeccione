// app/cliente/(painel)/pedido/novo/NovoPedidoForm.tsx
// ============================================================================
// Form de novo pedido no painel — 2 passos. NÃO coleta dados pessoais: nome,
// email e whatsapp vêm da conta autenticada (a página garante perfil completo
// antes de chegar aqui). Visual espelha o grid de nichos da home.
// ============================================================================

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import SelectModal from '@/app/components/SelectModal'

// Espelha a lista da home (app/page.tsx). Mantido aqui pra não tocar a home.
const NICHOS_PRINCIPAIS = [
  { id: 'interclasse', icon: '👕', title: 'Interclasse / Evento' },
  { id: 'private_label', icon: '✂️', title: 'Private Label' },
  { id: 'fitness', icon: '💪', title: 'Fitness' },
  { id: 'moda_praia', icon: '🏖️', title: 'Moda Praia' },
  { id: 'moda_intima', icon: '🩱', title: 'Moda Íntima' },
]
const NICHOS_EXTRAS = [
  { id: 'padrao_esportivo', icon: '⚽', title: 'Padrão Esportivo' },
  { id: 'fardamento', icon: '🏢', title: 'Fardamento' },
  { id: 'inverno', icon: '🧥', title: 'Inverno' },
  { id: 'roupas_uv', icon: '☀️', title: 'Roupas UV' },
  { id: 'bones', icon: '🧢', title: 'Bonés' },
  { id: 'bolsas', icon: '👜', title: 'Bolsas e Acessórios' },
]

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']

type Props = {
  nomeExibido: string
  email: string
}

export default function NovoPedidoForm({ nomeExibido, email }: Props) {
  const router = useRouter()
  const [passo, setPasso] = useState<1 | 2>(1)
  const [tipo, setTipo] = useState('')
  const [quantidade, setQuantidade] = useState(20)
  const [estado, setEstado] = useState('')
  const [prazo, setPrazo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [showExtras, setShowExtras] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // Catch 3: ao abrir a página, rola até o form (passo 1). Só no mount.
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    formRef.current?.scrollIntoView({
      behavior: coarse ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [])

  function avancar() {
    setErro(null)
    const faltando: string[] = []
    if (!tipo) faltando.push('tipo')
    if (!quantidade || quantidade <= 0) faltando.push('quantidade')
    if (!estado) faltando.push('estado')
    if (!prazo) faltando.push('prazo')
    if (faltando.length > 0) {
      setErro(`Preencha: ${faltando.join(', ')}`)
      return
    }
    setPasso(2)
  }

  async function criar() {
    setErro(null)
    setEnviando(true)
    try {
      const r = await fetch('/api/pedidos/criar', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          quantidade,
          prazo,
          estado,
          descricao: descricao.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(j.error ?? 'Erro ao criar pedido. Tente novamente.')
        setEnviando(false)
        return
      }
      router.push('/cliente/painel?criado=1')
      router.refresh()
    } catch {
      setErro('Erro de conexão. Tente novamente.')
      setEnviando(false)
    }
  }

  return (
    <div ref={formRef} className="bg-white border border-gray-200 rounded-2xl p-6 scroll-mt-4">
      {/* Indicador de passo */}
      <div className="flex items-center mb-6">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${
                i < passo
                  ? 'bg-[#1D9E75] text-white'
                  : i === passo
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {i < passo ? '✓' : i}
            </div>
            {i < 2 && (
              <div className={`flex-1 h-px mx-2 ${i < passo ? 'bg-[#1D9E75]' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {passo === 1 ? (
        <>
          <p className="text-gray-900 font-medium mb-1">O que você precisa produzir?</p>
          <p className="text-gray-400 text-sm mb-4">Escolha a categoria mais próxima.</p>

          <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-3">
            {(showExtras ? NICHOS_EXTRAS : NICHOS_PRINCIPAIS).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setTipo(n.id)}
                className={`text-left border-2 rounded-xl p-3 flex items-center gap-3 transition-all ${
                  tipo === n.id
                    ? 'border-[#1D9E75] bg-[#E1F5EE]'
                    : 'border-gray-200 hover:border-[#1D9E75]'
                }`}
              >
                <span className="text-2xl shrink-0">{n.icon}</span>
                <span className="text-sm font-medium text-gray-900 leading-tight">{n.title}</span>
              </button>
            ))}
            {!showExtras && (
              <button
                type="button"
                onClick={() => setShowExtras(true)}
                className="text-left border-2 border-gray-200 hover:border-[#1D9E75] rounded-xl p-3 flex items-center gap-3 transition-all"
              >
                <span className="text-2xl shrink-0">➕</span>
                <span className="text-sm font-medium text-gray-900 leading-tight">Outras categorias</span>
              </button>
            )}
          </div>
          {showExtras && (
            <button
              type="button"
              onClick={() => setShowExtras(false)}
              className="text-xs text-gray-500 hover:text-gray-800 mb-4 inline-flex items-center gap-1"
            >
              ← Voltar às principais
            </button>
          )}

          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Quantidade de peças</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 border border-gray-300 text-gray-700 rounded-lg text-lg flex items-center justify-center hover:bg-gray-50"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={quantidade}
                  onChange={(e) => setQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 h-9 border border-gray-300 rounded-lg text-center text-sm font-medium text-gray-900 focus:outline-none focus:border-[#1D9E75]"
                />
                <button
                  type="button"
                  onClick={() => setQuantidade((q) => q + 1)}
                  className="w-9 h-9 border border-gray-300 text-gray-700 rounded-lg text-lg flex items-center justify-center hover:bg-gray-50"
                >
                  +
                </button>
                <span className="text-sm text-gray-400">peças</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Estado (UF)</label>
                <SelectModal
                  label="Estado (UF)"
                  placeholder="Selecione..."
                  value={estado}
                  onChange={setEstado}
                  options={UFS.map((uf) => ({ value: uf, label: uf }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Prazo desejado</label>
                <SelectModal
                  label="Prazo desejado"
                  placeholder="Selecione..."
                  value={prazo}
                  onChange={setPrazo}
                  options={Object.entries(prazoLabel).map(([id, label]) => ({
                    value: id,
                    label,
                  }))}
                />
              </div>
            </div>
          </div>

          {erro && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          <div className="flex justify-end mt-6">
            <button
              type="button"
              onClick={avancar}
              className="bg-gray-900 text-white px-6 py-2.5 rounded-md text-sm font-medium hover:opacity-85"
            >
              Continuar →
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-gray-900 font-medium mb-4">Detalhes</p>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Descreva seu pedido (opcional)
            </label>
            <textarea
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex: camisa polo P/M/G, logo bordado no peito, cores azul e branco..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75] placeholder:text-gray-400 placeholder:font-normal"
            />
          </div>

          {/* Resumo do passo 1 */}
          <div className="bg-gray-50 rounded-md p-4 mt-5 text-sm">
            <p className="text-xs text-gray-400 font-medium mb-2">Resumo</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-gray-600">
                <span>Tipo</span>
                <span>{tipoLabel[tipo] ?? tipo}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Quantidade</span>
                <span>{quantidade} peças</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Estado</span>
                <span>{estado}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Prazo</span>
                <span>{prazoLabel[prazo] ?? prazo}</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-md p-3 mt-3 text-xs text-gray-600">
            Em nome de <strong className="text-gray-800">{nomeExibido}</strong> · {email}
          </div>

          {erro && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {erro}
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button
              type="button"
              onClick={() => {
                setErro(null)
                setPasso(1)
              }}
              disabled={enviando}
              className="border border-gray-300 text-gray-600 px-5 py-2.5 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              ← Voltar
            </button>
            <button
              type="button"
              onClick={criar}
              disabled={enviando}
              className="bg-[#1D9E75] hover:bg-[#178761] text-white px-6 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {enviando ? 'Criando…' : 'Criar pedido'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
