"use client";

// app/components/CarrosselVitrine.tsx
// ============================================================================
// Carrossel de peças produzidas pela rede, na home.
//
// Rola no eixo X com scroll-snap nativo — sem biblioteca. Um carrossel de
// imagens não justifica 30kB de JS: o navegador já faz isso, com inércia no
// celular e acessível por teclado. As setas são um extra do desktop.
//
// Passa sozinho (decisão do Fernando, 04/09/2026), mas com freios: para no
// hover, no foco de teclado, quando a aba sai de foco e quando o usuário toca
// pra rolar. Carrossel que continua girando enquanto a pessoa está olhando um
// card é o motivo de e-commerce sério ter abandonado autoplay.
//
// Roda em LOOP (05/09/2026): a lista é renderizada duas vezes e, quando o
// scroll passa da primeira cópia, ele volta o equivalente a uma cópia — sem
// animação, então ninguém vê o salto. Antes o carrossel batia no fim e voltava
// correndo pro começo, o que denuncia que acabou e faz o visitante parar de
// olhar; girando sem costura, a vitrine parece maior do que é.
//
// O conteúdo vem de fotos que o admin marcou como destaque em /admin/vitrine
// (ver getVitrineHome), já intercaladas por fornecedor.
// ============================================================================

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BotaoIrParaPedido from "@/app/components/BotaoIrParaPedido";
import type { ItemVitrine } from "@/app/lib/portfolio-fornecedor";

const INTERVALO_MS = 4500;

// Abaixo disso a lista duplicada ainda não enche a tela, e "voltar uma cópia"
// não teria pra onde voltar — nesse caso o carrossel fica sem loop, como era.
const MINIMO_PRA_LOOP = 5;

