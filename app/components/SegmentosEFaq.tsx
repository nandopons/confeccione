import Link from "next/link";

// Seção server-rendered da home (03/09/2026). Antes, a home tinha ~120 palavras
// de texto e não citava nenhum termo pelo qual o negócio é procurado
// ("confecção de uniformes", "fábrica de camisetas", "private label"...).
// Os cards linkam pro formulário; quando existirem páginas de serviço por
// segmento (/confeccao-de-uniformes etc.), troca o href aqui.
// O FAQ alimenta o JSON-LD FAQPage em app/page.tsx — mantenha os dois iguais.

const SEGMENTOS: Array<{ titulo: string; desc: string; busca: string }> = [
  {
    titulo: "Uniformes e fardamento",
    desc: "Camisas, polos e fardas para empresas, clínicas, restaurantes e equipes de campo.",
    busca: "confecção de uniformes",
  },
  {
    titulo: "Camisetas personalizadas",
    desc: "Fábrica de camisetas no atacado com silk, DTF ou sublimação, do lote pequeno à tiragem grande.",
    busca: "fábrica de camisetas",
  },
  {
    titulo: "Private label e marca própria",
    desc: "Fabricante de roupas para a sua marca: modelagem, piloto, etiqueta e produção com o seu nome.",
    busca: "private label roupas",
  },
  {
    titulo: "Roupas fitness",
    desc: "Leggings, tops e camisetas dry em suplex, poliamida e poliéster com costura reforçada.",
    busca: "confecção de roupas fitness",
  },
  {
    titulo: "Eventos, escolas e interclasse",
    desc: "Camisas de turma, formatura, corrida, igreja e eventos corporativos com arte pronta em dias.",
    busca: "camisetas para eventos",
  },
  {
    titulo: "Moda praia e íntima",
    desc: "Biquínis, maiôs, sungas e lingerie com confecções especializadas em elastano e forro.",
    busca: "fábrica de moda praia",
  },
  {
    titulo: "Padrão esportivo",
    desc: "Uniformes de futebol, vôlei e times amadores com sublimação total e numeração.",
    busca: "uniforme esportivo personalizado",
  },
  {
    titulo: "Facção e terceirização de costura",
    desc: "Já tem tecido cortado ou modelagem pronta? Encontre facções para costurar em escala.",
    busca: "facção de costura",
  },
];

export const FAQ_HOME: Array<{ pergunta: string; resposta: string }> = [
  {
    pergunta: "Como funciona a Confeccione?",
    resposta:
      "Você descreve o que precisa produzir (tipo de peça, tecido, quantidade e arte) pelo site ou pelo WhatsApp. A Confeccione gera os mockups, oferece o pedido a confecções verificadas e o fornecedor que assume monta o orçamento. Você só paga se aprovar.",
  },
  {
    pergunta: "Tem pedido mínimo?",
    resposta:
      "Cada fornecedor define o próprio pedido mínimo, de poucas peças a centenas. Na hora de ofertar, a Confeccione já filtra quem aceita a quantidade que você precisa, então você recebe orçamento só de quem consegue produzir o seu lote.",
  },
  {
    pergunta: "Qual é o prazo de produção?",
    resposta:
      "O prazo é informado no orçamento e começa a contar a partir da confirmação do pagamento. Em geral varia de 7 a 30 dias, conforme a quantidade, o tipo de peça e o acabamento (estampa, bordado, tingimento).",
  },
  {
    pergunta: "Como funciona o pagamento garantido?",
    resposta:
      "O pagamento é feito à Confeccione por PIX ou cartão e fica retido. O fornecedor só recebe depois que a produção é entregue conforme o combinado. Se houver problema, a Confeccione media e pode reembolsar total ou parcialmente.",
  },
  {
    pergunta: "Quem são os fornecedores?",
    resposta:
      "Confecções, facções, ateliês e costureiras de todo o Brasil, com cadastro analisado pela equipe da Confeccione antes de receber pedidos. Muitos ficam no polo têxtil de Pernambuco (Recife e Agreste), mas atendemos e entregamos em todo o país.",
  },
  {
    pergunta: "Atende todo o Brasil?",
    resposta:
      "Sim. O pedido é feito online, a produção acontece na confecção que assumir e a entrega é enviada para o seu endereço em qualquer estado.",
  },
];

export default function SegmentosEFaq() {
  return (
    <>
      <section className="bg-white px-6 py-16 border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-gray-900 text-2xl md:text-3xl font-medium mb-3">
            O que você pode produzir na Confeccione
          </h2>
          <p className="text-gray-500 text-sm md:text-base max-w-2xl mb-10 leading-relaxed">
            Confecção de uniformes, fábrica de camisetas, private label, fitness, moda praia e
            terceirização de costura: um único pedido chega a fornecedores verificados que já
            produzem o seu tipo de peça.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SEGMENTOS.map((s) => (
              <li key={s.titulo}>
                <Link
                  href="/#pedido"
                  className="block h-full border border-gray-200 rounded-2xl p-5 hover:border-[#1D9E75] transition-colors"
                >
                  <h3 className="text-gray-900 font-medium mb-1.5">{s.titulo}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
                  <span className="mt-3 inline-block text-xs text-[#0F6E56] font-medium">
                    Pedir orçamento →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-[#F7F8F9] px-6 py-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-gray-900 text-2xl md:text-3xl font-medium mb-8">Perguntas frequentes</h2>
          <dl className="divide-y divide-gray-200 border-y border-gray-200">
            {FAQ_HOME.map((f) => (
              <div key={f.pergunta} className="py-5">
                <dt className="text-gray-900 font-medium mb-2">{f.pergunta}</dt>
                <dd className="text-gray-500 text-sm leading-relaxed">{f.resposta}</dd>
              </div>
            ))}
          </dl>
          <p className="text-gray-500 text-sm mt-8">
            Quer saber mais sobre produção, estampa e marca própria? Leia os guias em{" "}
            <Link href="/saiba-mais" className="text-[#0F6E56] font-medium hover:underline">
              Saiba mais
            </Link>
            . É confecção, facção ou costureira?{" "}
            <Link href="/fornecedor/cadastro" className="text-[#0F6E56] font-medium hover:underline">
              Cadastre-se para receber pedidos
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
