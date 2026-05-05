"use client";
import Link from "next/link";
import { useState } from "react";

const WHATSAPP_HREF =
  "https://wa.me/5581995782077?text=Ol%C3%A1%21%20Vim%20pelo%20site%20do%20Confeccione";

const WhatsAppIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

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
        <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap flex items-center gap-1.5 text-white text-xs font-medium border border-white/20 px-2 md:px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors">
          <WhatsAppIcon />
          <span className="hidden md:inline">Falar no WhatsApp</span>
          <span className="md:hidden">WhatsApp</span>
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
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-2 text-white text-sm font-medium border border-white/20 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            <WhatsAppIcon />
            Falar no WhatsApp
          </a>
        </div>
      )}
    </nav>
  );
}
