"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SouFornecedorModal from "./SouFornecedorModal";

type StatusSessao = "desconhecido" | "logado" | "nao-logado";

export default function SiteHeader() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const [statusSessao, setStatusSessao] = useState<StatusSessao>("desconhecido");
  const [modalAberto, setModalAberto] = useState(false);

  // Checa sessão no mount via endpoint público (retorna só { logado })
  useEffect(() => {
    let cancelado = false;
    fetch("/api/fornecedor/sessao", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelado) return;
        setStatusSessao(data?.logado ? "logado" : "nao-logado");
      })
      .catch(() => {
        if (cancelado) return;
        setStatusSessao("nao-logado");
      });
    return () => {
      cancelado = true;
    };
  }, []);

  function handleSouFornecedor() {
    // Fecha drawer mobile (no-op em desktop)
    setOpen(false);
    if (statusSessao === "logado") {
      router.push("/fornecedor/painel");
      return;
    }
    // 'nao-logado' ou 'desconhecido' (loading inicial) → abre modal
    setModalAberto(true);
  }

  return (
    <nav className="bg-[#111] px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-40">
      <Link href="/" className="flex items-center gap-2 md:gap-3">
        <svg width="32" height="32" viewBox="0 0 60 60" fill="none">
          <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round"/>
          <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
          <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
          <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
          <circle cx="30" cy="30" r="5" fill="white"/>
        </svg>
        <span className="text-white font-medium tracking-widest text-base md:text-lg">CONFECCIONE</span>
      </Link>

      <div className="hidden md:flex items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={handleSouFornecedor}
          className="whitespace-nowrap text-white text-xs md:text-sm border border-white/20 px-2 md:px-4 py-2 rounded-full hover:bg-white/10 transition-colors"
        >
          {statusSessao === "logado" ? (
            "Painel"
          ) : (
            <>
              <span className="hidden md:inline">Sou fornecedor</span>
              <span className="md:hidden">Fornecedor</span>
            </>
          )}
        </button>
        <Link href="/saiba-mais" className="whitespace-nowrap text-white text-xs md:text-sm border border-white/20 px-2 md:px-4 py-2 rounded-full hover:bg-white/10 transition-colors">
          Saiba mais
        </Link>
        <Link href="/#pedido" className="whitespace-nowrap text-white text-xs md:text-sm font-medium bg-[#1D9E75] hover:bg-[#0F6E56] px-2 md:px-4 py-2 rounded-full transition-colors">
          Fazer meu pedido
        </Link>
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
          <button
            type="button"
            onClick={handleSouFornecedor}
            className="text-left text-white text-sm border border-white/20 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            {statusSessao === "logado" ? "Painel" : "Sou fornecedor"}
          </button>
          <Link
            href="/saiba-mais"
            onClick={close}
            className="text-white text-sm border border-white/20 px-4 py-3 rounded-xl hover:bg-white/10 transition-colors"
          >
            Saiba mais
          </Link>
          <Link
            href="/#pedido"
            onClick={close}
            className="text-white text-sm font-medium bg-[#1D9E75] hover:bg-[#0F6E56] px-4 py-3 rounded-xl transition-colors"
          >
            Fazer meu pedido
          </Link>
        </div>
      )}

      {modalAberto && (
        <SouFornecedorModal onClose={() => setModalAberto(false)} />
      )}
    </nav>
  );
}
