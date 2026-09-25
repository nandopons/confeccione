'use client'

// app/fornecedor/oferta/[id]/EditorPedidoFornecedor.tsx
// ============================================================================
// Fornecedor que ASSUMIU o pedido ajusta os produtos DIRETO em cada quadrinho
// da lista (modelo, cor, material, grade, observação, FOTOS), marca item por
// item (Salvar = aplica no rascunho / Excluir), e só um botão geral no fim —
// "Pronto, ajustado — atualizar e avisar o cliente" — grava tudo de uma vez
// (PATCH /api/fornecedor/oferta/[id]/linhas) depois de um pop-up avisando que
// o cliente será notificado. Cada linha leva origIdx pro servidor re-mapear
// os mockups. A tela de orçamento usa o mesmo editor, com o preço embaixo.
//
// FOTOS DA LINHA — 25/09/2026. Até aqui o editor só carregava a CONTAGEM de
// fotos de cada linha: dava pra ver, não pra tirar nem pôr, e linha nova nascia
// sem imagem. O Fernando, testando no celular: "ao editar produto não consegue
// editar a imagem; ao adicionar produto não consegue anexar imagem".
//
// Agora a foto é parte do rascunho da linha (`LinhaDraft.imagens`): a que já
// era da peça vem com uma chave (f:0, ia:1…) e sai com o ×; a nova sobe na
// hora pra pasta do pedido (POST /imagem, uma por vez, já redimensionada aqui
// no navegador) e entra como referência. Nada encosta no pedido até o botão
// geral: o PATCH leva, por linha, `imagens: { manter: [chaves], novas: [refs] }`
// — o servidor rebuilda `mockups[i]` (ver aplicarImagensEditadas).
// ============================================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type Tamanho = { tamanho?: string | null; qtd?: number | null }
export type VisualEntrada = { chave: string; url: string }
export type LinhaEntrada = {
  lid?: string | null
  modelo?: string | null
  cor?: string | null
  material?: string | null
  total?: number | null
  tamanhos?: Tamanho[] | null
  descricao?: string | null
  /** Imagens que a linha já tem (chave pra devolver, URL pra mostrar). */
  visuais?: VisualEntrada[] | null
}

export type ImagemDraft = {
  /** Chave da imagem que a linha JÁ tinha (f:<j> / ia:<j>); null = nova. */
  chave: string | null
  /** Referência `storage:` da foto nova, depois do upload. */
  ref: string | null
  /** O que o <img> mostra. */
  url: string
  subindo?: boolean
  erro?: string | null
}

export type LinhaDraft = {
  /**
   * Identidade da linha DENTRO do editor, estável enquanto a página vive —
   * 25/09/2026. `lid` pode ser nulo (pedido antigo, linha nova) e o índice
   * muda quando uma linha some. A tela de orçamento guarda o preço de cada
   * linha por esta chave, e é o que faz o preço seguir a linha certa quando a
   * confecção tira a segunda cor e a terceira vira a segunda.
   */
  key: string
  lid: string | null
  origIdx: number | null
  modelo: string
  cor: string
  material: string
  total: string
  tamanhos: Array<{ tamanho: string; qtd: string }>
  descricao: string
  imagens: ImagemDraft[]
  /** true quando difere do original (ou é nova). */
  alterada: boolean
}

const GRADE_PADRAO = ['PP', 'P', 'M', 'G', 'GG']
/** Mesmo teto do visualizador do cliente e do servidor (MAX_FOTOS_POR_LINHA). */
export const MAX_FOTOS = 6

function daLinha(l: LinhaEntrada, i: number): LinhaDraft {
  return {
    key: l.lid ?? `orig-${i}`,
    lid: l.lid ?? null,
    origIdx: i,
    modelo: l.modelo ?? '',
    cor: l.cor ?? '',
    material: l.material ?? '',
    total: l.total != null ? String(l.total) : '',
    tamanhos: (l.tamanhos ?? []).filter((t) => t?.tamanho).map((t) => ({ tamanho: String(t.tamanho), qtd: t.qtd != null ? String(t.qtd) : '' })),
    descricao: l.descricao ?? '',
    imagens: (l.visuais ?? []).map((v) => ({ chave: v.chave, ref: null, url: v.url })),
    alterada: false,
  }
}

