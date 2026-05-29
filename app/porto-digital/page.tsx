import type { Metadata } from "next";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import PortoDigitalBadge from "@/app/components/PortoDigitalBadge";

export const metadata: Metadata = {
  title: "Confeccione é empresa embarcada no Porto Digital",
  description:
    "A Confeccione integra o ecossistema do Porto Digital, distrito de inovação tecnológica de Recife/PE.",
  openGraph: {
    title: "Confeccione é empresa embarcada no Porto Digital",
    description:
      "A Confeccione integra o ecossistema do Porto Digital, distrito de inovação tecnológica de Recife/PE.",
    type: "website",
  },
};

export default function PortoDigitalPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] font-sans flex flex-col">
      <SiteHeader />

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-16">
        <div className="flex justify-center mb-10">
          <PortoDigitalBadge variant="hero" />
        </div>

        <h1 className="text-white text-3xl md:text-4xl font-medium text-center mb-8">
          A Confeccione no Porto Digital
        </h1>

        <blockquote className="border-l-2 border-[#1D9E75] pl-5 text-gray-300 leading-relaxed mb-12">
          Em 28 de maio de 2026, a Confeccione foi oficialmente embarcada no
          Porto Digital — distrito de inovação tecnológica de Recife/PE,
          reconhecido três vezes pela ANPROTEC como o melhor ambiente de
          inovação do Brasil.
        </blockquote>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-3">
            O que significa estar embarcada
          </h2>
          <p className="text-gray-400 leading-relaxed">
            A Confeccione integra o ecossistema do Porto Digital, distrito que
            reúne empresas de tecnologia da informação, comunicação e economia
            criativa. A plataforma se posiciona na interseção dessas verticais —
            engenharia de software aplicada ao setor de moda e confecção de
            roupas.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-4">
            O que isso muda para clientes e fornecedores
          </h2>
          <p className="text-gray-300 font-medium mb-2">
            Para clientes que fazem pedidos:
          </p>
          <ul className="text-gray-400 leading-relaxed list-disc list-inside space-y-1 mb-5">
            <li>Credibilidade institucional reforçada da plataforma.</li>
            <li>
              Acesso a uma operação inserida em um ecossistema reconhecido
              nacionalmente.
            </li>
          </ul>
          <p className="text-gray-300 font-medium mb-2">
            Para fornecedores cadastrados:
          </p>
          <ul className="text-gray-400 leading-relaxed list-disc list-inside space-y-1">
            <li>Vínculo da plataforma com um polo tecnológico consolidado.</li>
            <li>
              Maior previsibilidade institucional do negócio que intermedia seus
              pedidos.
            </li>
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-3">Sobre o Porto Digital</h2>
          <p className="text-gray-400 leading-relaxed mb-6">
            O Porto Digital é um dos maiores distritos de inovação tecnológica do
            Brasil. Em 2025, reuniu mais de 540 empresas embarcadas e 24 mil
            colaboradores que, juntos, geraram R$ 7,4 bilhões de faturamento. Foi
            eleito três vezes melhor parque tecnológico do Brasil pela ANPROTEC.
          </p>
          <a
            href="https://www.portodigital.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block border border-white/20 text-white hover:bg-white/10 font-medium px-6 py-3 rounded-xl transition-colors"
          >
            Conheça o Porto Digital →
          </a>
        </section>

        <section>
          <h2 className="text-white text-xl font-medium mb-3">Documentação</h2>
          <p className="text-gray-400 leading-relaxed">
            A Confeccione consta no diretório oficial de empresas embarcadas:{" "}
            <a
              href="https://embarcadas.portodigital.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1D9E75] hover:underline"
            >
              embarcadas.portodigital.org
            </a>
          </p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
