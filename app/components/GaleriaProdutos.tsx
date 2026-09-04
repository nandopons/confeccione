import Image from "next/image";
import BotaoIrParaPedido from "@/app/components/BotaoIrParaPedido";

// Galeria de peças fabricadas pela rede (03/09/2026). Substituiu a grade de
// texto por segmento: a home vende por foto, não por parágrafo. O SEO fica no
// `alt` e no rótulo curto de cada foto — são as buscas que queremos atender.
//
// Pra adicionar foto: joga o arquivo em public/galeria/ (JPG/WebP, ~1200 px no
// lado maior, sem texto grande em cima) e inclui uma linha aqui. A grade se
// ajusta a qualquer quantidade; a primeira foto ganha destaque no desktop.
const FOTOS: Array<{ src: string; alt: string; rotulo: string; largura: number; altura: number }> = [
  {
    src: "/galeria/camiseta-branca-kingcrest.jpg",
    alt: "Camiseta branca de marca própria com estampa fotográfica frontal, fabricada por confecção parceira da Confeccione",
    rotulo: "Marca própria · estampa digital",
    largura: 663,
    altura: 860,
  },
  {
    src: "/galeria/camiseta-preta-estampa-soccer.jpg",
    alt: "Camiseta preta 100% algodão com estampa em serigrafia de jogador de futebol",
    rotulo: "Camiseta · serigrafia",
    largura: 435,
    altura: 798,
  },
  {
    src: "/galeria/camiseta-preta-buda.jpg",
    alt: "Camiseta preta feminina com estampa de Buda em amarelo, produção para marca própria",
    rotulo: "Marca própria · silk",
    largura: 344,
    altura: 427,
  },
  {
    src: "/galeria/camiseta-costas-estampa-rosa.jpg",
    alt: "Costas de camiseta preta com estampa tipográfica rosa em serigrafia",
    rotulo: "Estampa nas costas",
    largura: 474,
    altura: 393,
  },
  {
    src: "/galeria/camiseta-costas-volei.jpg",
    alt: "Costas de camiseta preta com estampa fotográfica de vôlei de praia",
    rotulo: "Camiseta · estampa fotográfica",
    largura: 316,
    altura: 335,
  },
  {
    src: "/galeria/estamparia-dtf-silk.jpg",
    alt: "Camiseta preta 100% algodão com estampa em serigrafia — estamparia DTF ou silk",
    rotulo: "Estamparia · silk ou DTF",
    largura: 849,
    altura: 567,
  },
];

export default function GaleriaProdutos() {
  if (FOTOS.length === 0) return null;
  const unica = FOTOS.length === 1;

  return (
    <section className="bg-white px-6 py-10 md:py-14 border-t border-gray-100" aria-labelledby="galeria-titulo">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-end justify-between gap-4 mb-5 md:mb-6">
          <div>
            <h2 id="galeria-titulo" className="text-gray-900 text-lg md:text-2xl font-medium">
              Feito pela nossa rede
            </h2>
            <p className="text-gray-500 text-xs md:text-sm mt-1">
              Camisetas, uniformes, fitness e marca própria produzidos por confecções verificadas.
            </p>
          </div>
        </div>

        <ul
          className={
            unica
              ? "grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-3 md:gap-4"
              : "grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 [&>li:first-child]:col-span-2 [&>li:first-child]:row-span-2 [&>li:last-child]:col-span-2 md:[&>li:last-child]:col-span-1"
          }
        >
          {FOTOS.map((f, i) => (
            <li key={f.src} className="relative group overflow-hidden rounded-xl bg-gray-100">
              <BotaoIrParaPedido className="block w-full h-full text-left" aria-label={`Fazer pedido: ${f.rotulo}`}>
                <Image
                  src={f.src}
                  alt={f.alt}
                  width={f.largura}
                  height={f.altura}
                  sizes={i === 0 ? "(min-width: 768px) 66vw, 100vw" : "(min-width: 768px) 33vw, 50vw"}
                  className={`w-full ${unica ? "h-auto" : "h-full object-cover object-top aspect-square"} transition-transform duration-500 group-hover:scale-[1.03]`}
                />
                {/* Rótulo discreto no rodapé da foto; o botão central aparece no hover
                    (desktop) e fica sempre visível no toque (mobile não tem hover). */}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-8 text-white text-xs md:text-sm font-medium">
                  {f.rotulo}
                </span>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors">
                  <span className="bg-[#1D9E75] text-white text-xs md:text-sm font-medium px-4 py-2 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                    Fazer pedido →
                  </span>
                </span>
              </BotaoIrParaPedido>
            </li>
          ))}

          {unica && (
            <li className="flex flex-col justify-center rounded-xl bg-[#F7F8F9] border border-gray-200 p-6 md:p-8">
              <p className="text-gray-900 font-medium md:text-lg leading-snug">
                Uniformes, camisetas personalizadas, fitness, moda praia e marca própria.
              </p>
              <p className="text-gray-500 text-sm mt-2 leading-relaxed">
                Descreva a peça, a gente gera o mockup e manda pra confecção certa. Você só paga se aprovar o orçamento.
              </p>
              <BotaoIrParaPedido className="mt-5 inline-flex w-fit bg-[#1D9E75] hover:bg-[#178a64] text-white text-sm font-medium px-5 py-2.5 rounded-full transition-colors" />
            </li>
          )}
        </ul>

        {!unica && (
          <div className="flex justify-center mt-6 md:mt-8">
            <BotaoIrParaPedido className="bg-[#1D9E75] hover:bg-[#178a64] text-white text-sm font-medium px-6 py-3 rounded-full transition-colors" />
          </div>
        )}
      </div>
    </section>
  );
}
