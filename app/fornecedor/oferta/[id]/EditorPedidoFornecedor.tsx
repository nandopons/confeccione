'use client'

// app/fornecedor/oferta/[id]/EditorPedidoFornecedor.tsx
// ============================================================================
// Fornecedor que ASSUMIU o pedido ajusta os produtos antes/durante o orçamento:
// modelo, cor, material/tecido, grade por tamanho (total recalculado), obs.,
// adicionar e remover produto. Sem mockup/arte — isso segue com o cliente.
//
// Salvar → PATCH /api/fornecedor/oferta/[id]/linhas. Cada linha leva origIdx
// (posição original) pro servidor re-mapear os mockups. Ao salvar, o cliente
// é avisado pelo WhatsApp e, se já havia orçamento enviado, ele volta pra
// rascunho (o fornecedor reenvia).
// ============================================================================

import { useMemo, useState } from 'react'

type Tamanho = { tamanho?: string | null; qtd?: number | null }
export type LinhaEditavel = {
  lid?: string | null
  origIdx: number | null
  modelo: string
  cor: string
  material: string
  total: string
  tamanhos: Array<{ tamanho: string; qtd: string }>
  descricao: string
}

type LinhaEntrada = {
  lid?: string | null
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: Tamanho[] | null
  descricao?: string | null
}

const GRADE_PADRAO = ['PP', 'P', 'M', 'G', 'GG']

function daLinha(l: LinhaEntrada, i: number): LinhaEditavel {
  return {
    lid: l.lid ?? null,
    origIdx: i,
    modelo: l.modelo ?? '',
    cor: l.cor ?? '',
    material: l.material ?? '',
    total: l.total != null ? String(l.total) : '',
    tamanhos: (l.tamanhos ?? []).filter((t) => t?.tamanho).map((t) => ({ tamanho: String(t.tamanho), qtd: t.qtd != null ? String(t.qtd) : '' })),
    descricao: l.descricao ?? '',
  }
}

function somaGrade(l: LinhaEditavel): number {
  return l.tamanhos.reduce((s, t) => s + (parseInt(t.qtd, 10) || 0), 0)
}

