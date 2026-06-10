'use client'

// ============================================================================
// Shell visual do painel admin.
//
// Desktop (lg+): sidebar escura fixa à esquerda com logo, seções agrupadas
// (Vendas / Operação) e ícones; conteúdo claro à direita (lg:pl-60).
// Mobile (<lg): topbar escura sticky com hambúrguer → drawer lateral com a
// mesma navegação. O drawer fecha ao trocar de rota e trava o scroll do body.
//
// O layout (painel) é server (auth) e delega toda a moldura pra cá.
// ============================================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

type Item = { href: string; label: string; icone: ReactNode }
type Secao = { titulo: string | null; itens: Item[] }

// Ícones inline (stroke currentColor) — sem dependência externa.
function Ico({ d, extra }: { d: string; extra?: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <path d={d} />
      {extra}
    </svg>
  )
}

const SECOES: Secao[] = [
  {
    titulo: null,
    itens: [
      {
        href: '/admin',
        label: 'Dashboard',
        icone: (
          <Ico
            d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"
          />
        ),
      },
    ],
  },
  {
    titulo: 'Vendas',
    itens: [
      {
        href: '/admin/pedidos',
        label: 'Pedidos',
        icone: (
          <Ico d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3.3 8.3L12 13l8.7-4.7M12 13v8.5" />
        ),
      },
      {
        href: '/admin/pedidos-pagos',
        label: 'Pedidos pagos',
        icone: (
          <Ico
            d="M8.5 12.5l2.5 2.5 4.5-5"
            extra={<circle cx="12" cy="12" r="9" />}
          />
        ),
      },
      {
        href: '/admin/pedidos-chat',
        label: 'Pedidos do chat',
        icone: (
          <Ico d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.9-.9L3 20l1.1-5.4a8.1 8.1 0 0 1-1-3.9A8.4 8.4 0 0 1 11.6 2.4h.5A8.4 8.4 0 0 1 21 11v.5z" />
        ),
      },
      {
        href: '/admin/marketing',
        label: 'Marketing',
        icone: (
          <Ico d="M3 11l18-5v12L3 13v-2zM11.6 16.8a3 3 0 1 1-5.8-1.6" />
        ),
      },
    ],
  },
  {
    titulo: 'Operação',
    itens: [
      {
        href: '/admin/fornecedores',
        label: 'Fornecedores',
        icone: (
          <Ico d="M2 21h20M4 21V8l5 3.5V8l5 3.5V3h6v18" />
        ),
      },
      {
        href: '/admin/captacao',
        label: 'Captação',
        icone: (
          <Ico
            d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M19 7.5v6M22 10.5h-6"
            extra={<circle cx="8.5" cy="7" r="3.5" />}
          />
        ),
      },
      {
        href: '/admin/mockups',
        label: 'Mockups',
        icone: (
          <Ico
            d="M21 15.5l-4.5-4.5L6 21.5"
            extra={
              <>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
              </>
            }
          />
        ),
      },
      {
        href: '/admin/precos',
        label: 'Preços',
        icone: (
          <Ico
            d="M20.6 13.4L11 3.8A2 2 0 0 0 9.6 3.2H5a2 2 0 0 0-2 2v4.6c0 .5.2 1 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8z"
            extra={<circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />}
          />
        ),
      },
    ],
  },
]

const LogoMarca = (
  <svg width="26" height="26" viewBox="0 0 60 60" fill="none" aria-hidden>
    <path d="M30 6 A24 24 0 0 1 54 30" stroke="#1D9E75" strokeWidth="10" strokeLinecap="round" />
    <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.45" />
    <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.7" />
    <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.3" />
    <circle cx="30" cy="30" r="5" fill="white" />
  </svg>
)

function itemAtivo(href: string, pathname: string): boolean {
  // '/admin' exige match exato; demais casam por segmento
  // ('/admin/pedidos' NÃO casa '/admin/pedidos-pagos').
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(href + '/')
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
      {SECOES.map((secao, i) => (
        <div key={i}>
          {secao.titulo && (
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
              {secao.titulo}
            </p>
          )}
          <ul className="space-y-0.5">
            {secao.itens.map((item) => {
              const ativo = itemAtivo(item.href, pathname)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={ativo ? 'page' : undefined}
                    className={
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors ' +
                      (ativo
                        ? 'bg-[#1D9E75] text-white shadow-[0_4px_14px_-4px_rgba(29,158,117,0.55)]'
                        : 'text-[#9DB4AA] hover:text-white hover:bg-white/5')
                    }
                  >
                    {item.icone}
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function RodapeSidebar() {
  return (
    <div className="px-3 py-3 border-t border-white/10">
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-white/40 hover:text-white hover:bg-white/5 transition-colors"
      >
        <Ico
          d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
          extra={<circle cx="12" cy="12" r="10" />}
        />
        Ver site
        <span className="ml-auto text-white/25">↗</span>
      </a>
    </div>
  )
}

function CabecalhoSidebar() {
  return (
    <div className="px-5 pt-5 pb-4">
      <Link href="/admin" className="flex items-center gap-2.5 group">
        {LogoMarca}
        <span className="leading-tight">
          <span className="block text-white font-semibold tracking-[0.14em] text-[13px] group-hover:opacity-90">
            CONFECCIONE
          </span>
          <span className="block text-[10.5px] text-white/40 tracking-wide">
            Painel administrativo
          </span>
        </span>
      </Link>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [drawer, setDrawer] = useState(false)

  // Fecha o drawer ao navegar.
  useEffect(() => {
    setDrawer(false)
  }, [pathname])

  // Trava o scroll do body com o drawer aberto.
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawer])

  const labelAtual =
    SECOES.flatMap((s) => s.itens).find((i) => itemAtivo(i.href, pathname))
      ?.label ?? 'Admin'

  return (
    <div className="min-h-screen bg-[#F3F6F4]">
      {/* ───────── Sidebar desktop ───────── */}
      <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-60 bg-[#0E1814] border-r border-black/40 z-40">
        <CabecalhoSidebar />
        <NavLinks pathname={pathname} />
        <RodapeSidebar />
      </aside>

      {/* ───────── Topbar mobile ───────── */}
      <header className="lg:hidden sticky top-0 z-40 bg-[#0E1814] h-14 px-4 flex items-center justify-between">
        <Link href="/admin" className="flex items-center gap-2">
          {LogoMarca}
          <span className="text-white font-semibold tracking-[0.12em] text-xs">
            CONFECCIONE
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/50">{labelAtual}</span>
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Abrir menu"
            className="w-10 h-10 -mr-1.5 flex items-center justify-center rounded-lg text-white/80 hover:bg-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
        </div>
      </header>

      {/* ───────── Drawer mobile ───────── */}
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-[#0E1814] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              <CabecalhoSidebar />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Fechar menu"
                className="w-10 h-10 flex items-center justify-center rounded-lg text-white/70 hover:bg-white/10"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <NavLinks pathname={pathname} />
            <RodapeSidebar />
          </div>
        </div>
      )}

      {/* ───────── Conteúdo ───────── */}
      <main className="lg:pl-60">{children}</main>
    </div>
  )
}
