'use client'

// app/admin/(painel)/precos/PrecosAdmin.tsx
// Gerencia preços: (1) produtos por modelo+material com faixas de quantidade,
// (2) estampas por posição+tamanho. Valores em R$ na UI, centavos no banco.

import { useEffect, useState } from 'react'

type Faixa = { qtd_min: number; preco_centavos: number }
type Produto = { chave: string; modelo: string; material: string | null; faixas: Faixa[] }
type Estampa = { chave: string; posicao: string; tamanho: string; preco_centavos: number }

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function paraCentavos(txt: string): number | null {
  const s = txt.trim().replace(/\s/g, '').replace('R$', '').replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

const inp = 'border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-900'

export default function PrecosAdmin() {
  const [aba, setAba] = useState<'produtos' | 'estampas'>('produtos')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // produtos
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [pModelo, setPModelo] = useState('')
  const [pMaterial, setPMaterial] = useState('')
  const [pFaixas, setPFaixas] = useState<Array<{ qtd_min: string; preco: string }>>([{ qtd_min: '1', preco: '' }])

  // estampas
  const [estampas, setEstampas] = useState<Estampa[]>([])
  const [ePos, setEPos] = useState('')
  const [eTam, setETam] = useState('')
  const [ePreco, setEPreco] = useState('')

  async function carregar() {
    setErro(null)
    try {
      const [rp, re] = await Promise.all([
        fetch('/api/admin/precos/produtos').then((r) => r.json()),
        fetch('/api/admin/precos/estampas').then((r) => r.json()),
      ])
      setProdutos(rp?.produtos ?? [])
      setEstampas(re?.estampas ?? [])
    } catch {
      setErro('Erro ao carregar preços.')
    }
  }
  useEffect(() => { void carregar() }, [])

  // ---- produtos ----
  function editarProduto(p: Produto) {
    setAba('produtos')
    setPModelo(p.modelo)
    setPMaterial(p.material ?? '')
    setPFaixas(p.faixas.map((f) => ({ qtd_min: String(f.qtd_min), preco: String((f.preco_centavos / 100).toFixed(2)).replace('.', ',') })))
  }
  function limparProduto() {
    setPModelo(''); setPMaterial(''); setPFaixas([{ qtd_min: '1', preco: '' }])
  }
  async function salvarProduto() {
    setErro(null)
    if (!pModelo.trim()) { setErro('Informe o modelo.'); return }
    const faixas: Faixa[] = []
    for (const f of pFaixas) {
      const qm = parseInt(f.qtd_min)
      const c = paraCentavos(f.preco)
      if (!qm || qm < 1 || c === null) { setErro('Faixas inválidas: confira quantidade mínima e preço.'); return }
      faixas.push({ qtd_min: qm, preco_centavos: c })
    }
    if (faixas.length === 0) { setErro('Adicione ao menos uma faixa.'); return }
    setSalvando(true)
    try {
      const res = await fetch('/api/admin/precos/produtos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo: pModelo, material: pMaterial || null, faixas }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.erro || 'Erro ao salvar')
      limparProduto(); await carregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar') }
    finally { setSalvando(false) }
  }
  async function excluirProduto(p: Produto) {
    if (!confirm(`Excluir preço de "${[p.modelo, p.material].filter(Boolean).join(' · ')}"?`)) return
    setSalvando(true)
    try {
      await fetch(`/api/admin/precos/produtos?chave=${encodeURIComponent(p.chave)}`, { method: 'DELETE' })
      await carregar()
    } finally { setSalvando(false) }
  }

  // ---- estampas ----
  async function salvarEstampa() {
    setErro(null)
    const c = paraCentavos(ePreco)
    if (!ePos.trim() || !eTam.trim() || c === null) { setErro('Informe posição, tamanho e preço.'); return }
    setSalvando(true)
    try {
      const res = await fetch('/api/admin/precos/estampas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posicao: ePos, tamanho: eTam, preco_centavos: c }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.erro || 'Erro ao salvar')
      setEPos(''); setETam(''); setEPreco(''); await carregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar') }
    finally { setSalvando(false) }
  }
  async function excluirEstampa(e: Estampa) {
    if (!confirm(`Excluir estampa "${e.posicao} · ${e.tamanho}"?`)) return
    setSalvando(true)
    try {
      await fetch(`/api/admin/precos/estampas?chave=${encodeURIComponent(e.chave)}`, { method: 'DELETE' })
      await carregar()
    } finally { setSalvando(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">Preços</h2>
        {salvando && <span className="text-xs text-gray-400">salvando…</span>}
      </div>
      <p className="text-sm text-gray-500 mb-4">Base do orçamento. A comissão da Confeccione (3%) é embutida no total mostrado ao cliente.</p>

      <div className="flex gap-1 mb-5">
        {(['produtos', 'estampas'] as const).map((a) => (
          <button key={a} type="button" onClick={() => setAba(a)}
            className={'text-sm px-3 py-1.5 rounded-md font-medium ' + (aba === a ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100')}>
            {a === 'produtos' ? 'Produtos' : 'Estampas'}
          </button>
        ))}
      </div>

      {erro && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erro}</div>}

      {aba === 'produtos' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-gray-900 mb-3">Adicionar / editar preço de produto</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <input value={pModelo} onChange={(e) => setPModelo(e.target.value)} placeholder="modelo (ex.: oversized)" className={inp} />
              <input value={pMaterial} onChange={(e) => setPMaterial(e.target.value)} placeholder="material (ex.: algodão) — opcional" className={inp} />
            </div>
            <p className="text-xs text-gray-500 mb-2">Faixas de quantidade (preço unitário a partir da qtd mínima):</p>
            <div className="space-y-2">
              {pFaixas.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">a partir de</span>
                  <input value={f.qtd_min} onChange={(e) => setPFaixas((arr) => arr.map((x, k) => k === i ? { ...x, qtd_min: e.target.value } : x))} className={inp + ' w-20'} placeholder="1" inputMode="numeric" />
                  <span className="text-xs text-gray-400">un. →</span>
                  <input value={f.preco} onChange={(e) => setPFaixas((arr) => arr.map((x, k) => k === i ? { ...x, preco: e.target.value } : x))} className={inp + ' w-28'} placeholder="R$ por un." inputMode="decimal" />
                  <button type="button" onClick={() => setPFaixas((arr) => arr.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setPFaixas((arr) => [...arr, { qtd_min: '', preco: '' }])} className="text-xs text-gray-700 hover:underline">+ adicionar faixa</button>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void salvarProduto()} disabled={salvando} className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50">Salvar produto</button>
              <button type="button" onClick={limparProduto} className="text-sm text-gray-500 px-3 py-2 rounded-md hover:bg-gray-100">Limpar</button>
            </div>
          </div>

          {produtos.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum preço de produto cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {produtos.map((p) => (
                <div key={p.chave} className="bg-white border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900 capitalize">{[p.modelo, p.material].filter(Boolean).join(' · ')}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {p.faixas.map((f, i) => (
                        <span key={i} className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-0.5 text-gray-700">{f.qtd_min}+ un · {brl(f.preco_centavos)}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => editarProduto(p)} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs px-3 py-1.5 rounded-md">Editar</button>
                    <button type="button" onClick={() => void excluirProduto(p)} className="border border-gray-200 text-red-600 hover:bg-red-50 text-xs px-3 py-1.5 rounded-md">Excluir</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {aba === 'estampas' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
            <p className="text-sm font-medium text-gray-900 mb-3">Adicionar / editar preço de estampa</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <input value={ePos} onChange={(e) => setEPos(e.target.value)} placeholder="posição (frente, costas, manga, barra)" className={inp} />
              <input value={eTam} onChange={(e) => setETam(e.target.value)} placeholder="tamanho (ex.: ate a4, a3)" className={inp} />
              <input value={ePreco} onChange={(e) => setEPreco(e.target.value)} placeholder="R$ por peça" inputMode="decimal" className={inp} />
            </div>
            <div className="mt-3">
              <button type="button" onClick={() => void salvarEstampa()} disabled={salvando} className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50">Salvar estampa</button>
            </div>
          </div>

          {estampas.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum preço de estampa cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {estampas.map((e) => (
                <div key={e.chave} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-gray-900 capitalize">{e.posicao} · {e.tamanho} <span className="text-gray-500">— {brl(e.preco_centavos)}/peça</span></p>
                  <button type="button" onClick={() => void excluirEstampa(e)} className="border border-gray-200 text-red-600 hover:bg-red-50 text-xs px-3 py-1.5 rounded-md shrink-0">Excluir</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
