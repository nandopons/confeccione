'use client'

// app/components/Rastreio.tsx
// ============================================================================
// Pageviews do site público pro painel /admin/funil. Montado no layout raiz;
// dispara 1 evento por troca de rota. Áreas internas (/admin, /cliente,
// /fornecedor) ficam de fora — o funil mede o site público.
// ============================================================================

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { capturarOrigem, track } from '@/app/lib/rastreio'

const IGNORAR = /^\/(admin|cliente|fornecedor)(\/|$)/

export default function Rastreio() {
  const pathname = usePathname()
  const ultimaRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || IGNORAR.test(pathname)) return
    if (ultimaRef.current === pathname) return // StrictMode/re-render: 1 evento por rota
    ultimaRef.current = pathname
    capturarOrigem()
    track('pageview', { pagina: pathname })
  }, [pathname])

  return null
}
