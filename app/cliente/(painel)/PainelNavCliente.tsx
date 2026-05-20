"use client";
// app/cliente/(painel)/PainelNavCliente.tsx
// ============================================================================
// Navegação do painel do CLIENTE: sidebar à esquerda em desktop, bottom nav
// fixa em mobile. DUPLICADO de fornecedor/painel/PainelNav.tsx (mesmo
// responsivo, mesmos SVGs inline, mesma cor ativa, mesma lógica isActive),
// com itens e logout próprios do cliente. Não compartilha código de propósito.
// Client component: usa usePathname pro item ativo + handler de logout.
// ============================================================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type Item = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactElement;
};

const items: Item[] = [
  {
    href: "/cliente/painel",
    label: "Pedidos",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: "/cliente/repositorio",
    label: "Arquivos",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    href: "/cliente/perfil",
    label: "Perfil",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // "Pedidos" cobre o dashboard E as telas de pedido (/cliente/pedido/novo,
  // /cliente/pedido/[id]) — cliente nunca fica numa tela sem item destacado.
  if (href === "/cliente/painel") {
    return pathname === href || pathname.startsWith("/cliente/pedido");
  }
  return pathname.startsWith(href);
}

export default function PainelNavCliente({ nomeCliente }: { nomeCliente: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      await fetch("/api/cliente/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (err) {
      console.error(err);
    }
    router.push("/cliente/login");
  }

  return (
    <>
      {/* SIDEBAR DESKTOP */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-gray-200 sticky top-0 h-screen p-4">
        <Link href="/" className="flex items-center gap-2 mb-8 px-2 pt-2">
          <svg width="28" height="28" viewBox="0 0 60 60" fill="none">
            <path d="M30 6 A24 24 0 0 1 54 30" stroke="#111" strokeWidth="10" strokeLinecap="round"/>
            <path d="M54 30 A24 24 0 0 1 30 54" stroke="#111" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <path d="M30 54 A24 24 0 0 1 6 30" stroke="#111" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
            <path d="M6 30 A24 24 0 0 1 30 6" stroke="#111" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <circle cx="30" cy="30" r="5" fill="#111"/>
          </svg>
          <span className="text-gray-900 font-medium tracking-widest text-sm">CONFECCIONE</span>
        </Link>

        <div className="px-3 pb-4 mb-2 border-b border-gray-100">
          <div className="text-xs text-gray-400">Logado como</div>
          <div className="text-sm text-gray-900 font-medium truncate" title={nomeCliente}>
            {nomeCliente}
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  active
                    ? "bg-[#E1F5EE] text-[#0F6E56] font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {item.icon(active)}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <button
          onClick={sair}
          disabled={saindo}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors disabled:opacity-50"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>{saindo ? "Saindo..." : "Sair"}</span>
        </button>
      </aside>

      {/* BOTTOM NAV MOBILE — 4 colunas (3 itens + Sair) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 grid grid-cols-4 z-40">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center py-2 gap-1 ${
                active ? "text-[#1D9E75]" : "text-gray-500"
              }`}
            >
              {item.icon(active)}
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
        <button
          onClick={sair}
          disabled={saindo}
          className="flex flex-col items-center justify-center py-2 gap-1 text-gray-500 disabled:opacity-50"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="text-[10px] font-medium">{saindo ? "Saindo" : "Sair"}</span>
        </button>
      </nav>
    </>
  );
}
