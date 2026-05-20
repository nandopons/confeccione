// app/cliente/(painel)/repositorio/RepositorioClient.tsx
// ============================================================================
// Interação do repositório: upload, renomear (preservando extensão), excluir.
// Lista em grade com preview de imagens (~120px) + modal grande ao clicar.
// Arquivos não-imagem mostram um ícone com a extensão.
// ============================================================================

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ehImagem,
  extensaoLabel,
  formatarTamanho,
  reunirNome,
  splitExtensao,
} from '@/app/lib/arquivos-format'
import { enviarArquivo } from '@/app/lib/arquivos-upload'

type Arquivo = {
  id: string
  display_name: string
  mime_type: string | null
  tamanho_bytes: number
  criado_em: string
  url: string | null
}

type Props = {
  arquivosIniciais: Arquivo[]
  usadoInicial: number
  quotaBytes: number
}

export default function RepositorioClient({
  arquivosIniciais,
  usadoInicial,
  quotaBytes,
}: Props) {
  const router = useRouter()
  const [arquivos, setArquivos] = useState<Arquivo[]>(arquivosIniciais)
  const [usado, setUsado] = useState(usadoInicial)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [renomeandoId, setRenomeandoId] = useState<string | null>(null)
  const [baseEditado, setBaseEditado] = useState('')
  const [modalUrl, setModalUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pct = Math.min(100, Math.round((usado / quotaBytes) * 100))

  // Esc fecha o modal de imagem
  useEffect(() => {
    if (!modalUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalUrl(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modalUrl])

  async function handleArquivos(files: FileList | null) {
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
        // url só é gerada no servidor; recém-enviado entra sem preview até o
        // próximo carregamento (refresh abaixo re-gera no servidor).
        setArquivos((prev) => [{ ...res.arquivo, url: null }, ...prev])
        setUsado(res.usado_bytes)
      }
      router.refresh()
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function iniciarRenomear(a: Arquivo) {
    setErro(null)
    setRenomeandoId(a.id)
    setBaseEditado(splitExtensao(a.display_name).base)
  }

  async function handleRenomear(a: Arquivo) {
    const { ext } = splitExtensao(a.display_name)
    const novoDisplay = reunirNome(baseEditado, ext)
    if (novoDisplay.trim().length === 0 || baseEditado.trim().length === 0) {
      setRenomeandoId(null)
      return
    }
    setErro(null)
    try {
      const r = await fetch(`/api/cliente/arquivos/${a.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: novoDisplay }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(j.erro ?? 'Erro ao renomear.')
        return
      }
      setArquivos((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, display_name: j.arquivo.display_name } : x)),
      )
      setRenomeandoId(null)
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    }
  }

  async function handleExcluir(a: Arquivo) {
    if (!confirm(`Excluir "${a.display_name}"? Esta ação não pode ser desfeita.`)) {
      return
    }
    setErro(null)
    try {
      const r = await fetch(`/api/cliente/arquivos/${a.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setErro(j.erro ?? 'Erro ao excluir.')
        return
      }
      setArquivos((prev) => prev.filter((x) => x.id !== a.id))
      setUsado((prev) => Math.max(0, prev - a.tamanho_bytes))
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    }
  }

  return (
    <div>
      {/* Barra de quota */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-gray-700">
            Usado: <strong>{formatarTamanho(usado)}</strong> de{' '}
            {formatarTamanho(quotaBytes)}
          </span>
          <span className="text-gray-400 text-xs">{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-[#1D9E75]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Upload */}
      <div className="mb-4">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleArquivos(e.target.files)}
          disabled={enviando}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
          className="px-5 py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761] disabled:opacity-50"
        >
          {enviando ? 'Enviando…' : '+ Enviar arquivos'}
        </button>
      </div>

      {erro && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {erro}
        </div>
      )}

      {/* Lista / empty state */}
      {arquivos.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-10 text-center">
          <div className="text-4xl mb-2" aria-hidden="true">
            📁
          </div>
          <p className="text-gray-600 text-sm">
            Nenhum arquivo ainda. Envie suas artes e modelos pra ter tudo à mão.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {arquivos.map((a) => {
            const imagem = ehImagem(a.display_name)
            const { ext } = splitExtensao(a.display_name)
            return (
              <div
                key={a.id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col"
              >
                {/* Preview */}
                {imagem && a.url ? (
                  <button
                    type="button"
                    onClick={() => setModalUrl(a.url)}
                    className="block h-[120px] w-full bg-gray-100"
                    title="Ver maior"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={a.url}
                      alt={a.display_name}
                      className="h-[120px] w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="h-[120px] w-full bg-gray-50 flex flex-col items-center justify-center gap-1">
                    <span className="text-3xl" aria-hidden="true">
                      {imagem ? '🖼️' : '📄'}
                    </span>
                    <span className="text-[10px] font-semibold tracking-wide text-gray-400">
                      {imagem ? 'PRÉVIA AO RECARREGAR' : extensaoLabel(a.display_name)}
                    </span>
                  </div>
                )}

                {/* Metadata + ações */}
                <div className="p-2.5 flex-1 flex flex-col gap-1">
                  {renomeandoId === a.id ? (
                    <div className="flex flex-col gap-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={baseEditado}
                          autoFocus
                          maxLength={100}
                          onChange={(e) => setBaseEditado(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenomear(a)
                            if (e.key === 'Escape') setRenomeandoId(null)
                          }}
                          className="min-w-0 flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-xs focus:outline-none focus:border-[#1D9E75]"
                        />
                        <span className="text-gray-400 text-xs select-none shrink-0">{ext}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => handleRenomear(a)}
                          className="text-xs text-[#1D9E75] hover:text-[#178761] font-medium"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenomeandoId(null)}
                          className="text-xs text-gray-500 hover:text-gray-800"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-gray-900 truncate" title={a.display_name}>
                        {a.display_name}
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {formatarTamanho(a.tamanho_bytes)}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <a
                          href={`/api/cliente/arquivos/${a.id}/download`}
                          download={a.display_name}
                          className="text-[11px] text-gray-500 hover:text-gray-800"
                        >
                          Baixar
                        </a>
                        <button
                          type="button"
                          onClick={() => iniciarRenomear(a)}
                          className="text-[11px] text-gray-500 hover:text-gray-800"
                        >
                          Renomear
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExcluir(a)}
                          className="text-[11px] text-red-600 hover:text-red-800"
                        >
                          Excluir
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de imagem grande */}
      {modalUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={() => setModalUrl(null)}
        >
          <button
            type="button"
            onClick={() => setModalUrl(null)}
            aria-label="Fechar"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-gray-800 text-xl flex items-center justify-center hover:bg-white"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={modalUrl}
            alt="Visualização"
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
