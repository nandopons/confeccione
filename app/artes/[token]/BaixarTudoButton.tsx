// app/artes/[token]/BaixarTudoButton.tsx
// ============================================================================
// Ilha client da página pública de artes. Único pedaço com JS no cliente:
// busca cada arquivo pela signed URL, monta um .zip em memória com fflate
// (zero deps, ~3KB gz) e dispara o download. Sem invocação serverless.
//
// Erros (fetch falho / link de 1h expirado / CORS) são tratados sem quebrar
// o botão — o "Baixar" individual de cada card segue funcionando.
// ============================================================================

'use client'

import { useState } from 'react'
import { zip } from 'fflate'

type Arquivo = { nome: string; url: string }

export default function BaixarTudoButton({
  arquivos,
  zipNome,
}: {
  arquivos: Arquivo[]
  zipNome: string
}) {
  const [baixando, setBaixando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function baixarTudo() {
    setErro(null)
    setBaixando(true)
    try {
      // 1. Busca os bytes de cada arquivo em paralelo.
      const entradas = await Promise.all(
        arquivos.map(async (a) => {
          const res = await fetch(a.url)
          if (!res.ok) throw new Error(`Falha ao baixar ${a.nome}`)
          return [a.nome, new Uint8Array(await res.arrayBuffer())] as const
        }),
      )

      // 2. Resolve nomes duplicados (ex.: dois "logo.png" viram "logo (1).png").
      const usados = new Map<string, number>()
      const registro: Record<string, Uint8Array> = {}
      for (const [nome, buf] of entradas) {
        let final = nome
        if (usados.has(nome)) {
          const n = (usados.get(nome) ?? 0) + 1
          usados.set(nome, n)
          const ponto = nome.lastIndexOf('.')
          final =
            ponto > 0
              ? `${nome.slice(0, ponto)} (${n})${nome.slice(ponto)}`
              : `${nome} (${n})`
        } else {
          usados.set(nome, 0)
        }
        registro[final] = buf
      }

      // 3. Zipa em memória (callback assíncrono do fflate não trava a UI).
      const zipado = await new Promise<Uint8Array>((resolve, reject) => {
        zip(registro, (err, data) => (err ? reject(err) : resolve(data)))
      })

      // 4. Dispara o download via blob temporário. Reembrulhamos num
      //    Uint8Array com ArrayBuffer próprio (fflate devolve ArrayBufferLike,
      //    que o tipo de BlobPart não aceita direto).
      const blob = new Blob([new Uint8Array(zipado)], {
        type: 'application/zip',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = zipNome
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[BaixarTudo] erro:', e)
      setErro(
        'Não deu pra montar o .zip. Baixe os arquivos individualmente ou recarregue a página (os links expiram em 1h).',
      )
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={baixarTudo}
        disabled={baixando}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60 transition"
      >
        {baixando ? 'Preparando…' : '⬇ Baixar tudo (.zip)'}
      </button>
      {erro && <p className="text-xs text-red-600 max-w-xs text-right">{erro}</p>}
    </div>
  )
}