function somaGrade(l: { tamanhos: Array<{ qtd: string }> }): number {
  return l.tamanhos.reduce((s, t) => s + (parseInt(t.qtd, 10) || 0), 0)
}
export function totalDraft(l: LinhaDraft): number {
  return somaGrade(l) || parseInt(l.total, 10) || 0
}
/** Só imagens prontas contam: a que ainda está subindo não é da linha ainda. */
function imagensProntas(l: { imagens: ImagemDraft[] }): ImagemDraft[] {
  return l.imagens.filter((i) => !i.subindo && !i.erro && (i.chave || i.ref))
}
function assinatura(l: Omit<LinhaDraft, 'alterada'>): string {
  return JSON.stringify([
    l.modelo.trim(),
    l.cor.trim(),
    l.material.trim(),
    String(totalDraft({ ...l, alterada: false })),
    l.tamanhos.filter((t) => t.tamanho.trim()).map((t) => [t.tamanho.trim().toUpperCase(), parseInt(t.qtd, 10) || 0]),
    l.descricao.trim(),
    imagensProntas(l).map((i) => i.chave ?? i.ref),
  ])
}

/** O que o PATCH /linhas e o POST /orcamento recebem por linha. */
export function imagensParaEnvio(l: LinhaDraft): { manter: string[]; novas: string[] } {
  const prontas = imagensProntas(l)
  return {
    manter: prontas.map((i) => i.chave).filter((c): c is string => Boolean(c)),
    novas: prontas.filter((i) => !i.chave).map((i) => i.ref).filter((r): r is string => Boolean(r)),
  }
}

// ── Estado compartilhado ─────────────────────────────────────────────────────

export function useEditorLinhas(linhasOriginais: LinhaEntrada[], opts: { ofertaId?: string | null } = {}) {
  const originais = useMemo(() => linhasOriginais.map(daLinha), [linhasOriginais])
  const [itens, setItens] = useState<LinhaDraft[]>(originais)
  const [editando, setEditando] = useState<number | null>(null)
  // Sequência das chaves de linha nova. Ref, não state: não é pra renderizar.
  const seqNova = useRef(0)

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
    seqNova.current += 1
    const key = `nova-${seqNova.current}`
    setItens((arr) => [...arr, { key, lid: null, origIdx: null, modelo: '', cor: '', material: '', total: '', tamanhos: [], descricao: '', imagens: [], alterada: true }])
    setEditando(itens.length)
  }
  function desfazerTudo() {
    setItens(originais)
    setEditando(null)
  }

  return { itens, editando, setEditando, aplicar, excluir, adicionar, desfazerTudo, temMudanca, alteradas, removidas, ofertaId: opts.ofertaId ?? null }
}

export type EditorLinhas = ReturnType<typeof useEditorLinhas>

// ── Upload da foto (redimensiona no navegador, sobe uma por vez) ─────────────

const LADO_MAX = 1600

function lerComoDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('não deu pra ler o arquivo'))
    r.readAsDataURL(file)
  })
}

/**
 * Foto de celular tem 3–8 MB; a função da Vercel aceita 4,5 MB. Reduz pra
 * ≤1600 px em JPEG antes de subir — mesmo caminho do visualizador do cliente.
 * Arquivo já pequeno passa como está.
 */
async function prepararParaUpload(file: File): Promise<Blob> {
  if (file.size <= 900_000) return file
  const dataUrl = await lerComoDataUrl(file)
  const img = document.createElement('img')
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('imagem inválida')); img.src = dataUrl })
  const esc = Math.min(1, LADO_MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * esc))
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * esc))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const cx = cv.getContext('2d')
  if (!cx) return file
  cx.fillStyle = '#ffffff'
  cx.fillRect(0, 0, w, h)
  cx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', 0.85))
  return blob ?? file
}

