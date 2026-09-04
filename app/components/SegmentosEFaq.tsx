import Link from "next/link";

// FAQ da home (03/09/2026), em acordeão fechado pra não pesar. Alimenta o
// JSON-LD FAQPage em app/page.tsx — mantenha os dois iguais. A grade de
// segmentos em texto que existia aqui virou a galeria (GaleriaProdutos).

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
    <section className="bg-[#F7F8F9] px-6 py-10 md:py-14">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-gray-900 text-lg md:text-2xl font-medium mb-4 md:mb-6">Perguntas frequentes</h2>
        <div className="divide-y divide-gray-200 border-y border-gray-200">
          {FAQ_HOME.map((f) => (
            <details key={f.pergunta} className="group py-3.5">
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-gray-900 text-sm md:text-base font-medium [&::-webkit-details-marker]:hidden">
                {f.pergunta}
                <span className="text-gray-400 text-lg leading-none transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="text-gray-500 text-sm leading-relaxed mt-2 pr-8">{f.resposta}</p>
            </details>
          ))}
        </div>
        <p className="text-gray-500 text-xs md:text-sm mt-6">
          Mais sobre produção, estampa e marca própria em{" "}
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
  );
}
