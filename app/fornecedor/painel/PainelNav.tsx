"use client";
// app/fornecedor/painel/PainelNav.tsx
// ============================================================================
// Navegação do painel: sidebar à esquerda em desktop; no celular, barra de cima
// (quem está logado + Sair) e bottom nav fixa com as 6 abas.
// Componente cliente porque usa usePathname pra destacar o item ativo e tem
// o handler de logout.
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
    href: "/fornecedor/painel",
    label: "Início",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: "/fornecedor/painel/pedidos",
    label: "Pedidos",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    href: "/fornecedor/painel/carteira",
    label: "Carteira",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 7a2 2 0 0 1 2-2h15a1 1 0 0 1 1 1v3" />
        <path d="M2 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3" />
        <path d="M16 12h6v4h-6a2 2 0 0 1 0-4z" />
      </svg>
    ),
  },
  {
    href: "/fornecedor/painel/envio",
    label: "Envio",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 3h15v13H1z" />
        <path d="M16 8h4l3 3v5h-7z" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    href: "/fornecedor/painel/portfolio",
    label: "Portfólio",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1D9E75" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    href: "/fornecedor/painel/dados",
    label: "Dados",
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
  if (href === "/fornecedor/painel") return pathname === href;
  return pathname.startsWith(href);
}

export default function PainelNav({ nomeFornecedor }: { nomeFornecedor: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);
    try {
      await fetch("/api/fornecedor/auth/logout", { method: "POST" });
    } catch (err) {
      console.error(err);
    }
    router.push("/fornecedor/entrar");
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
          <div className="text-sm text-gray-900 font-medium truncate" title={nomeFornecedor}>
            {nomeFornecedor}
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

      {/* TOP BAR MOBILE — 25/09/2026.
          Quem está logado e o Sair moram aqui no celular. O Sair era o 7º item
          de uma barra de 6 colunas: caía sozinho numa segunda linha e a barra
          passava a ocupar ~150 px da tela (o conteúdo reservava 80). Ver a
          bottom nav abaixo. */}
      <header className="md:hidden sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-200">
        <div className="flex items-center justify-between gap-3 px-5 h-12">
          <Link href="/fornecedor/painel" className="flex items-center gap-2 min-w-0">
            <svg width="22" height="22" viewBox="0 0 60 60" fill="none" aria-hidden>
              <path d="M30 6 A24 24 0 0 1 54 30" stroke="#111" strokeWidth="10" strokeLinecap="round"/>
              <path d="M54 30 A24 24 0 0 1 30 54" stroke="#111" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
              <path d="M30 54 A24 24 0 0 1 6 30" stroke="#111" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
              <path d="M6 30 A24 24 0 0 1 30 6" stroke="#111" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
              <circle cx="30" cy="30" r="5" fill="#111"/>
            </svg>
            <span className="text-sm text-gray-900 font-medium truncate" title={nomeFornecedor}>{nomeFornecedor}</span>
          </Link>
          <button
            onClick={sair}
            disabled={saindo}
            className="shrink-0 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 disabled:opacity-50 -mr-1 px-1 py-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {saindo ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>

      {/* BOTTOM NAV MOBILE — 6 abas, uma linha. `pb-[env(...)]` é a faixa do
          gesto do iPhone: sem ela a aba de baixo fica atrás da barra do sistema. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-6">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center justify-center pt-2.5 pb-2 gap-1 min-h-[56px] ${
                  active ? "text-[#0F6E56]" : "text-gray-500"
                }`}
              >
                {active && <span className="absolute top-0 left-3 right-3 h-0.5 rounded-b bg-[#1D9E75]" aria-hidden />}
                {item.icon(active)}
                <span className={`text-[11px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
