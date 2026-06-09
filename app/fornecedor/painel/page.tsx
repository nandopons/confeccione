// app/fornecedor/painel/page.tsx
// Dashboard do fornecedor — modelo novo (jun/2026). Sem cota/plano.
import Link from "next/link";
import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import {
  pedidosPendentesFornecedor,
  pedidosAceitosFornecedor,
  carteiraFornecedor,
} from "@/app/lib/fornecedor-pedidos";

export const dynamic = "force-dynamic";

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function PainelDashboard() {
  const fornecedor = await exigirFornecedorAtual();
  const [pendentes, aceitos, carteira] = await Promise.all([
    pedidosPendentesFornecedor(fornecedor.id),
    pedidosAceitosFornecedor(fornecedor.id),
    carteiraFornecedor(fornecedor.id),
  ]);
  const inativo = fornecedor.status === "inativo";
  const nPend = pendentes.length;

  return (
    <section className="px-5 md:px-8 pt-8 pb-24 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-2xl font-medium mb-1">Olá, {primeiroNome(fornecedor.nome)}!</h1>
        <p className="text-gray-500 text-sm">Aqui é seu resumo de hoje.</p>
      </div>

      {inativo && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⏸</div>
            <div>
              <div className="text-orange-900 font-medium mb-1">Sua conta está pausada</div>
              <p className="text-orange-800 text-sm leading-relaxed">
                Enquanto pausada, você não recebe pedidos novos. Pra reativar, fale com a Confeccione.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Card grande: pedidos pendentes */}
      <Link
        href="/fornecedor/painel/pedidos"
        className="block bg-white border border-gray-200 rounded-2xl p-6 mb-4 hover:border-[#1D9E75] transition-colors"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-1">Esperando sua resposta</div>
            {nPend === 0 ? (
              <>
                <div className="text-gray-900 text-2xl font-medium mb-1">Nenhum pedido agora</div>
                <div className="text-gray-500 text-sm">A gente avisa por WhatsApp e e-mail quando chegar um pedido pra você.</div>
              </>
            ) : (
              <>
                <div className="text-gray-900 text-3xl font-medium mb-1">{nPend} {nPend === 1 ? "pedido" : "pedidos"}</div>
                <div className="text-[#0F6E56] text-sm font-medium">Toque para responder →</div>
              </>
            )}
          </div>
          {nPend > 0 && (
            <div className="bg-[#E1F5EE] rounded-2xl p-3 flex-shrink-0">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          )}
        </div>
      </Link>

      {/* Cards menores: carteira + aceitos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/fornecedor/painel/carteira" className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition-colors">
          <div className="text-xs text-gray-400 mb-1">A receber</div>
          <div className="text-gray-900 text-2xl font-medium">{brl(carteira.saldoAReceberCentavos)}</div>
          <div className="text-xs text-gray-500 mt-1">Ver carteira →</div>
        </Link>
        <Link href="/fornecedor/painel/pedidos" className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition-colors">
          <div className="text-xs text-gray-400 mb-1">Pedidos assumidos</div>
          <div className="text-gray-900 text-2xl font-medium">{aceitos.length}</div>
          <div className="text-xs text-gray-500 mt-1">Ver pedidos →</div>
        </Link>
      </div>
    </section>
  );
}

function primeiroNome(nome: string): string {
  return (nome || "").split(" ")[0] || nome;
}
