import Link from "next/link";
import BotaoIrParaPedido from "@/app/components/BotaoIrParaPedido";

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
      {/* Discreto de propósito (03/09): a primeira versão tinha 8 cards altos
          empilhados no mobile e ficou pesada. Agora é uma grade compacta de
          2 colunas no celular, 4 no desktop, com a descrição só no desktop. */}
      <section className="bg-white px-6 py-10 md:py-14 border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-gray-900 text-lg md:text-2xl font-medium mb-2">
            O que você pode produzir na Confeccione
          </h2>
          <p className="text-gray-500 text-xs md:text-sm max-w-2xl mb-6 leading-relaxed">
            Confecção de uniformes, fábrica de camisetas, private label, fitness, moda praia e
            terceirização de costura: um único pedido chega a fornecedores verificados que já
            produzem o seu tipo de peça.
          </p>
          <ul className="grid gap-2 md:gap-3 grid-cols-2 lg:grid-cols-4">
            {SEGMENTOS.map((s) => (
              <li key={s.titulo}>
                <BotaoIrParaPedido
                  className="group w-full h-full text-left border border-gray-200 rounded-xl px-3.5 py-3 md:p-4 hover:border-[#1D9E75] hover:bg-[#F7FBF9] transition-colors"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-gray-900 text-sm font-medium leading-snug">{s.titulo}</span>
                    <span className="text-[#1D9E75] text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true">→</span>
                  </span>
                  <span className="hidden md:block text-gray-500 text-xs leading-relaxed mt-1.5">{s.desc}</span>
                </BotaoIrParaPedido>
              </li>
            ))}
          </ul>
        </div>
      </section>

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
    </>
  );
}
