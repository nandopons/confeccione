"use client";
// app/components/SouFornecedorModal.tsx
// ============================================================================
// Modal aberto pelo botão "Sou fornecedor" do SiteHeader quando o user NÃO
// está logado (ou status de sessão ainda desconhecido).
//
// Oferece 2 opções:
//   - "Já sou fornecedor" → /fornecedor/entrar (verde primary)
//   - "Quero me cadastrar" → /fornecedor/cadastro (outline secundário)
//
// Fecha com X (canto superior direito), ESC ou click fora.
// ============================================================================

import Link from "next/link";
import { useEffect } from "react";

type Props = {
  onClose: () => void;
};

export default function SouFornecedorModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botão X no canto superior direito */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        <div className="text-center mb-5 mt-2">
          <div className="text-3xl mb-2">👔</div>
          <h2 className="text-gray-900 text-lg font-medium mb-1">
            Sou fornecedor
          </h2>
          <p className="text-gray-500 text-sm">
            Já tem cadastro ou quer começar agora?
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Link
            href="/fornecedor/entrar"
            onClick={onClose}
            className="w-full text-center bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-4 py-3 rounded-xl font-medium transition-colors"
          >
            <div className="text-sm">Já sou fornecedor</div>
            <div className="text-[11px] font-normal text-white/80 mt-0.5">
              Entrar com email ou WhatsApp
            </div>
          </Link>
          <Link
            href="/fornecedor/cadastro"
            onClick={onClose}
            className="w-full text-center border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-3 rounded-xl font-medium transition-colors"
          >
            <div className="text-sm">Quero me cadastrar</div>
            <div className="text-[11px] font-normal text-gray-500 mt-0.5">
              É rápido e gratuito
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
