'use client'

// app/admin/(painel)/mockups/MockupsAdmin.tsx
// Gerencia o repositório de mockups lisos: lista, adiciona, substitui e exclui.

import { useEffect, useRef, useState } from 'react'

type Mockup = {
  chave: string
  modelo: string | null
  cor: string | null
  material: string | null
  criado_em: string
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

export default function MockupsAdmin() {
  const [lista, setLista] = useState<Mockup[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [cacheBust, setCacheBust] = useState(() => Date.now())
  const [salvando, setSalvando] = useState(false)

  // form de adicionar
  const [modelo, setModelo] = useState('')
  const [cor, setCor] = useState('')
  const [material, setMaterial] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const addFileRef = useRef<HTMLInputElement>(null)
  const subFileRef = useRef<HTMLInputElement>(null)
  const subAlvoRef = useRef<Mockup | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch('/api/admin/mockups')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.erro || 'Erro ao listar')
      setLista(data.mockups ?? [])
      setCacheBust(Date.now())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao listar')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
  }, [])

  async function enviar(modeloV: string, corV: string, materialV: string, file: File) {
    setSalvando(true)
    setErro(null)
    try {
      const imagemDataUrl = await fileToDataUrl(file)
      const res = await fetch('/api/admin/mockups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo: modeloV, cor: corV, material: materialV || null, imagemDataUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.erro || 'Erro ao salvar')
      await carregar()
      return true
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
      return false
    } finally {
      setSalvando(false)
    }
  }

  async function adicionar() {
    if (!modelo.trim() || !cor.trim() || !arquivo) {
      setErro('Preencha modelo, cor e selecione a imagem.')
      return
    }
    const ok = await enviar(modelo, cor, material, arquivo)
    if (ok) {
      setModelo(''); setCor(''); setMaterial(''); setArquivo(null)
      if (addFileRef.current) addFileRef.current.value = ''
    }
  }

  function pedirSubstituicao(m: Mockup) {
    subAlvoRef.current = m
    subFileRef.current?.click()
  }

  async function onSubFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const alvo = subAlvoRef.current
    if (file && alvo) {
      await enviar(alvo.modelo ?? '', alvo.cor ?? '', alvo.material ?? '', file)
    }
    if (subFileRef.current) subFileRef.current.value = ''
    subAlvoRef.current = null
  }

  async function excluir(m: Mockup) {
    if (!confirm(`Excluir o mockup "${[m.modelo, m.cor].filter(Boolean).join(' · ')}"?`)) return
    setSalvando(true)
    try {
      const res = await fetch(`/api/admin/mockups?chave=${encodeURIComponent(m.chave)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.erro || 'Erro ao excluir')
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">Repositório de mockups</h2>
        {salvando && <span className="text-xs text-gray-400">salvando…</span>}
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Mockups de peça lisa reaproveitados no visualizador. A chave é <code>modelo · cor · material</code> (sem acento, minúsculo).
        Adicionar um produto que já existe substitui a imagem dele.
        Toda imagem é padronizada automaticamente para <strong>2048×878 (21:9)</strong> com fundo branco — pode subir em qualquer tamanho.
      </p>

      {/* Adicionar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-gray-900 mb-3">Adicionar / substituir mockup</p>
        <div className="grid sm:grid-cols-4 gap-3">
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="modelo (ex.: oversized)" className={inp} />
          <input value={cor} onChange={(e) => setCor(e.target.value)} placeholder="cor (ex.: preta)" className={inp} />
          <input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="material (ex.: algodão)" className={inp} />
          <input ref={addFileRef} type="file" accept="image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-sm text-gray-600" />
        </div>
        <div className="mt-3">
          <button type="button" onClick={() => void adicionar()} disabled={salvando}
            className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50">
            Salvar mockup
          </button>
        </div>
      </div>

      {erro && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erro}</div>}

      {/* input escondido p/ substituir */}
      <input ref={subFileRef} type="file" accept="image/*" className="hidden" onChange={onSubFile} />

      {/* Lista */}
      {carregando ? (
        <p className="text-sm text-gray-400">carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum mockup salvo ainda. Eles são criados automaticamente quando o visualizador gera uma peça lisa, ou você pode adicionar aqui.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {lista.map((m) => (
            <div key={m.chave} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-100 flex items-center justify-center p-2 min-h-[140px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/admin/mockups/imagem?chave=${encodeURIComponent(m.chave)}&v=${cacheBust}`} alt={m.chave} className="max-h-[200px] w-auto max-w-full object-contain" />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-gray-900 capitalize">{[m.modelo, m.cor].filter(Boolean).join(' · ') || m.chave}</p>
                <p className="text-xs text-gray-500">{m.material ? `material: ${m.material}` : 'sem material'}</p>
                <p className="text-[11px] text-gray-400 mt-1">{new Date(m.criado_em).toLocaleString('pt-BR')}</p>
                <div className="flex gap-2 mt-3">
                  <button type="button" onClick={() => pedirSubstituicao(m)} disabled={salvando}
                    className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs px-3 py-1.5 rounded-md disabled:opacity-50">Substituir imagem</button>
                  <button type="button" onClick={() => void excluir(m)} disabled={salvando}
                    className="border border-gray-200 text-red-600 hover:bg-red-50 text-xs px-3 py-1.5 rounded-md disabled:opacity-50">Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const inp = 'border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-900'
