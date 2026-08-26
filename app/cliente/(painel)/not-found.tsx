// app/cliente/(painel)/not-found.tsx
// ============================================================================
// 26/08/2026 — `pedido/[id]/page.tsx` chama `notFound()` quando o pedido não
// é do cliente logado (ou não existe). Sem este arquivo isso caía na 404
// padrão do Next: em inglês, sem link de volta, sem contato.
//
// O caso mais comum não é link quebrado — é a pessoa ter feito o pedido com
// um e-mail e entrado com outro (`app/lib/cliente-pedidos.ts` casa por
// e-mail). Por isso o texto fala disso em vez de "página não encontrada".
// ============================================================================

import Link from "next/link";
import { linkWhatsAppSuporte } from "@/app/lib/contatos";

export default function PedidoNaoEncontrado() {
  return (
    <section className="px-5 md:px-8 pt-12 pb-24 max-w-lg mx-auto">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="w-12 h-12 bg-[#E1F5EE] rounded-full flex items-center justify-center mb-4 text-2xl">
          🔎
        </div>
        <h1 className="text-gray-900 text-lg font-medium mb-2">
          Não achamos esse pedido nesta conta
        </h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-2">
          Ou o endereço está errado, ou o pedido foi feito com{" "}
          <strong>outro e-mail</strong>. A gente liga seus pedidos ao e-mail que
          você usou na hora de pedir.
        </p>
        <p className="text-gray-500 text-sm leading-relaxed mb-5">
          Se foi outro e-mail, entre com ele — os pedidos aparecem lá.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Link
            href="/cliente/painel"
            className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium rounded-xl px-5 py-3 text-center transition-colors"
          >
            Ver meus pedidos
          </Link>
          <Link
            href="/cliente/login"
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm rounded-xl px-5 py-3 text-center transition-colors"
          >
            Entrar com outro e-mail
          </Link>
        </div>

        <p className="text-xs text-gray-400 mt-5 leading-relaxed">
          Não lembra qual e-mail usou? Chama a gente no{" "}
          <a
            href={linkWhatsAppSuporte("Oi! Não estou achando meu pedido no painel.")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0F6E56] font-medium hover:underline"
          >
            WhatsApp
          </a>{" "}
          que a gente localiza.
        </p>
      </div>
    </section>
  );
}
