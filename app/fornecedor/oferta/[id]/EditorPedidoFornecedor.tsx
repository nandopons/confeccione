'use client'

// app/fornecedor/oferta/[id]/EditorPedidoFornecedor.tsx
// ============================================================================
// Fornecedor que ASSUMIU o pedido ajusta os produtos DIRETO em cada quadrinho
// da lista (modelo, cor, material, grade, observação), marca item por item
// (Salvar = aplica no rascunho / Excluir), e só um botão geral no fim —
// "Pronto, ajustado — atualizar e avisar o cliente" — grava tudo de uma vez
// (PATCH /api/fornecedor/oferta/[id]/linhas) depois de um pop-up avisando que
// o cliente será notificado. Cada linha leva origIdx pro servidor re-mapear
// os mockups.
// ============================================================================

import { useMemo, useState, type ReactNode } from 'react'

type Tamanho = { tamanho?: string | null; qtd?: number | null }
export type LinhaEntrada = {
  lid?: string | null
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: Tamanho[] | null
  descricao?: string | null
}

export type LinhaDraft = {
  lid: string | null
  origIdx: number | null
  modelo: string
  cor: string
  material: string
  total: string
  tamanhos: Array<{ tamanho: string; qtd: string }>
  descricao: string
  /** true quando difere do original (ou é nova). */
  alterada: boolean
}

const GRADE_PADRAO = ['PP', 'P', 'M', 'G', 'GG']

function daLinha(l: LinhaEntrada, i: number): LinhaDraft {
  return {
    lid: l.lid ?? null,
    origIdx: i,
    modelo: l.modelo ?? '',
    cor: l.cor ?? '',
    material: l.material ?? '',
    total: l.total != null ? String(l.total) : '',
    tamanhos: (l.tamanhos ?? []).filter((t) => t?.tamanho).map((t) => ({ tamanho: String(t.tamanho), qtd: t.qtd != null ? String(t.qtd) : '' })),
    descricao: l.descricao ?? '',
    alterada: false,
  }
}

function somaGrade(l: { tamanhos: Array<{ qtd: string }> }): number {
  return l.tamanhos.reduce((s, t) => s + (parseInt(t.qtd, 10) || 0), 0)
}
export function totalDraft(l: LinhaDraft): number {
  return somaGrade(l) || parseInt(l.total, 10) || 0
}
function assinatura(l: Omit<LinhaDraft, 'alterada'>): string {
  return JSON.stringify([l.modelo.trim(), l.cor.trim(), l.material.trim(), String(totalDraft({ ...l, alterada: false })), l.tamanhos.filter((t) => t.tamanho.trim()).map((t) => [t.tamanho.trim().toUpperCase(), parseInt(t.qtd, 10) || 0]), l.descricao.trim()])
}

// ── Estado compartilhado ─────────────────────────────────────────────────────

export function useEditorLinhas(linhasOriginais: LinhaEntrada[]) {
  const originais = useMemo(() => linhasOriginais.map(daLinha), [linhasOriginais])
  const [itens, setItens] = useState<LinhaDraft[]>(originais)
  const [editando, setEditando] = useState<number | null>(null)

  const removidas = originais.filter((o) => !itens.some((l) => l.origIdx === o.origIdx)).length
  const alteradas = itens.filter((l) => l.alterada).length
  const temMudanca = removidas > 0 || alteradas > 0

  function aplicar(i: number, novo: Omit<LinhaDraft, 'alterada'>) {
    setItens((arr) => arr.map((l, idx) => {
      if (idx !== i) return l
      const orig = novo.origIdx != null ? originais[novo.origIdx] : null
      const alterada = !orig || assinatura(novo) !== assinatura(orig)
      return { ...novo, alterada }
    }))
    setEditando(null)
  }
  function excluir(i: number) {
    setItens((arr) => arr.filter((_, idx) => idx !== i))
    setEditando(null)
  }
  function adicionar() {
    setItens((arr) => [...arr, { lid: null, origIdx: null, modelo: '', cor: '', material: '', total: '', tamanhos: [], descricao: '', alterada: true }])
    setEditando(itens.length)
  }
  function desfazerTudo() {
    setItens(originais)
    setEditando(null)
  }

  return { itens, editando, setEditando, aplicar, excluir, adicionar, desfazerTudo, temMudanca, alteradas, removidas }
}

export type EditorLinhas = ReturnType<typeof useEditorLinhas>

// ── Formulário inline de um quadrinho ────────────────────────────────────────

const inp = 'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

