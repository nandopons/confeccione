// app/cliente/(painel)/painel/BibliotecaCard.tsx
// ============================================================================
// Card "Biblioteca de Artes" no painel, com upload integrado. Desktop: dropzone
// com drag & drop. Mobile: botão grande que abre o file picker. Mini-lista dos
// últimos arquivos + link pro repositório completo. Reusa enviarArquivo.
// ============================================================================

'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ehImagem, extensaoLabel, formatarTamanho } from '@/app/lib/arquivos-format'
import { enviarArquivo } from '@/app/lib/arquivos-upload'

type ArquivoMini = {
  id: string
  display_name: string
  mime_type: string | null
  tamanho_bytes: number
  url: string | null
}

type Props = {
  arquivosIniciais: ArquivoMini[]
  totalCount: number
  usadoInicial: number
  quotaBytes: number
}

const MAX_MINI = 5

export default function BibliotecaCard({
  arquivosIniciais,
  totalCount,
  usadoInicial,
  quotaBytes,
}: Props) {
  const [arquivos, setArquivos] = useState<ArquivoMini[]>(arquivosIniciais)
  const [count, setCount] = useState(totalCount)
  const [usado, setUsado] = useState(usadoInicial)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setErro(null)
    setEnviando(true)
    try {
      for (const file of Array.from(files)) {
        const res = await enviarArquivo(file)
        if (!res.ok) {
          setErro(res.erro)
          break
        }
        setArquivos((prev) =>
          [{ ...res.arquivo, url: null }, ...prev].slice(0, MAX_MINI),
        )
        setCount((c) => c + 1)
        setUsado(res.usado_bytes)
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const usoLabel =
    count === 0
      ? 'Faça upload da sua logo e modelagens — só vai precisar uma vez.'
      : `${count} ${count === 1 ? 'arquivo' : 'arquivos'} · ${formatarTamanho(usado)} usados de ${formatarTamanho(quotaBytes)}`

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
          Biblioteca de Artes
        </h3>
        <Link
          href="/cliente/repositorio"
          className="text-sm text-[#1D9E75] hover:text-[#178761] font-medium shrink-0"
        >
          Ver todos →
        </Link>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={enviando}
      />

      {/* Desktop: dropzone com drag & drop */}
      <div
        className={`hidden md:block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
          arrastando ? 'border-[#1D9E75] bg-[#E1F5EE]' : 'border-gray-300 hover:border-[#1D9E75]'
        } ${enviando ? 'opacity-60 pointer-events-none' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault()
          setArrastando(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        <div className="text-2xl mb-1" aria-hidden="true">
          📎
        </div>
        <p className="text-sm text-gray-700 font-medium">
          {enviando ? 'Enviando…' : 'Arraste arquivos ou clique pra enviar'}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          Logos, modelagens, referências (até 50 MB)
        </p>
      </div>

      {/* Mobile: botão grande */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
        className="block md:hidden w-full py-3 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761] disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : '📎 Enviar arquivos'}
      </button>

      <p className="text-xs text-gray-500 mt-3">{usoLabel}</p>

      {erro && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
          {erro}
        </div>
      )}

      {/* Mini-lista dos últimos arquivos */}
      {arquivos.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-3">
          {arquivos.map((a) => {
            const imagem = ehImagem(a.display_name)
            return (
              <li key={a.id} className="w-16">
                <div className="h-16 w-16 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
                  {imagem && a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.url}
                      alt={a.display_name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-gray-400">
                      {imagem ? '🖼️' : extensaoLabel(a.display_name)}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 truncate mt-1" title={a.display_name}>
                  {a.display_name}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
