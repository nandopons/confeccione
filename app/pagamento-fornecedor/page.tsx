// app/pagamento-fornecedor/page.tsx
// ============================================================================
// COMO A CONFECÇÃO RECEBE — página pública, voltada pra quem vai costurar.
//
// POR QUE ISTO EXISTE (10/09/2026)
// A pergunta que mais trava confecção nova não é preço nem prazo: é "quando eu
// recebo?". Ela compra tecido antes de costurar, então "pagamento após a
// entrega" significa financiar o pedido do próprio bolso. A Vanessa disse com
// todas as letras — "costumo trabalhar pedindo 30% de sinal, a plataforma
// aceita?" — e emendou "na plataforma diz que o pagamento é somente depois do
// envio", que era a única informação pública que existia.
//
// Sem uma página, essa resposta vivia só na conversa: cada confecção ouvia uma
// versão, e o Luigi tinha que improvisar em cima de uma regra comercial. Agora
// tem um lugar único, que ele cita em vez de reformular.
//
// O QUE ESTA PÁGINA NÃO DIZ: a comissão da Confeccione em número, e qualquer
// condição que dependa de negociação. Acima de R$ 10.000 é caso a caso de
// propósito — prometer em público o que depende do fluxo de caixa é como se
// cria dívida que não dá pra pagar.
// ============================================================================

import type { Metadata } from 'next'
import Link from 'next/link'
import SiteHeader from '@/app/components/SiteHeader'
import SiteFooter from '@/app/components/SiteFooter'

export const metadata: Metadata = {
  alternates: { canonical: '/pagamento-fornecedor' },
  title: 'Como a confecção recebe na Confeccione: pagamento e garantias',
  description:
    'Metade no fechamento do pedido e metade na entrega, para confecções verificadas em pedidos de até R$ 10.000. Como funciona a garantia do valor final.',
  openGraph: {
    type: 'website',
    url: '/pagamento-fornecedor',
    title: 'Como a confecção recebe na Confeccione',
    description:
      'Metade no fechamento e metade na entrega, para confecções verificadas em pedidos de até R$ 10.000.',
  },
}

const CARD = 'rounded-xl border border-white/10 bg-white/[0.03] p-6'

export default function PagamentoFornecedorPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] font-sans flex flex-col">
      <SiteHeader />

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-16">
        <p className="text-[#1D9E75] text-sm font-medium mb-3">Para confecções</p>
        <h1 className="text-white text-3xl md:text-4xl font-medium mb-6">Como você recebe</h1>

        <p className="text-gray-300 leading-relaxed mb-12">
          Você compra tecido antes de costurar. Por isso a gente não trabalha com
          &ldquo;pagamento só depois da entrega&rdquo;: em pedido de até R$ 10.000, metade do
          valor sai quando o pedido é fechado, e a outra metade quando você entrega.
        </p>

        <section className={`${CARD} mb-10`}>
          <h2 className="text-white text-xl font-medium mb-5">Os dois pagamentos</h2>

          <div className="flex gap-4 mb-6">
            <span className="shrink-0 w-12 h-12 rounded-full bg-[#1D9E75]/15 text-[#1D9E75] flex items-center justify-center font-medium">
              50%
            </span>
            <div>
              <p className="text-white font-medium mb-1">No fechamento do pedido</p>
              <p className="text-gray-400 text-sm leading-relaxed">
                Assim que o cliente aprova o seu orçamento e paga, a gente libera
                metade direto na conta cadastrada no seu painel. Você não espera a
                produção terminar pra comprar material.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <span className="shrink-0 w-12 h-12 rounded-full bg-[#1D9E75]/15 text-[#1D9E75] flex items-center justify-center font-medium">
              50%
            </span>
            <div>
              <p className="text-white font-medium mb-1">Na entrega</p>
              <p className="text-gray-400 text-sm leading-relaxed">
                A outra metade é garantida pela Confeccione, desde que a produção
                saia em conformidade com o que está no orçamento do sistema — as
                peças, as quantidades, os tamanhos e os detalhes que você mesma
                registrou lá.
              </p>
            </div>
          </div>
        </section>

        <section className={`${CARD} mb-10`}>
          <h2 className="text-white text-xl font-medium mb-3">
            &ldquo;Em conformidade&rdquo; é o orçamento, não o gosto de ninguém
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-3">
            O que vale é o que está escrito no orçamento que você montou e o
            cliente aprovou. Não é avaliação subjetiva, nem opinião de última hora:
            se o pedido dizia 200 camisetas gola careca em algodão premium, nas
            grades combinadas, e é isso que chega, o valor final é seu.
          </p>
          <p className="text-gray-400 text-sm leading-relaxed">
            Se houver divergência, a Confeccione entra no meio antes de qualquer
            desconto — você é ouvida, e o orçamento é a referência dos dois lados.
            É justamente pra isso que o pedido inteiro fica registrado na
            plataforma.
          </p>
        </section>

        <section className={`${CARD} mb-10`}>
          <h2 className="text-white text-xl font-medium mb-3">Quem tem direito</h2>
          <p className="text-gray-400 text-sm leading-relaxed mb-4">
            Confecções verificadas — as que passaram pela nossa análise de
            cadastro. A verificação é gratuita e leva cerca de um dia útil; é o
            mesmo passo que libera você a receber pedidos.
          </p>
          <p className="text-gray-400 text-sm leading-relaxed">
            <span className="text-white">Acima de R$ 10.000</span>, as condições são
            combinadas caso a caso com a gente, antes de você assumir o pedido.
            Nunca comece uma produção grande sem esse alinhamento.
          </p>
        </section>

        <section className={`${CARD} mb-12`}>
          <h2 className="text-white text-xl font-medium mb-4">O que a gente nunca faz</h2>
          <ul className="text-gray-400 text-sm leading-relaxed space-y-2">
            <li>— Cobrar de você pra entrar, pra receber pedido ou pra aparecer melhor.</li>
            <li>— Pedir dinheiro seu em qualquer hipótese. Se alguém pedir em nosso nome, não é a gente.</li>
            <li>— Passar seu contato pro cliente antes do pedido fechado.</li>
            <li>— Mudar o valor combinado depois que o orçamento foi aprovado.</li>
          </ul>
        </section>

        <div className="text-center">
          <p className="text-gray-400 text-sm mb-5">
            Ficou alguma dúvida sobre pagamento? Fale com a gente antes de assumir
            um pedido — a resposta é sempre a mesma, e por escrito.
          </p>
          <Link
            href="/fornecedor/cadastro"
            className="inline-block bg-[#1D9E75] hover:bg-[#178A65] text-white font-medium px-6 py-3 rounded-xl text-sm transition-colors"
          >
            Cadastrar minha confecção
          </Link>
        </div>
      </div>

      <SiteFooter />
    </main>
  )
}
