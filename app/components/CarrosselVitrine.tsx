"use client";

// app/components/CarrosselVitrine.tsx
// ============================================================================
// Carrossel de peças produzidas pela rede, na home.
//
// Rola no eixo X com scroll-snap nativo — sem biblioteca. Um carrossel de
// imagens não justifica 30kB de JS: o navegador já faz isso, com inércia no
// celular e acessível por teclado. As setas são um extra do desktop.
//
// O conteúdo vem de fotos que o admin marcou como destaque em /admin/vitrine
// (ver getVitrineHome). Se não houver nenhuma, a seção nem renderiza — home
// sem carrossel é melhor do que carrossel vazio.
// ============================================================================

import Image from "next/image";
import { useRef } from "react";
import BotaoIrParaPedido from "@/app/components/BotaoIrParaPedido";
import type { ItemVitrine } from "@/app/lib/portfolio-fornecedor";

export default function CarrosselVitrine({ itens }: { itens: ItemVitrine[] }) {
  const trilhoRef = useRef<HTMLUListElement>(null);

  function rolar(direcao: 1 | -1) {
    const el = trilhoRef.current;
    if (!el) return;
    // Uma "página" = a largura visível menos um respiro, pra sobrar sempre um
    // pedaço do próximo card e ficar claro que dá pra continuar rolando.
    el.scrollBy({ left: direcao * (el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="bg-white px-6 py-10 md:py-14 border-t border-gray-100" aria-labelledby="vitrine-titulo">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <h2 id="vitrine-titulo" className="text-gray-900 text-lg md:text-2xl font-medium">
              Feito pela nossa rede
            </h2>
            <p className="text-gray-500 text-xs md:text-sm mt-1">
              Peças produzidas por confecções cadastradas na Confeccione.
            </p>
          </div>

          <div className="hidden md:flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => rolar(-1)}
              aria-label="Ver peças anteriores"
              className="w-9 h-9 rounded-full border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-900 transition-colors"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => rolar(1)}
              aria-label="Ver mais peças"
              className="w-9 h-9 rounded-full border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-900 transition-colors"
            >
              ›
            </button>
          </div>
        </div>

        <ul
          ref={trilhoRef}
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-6 px-6 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {itens.map((item, i) => (
            <li
              key={item.id}
              className="snap-start shrink-0 w-[46%] sm:w-[31%] lg:w-[23%] relative group rounded-xl overflow-hidden bg-gray-100"
            >
              <BotaoIrParaPedido
                className="block w-full text-left"
                aria-label={`Fazer pedido parecido com ${item.legenda ?? "esta peça"}`}
              >
                <Image
                  src={item.url}
                  alt={
                    item.legenda ??
                    `Peça produzida por ${item.fornecedorNome ?? "confecção parceira"} da Confeccione`
                  }
                  width={item.largura}
                  height={item.altura}
                  sizes="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw"
                  loading={i < 4 ? "eager" : "lazy"}
                  className="w-full object-cover aspect-[4/5] transition-transform duration-500 group-hover:scale-[1.03]"
                />
                {(item.legenda || item.fornecedorCidade) && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-3 pb-2.5 pt-8 text-white text-xs font-medium">
                    {item.legenda ?? [item.fornecedorCidade, item.fornecedorUf].filter(Boolean).join("/")}
                  </span>
                )}
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                  <span className="bg-[#1D9E75] text-white text-xs md:text-sm font-medium px-4 py-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    Fazer pedido →
                  </span>
                </span>
              </BotaoIrParaPedido>
            </li>
          ))}
        </ul>

        <div className="flex justify-center mt-6">
          <BotaoIrParaPedido className="bg-[#1D9E75] hover:bg-[#178a64] text-white text-sm font-medium px-6 py-3 rounded-full transition-colors" />
        </div>
      </div>
    </section>
  );
}