async function subirFoto(ofertaId: string, file: File): Promise<{ ref: string; url: string }> {
  const blob = await prepararParaUpload(file)
  const fd = new FormData()
  fd.append('file', blob, blob === file ? file.name : 'foto.jpg')
  const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/imagem`, { method: 'POST', body: fd })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.ref) throw new Error(j?.erro || 'Não deu pra subir a foto.')
  return { ref: j.ref as string, url: j.url as string }
}

// ── Formulário inline de um quadrinho ────────────────────────────────────────

const inp = 'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40'

export function FormLinhaInline({ linha, ofertaId, onSalvar, onCancelar, onExcluir }: {
  linha: LinhaDraft
  /** Sem oferta não há onde subir foto — o botão some. */
  ofertaId: string | null
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
  const inputFoto = useRef<HTMLInputElement>(null)
  // Upload termina depois de a pessoa ter clicado Cancelar: o setState num
  // componente desmontado é ruído. A ref diz se ainda estamos aqui.
  const vivo = useRef(true)
  useEffect(() => () => { vivo.current = false }, [])

  const subindo = f.imagens.some((i) => i.subindo)
  const vagas = Math.max(0, MAX_FOTOS - f.imagens.filter((i) => !i.erro).length)

  function upd(p: Partial<typeof f>) { setF((x) => ({ ...x, ...p })) }
  function updTam(j: number, p: Partial<{ tamanho: string; qtd: string }>) { setF((x) => ({ ...x, tamanhos: x.tamanhos.map((t, k) => (k === j ? { ...t, ...p } : t)) })) }
  function addTam() {
    setF((x) => {
      const usados = new Set(x.tamanhos.map((t) => t.tamanho.toUpperCase()))
      return { ...x, tamanhos: [...x.tamanhos, { tamanho: GRADE_PADRAO.find((g) => !usados.has(g)) ?? '', qtd: '' }] }
    })
  }
  function removerImagem(url: string) {
    setF((x) => ({ ...x, imagens: x.imagens.filter((i) => i.url !== url) }))
  }
  async function escolherFotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((x) => x.type.startsWith('image/'))
    e.target.value = ''
    if (!ofertaId || files.length === 0) return
    const aUsar = files.slice(0, vagas)
    if (aUsar.length === 0) { setErro(`No máximo ${MAX_FOTOS} fotos por item.`); return }
    setErro(null)
    for (const file of aUsar) {
      const urlLocal = URL.createObjectURL(file)
      setF((x) => ({ ...x, imagens: [...x.imagens, { chave: null, ref: null, url: urlLocal, subindo: true }] }))
      try {
        const { ref } = await subirFoto(ofertaId, file)
        if (!vivo.current) continue
        setF((x) => ({ ...x, imagens: x.imagens.map((i) => (i.url === urlLocal ? { ...i, ref, subindo: false } : i)) }))
      } catch (err) {
        if (!vivo.current) continue
        const msg = err instanceof Error ? err.message : 'Não deu pra subir a foto.'
        setF((x) => ({ ...x, imagens: x.imagens.map((i) => (i.url === urlLocal ? { ...i, subindo: false, erro: msg } : i)) }))
      }
    }
  }
  function salvar() {
    if (!f.modelo.trim()) { setErro('Informe o modelo.'); return }
    if (!(somaGrade(f) || parseInt(f.total, 10) || 0)) { setErro('Informe a quantidade (grade ou total).'); return }
    if (subindo) { setErro('Espera a foto terminar de subir.'); return }
    // Foto que falhou não vai: sai do rascunho na hora de salvar.
    onSalvar({ ...f, imagens: f.imagens.filter((i) => !i.erro) })
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

      {/* FOTOS DA PEÇA — miniaturas com × e, no fim da fila, o quadrinho
          tracejado "+ foto" (64 px: cabe o dedo; abre câmera ou galeria). */}
      <div className="mt-2">
        <span className="text-xs text-gray-500">Fotos da peça{f.imagens.length > 0 && <span className="text-gray-700"> · {f.imagens.filter((i) => !i.erro).length}/{MAX_FOTOS}</span>}</span>
        <input ref={inputFoto} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void escolherFotos(e)} />
        <div className="mt-1.5 flex flex-wrap gap-2">
          {f.imagens.map((im) => (
            <div key={im.url} className={'relative h-16 w-16 overflow-hidden rounded-lg border bg-white ' + (im.erro ? 'border-red-300' : 'border-gray-200')} title={im.erro ?? undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" className={'h-full w-full object-cover ' + (im.subindo ? 'opacity-40' : '')} />
              {im.subindo && <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-gray-700">subindo…</span>}
              {im.erro && <span className="absolute inset-x-0 bottom-0 bg-red-600/90 text-[9px] leading-tight text-white text-center px-0.5">falhou</span>}
              <button
                type="button"
                onClick={() => removerImagem(im.url)}
                aria-label="Tirar foto"
                title="Tirar foto"
                className="absolute top-0.5 right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white text-[12px] leading-none hover:bg-red-600"
              >
                ×
              </button>
            </div>
          ))}
          {ofertaId && vagas > 0 && (
            <button
              type="button"
              onClick={() => inputFoto.current?.click()}
              className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 bg-white text-gray-500 hover:border-emerald-500 hover:text-emerald-700"
              aria-label="Adicionar foto"
            >
              <span className="text-xl leading-none">+</span>
              <span className="text-[10px] font-medium">foto</span>
            </button>
          )}
        </div>
        {f.imagens.length === 0 && (
          <p className="mt-1 text-[11px] text-gray-400">
            {ofertaId ? 'Anexe a referência da peça — câmera ou galeria.' : 'Sem foto.'}
          </p>
        )}
      </div>

      <label className="mt-2 block text-xs text-gray-500">Observação<textarea className={inp} rows={2} value={f.descricao} onChange={(e) => upd({ descricao: e.target.value })} placeholder="acabamento, gola, etiqueta…" /></label>
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={salvar} disabled={subindo} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{subindo ? 'Subindo foto…' : 'Salvar'}</button>
        <button type="button" onClick={onCancelar} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
        <button type="button" onClick={onExcluir} className="ml-auto text-sm text-gray-400 hover:text-red-600">Excluir</button>
      </div>
    </div>
  )
}

// ── Ícones (SVG inline, como o resto do site — não há lib de ícone) ──────────

function IconeLapis() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
function IconeX() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

/**
 * Ações de um quadrinho: lápis e × no CANTO SUPERIOR DIREITO do card, como
 * botões redondos — 25/09/2026. Eram dois links de texto ("Editar Excluir")
 * embaixo do conteúdo, e o Fernando, vendo a tela de orçamento: "ficou meio
 * estranho; coloca um lápis e um X em cada card, bem proeminente e elegante".
 * 36 px cada, que é o mínimo pra dedo; o × só fica vermelho ao passar.
 */
function AcoesLinha({ onEditar, onExcluir }: { onEditar: () => void; onExcluir: () => void }) {
  return (
    <div className="absolute -top-0.5 right-0 flex items-center gap-2">
      <button
        type="button"
        onClick={onEditar}
        title="Editar item"
        aria-label="Editar item"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        <IconeLapis />
      </button>
      <button
        type="button"
        onClick={onExcluir}
        title="Remover item"
        aria-label="Remover item"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400/40"
      >
        <IconeX />
      </button>
    </div>
  )
}

/**
 * Quadrinho completo (vista + form) — conteúdo da vista vem por children.
 * A vista fica num bloco `relative` com espaço à direita (pr-24) pros dois
 * botões, que são posicionados em cima dele — assim funcionam igual na página
 * da oferta (onde há fotos acima) e na de orçamento (onde o preço vem abaixo).
 */
export function QuadroLinhaEditavel({ editor, i, children }: { editor: EditorLinhas; i: number; children: ReactNode }) {
  const l = editor.itens[i]
  const emEdicao = editor.editando === i
  function excluir() {
    // Texto genérico de propósito: este quadro vive na página da oferta
    // ("Pronto, ajustado") e na de orçamento ("Atualizar e reenviar").
    if (!confirm('Remover este produto do pedido? Nada muda até você confirmar no botão do fim da página.')) return
    editor.excluir(i)
  }
  if (emEdicao) {
    return (
      <FormLinhaInline linha={l} ofertaId={editor.ofertaId} onSalvar={(n) => editor.aplicar(i, n)} onCancelar={() => { if (l.origIdx == null && !l.modelo) editor.excluir(i); else editor.setEditando(null) }} onExcluir={excluir} />
    )
  }
  return (
    <div className="relative pr-24">
      {children}
      {l.alterada && (
        <span className="mt-1.5 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
          {l.origIdx == null ? 'novo' : 'ajustado'}
        </span>
      )}
      <AcoesLinha onEditar={() => editor.setEditando(i)} onExcluir={excluir} />
    </div>
  )
}

/**
 * Vista resumida de uma linha do rascunho (mesmo visual da lista original),
 * com as fotos da peça em cima. Clique na foto abre por `onAbrirImagem`
 * (lightbox da página) ou, sem ele, numa aba nova.
 */
export function VistaLinhaDraft({ l, onAbrirImagem }: { l: LinhaDraft; onAbrirImagem?: (url: string) => void }) {
  const tam = l.tamanhos.filter((t) => t.tamanho.trim()).map((t) => `${t.tamanho.toUpperCase()}: ${t.qtd || '?'}`).join('  ·  ')
  const fotos = imagensProntas(l)
  return (
    <div className="text-sm">
      {fotos.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto">
          {fotos.map((im, j) =>
            onAbrirImagem ? (
              <button key={im.url} type="button" onClick={() => onAbrirImagem(im.url)} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white" aria-label={`Ampliar foto ${j + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt="" className="h-full w-full object-cover" />
              </button>
            ) : (
              <a key={im.url} href={im.url} target="_blank" rel="noopener noreferrer" className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white" aria-label={`Abrir foto ${j + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt="" className="h-full w-full object-cover" />
              </a>
            )
          )}
        </div>
      )}
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
          imagens: imagensParaEnvio(l),
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
