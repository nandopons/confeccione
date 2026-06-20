'use client'

import { useRef, useState } from 'react'
import type { PortfolioMidia } from '@/app/lib/orcamento-portfolio'

export default function PortfolioUploader({
  ofertaId,
  inicial,
}: {
  ofertaId: string
  inicial: PortfolioMidia[]
}) {
  const [midias, setMidias] = useState<PortfolioMidia[]>(inicial)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function enviarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return
    setErro(null)
    setOcupado(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/portfolio`, { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setErro(j.erro || 'Falha ao enviar arquivo'); break }
        if (Array.isArray(j.midias)) setMidias(j.midias)
      }
    } finally {
      setOcupado(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remover(path: string) {
    if (!window.confirm('Remover este arquivo?')) return
    setOcupado(true)
    setErro(null)
    try {
      const r = await fetch(`/api/fornecedor/oferta/${ofertaId}/portfolio?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.erro || 'Falha ao remover'); return }
      if (Array.isArray(j.midias)) setMidias(j.midias)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
      <p className="text-sm font-medium text-gray-900">Fotos e vídeos de trabalhos (opcional)</p>
      <p className="text-[12px] text-gray-500 mt-1">
        Suba peças parecidas com o que o cliente pediu — isso aumenta muito a chance de ele aprovar o seu orçamento. O cliente vê essas mídias junto com o valor.
      </p>

      {midias.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
          {midias.map((m, i) => (
            <div key={m.path} className="relative group aspect-square overflow-hidden rounded-lg border border-gray-200 bg-white">
              {m.tipo === 'video' ? (
                <video src={`/api/oferta/${ofertaId}/portfolio/${i}`} className="h-full w-full object-cover" muted playsInline preload="metadata" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/oferta/${ofertaId}/portfolio/${i}`} alt={m.nome} className="h-full w-full object-cover" />
              )}
              {m.tipo === 'video' && (
                <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white rounded px-1">vídeo</span>
              )}
              <button
                type="button"
                onClick={() => void remover(m.path)}
                disabled={ocupado}
                className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center rounded-full bg-black/55 hover:bg-black/75 text-white text-sm leading-none disabled:opacity-50"
                aria-label="Remover"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => void enviarArquivos(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={ocupado || midias.length >= 8}
        className="mt-3 inline-flex items-center gap-1.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50"
      >
        {ocupado ? 'Enviando…' : midias.length >= 8 ? 'Limite de 8 arquivos' : '+ Adicionar fotos/vídeos'}
      </button>
      {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}
    </div>
  )
}