export default function EditorPedidoFornecedor({
  ofertaId,
  linhas,
  orcamentoDefinido,
  onSalvo,
}: {
  ofertaId: string
  linhas: LinhaEntrada[]
  orcamentoDefinido: boolean
  onSalvo?: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [itens, setItens] = useState<LinhaEditavel[]>(() => linhas.map(daLinha))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const totalPecas = useMemo(() => itens.reduce((s, l) => s + (somaGrade(l) || parseInt(l.total, 10) || 0), 0), [itens])

  function upd(i: number, patch: Partial<LinhaEditavel>) {
    setItens((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function updTam(i: number, j: number, patch: Partial<{ tamanho: string; qtd: string }>) {
    setItens((arr) => arr.map((l, idx) => (idx === i ? { ...l, tamanhos: l.tamanhos.map((t, k) => (k === j ? { ...t, ...patch } : t)) } : l)))
  }
  function addTam(i: number) {
    setItens((arr) => arr.map((l, idx) => {
      if (idx !== i) return l
      const usados = new Set(l.tamanhos.map((t) => t.tamanho.toUpperCase()))
      const prox = GRADE_PADRAO.find((g) => !usados.has(g)) ?? ''
      return { ...l, tamanhos: [...l.tamanhos, { tamanho: prox, qtd: '' }] }
    }))
  }
  function gradePadrao(i: number) {
    setItens((arr) => arr.map((l, idx) => (idx === i ? { ...l, tamanhos: GRADE_PADRAO.map((g) => ({ tamanho: g, qtd: '' })) } : l)))
  }
  function rmTam(i: number, j: number) {
    setItens((arr) => arr.map((l, idx) => (idx === i ? { ...l, tamanhos: l.tamanhos.filter((_, k) => k !== j) } : l)))
  }
  function addLinha() {
    setItens((arr) => [...arr, { lid: null, origIdx: null, modelo: '', cor: '', material: '', total: '', tamanhos: [], descricao: '' }])
  }
  function rmLinha(i: number) {
    if (!confirm('Remover este produto do pedido? O cliente será avisado.')) return
    setItens((arr) => arr.filter((_, idx) => idx !== i))
  }
  function cancelar() {
    setItens(linhas.map(daLinha))
    setErro(null)
    setAberto(false)
  }

  async function salvar() {
    setErro(null)
    setOk(null)
    const invalida = itens.findIndex((l) => !l.modelo.trim())
    if (invalida >= 0) { setErro(`Produto ${invalida + 1}: informe o modelo.`); return }
    const semQtd = itens.findIndex((l) => !(somaGrade(l) || parseInt(l.total, 10) || 0))
    if (semQtd >= 0) { setErro(`Produto ${semQtd + 1}: informe a quantidade (grade ou total).`); return }
    if (!confirm(`Salvar as alterações? O cliente recebe um aviso no WhatsApp com o que mudou${orcamentoDefinido ? ' e o orçamento que você já enviou volta pra rascunho' : ''}.`)) return

    setSalvando(true)
    try {
      const body = {
        linhas: itens.map((l) => ({
          lid: l.lid ?? null,
          origIdx: l.origIdx,
          modelo: l.modelo.trim() || null,
          cor: l.cor.trim() || null,
          material: l.material.trim() || null,
          total: parseInt(l.total, 10) || null,
          tamanhos: l.tamanhos.filter((t) => t.tamanho.trim()).map((t) => ({ tamanho: t.tamanho.trim().toUpperCase(), qtd: parseInt(t.qtd, 10) || 0 })),
          descricao: l.descricao.trim() || null,
        })),
      }
      const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/linhas`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não foi possível salvar.')
      setOk(j.mudou ? (j.avisado ? 'Salvo. O cliente foi avisado no WhatsApp.' : 'Salvo.') : 'Nada mudou.')
      setAberto(false)
      onSalvo?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  if (!aberto) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => { setAberto(true); setOk(null) }}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:border-emerald-500 hover:text-emerald-700"
        >
          ✏️ Ajustar produtos do pedido <span className="text-gray-400 font-normal">(material, grade, adicionar/remover)</span>
        </button>
        {ok && <p className="mt-2 text-center text-xs text-emerald-700">{ok}</p>}
      </div>
    )
  }

  const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Ajustar produtos do pedido</p>
          <p className="text-xs text-gray-500 mt-0.5">Combine com o cliente antes. Ao salvar, ele recebe o resumo das mudanças no WhatsApp.</p>
        </div>
        <span className="text-xs text-gray-500 shrink-0">{totalPecas} peças</span>
      </div>

      <div className="mt-3 space-y-3">
        {itens.map((l, i) => {
          const soma = somaGrade(l)
          return (
            <div key={l.lid ?? `n${i}`} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-500">Produto {i + 1}{l.origIdx == null && <span className="ml-1.5 text-emerald-700">novo</span>}</span>
                <button type="button" onClick={() => rmLinha(i)} className="text-xs text-gray-400 hover:text-red-600">Remover</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="text-xs text-gray-500">Modelo
                  <input className={inp} value={l.modelo} onChange={(e) => upd(i, { modelo: e.target.value })} placeholder="ex.: camiseta gola V" />
                </label>
                <label className="text-xs text-gray-500">Cor
                  <input className={inp} value={l.cor} onChange={(e) => upd(i, { cor: e.target.value })} placeholder="ex.: preto" />
                </label>
                <label className="text-xs text-gray-500">Material / tecido
                  <input className={inp} value={l.material} onChange={(e) => upd(i, { material: e.target.value })} placeholder="ex.: malha PV 67/33" />
                </label>
              </div>

              <div className="mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Grade por tamanho {soma > 0 && <span className="text-gray-700">· total {soma}</span>}</span>
                  <div className="flex gap-2">
                    {l.tamanhos.length === 0 && <button type="button" onClick={() => gradePadrao(i)} className="text-xs text-emerald-700 hover:underline">PP–GG</button>}
                    <button type="button" onClick={() => addTam(i)} className="text-xs text-emerald-700 hover:underline">+ tamanho</button>
                  </div>
                </div>
                {l.tamanhos.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {l.tamanhos.map((t, j) => (
                      <div key={j} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-1">
                        <input className="w-12 rounded border border-gray-200 px-1 py-0.5 text-xs text-center uppercase" value={t.tamanho} onChange={(e) => updTam(i, j, { tamanho: e.target.value })} placeholder="tam" />
                        <input className="w-14 rounded border border-gray-200 px-1 py-0.5 text-xs text-center" inputMode="numeric" value={t.qtd} onChange={(e) => updTam(i, j, { qtd: e.target.value.replace(/\D/g, '') })} placeholder="qtd" />
                        <button type="button" onClick={() => rmTam(i, j)} className="text-gray-400 hover:text-red-600 text-xs px-0.5" aria-label="remover tamanho">×</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <label className="mt-1.5 block text-xs text-gray-500">Quantidade total (sem grade)
                    <input className={inp + ' max-w-[10rem]'} inputMode="numeric" value={l.total} onChange={(e) => upd(i, { total: e.target.value.replace(/\D/g, '') })} placeholder="ex.: 50" />
                  </label>
                )}
              </div>

              <label className="mt-2 block text-xs text-gray-500">Observação
                <textarea className={inp} rows={2} value={l.descricao} onChange={(e) => upd(i, { descricao: e.target.value })} placeholder="detalhes de acabamento, gola, punho, etiqueta…" />
              </label>
            </div>
          )
        })}
      </div>

      <button type="button" onClick={addLinha} className="mt-3 w-full rounded-lg border-2 border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-emerald-500 hover:text-emerald-700">+ Adicionar produto</button>

      {orcamentoDefinido && (
        <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">Você já enviou um orçamento. Se salvar mudanças, ele volta pra rascunho e você precisa reenviar com os novos valores.</p>
      )}
      {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={salvar} disabled={salvando} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {salvando ? 'Salvando…' : 'Salvar e avisar o cliente'}
        </button>
        <button type="button" onClick={cancelar} disabled={salvando} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
      </div>
    </div>
  )
}
