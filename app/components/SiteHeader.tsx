"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SouFornecedorModal from "./SouFornecedorModal";

type StatusSessao = "desconhecido" | "logado" | "nao-logado";

export default function SiteHeader({ transparent = false }: { transparent?: boolean }) {
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
    setOpen(false);
    if (statusSessao === "logado") {
      router.push("/fornecedor/painel");
      return;
    }
    setModalAberto(true);
  }

  const navClass = transparent
    ? "absolute top-0 left-0 right-0 z-20 bg-transparent"
    : "sticky top-0 z-40 bg-[#111]";

  const Logo = (
    <Link
      href="/"
      onClick={close}
      className="flex items-center gap-2 md:gap-3 hover:opacity-80 transition-opacity"
    >
      <svg width="32" height="32" viewBox="0 0 60 60" fill="none">
        <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round" />
        <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5" />
        <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75" />
        <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35" />
        <circle cx="30" cy="30" r="5" fill="white" />
      </svg>
      <span className="text-white font-medium tracking-widest text-base md:text-lg">CONFECCIONE</span>
    </Link>
  );

  return (
    <>
      <nav className={`${navClass} px-4 md:px-10 py-4 flex items-center justify-between`}>
        {Logo}

        <div className="flex items-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={handleSouFornecedor}
            className="whitespace-nowrap text-sm text-gray-200 hover:text-white transition-colors"
          >
            {statusSessao === "logado" ? "Painel" : "Sou fornecedor"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={open}
            aria-controls="site-menu-drawer"
            className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <svg className="w-[18px] h-[18px] md:w-[22px] md:h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Drawer lateral direito */}
      <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
          onClick={close}
        />
        <div
          id="site-menu-drawer"
          className={`absolute top-0 right-0 h-full w-72 max-w-[80%] bg-[#0a0a0a] border-l border-white/10 shadow-xl flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="flex justify-end p-4">
            <button
              type="button"
              onClick={close}
              aria-label="Fechar menu"
              className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>

          <nav className="flex flex-col px-6 py-2 gap-1 text-gray-300">
            <Link href="/#pedido" onClick={close} className="py-3 border-b border-white/5 hover:text-white transition-colors">
              Fazer meu pedido
            </Link>
            <Link href="/sobre" onClick={close} className="py-3 border-b border-white/5 hover:text-white transition-colors">
              Sobre
            </Link>
            <Link href="/saiba-mais" onClick={close} className="py-3 border-b border-white/5 hover:text-white transition-colors">
              Saiba mais
            </Link>
            <Link href="/porto-digital" onClick={close} className="py-3 border-b border-white/5 hover:text-white transition-colors">
              Porto Digital
            </Link>
            <button
              type="button"
              onClick={handleSouFornecedor}
              className="py-3 border-b border-white/5 text-left hover:text-white transition-colors"
            >
              {statusSessao === "logado" ? "Painel do fornecedor" : "Sou fornecedor"}
            </button>
            <Link href="/cliente/login" onClick={close} className="py-3 hover:text-white transition-colors">
              Acompanhar meu pedido
            </Link>
          </nav>
        </div>
      </div>

      {modalAberto && <SouFornecedorModal onClose={() => setModalAberto(false)} />}
    </>
  );
}
