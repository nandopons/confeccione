'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITENS: Array<{ href: string; label: string }> = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/pedidos', label: 'Pedidos' },
  { href: '/admin/fornecedores', label: 'Fornecedores' },
  { href: '/admin/captacao', label: 'Captação' },
  { href: '/admin/mockups', label: 'Mockups' },
  { href: '/admin/precos', label: 'Preços' },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 flex-wrap">
      {ITENS.map((item) => {
        // '/admin' precisa de match exato — startsWith pegaria todas
        // as outras rotas (/admin/pedidos, /admin/orfaos, etc).
        const ativo =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              'text-sm px-3 py-1.5 rounded-md font-medium transition-colors ' +
              (ativo
                ? 'bg-gray-900 text-white'
                : 'text-gray-700 hover:bg-gray-100')
            }
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
