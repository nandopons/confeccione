// app/fornecedor/painel/portfolio/page.tsx
// Vitrine do fornecedor (03/09/2026). A infra (bucket + tabela + API) já
// existia desde o app mobile, mas nunca teve tela na web — a tabela estava
// zerada. Esta página é a ponta que faltava.

import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import { getPortfolio } from "@/app/lib/portfolio-fornecedor";
import { provedorFundoConfigurado } from "@/app/lib/remover-fundo";
import PortfolioFornecedor from "./PortfolioFornecedor";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const fornecedor = await exigirFornecedorAtual();
  const fotos = await getPortfolio(fornecedor.id);
  // Sem provedor configurado o botão de recorte nem aparece — melhor não ter o
  // botão do que ter um que sempre falha.
  const recorteDisponivel = provedorFundoConfigurado() !== null;

  return (
    <section className="px-5 md:px-8 pt-8 pb-24 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-2xl font-medium mb-1">Meu portfólio</h1>
        <p className="text-gray-500 text-sm leading-relaxed max-w-xl">
          Mostre o que você já produziu. Pode mandar a foto direto do celular — a gente ajusta o
          tamanho e o enquadramento automaticamente.
        </p>
      </div>

      <PortfolioFornecedor inicial={fotos} recorteDisponivel={recorteDisponivel} />

      <div className="mt-8 bg-[#F7FBF9] border border-[#E1F5EE] rounded-2xl p-5">
        <p className="text-gray-900 text-sm font-medium mb-2">Dicas para uma boa foto</p>
        <ul className="text-gray-600 text-sm space-y-1.5 leading-relaxed list-disc pl-5">
          <li>Peça sozinha, em cabide ou vestida — evite mesa bagunçada ao fundo.</li>
          <li>Luz natural, sem flash. Perto da janela costuma bastar.</li>
          <li>Uma foto por modelo. Se quiser mostrar detalhe (gola, costura, estampa), mande junto.</li>
          <li>Não coloque texto, preço ou marca d&apos;água sobre a foto.</li>
          <li>
            Se o corte não ficou bom, passe o dedo (ou o mouse) na foto e use{" "}
            <strong>Cima / Meio / Baixo</strong> para escolher que parte da imagem fica no quadro.
          </li>
          <li>Depois de enviar, use &quot;Remover fundo&quot; pra deixar a peça no fundo padrão da vitrine. Funciona melhor com a peça inteira; em close de detalhe, confira antes de manter — dá pra voltar ao original a qualquer momento.</li>
        </ul>
      </div>
    </section>
  );
}
