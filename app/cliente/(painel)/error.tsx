"use client";

// app/cliente/(painel)/error.tsx
// ============================================================================
// Fronteira de erro do painel do cliente (26/08/2026). Ver a irmã em
// app/fornecedor/painel/error.tsx — mesma motivação: o projeto não tinha
// nenhum error.tsx, então qualquer falha de servidor caía na tela genérica do
// Next, em inglês e sem saída.
//
// `unstable_retry` é o nome do prop nesta versão do Next (não `reset`).
// ============================================================================

import { useEffect } from "react";
import Link from "next/link";
import { linkWhatsAppSuporte } from "@/app/lib/contatos";

export default function ErroPainelCliente({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[painel-cliente]", error);
  }, [error]);

  return (
    <section className="px-5 md:px-8 pt-12 pb-24 max-w-lg mx-auto">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="w-12 h-12 bg-orange-50 rounded-full flex items-center justify-center mb-4 text-2xl">
          ⚠️
        </div>
        <h1 className="text-gray-900 text-lg font-medium mb-2">
          Não conseguimos carregar esta tela
        </h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-5">
          Deu um problema do nosso lado. Seus pedidos continuam guardados — é
          só uma falha ao buscar, nada foi perdido.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium rounded-xl px-5 py-3 transition-colors"
          >
            Tentar de novo
          </button>
          <Link
            href="/cliente/painel"
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm rounded-xl px-5 py-3 text-center transition-colors"
          >
            Meus pedidos
          </Link>
        </div>

        <p className="text-xs text-gray-400 mt-5 leading-relaxed">
          Se continuar assim, fale com a gente no{" "}
          <a
            href={linkWhatsAppSuporte("Oi! Meu painel está dando erro ao carregar.")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0F6E56] font-medium hover:underline"
          >
            WhatsApp
          </a>
          .
        </p>
      </div>
    </section>
  );
}
