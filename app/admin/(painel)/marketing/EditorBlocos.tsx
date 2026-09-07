'use client'

// ============================================================================
// EDITOR DE BLOCOS DO E-MAIL
//
// Coluna da esquerda: a pilha de blocos, cada um com seus campos.
// Coluna da direita: a prévia — renderizada NO SERVIDOR, pelo mesmo código que
// monta o e-mail de verdade. Prévia feita em duplicata no cliente mente na
// hora errada; essa não tem como divergir do que o lead recebe.
//
// Upload de imagem vai pro bucket público 'marketing' e volta como URL — é
// assim que a logo entra no e-mail (arquivo hospedado, nunca anexo).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Alinhamento, Bloco, TipoBloco } from '@/app/lib/email-blocos'

const TIPOS: Array<{ tipo: TipoBloco; rotulo: string; icone: string }> = [
  { tipo: 'logo', rotulo: 'Logo', icone: '◧' },
  { tipo: 'titulo', rotulo: 'Título', icone: 'H' },
  { tipo: 'texto', rotulo: 'Texto', icone: '¶' },
  { tipo: 'imagem', rotulo: 'Imagem', icone: '▢' },
  { tipo: 'botao', rotulo: 'Botão', icone: '▭' },
  { tipo: 'divisor', rotulo: 'Linha', icone: '—' },
  { tipo: 'espaco', rotulo: 'Espaço', icone: '␣' },
]

const VERDE = '#1D9E75'

const CAMPO =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]'

/** Espelha blocoVazio do lib (não dá pra importar valor de módulo server-side). */
function blocoNovo(tipo: TipoBloco): Bloco {
  switch (tipo) {
    case 'logo':
      return { tipo: 'logo', url: '', largura: 160, alinhamento: 'left' }
    case 'titulo':
      return { tipo: 'titulo', texto: 'Um título curto e direto', alinhamento: 'left' }
    case 'texto':
      return { tipo: 'texto', texto: 'Oi, #nome!\n\nEscreva aqui.', alinhamento: 'left' }
    case 'imagem':
      return { tipo: 'imagem', url: '', alt: '' }
    case 'botao':
      return { tipo: 'botao', texto: 'Quero um orçamento', url: 'https://www.confeccione.com.br', cor: VERDE, alinhamento: 'left' }
    case 'divisor':
      return { tipo: 'divisor' }
    case 'espaco':
      return { tipo: 'espaco', altura: 24 }
  }
}

