"use client";

// app/fornecedor/painel/error.tsx
// ============================================================================
// Fronteira de erro do painel do fornecedor (26/08/2026).
//
// Até aqui o projeto não tinha NENHUM error.tsx: qualquer falha numa página de
// servidor caía na tela genérica do Next, em inglês, sem link de volta. Isso
// ficou mais importante agora que `fornecedor-pedidos.ts` PROPAGA o erro do
// banco em vez de devolver lista vazia — antes, falha de leitura virava
// "Nenhum pedido agora", que é pior do que um erro honesto.
//
// `unstable_retry` (e não `reset`) é o nome do prop nesta versão do Next —
// conferido em node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/error.md.
// ============================================================================

import { useEffect } from "react";
import Link from "next/link";
import { linkWhatsAppSuporte } from "@/app/lib/contatos";

export default function ErroPainelFornecedor({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[painel-fornecedor]", error);
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
        <p className="text-gray-600 text-sm leading-relaxed mb-1">
          {/* A mensagem dos nossos próprios throws é escrita pra ser lida por
              quem usa; a de erro inesperado, não — por isso o fallback. */}
          {error.message?.startsWith("Não conseguimos")
            ? error.message
            : "Deu um problema do nosso lado ao buscar seus dados."}
        </p>
        <p className="text-gray-500 text-sm leading-relaxed mb-5">
          Seus pedidos e seus valores continuam guardados — isto é uma falha de
          leitura, nada foi perdido.
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
            href="/fornecedor/painel"
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm rounded-xl px-5 py-3 text-center transition-colors"
          >
            Voltar ao início
          </Link>
        </div>

        <p className="text-xs text-gray-400 mt-5 leading-relaxed">
          Se continuar assim, fale com a gente no{" "}
          <a
            href={linkWhatsAppSuporte("Oi! O painel do fornecedor está dando erro ao carregar.")}
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
