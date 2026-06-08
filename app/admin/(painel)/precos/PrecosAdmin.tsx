'use client'

// app/admin/(painel)/precos/PrecosAdmin.tsx
// Preços unificados: por produto (modelo+material+variante liso/estampado) com
// curva de preço por faixa de quantidade. A IA estima a curva (botão Pesquisar
// mercado); você revisa/ajusta e salva.

import { useEffect, useState } from 'react'

const FAIXAS_PADRAO = [1, 3, 6, 9, 15, 20, 30, 50, 70, 100]

type Faixa = { qtd_min: number; preco_centavos: number }
type Pesquisa = {
  chave: string
  modelo: string
  material: string | null
  estampado: boolean
  faixas: Faixa[]
  observacao: string | null
}
type FaixaForm = { qtd_min: string; preco: string }

function brl(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function paraCentavos(txt: string): number | null {
  const s = txt.trim().replace(/\s/g, '').replace('R$', '').replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}
function deCentavos(c: number): string {
  return (c / 100).toFixed(2).replace('.', ',')
}

const inp = 'border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gray-900'

export default function PrecosAdmin() {
  const [lista, setLista] = useState<Pesquisa[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [pesquisando, setPesquisando] = useState(false)

  const [modelo, setModelo] = useState('')
  const [material, setMaterial] = useState('')
  const [estampado, setEstampado] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [faixas, setFaixas] = useState<FaixaForm[]>(FAIXAS_PADRAO.map((q) => ({ qtd_min: String(q), preco: '' })))

  async function carregar() {
    try {
      const r = await fetch('/api/admin/precos/pesquisas').then((x) => x.json())
      setLista(r?.pesquisas ?? [])
    } catch { setErro('Erro ao carregar.') }
  }
  useEffect(() => { void carregar() }, [])

  function limpar() {
    setModelo(''); setMaterial(''); setEstampado(false); setObservacao('')
    setFaixas(FAIXAS_PADRAO.map((q) => ({ qtd_min: String(q), preco: '' })))
  }

  async function pesquisarIA() {
    setErro(null)
    if (!modelo.trim()) { setErro('Informe o modelo antes de pesquisar.'); return }
    setPesquisando(true)
    try {
      const r = await fetch('/api/admin/precos/pesquisar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo, material: material || null, estampado, faixasQtdMin: faixas.map((f) => parseInt(f.qtd_min)).filter((n) => n > 0) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.erro || 'Erro na pesquisa')
      setFaixas((d.faixas as Faixa[]).map((f) => ({ qtd_min: String(f.qtd_min), preco: deCentavos(f.preco_centavos) })))
      if (d.observacao) setObservacao(d.observacao)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro na pesquisa') }
    finally { setPesquisando(false) }
  }

  async function salvar() {
    setErro(null)
    if (!modelo.trim()) { setErro('Informe o modelo.'); return }
    const fx: Faixa[] = []
    for (const f of faixas) {
      const q = parseInt(f.qtd_min); const c = paraCentavos(f.preco)
      if (!q || q < 1) continue
      if (c === null) { setErro('Há preço inválido nas faixas.'); return }
      fx.push({ qtd_min: q, preco_centavos: c })
    }
    if (fx.length === 0) { setErro('Preencha ao menos uma faixa com preço.'); return }
    setSalvando(true)
    try {
      const r = await fetch('/api/admin/precos/pesquisas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo, material: material || null, estampado, faixas: fx, observacao: observacao || null }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.erro || 'Erro ao salvar')
      limpar(); await carregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar') }
    finally { setSalvando(false) }
  }

  function editar(p: Pesquisa) {
    setModelo(p.modelo); setMaterial(p.material ?? ''); setEstampado(p.estampado); setObservacao(p.observacao ?? '')
    setFaixas(p.faixas.map((f) => ({ qtd_min: String(f.qtd_min), preco: deCentavos(f.preco_centavos) })))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function excluir(p: Pesquisa) {
    if (!confirm(`Excluir preço de "${[p.modelo, p.material].filter(Boolean).join(' · ')} ${p.estampado ? '(estampado)' : '(liso)'}"?`)) return
    setSalvando(true)
    try { await fetch(`/api/admin/precos/pesquisas?chave=${encodeURIComponent(p.chave)}`, { method: 'DELETE' }); await carregar() }
    finally { setSalvando(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">Preços por produto</h2>
        {salvando && <span className="text-xs text-gray-400">salvando…</span>}
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Cada produto (modelo + material + variante <strong>liso</strong> ou <strong>estampado</strong>) tem uma curva de preço por quantidade.
        A IA estima a curva de mercado — você revisa e ajusta. A comissão da Confeccione (3%) é embutida no total ao cliente.
      </p>

      {/* Formulário */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="modelo (ex.: oversized)" className={inp} />
          <input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="material (ex.: algodão) — opcional" className={inp} />
        </div>
        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="radio" checked={!estampado} onChange={() => setEstampado(false)} /> Liso
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="radio" checked={estampado} onChange={() => setEstampado(true)} /> Estampado
          </label>
          <button type="button" onClick={() => void pesquisarIA()} disabled={pesquisando}
            className="ml-auto bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
            {pesquisando ? 'Pesquisando…' : '✨ Pesquisar mercado (IA)'}
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-2">Curva de preço (R$ por unidade, a partir da quantidade mínima):</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {faixas.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={f.qtd_min} onChange={(e) => setFaixas((a) => a.map((x, k) => k === i ? { ...x, qtd_min: e.target.value } : x))} className={inp + ' w-16'} inputMode="numeric" />
              <span className="text-xs text-gray-400">+</span>
              <input value={f.preco} onChange={(e) => setFaixas((a) => a.map((x, k) => k === i ? { ...x, preco: e.target.value } : x))} className={inp + ' flex-1'} placeholder="R$/un" inputMode="decimal" />
              <button type="button" onClick={() => setFaixas((a) => a.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setFaixas((a) => [...a, { qtd_min: '', preco: '' }])} className="text-xs text-gray-700 hover:underline mt-2">+ faixa</button>

        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="observação da pesquisa (fonte, faixa de mercado…)" className={inp + ' w-full resize-none mt-3'} />

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void salvar()} disabled={salvando} className="bg-gray-900 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50">Salvar produto</button>
          <button type="button" onClick={limpar} className="text-sm text-gray-500 px-3 py-2 rounded-md hover:bg-gray-100">Limpar</button>
        </div>
      </div>

      {erro && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{erro}</div>}

      {/* Lista */}
      {lista.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum preço cadastrado ainda. Preencha um produto acima e use a pesquisa de mercado.</p>
      ) : (
        <div className="space-y-2">
          {lista.map((p) => (
            <div key={p.chave} className="bg-white border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 capitalize">
                  {[p.modelo, p.material].filter(Boolean).join(' · ')}{' '}
                  <span className={'text-xs px-1.5 py-0.5 rounded ' + (p.estampado ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-gray-100 text-gray-600')}>{p.estampado ? 'estampado' : 'liso'}</span>
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {p.faixas.map((f, i) => (
                    <span key={i} className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-0.5 text-gray-700">{f.qtd_min}+ · {brl(f.preco_centavos)}</span>
                  ))}
                </div>
                {p.observacao && <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">{p.observacao}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => editar(p)} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs px-3 py-1.5 rounded-md">Editar</button>
                <button type="button" onClick={() => void excluir(p)} className="border border-gray-200 text-red-600 hover:bg-red-50 text-xs px-3 py-1.5 rounded-md">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