export function FormLinhaInline({ linha, onSalvar, onCancelar, onExcluir }: {
  linha: LinhaDraft
  onSalvar: (l: Omit<LinhaDraft, 'alterada'>) => void
  onCancelar: () => void
  onExcluir: () => void
}) {
  const [f, setF] = useState<Omit<LinhaDraft, 'alterada'>>(() => {
    const { alterada: _a, ...resto } = linha
    void _a
    return resto
  })
  const [erro, setErro] = useState<string | null>(null)
  const soma = somaGrade(f)

  function upd(p: Partial<typeof f>) { setF((x) => ({ ...x, ...p })) }
  function updTam(j: number, p: Partial<{ tamanho: string; qtd: string }>) { setF((x) => ({ ...x, tamanhos: x.tamanhos.map((t, k) => (k === j ? { ...t, ...p } : t)) })) }
  function addTam() {
    setF((x) => {
      const usados = new Set(x.tamanhos.map((t) => t.tamanho.toUpperCase()))
      return { ...x, tamanhos: [...x.tamanhos, { tamanho: GRADE_PADRAO.find((g) => !usados.has(g)) ?? '', qtd: '' }] }
    })
  }
  function salvar() {
    if (!f.modelo.trim()) { setErro('Informe o modelo.'); return }
    if (!(somaGrade(f) || parseInt(f.total, 10) || 0)) { setErro('Informe a quantidade (grade ou total).'); return }
    onSalvar(f)
  }

  return (
    <div className="mt-1 rounded-lg border border-emerald-300 bg-emerald-50/50 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-gray-500">Modelo<input className={inp} value={f.modelo} onChange={(e) => upd({ modelo: e.target.value })} placeholder="ex.: pijama pet" /></label>
        <label className="text-xs text-gray-500">Cor<input className={inp} value={f.cor} onChange={(e) => upd({ cor: e.target.value })} placeholder="ex.: azul" /></label>
        <label className="text-xs text-gray-500">Material / tecido<input className={inp} value={f.material} onChange={(e) => upd({ material: e.target.value })} placeholder="ex.: malha PV" /></label>
      </div>
      <div className="mt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Grade por tamanho{soma > 0 && <span className="text-gray-700"> · total {soma}</span>}</span>
          <div className="flex gap-2">
            {f.tamanhos.length === 0 && <button type="button" onClick={() => upd({ tamanhos: GRADE_PADRAO.map((g) => ({ tamanho: g, qtd: '' })) })} className="text-xs text-emerald-700 hover:underline">PP–GG</button>}
            <button type="button" onClick={addTam} className="text-xs text-emerald-700 hover:underline">+ tamanho</button>
          </div>
        </div>
        {f.tamanhos.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {f.tamanhos.map((t, j) => (
              <div key={j} className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1">
                <input className="w-12 rounded border border-gray-200 px-1 py-0.5 text-xs text-center uppercase" value={t.tamanho} onChange={(e) => updTam(j, { tamanho: e.target.value })} placeholder="tam" />
                <input className="w-14 rounded border border-gray-200 px-1 py-0.5 text-xs text-center" inputMode="numeric" value={t.qtd} onChange={(e) => updTam(j, { qtd: e.target.value.replace(/\D/g, '') })} placeholder="qtd" />
                <button type="button" onClick={() => upd({ tamanhos: f.tamanhos.filter((_, k) => k !== j) })} className="text-gray-400 hover:text-red-600 text-xs px-0.5" aria-label="remover tamanho">×</button>
              </div>
            ))}
          </div>
        ) : (
          <label className="mt-1.5 block text-xs text-gray-500">Quantidade total<input className={inp + ' max-w-[9rem]'} inputMode="numeric" value={f.total} onChange={(e) => upd({ total: e.target.value.replace(/\D/g, '') })} placeholder="ex.: 50" /></label>
        )}
      </div>
      <label className="mt-2 block text-xs text-gray-500">Observação<textarea className={inp} rows={2} value={f.descricao} onChange={(e) => upd({ descricao: e.target.value })} placeholder="acabamento, gola, etiqueta…" /></label>
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={salvar} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Salvar</button>
        <button type="button" onClick={onCancelar} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
        <button type="button" onClick={onExcluir} className="ml-auto text-sm text-gray-400 hover:text-red-600">Excluir</button>
      </div>
    </div>
  )
}

