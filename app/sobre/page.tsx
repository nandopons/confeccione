import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import PortoDigitalBadge from "@/app/components/PortoDigitalBadge";

export const metadata: Metadata = {
  title: "Sobre a Confeccione",
  description:
    "Marketplace brasileiro de confecção. Empresa embarcada no Porto Digital. CNPJ 49.307.439/0001-50.",
  openGraph: {
    title: "Sobre a Confeccione",
    description:
      "Marketplace brasileiro de confecção, empresa embarcada no Porto Digital.",
    type: "website",
  },
};

export default function SobrePage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] font-sans flex flex-col">
      <SiteHeader />

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-white text-3xl md:text-4xl font-medium mb-10">
          Sobre a Confeccione
        </h1>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-3">O que é</h2>
          <p className="text-gray-400 leading-relaxed">
            A Confeccione é um marketplace brasileiro que conecta clientes que precisam
            fabricar roupa a fornecedores de confecção compatíveis. O matching considera
            tipo de peça, quantidade, prazo e localização — e o pedido é oferecido
            automaticamente ao fornecedor certo.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-4">
            Como funciona em três passos
          </h2>
          <ol className="text-gray-400 leading-relaxed list-decimal list-inside space-y-2">
            <li>Cliente faz o pedido em minutos pelo site.</li>
            <li>Sistema encontra fornecedores compatíveis e envia a oferta no WhatsApp deles.</li>
            <li>Fornecedor aceita, e o contato é liberado para o cliente.</li>
          </ol>
          <p className="text-gray-400 leading-relaxed mt-4">
            Tudo automatizado, com follow-ups inteligentes, sem ligações cegas, sem
            orçamentos perdidos.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-5">
            Ecossistema e reconhecimento
          </h2>
          <div className="mb-6">
            <PortoDigitalBadge variant="inline" />
          </div>
          <p className="text-gray-400 leading-relaxed mb-6">
            A Confeccione é empresa embarcada no Porto Digital, distrito de inovação
            de Recife/PE, reconhecido três vezes pela ANPROTEC como o melhor ambiente
            de inovação do Brasil.
          </p>
          <Link
            href="/porto-digital"
            className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-medium px-6 py-3 rounded-xl transition-colors"
          >
            Saiba mais sobre nossa relação com o Porto Digital →
          </Link>
        </section>

        <section className="mb-12">
          <h2 className="text-white text-xl font-medium mb-3">Dados institucionais</h2>
          <ul className="text-gray-400 leading-relaxed space-y-1">
            <li>CNPJ: 49.307.439/0001-50</li>
            <li>Sede: Travessa do Amorim, 66 — Recife, PE — 50030-070</li>
            <li>Marca registrada no INPI</li>
          </ul>
        </section>

        <section>
          <h2 className="text-white text-xl font-medium mb-3">Contato</h2>
          <ul className="text-gray-400 leading-relaxed space-y-1">
            <li>
              <a
                href="mailto:contato@confeccione.com.br"
                className="hover:text-white transition-colors"
              >
                contato@confeccione.com.br
              </a>
            </li>
            <li>(81) 99593-2695 (WhatsApp)</li>
          </ul>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
