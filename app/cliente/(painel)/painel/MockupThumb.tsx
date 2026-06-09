'use client'

import { useState } from 'react'

// Miniatura do mockup salvo do pedido. Se não houver imagem (404), mostra um
// placeholder neutro em vez de imagem quebrada.
export default function MockupThumb({ id }: { id: string }) {
  const [ok, setOk] = useState(true)
  if (!ok) {
    return <div className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 shrink-0" aria-hidden="true" />
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/pedido/assistente/${id}/mockup-thumb`}
      alt="Mockup do pedido"
      loading="lazy"
      onError={() => setOk(false)}
      className="w-16 h-16 rounded-lg object-cover border border-gray-200 bg-white shrink-0"
    />
  )
}
