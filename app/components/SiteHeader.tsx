"use client";
import Link from "next/link";
import { useState } from "react";

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="bg-[#111] px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-2 md:gap-3">
        <svg width="32" height="32" viewBox="0 0 60 60" fill="none">
          <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round"/>
          <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
          <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
          <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
          <circle cx="30" cy="30" r="5" fill="white"/>
        </svg>
        <span className="text-white font-medium tracking-widest text-base md:text-lg">CONFECCIONE</span>
      </div>

      <div className="hidden md:flex items-center gap-2 md:gap-3">
        <Link href="/fornecedor/cadastro" className="whitespace-nowrap text-white text-xs md:text-sm border border-white/20 px-2 md:px-4 py-2 rounded-full hover:bg-white/10 transition-colors">
          <span className="hidden md:inline">Sou fornecedor</span>
          <span className="md:hidden">Fornecedor</span>
        </Link>
        <Link href="/saiba-mais" className="whitespace-nowrap text-white text-xs md:text-sm border border-white/20 px-2 md:px-4 py-2 rounded-full hover:bg-white/10 transition-colors">
          Saiba mais
        </Link>
        <a href="#pedido" className="whitespace-nowrap text-white text-xs md:text-sm font-medium bg-[#1D9E75] hover:bg-[#0F6E56] px-2 md:px-4 py-2 rounded-full transition-colors">
          Fazer meu pedido
        </a>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        aria-expanded={open}
        aria-controls="site-header-mobile-menu"
        className="md:hidden text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        )}
      </button>

      {open && (
        <div
          id="site-header-mobile-menu"
          className="md:hidden absolute top-full left-0 right-0 bg-[#111] border-t border-white/10 flex flex-col p-4 gap-2"
        >
          <Link
            href="/fornecedor/cadastro"
            onClick={close}
            className="text-white text-sm border border-white/20 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            Sou fornecedor
          </Link>
          <Link
            href="/saiba-mais"
            onClick={close}
            className="text-white text-sm border border-white/20 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            Saiba mais
          </Link>
          <a
            href="#pedido"
            onClick={close}
            className="text-white text-sm font-medium bg-[#1D9E75] hover:bg-[#0F6E56] px-4 py-3 rounded-xl transition-colors"
          >
            Fazer meu pedido
          </a>
        </div>
      )}
    </nav>
  );
}