export default function CarrosselVitrine({ itens }: { itens: ItemVitrine[] }) {
  const trilhoRef = useRef<HTMLUListElement>(null);
  const [pausado, setPausado] = useState(false);
  // Trava o handler enquanto NÓS reposicionamos o scroll: o próprio ajuste
  // dispara um evento de scroll, e sem isso ele se chamaria de novo.
  const ajustando = useRef(false);

  const loop = itens.length >= MINIMO_PRA_LOOP;
  // Duas cópias: é o que permite passar do último pro primeiro sem corte.
  const visiveis = loop ? [...itens, ...itens] : itens;

  /** Reposiciona o scroll pra cópia equivalente, sem animação. */
  function normalizar() {
    const el = trilhoRef.current;
    if (!el || !loop) return;
    const umaCopia = el.scrollWidth / 2;
    if (umaCopia <= 0) return;

    // O 1px de folga nas duas pontas não é frescura: pousar EXATAMENTE em 0
    // faria a regra de "rolando pra trás" disparar logo depois da volta pra
    // frente, e o carrossel ficaria pingando entre as duas cópias.
    let novo: number | null = null;
    if (el.scrollLeft >= umaCopia) novo = Math.max(1, el.scrollLeft - umaCopia);
    else if (el.scrollLeft <= 0) novo = umaCopia - 1; // rolando pra trás no começo
    if (novo === null) return;

    // scroll-behavior é CSS aqui, então atribuir scrollLeft animaria e o salto
    // apareceria. Desliga, pula, religa.
    ajustando.current = true;
    const anterior = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollLeft = novo;
    el.style.scrollBehavior = anterior;
    // rAF: solta a trava só depois que o evento de scroll deste ajuste passou.
    requestAnimationFrame(() => {
      ajustando.current = false;
    });
  }

  function rolar(direcao: 1 | -1) {
    const el = trilhoRef.current;
    if (!el) return;
    // Uma "página" = a largura visível menos um respiro, pra sobrar sempre um
    // pedaço do próximo card e ficar claro que dá pra continuar rolando.
    el.scrollBy({ left: direcao * (el.clientWidth * 0.8), behavior: "smooth" });
  }

  // Costura do loop: escuta o scroll (do dedo, das setas e do autoplay) e
  // devolve a posição pra primeira cópia quando ela passa da segunda.
  useEffect(() => {
    const el = trilhoRef.current;
    if (!el || !loop) return;

    let pendente = 0;
    function aoRolar() {
      if (ajustando.current) return;
      // Só normaliza quando o movimento PARA: mexer no scrollLeft durante uma
      // rolagem suave a cancelaria no meio, e o carrossel travaria.
      window.clearTimeout(pendente);
      pendente = window.setTimeout(normalizar, 120);
    }

    el.addEventListener("scroll", aoRolar, { passive: true });
    return () => {
      window.clearTimeout(pendente);
      el.removeEventListener("scroll", aoRolar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  useEffect(() => {
    if (pausado) return;
    // Respeita quem pediu menos movimento no sistema — autoplay é exatamente o
    // tipo de animação que a preferência existe pra desligar.
    const menosMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (menosMovimento) return;

    const id = setInterval(() => {
      const el = trilhoRef.current;
      if (!el || document.hidden) return;
      if (loop) {
        rolar(1); // a costura acima cuida da volta; aqui é sempre pra frente
        return;
      }
      const fim = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      if (fim) el.scrollTo({ left: 0, behavior: "smooth" });
      else rolar(1);
    }, INTERVALO_MS);
    return () => clearInterval(id);
  }, [pausado, loop]);

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
          onMouseEnter={() => setPausado(true)}
          onMouseLeave={() => setPausado(false)}
          onFocusCapture={() => setPausado(true)}
          onBlurCapture={() => setPausado(false)}
          onTouchStart={() => setPausado(true)}
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-6 px-6 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visiveis.map((item, i) => {
            const titulo = item.nome ?? item.legenda;
            const conteudo = (
              <>
                <Image
                  src={item.url}
                  alt={
                    titulo ??
                    `Peça produzida por ${item.fornecedorNome ?? "confecção parceira"} da Confeccione`
                  }
                  width={item.largura}
                  height={item.altura}
                  sizes="(min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw"
                  loading={i < 4 ? "eager" : "lazy"}
                  className="w-full object-cover aspect-[4/5] transition-transform duration-500 group-hover:scale-[1.03]"
                />
                {titulo && (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8 text-white text-xs font-medium">
                    <span className="block truncate">{titulo}</span>
                  </span>
                )}
              </>
            );

            // Produto com ficha preenchida tem página própria; foto solta ainda
            // não tem o que mostrar numa página, então segue mandando pro chat.
            return (
              <li
                // A segunda cópia repete os ids, então a chave leva a posição.
                key={`${item.id}-${i}`}
                // A segunda cópia sai da árvore de acessibilidade e do Tab: o
                // leitor de tela já leu esses cards, e `inert` (ao contrário de
                // aria-hidden sozinho) também impede o foco cair num item que
                // some do lugar quando a costura acontece.
                inert={loop && i >= itens.length}
                className="snap-start shrink-0 w-[46%] sm:w-[31%] lg:w-[23%] relative group rounded-xl overflow-hidden bg-gray-100"
              >
                {item.nome ? (
                  <Link
                    href={`/produto/${item.id}`}
                    className="block"
                    aria-label={`Ver detalhes de ${item.nome}`}
                  >
                    {conteudo}
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                      <span className="bg-white text-gray-900 text-xs md:text-sm font-medium px-4 py-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        Ver detalhes →
                      </span>
                    </span>
                  </Link>
                ) : (
                  <BotaoIrParaPedido className="block w-full text-left" aria-label="Fazer um pedido">
                    {conteudo}
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                      <span className="bg-[#1D9E75] text-white text-xs md:text-sm font-medium px-4 py-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        Fazer pedido →
                      </span>
                    </span>
                  </BotaoIrParaPedido>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex justify-center mt-6">
          <BotaoIrParaPedido className="bg-[#1D9E75] hover:bg-[#178a64] text-white text-sm font-medium px-6 py-3 rounded-full transition-colors" />
        </div>
      </div>
    </section>
  );
}
