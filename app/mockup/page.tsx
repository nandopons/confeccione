import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import MockupStudio from "./MockupStudio";

export const metadata = {
  title: "Monte seu mockup | Confeccione",
  description:
    "Visualize sua arte ou logomarca em qualquer peça com a ajuda da nossa IA. Monte o mockup e transforme em pedido.",
};

export default function MockupPage() {
  return (
    <main className="min-h-screen bg-white font-sans">
      <section className="bg-[#0a0a0a]">
        <SiteHeader />
        <div className="max-w-5xl mx-auto px-6 pt-10 pb-12 md:pt-14 md:pb-16">
          <span className="bg-[#1D9E75]/20 text-[#2DD4A7] text-xs font-medium px-3 py-1 rounded-full">
            Novo
          </span>
          <h1 className="text-white font-semibold text-2xl md:text-4xl leading-tight tracking-tight mt-4">
            Monte seu mockup com a nossa IA
          </h1>
          <p className="text-gray-400 text-sm md:text-base leading-relaxed mt-3 max-w-2xl">
            Envie sua logomarca ou arte, converse com o assistente pra escolher a peça,
            a cor e onde a arte vai — e veja o mockup ganhar forma. Quando gostar, é só
            transformar em pedido.
          </p>
        </div>
      </section>

      <MockupStudio />

      <SiteFooter />
    </main>
  );
}
