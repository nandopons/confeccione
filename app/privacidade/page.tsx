import type { Metadata } from "next";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";

export const metadata: Metadata = {
  title: "Política de Privacidade | Confeccione",
  description:
    "Como a Confeccione coleta, usa e protege os seus dados pessoais, em conformidade com a LGPD.",
};

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] font-sans flex flex-col">
      <SiteHeader />

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-white text-3xl md:text-4xl font-medium mb-4">
          Política de Privacidade
        </h1>
        <p className="text-gray-500 text-sm mb-10">
          Última atualização: 5 de julho de 2026
        </p>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">Quem somos</h2>
          <p className="text-gray-400 leading-relaxed">
            A Confeccione (CNPJ 49.307.439/0001-50) é um marketplace brasileiro
            que conecta clientes que precisam fabricar roupas a fornecedores de
            confecção. Esta política explica como coletamos, usamos e protegemos
            os seus dados pessoais quando você usa o site confeccione.com.br e os
            nossos canais de atendimento, em conformidade com a Lei Geral de
            Proteção de Dados (Lei nº 13.709/2018 — LGPD).
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">
            Dados que coletamos
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Coletamos os dados que você nos fornece ao fazer um pedido, solicitar
            um orçamento, se cadastrar como fornecedor ou falar com a gente:
            nome, telefone/WhatsApp, e-mail, cidade e endereço de entrega, dados
            da empresa (quando aplicável) e as informações do pedido (tipo de
            peça, quantidades, tamanhos, artes e referências enviadas). Também
            registramos as mensagens trocadas nos nossos canais de atendimento,
            incluindo o WhatsApp oficial da Confeccione, e dados técnicos básicos
            de navegação (como cookies essenciais e estatísticas de uso do site).
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">
            Como usamos os seus dados
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Usamos os dados para operar o serviço: conectar o seu pedido a
            fornecedores compatíveis, gerar orçamentos e cobranças, acompanhar a
            produção e a entrega, prestar atendimento pelo WhatsApp e por
            e-mail, e melhorar o funcionamento da plataforma. Bases legais:
            execução de contrato ou de procedimentos preliminares a pedido do
            titular, cumprimento de obrigação legal e legítimo interesse, sempre
            respeitando os seus direitos.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">
            Compartilhamento
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Compartilhamos apenas o necessário: com fornecedores de confecção
            parceiros, para viabilizar o seu pedido (por exemplo, contato e
            especificações da peça após o aceite); e com operadores que dão
            suporte à plataforma, como provedores de infraestrutura e
            hospedagem, meios de pagamento e a plataforma WhatsApp Business
            (Meta) usada no atendimento oficial. Não vendemos os seus dados
            pessoais.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">
            Armazenamento e segurança
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Os dados são armazenados em serviços de nuvem com controles de
            acesso restritos e comunicação criptografada. Mantemos os dados pelo
            tempo necessário para as finalidades desta política e para o
            cumprimento de obrigações legais, e depois os excluímos ou
            anonimizamos.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">
            Seus direitos
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Nos termos da LGPD, você pode solicitar a confirmação de tratamento,
            o acesso, a correção, a anonimização, a portabilidade ou a exclusão
            dos seus dados, além de revogar consentimentos. Para exercer esses
            direitos, fale com a gente pelo e-mail{" "}
            <a
              href="mailto:contato@confeccione.com.br"
              className="text-emerald-400 hover:underline"
            >
              contato@confeccione.com.br
            </a>
            .
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-white text-xl font-medium mb-3">
            Atualizações desta política
          </h2>
          <p className="text-gray-400 leading-relaxed">
            Podemos atualizar esta política para refletir mudanças no serviço ou
            na legislação. A versão vigente estará sempre disponível nesta
            página, com a data da última atualização indicada no topo.
          </p>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
