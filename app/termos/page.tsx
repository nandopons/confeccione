import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Regras de uso da plataforma Confeccione para clientes e fornecedores: intermediação, pagamento garantido, comissão, prazos, cancelamentos e planos.",
  alternates: { canonical: "/termos" },
  openGraph: {
    type: "website",
    url: "/termos",
    title: "Termos de Uso | Confeccione",
    description:
      "Regras da plataforma para clientes e fornecedores: intermediação, pagamento garantido, comissão, prazos, cancelamentos e planos.",
  },
  robots: { index: true, follow: true },
};

// Rascunho escrito a partir do que o sistema faz hoje (set/2026). Revisar com
// advogado antes de tratar como contrato definitivo. Números (comissão, planos,
// trocas) espelham app/lib/planos.ts, orcamento.ts e solicitar-outro.

const h2 = "text-white text-xl font-medium mb-3";
const p = "text-gray-400 leading-relaxed";
const li = "text-gray-400 leading-relaxed";

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] font-sans flex flex-col">
      <SiteHeader />

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-white text-3xl md:text-4xl font-medium mb-4">Termos de Uso</h1>
        <p className="text-gray-500 text-sm mb-10">Última atualização: 3 de setembro de 2026</p>

        <section className="mb-10">
          <h2 className={h2}>1. O que é a Confeccione</h2>
          <p className={p}>
            A Confeccione (CNPJ 49.307.439/0001-50, Travessa do Amorim, 66, Recife/PE, CEP 50030-070) é uma plataforma de intermediação que
            conecta pessoas e empresas que precisam produzir roupas e acessórios (&quot;clientes&quot;) a
            confecções, facções, ateliês e costureiras (&quot;fornecedores&quot;). A Confeccione não fabrica
            as peças: quem produz é o fornecedor que assume o pedido. Ao usar o site confeccione.com.br,
            os painéis de cliente e de fornecedor e os nossos canais de atendimento, você concorda com
            estes Termos e com a nossa{" "}
            <Link href="/privacidade" className="text-[#1D9E75] hover:underline">Política de Privacidade</Link>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2}>2. Como funciona um pedido</h2>
          <ul className="space-y-2 list-disc pl-5">
            <li className={li}>O cliente descreve o que quer produzir (modelos, cores, tecidos, quantidades e artes) pelo site ou pelo WhatsApp e confirma o pedido.</li>
            <li className={li}>A Confeccione oferece o pedido a fornecedores cadastrados. O primeiro que aceitar assume a produção e recebe o contato do cliente para alinhar detalhes.</li>
            <li className={li}>Cliente e fornecedor podem ajustar os produtos do pedido (material, grade, quantidades, incluir ou remover itens) até o orçamento ser aprovado. Toda alteração é registrada e avisada ao outro lado.</li>
            <li className={li}>O fornecedor define o orçamento final (produtos e frete) pela plataforma. O cliente só paga se aprovar. Pode recusar o orçamento ou pedir outro fornecedor.</li>
            <li className={li}>O prazo de produção informado conta a partir da confirmação do pagamento, não da data do pedido.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className={h2}>3. Pagamento garantido</h2>
          <p className={p}>
            O cliente paga à Confeccione, por PIX ou cartão, através do nosso parceiro de pagamentos. O
            valor fica retido e é repassado ao fornecedor depois da entrega em conformidade com o que foi
            combinado no pedido. Se o fornecedor não entregar, ou entregar em desacordo e não corrigir, a
            Confeccione media a solução, que pode incluir reembolso total ou parcial ao cliente. Orçamentos,
            pagamentos e combinações feitos fora da plataforma não têm essa garantia nem o nosso suporte.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2}>4. Comissão e repasse</h2>
          <p className={p}>
            A Confeccione retém 3% (três por cento) do valor dos produtos como comissão de intermediação.
            O restante, mais o frete, é o repasse do fornecedor, exibido a ele antes de aceitar o pedido e
            no orçamento. O repasse é feito por PIX na conta cadastrada pelo fornecedor após a confirmação
            da entrega. A nota fiscal da produção é responsabilidade do fornecedor, conforme o regime
            tributário dele; a Confeccione emite nota da sua comissão.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2}>5. Cancelamentos e troca de fornecedor</h2>
          <ul className="space-y-2 list-disc pl-5">
            <li className={li}>Antes do pagamento, o cliente pode cancelar o pedido a qualquer momento pelo visualizador. Depois do pagamento, o cancelamento depende de acordo, porque a produção pode já ter começado.</li>
            <li className={li}>O cliente pode pedir outro fornecedor enquanto o pedido não estiver pago. No plano gratuito, até 2 trocas por pedido.</li>
            <li className={li}>O fornecedor pode recusar uma oferta. Depois de aceitar, deve seguir com a produção; abandonar pedidos aceitos ou não responder ao cliente pode levar à pausa ou exclusão do cadastro.</li>
            <li className={li}>Pedidos sem resposta do cliente por muito tempo podem ser encerrados pela Confeccione.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className={h2}>6. Fornecedores: cadastro e planos</h2>
          <ul className="space-y-2 list-disc pl-5">
            <li className={li}>O cadastro é gratuito. A Confeccione aprova cada fornecedor antes de ofertar pedidos e pode pedir documentos, fotos de produção e referências.</li>
            <li className={li}>O plano Free inclui 3 pedidos por mês; os planos Starter (R$ 89/mês, 10 pedidos) e Pro (R$ 199/mês, 30 pedidos) ampliam esse limite. Pedidos extras podem ser comprados avulsos. Novos cadastros ganham um período de teste. Valores e limites vigentes estão na área do fornecedor.</li>
            <li className={li}>Assinaturas são cobradas mensalmente e podem ser canceladas a qualquer momento, valendo até o fim do período pago.</li>
            <li className={li}>O fornecedor responde pela qualidade, prazo, embalagem e envio das peças, e por manter atualizados seus dados de contato, endereço e conta para repasse.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className={h2}>7. Conteúdo, artes e propriedade</h2>
          <p className={p}>
            Artes, logos, fotos e mockups enviados pelo cliente continuam sendo dele. Ele garante que tem o
            direito de usá-los e responde por qualquer violação de marca ou direito autoral. O fornecedor
            só pode usar esse material para produzir o pedido. As imagens geradas pela plataforma como
            pré-visualização são ilustrativas e não substituem a peça-piloto quando combinada.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2}>8. Comunicação</h2>
          <p className={p}>
            Ao informar seu WhatsApp ou e-mail, você aceita receber mensagens sobre o seu pedido, ofertas de
            produção (fornecedores) e lembretes de pedidos em andamento. Você pode pedir para parar de
            receber lembretes a qualquer momento respondendo à mensagem ou falando com o suporte.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2}>9. Responsabilidades e limites</h2>
          <p className={p}>
            A Confeccione se compromete a intermediar com transparência e a manter o pagamento garantido
            nos termos acima. Não responde por atrasos de transportadora, por informações incorretas
            fornecidas pelas partes, nem por combinações feitas fora da plataforma. Podemos suspender
            contas que usem a plataforma de má-fé, tentem contornar o pagamento garantido ou desrespeitem
            outros usuários.
          </p>
        </section>

        <section className="mb-10">
          <h2 className={h2}>10. Alterações e contato</h2>
          <p className={p}>
            Estes Termos podem ser atualizados; a data no topo indica a versão vigente e mudanças
            relevantes são comunicadas pelos nossos canais. Dúvidas: contato@confeccione.com.br ou
            WhatsApp (81) 99593-2695. Foro de Recife/PE para qualquer questão relativa a estes Termos.
          </p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