/** Cabeçalho de um quadrinho em modo edição: selo + botões Editar/Excluir. */
export function AcoesLinha({ linha, editando, onEditar, onExcluir }: { linha: LinhaDraft; editando: boolean; onEditar: () => void; onExcluir: () => void }) {
  if (editando) return null
  return (
    <div className="mt-2 flex items-center gap-3 text-xs">
      {linha.alterada && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{linha.origIdx == null ? 'novo' : 'ajustado'}</span>}
      <button type="button" onClick={onEditar} className="text-emerald-700 hover:underline">Editar</button>
      <button type="button" onClick={onExcluir} className="text-gray-400 hover:text-red-600">Excluir</button>
    </div>
  )
}

/** Quadrinho completo (vista + form) — conteúdo da vista vem por children. */
export function QuadroLinhaEditavel({ editor, i, children }: { editor: EditorLinhas; i: number; children: ReactNode }) {
  const l = editor.itens[i]
  const emEdicao = editor.editando === i
  function excluir() {
    if (!confirm('Remover este produto do pedido? A remoção só vale quando você clicar em "Pronto, ajustado".')) return
    editor.excluir(i)
  }
  return (
    <>
      {emEdicao ? (
        <FormLinhaInline linha={l} onSalvar={(n) => editor.aplicar(i, n)} onCancelar={() => { if (l.origIdx == null && !l.modelo) editor.excluir(i); else editor.setEditando(null) }} onExcluir={excluir} />
      ) : (
        <>
          {children}
          <AcoesLinha linha={l} editando={false} onEditar={() => editor.setEditando(i)} onExcluir={excluir} />
        </>
      )}
    </>
  )
}

/** Vista resumida de uma linha do rascunho (mesmo visual da lista original). */
export function VistaLinhaDraft({ l }: { l: LinhaDraft }) {
  const tam = l.tamanhos.filter((t) => t.tamanho.trim()).map((t) => `${t.tamanho.toUpperCase()}: ${t.qtd || '?'}`).join('  ·  ')
  return (
    <div className="text-sm">
      <div className="font-medium text-gray-900">{totalDraft(l) || '?'}× {l.modelo || 'peça'}{l.cor ? ` · ${l.cor}` : ''}</div>
      {l.material && <div className="text-gray-600 mt-1">Tecido: {l.material}</div>}
      {tam && <div className="text-gray-600 mt-1">{tam}</div>}
      {l.descricao && <div className="text-gray-500 mt-1">{l.descricao}</div>}
    </div>
  )
}

// ── Botão geral + pop-up ─────────────────────────────────────────────────────

export function BarraProntoAjustado({ editor, ofertaId, orcamentoDefinido }: { editor: EditorLinhas; ofertaId: string; orcamentoDefinido: boolean }) {
  const [popup, setPopup] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function confirmar() {
    setSalvando(true); setErro(null)
    try {
      const body = {
        linhas: editor.itens.map((l) => ({
          lid: l.lid,
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
      window.location.reload()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
      setSalvando(false)
    }
  }

  const total = editor.itens.reduce((s, l) => s + totalDraft(l), 0)
  const n = editor.alteradas + editor.removidas

  return (
    <>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <button type="button" onClick={editor.adicionar} className="rounded-lg border-2 border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-emerald-500 hover:text-emerald-700">+ Adicionar produto</button>
        {editor.temMudanca && <button type="button" onClick={editor.desfazerTudo} className="text-sm text-gray-500 hover:underline sm:ml-auto">Desfazer tudo</button>}
      </div>

      {editor.temMudanca && (
        <div className="sticky bottom-3 mt-4 rounded-xl border border-emerald-300 bg-white p-3 shadow-lg">
          <p className="text-xs text-gray-600 mb-2">{n} {n === 1 ? 'item ajustado' : 'itens ajustados'} · {total} peças no total. Nada foi enviado ainda.</p>
          <button type="button" onClick={() => setPopup(true)} disabled={editor.editando !== null} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            Pronto, ajustado — atualizar e avisar o cliente
          </button>
          {editor.editando !== null && <p className="mt-1 text-center text-xs text-gray-400">Salve ou cancele o item aberto antes.</p>}
        </div>
      )}

      {popup && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !salvando && setPopup(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900">Atualizar o pedido e avisar o cliente?</p>
            <p className="mt-2 text-sm text-gray-600">O cliente recebe agora, no WhatsApp, um resumo do que você ajustou e o link pra ver o pedido atualizado.</p>
            {orcamentoDefinido && <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">O orçamento que você já enviou volta pra rascunho. Você precisa reenviar com os novos valores.</p>}
            {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={confirmar} disabled={salvando} className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{salvando ? 'Atualizando…' : 'Atualizar e avisar'}</button>
              <button type="button" onClick={() => setPopup(false)} disabled={salvando} className="rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">Voltar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