export default function EditorBlocos({
  blocos,
  assunto,
  onChange,
}: {
  blocos: Bloco[]
  assunto: string
  onChange: (b: Bloco[]) => void
}) {
  const [html, setHtml] = useState('')
  const [carregandoPrevia, setCarregandoPrevia] = useState(false)
  const [teste, setTeste] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [abrindoTeste, setAbrindoTeste] = useState(false)

  const previa = useCallback(async (bs: Bloco[]) => {
    setCarregandoPrevia(true)
    try {
      const r = await fetch('/api/admin/marketing/templates/previa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocos: bs, assunto }),
      })
      const j = await r.json()
      if (r.ok) setHtml(j.html as string)
    } finally {
      setCarregandoPrevia(false)
    }
  }, [assunto])

  // Espera parar de digitar antes de repintar a prévia.
  useEffect(() => {
    const t = setTimeout(() => void previa(blocos), 400)
    return () => clearTimeout(t)
  }, [blocos, previa])

  function muda(i: number, patch: Record<string, unknown>) {
    onChange(blocos.map((b, j) => (j === i ? ({ ...b, ...patch } as Bloco) : b)))
  }
  function remove(i: number) {
    onChange(blocos.filter((_, j) => j !== i))
  }
  function move(i: number, dir: -1 | 1) {
    const alvo = i + dir
    if (alvo < 0 || alvo >= blocos.length) return
    const novo = [...blocos]
    ;[novo[i], novo[alvo]] = [novo[alvo], novo[i]]
    onChange(novo)
  }
  function adiciona(tipo: TipoBloco) {
    onChange([...blocos, blocoNovo(tipo)])
  }

  async function enviarTeste() {
    if (!teste.includes('@')) return
    setAbrindoTeste(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/marketing/templates/previa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocos, assunto, para: teste }),
      })
      const j = await r.json()
      setMsg(r.ok ? `E-mail de teste enviado pra ${teste}.` : (j.erro as string))
    } catch {
      setMsg('Não deu pra enviar o teste.')
    } finally {
      setAbrindoTeste(false)
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* ───────── Blocos ───────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-gray-400 mr-1">adicionar:</span>
          {TIPOS.map((t) => (
            <button
              key={t.tipo}
              type="button"
              onClick={() => adiciona(t.tipo)}
              className="text-xs border border-gray-200 hover:border-[#1D9E75] hover:text-[#0F6E56] rounded-lg px-2.5 py-1.5 text-gray-600"
            >
              <span className="mr-1 text-gray-400">{t.icone}</span>
              {t.rotulo}
            </button>
          ))}
        </div>

        {blocos.length === 0 && (
          <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg py-10 text-center">
            E-mail vazio. Comece pela logo e um texto.
          </p>
        )}

        {blocos.map((b, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {TIPOS.find((t) => t.tipo === b.tipo)?.rotulo}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === blocos.length - 1}
                  className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1">↓</button>
                <button type="button" onClick={() => remove(i)}
                  className="text-xs text-red-400 hover:text-red-600 px-1">remover</button>
              </div>
            </div>

            <CamposDoBloco bloco={b} onMuda={(patch) => muda(i, patch)} />
          </div>
        ))}

        <p className="text-[11px] text-gray-400 pt-1">
          Marcadores funcionam no texto, no título e até dentro do link do botão:{' '}
          <code className="bg-gray-100 px-1 rounded">#nome</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">#empresa</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">#cidade</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">#link</code>. Use{' '}
          <code className="bg-gray-100 px-1 rounded">*asterisco*</code> pra negrito, igual no WhatsApp.
        </p>
      </div>

      {/* ───────── Prévia ───────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Prévia {carregandoPrevia && <span className="text-gray-300">· atualizando</span>}
          </p>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden bg-[#f5f5f5]">
          <iframe
            title="Prévia do e-mail"
            srcDoc={`<body style="margin:0;padding:20px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">${html}</div></body>`}
            className="w-full h-[460px] border-0"
            sandbox=""
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={teste}
            onChange={(e) => setTeste(e.target.value)}
            placeholder="seu@email.com"
            className={CAMPO + ' flex-1 min-w-[160px]'}
          />
          <button
            type="button"
            onClick={() => void enviarTeste()}
            disabled={abrindoTeste || !teste.includes('@')}
            className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 whitespace-nowrap"
          >
            {abrindoTeste ? 'Enviando…' : 'Enviar teste'}
          </button>
        </div>
        {msg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2">{msg}</p>}
        <p className="text-[11px] text-gray-400">
          A prévia sai do mesmo renderizador do envio real — o que você vê aqui é o que o lead recebe. Mande um teste
          pra si mesmo antes de usar num fluxo: o Gmail e o Outlook desenham e-mail de um jeito próprio.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Campos por tipo de bloco
// ─────────────────────────────────────────────────────────────

function CamposDoBloco({ bloco, onMuda }: { bloco: Bloco; onMuda: (p: Record<string, unknown>) => void }) {
  switch (bloco.tipo) {
    case 'logo':
      return (
        <div className="space-y-2">
          <UploadImagem url={bloco.url} onUrl={(url) => onMuda({ url })} rotulo="Logo (PNG com fundo transparente)" />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
              largura
              <input
                value={bloco.largura ?? 160}
                onChange={(e) => onMuda({ largura: Number(e.target.value.replace(/\D/g, '')) || 160 })}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-16 text-gray-900"
              />
              px
            </label>
            <Alinha valor={bloco.alinhamento ?? 'left'} onMuda={(alinhamento) => onMuda({ alinhamento })} />
          </div>
        </div>
      )

    case 'titulo':
      return (
        <div className="space-y-2">
          <input value={bloco.texto} onChange={(e) => onMuda({ texto: e.target.value })} className={CAMPO} />
          <Alinha valor={bloco.alinhamento ?? 'left'} onMuda={(alinhamento) => onMuda({ alinhamento })} />
        </div>
      )

    case 'texto':
      return (
        <div className="space-y-2">
          <textarea
            value={bloco.texto}
            onChange={(e) => onMuda({ texto: e.target.value })}
            rows={5}
            className={CAMPO + ' resize-y'}
          />
          <Alinha valor={bloco.alinhamento ?? 'left'} onMuda={(alinhamento) => onMuda({ alinhamento })} />
        </div>
      )

    case 'imagem':
      return (
        <div className="space-y-2">
          <UploadImagem url={bloco.url} onUrl={(url) => onMuda({ url })} rotulo="Imagem (até 5 MB)" />
          <input
            value={bloco.alt ?? ''}
            onChange={(e) => onMuda({ alt: e.target.value })}
            placeholder="Descrição da imagem — aparece se o e-mail bloquear imagens"
            className={CAMPO}
          />
          <input
            value={bloco.link ?? ''}
            onChange={(e) => onMuda({ link: e.target.value })}
            placeholder="Link ao clicar (opcional)"
            className={CAMPO}
          />
        </div>
      )

    case 'botao':
      return (
        <div className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={bloco.texto} onChange={(e) => onMuda({ texto: e.target.value })} placeholder="Texto do botão" className={CAMPO} />
            <input value={bloco.url} onChange={(e) => onMuda({ url: e.target.value })} placeholder="https://… ou #link" className={CAMPO} />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
              cor
              <input
                type="color"
                value={bloco.cor ?? VERDE}
                onChange={(e) => onMuda({ cor: e.target.value })}
                className="w-8 h-8 border border-gray-200 rounded cursor-pointer"
              />
            </label>
            <Alinha valor={bloco.alinhamento ?? 'left'} onMuda={(alinhamento) => onMuda({ alinhamento })} />
          </div>
        </div>
      )

    case 'espaco':
      return (
        <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
          altura
          <input
            value={bloco.altura ?? 24}
            onChange={(e) => onMuda({ altura: Number(e.target.value.replace(/\D/g, '')) || 24 })}
            className="border border-gray-200 rounded-lg px-2 py-1 text-sm w-16 text-gray-900"
          />
          px
        </label>
      )

    case 'divisor':
      return <p className="text-[11px] text-gray-400">Uma linha fina separando as seções.</p>
  }
}

function Alinha({ valor, onMuda }: { valor: Alinhamento; onMuda: (v: Alinhamento) => void }) {
  const opcoes: Array<[Alinhamento, string]> = [
    ['left', 'esquerda'],
    ['center', 'centro'],
    ['right', 'direita'],
  ]
  return (
    <div className="flex gap-1">
      {opcoes.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onMuda(v)}
          className={
            'text-[11px] px-2 py-1 rounded border ' +
            (valor === v ? 'border-[#1D9E75] text-[#0F6E56] bg-[#E1F5EE]/50' : 'border-gray-200 text-gray-500 hover:bg-gray-50')
          }
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function UploadImagem({ url, onUrl, rotulo }: { url: string; onUrl: (u: string) => void; rotulo: string }) {
  const [subindo, setSubindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function sobe(file: File) {
    setSubindo(true)
    setErro(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/admin/marketing/imagens', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha no upload')
      onUrl(j.url as string)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro no upload.')
    } finally {
      setSubindo(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-10 max-w-[140px] object-contain border border-gray-100 rounded bg-white" />
        ) : (
          <span className="text-[11px] text-gray-400">{rotulo}</span>
        )}
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={subindo}
          className="text-xs border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          {subindo ? 'Enviando…' : url ? 'Trocar' : 'Enviar imagem'}
        </button>
        {url && (
          <button type="button" onClick={() => onUrl('')} className="text-xs text-gray-400 hover:text-gray-600">
            remover
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void sobe(f)
          e.target.value = ''
        }}
      />
      <input
        value={url}
        onChange={(e) => onUrl(e.target.value)}
        placeholder="ou cole a URL da imagem"
        className={CAMPO + ' text-xs'}
      />
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}
    </div>
  )
}
