// app/cliente/(painel)/repositorio/RepositorioClient.tsx
// ============================================================================
// Interação do repositório: upload (sequencial, valida quota no servidor),
// renomear inline e excluir. Barra de quota no topo. Client Component.
// ============================================================================

'use client'

import { useRef, useState } from 'react'

type Arquivo = {
  id: string
  display_name: string
  mime_type: string | null
  tamanho_bytes: number
  criado_em: string
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
  const [arquivos, setArquivos] = useState<Arquivo[]>(arquivosIniciais)
  const [usado, setUsado] = useState(usadoInicial)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [renomeandoId, setRenomeandoId] = useState<string | null>(null)
  const [novoNome, setNovoNome] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const pct = Math.min(100, Math.round((usado / quotaBytes) * 100))

  async function handleArquivos(files: FileList | null) {
    if (!files || files.length === 0) return
    setErro(null)
    setEnviando(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const r = await fetch('/api/cliente/arquivos/upload', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setErro(
            j.erro ??
              (r.status === 413
                ? 'Espaço insuficiente para este arquivo.'
                : 'Erro ao enviar arquivo.'),
          )
          break
        }
        setArquivos((prev) => [j.arquivo, ...prev])
        setUsado(j.usado_bytes)
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRenomear(id: string) {
    const nome = novoNome.trim()
    if (nome.length === 0) {
      setRenomeandoId(null)
      return
    }
    setErro(null)
    try {
      const r = await fetch(`/api/cliente/arquivos/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: nome }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(j.erro ?? 'Erro ao renomear.')
        return
      }
      setArquivos((prev) =>
        prev.map((a) => (a.id === id ? { ...a, display_name: j.arquivo.display_name } : a)),
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
        <ul className="space-y-2">
          {arquivos.map((a) => (
            <li
              key={a.id}
              className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3"
            >
              <span className="text-2xl shrink-0" aria-hidden="true">
                {(a.mime_type ?? '').startsWith('image/') ? '🖼️' : '📄'}
              </span>

              <div className="min-w-0 flex-1">
                {renomeandoId === a.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={novoNome}
                      autoFocus
                      maxLength={200}
                      onChange={(e) => setNovoNome(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenomear(a.id)
                        if (e.key === 'Escape') setRenomeandoId(null)
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => handleRenomear(a.id)}
                      className="text-sm text-[#1D9E75] hover:text-[#178761] font-medium"
                    >
                      Salvar
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-gray-900 truncate" title={a.display_name}>
                      {a.display_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatarTamanho(a.tamanho_bytes)}
                    </div>
                  </>
                )}
              </div>

              {renomeandoId !== a.id && (
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setRenomeandoId(a.id)
                      setNovoNome(a.display_name)
                    }}
                    className="text-xs text-gray-500 hover:text-gray-800"
                  >
                    Renomear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExcluir(a)}
                    className="text-xs text-red-600 hover:text-red-800"
                  >
                    Excluir
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
