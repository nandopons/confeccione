// app/fornecedor/painel/pagamento/sucesso/page.tsx
// ============================================================================
// Página de retorno pós-checkout. Mostra status do pagamento.
// Query param: ?id=<asaas_payment_id>.
//
// Hoje o fornecedor chega aqui manualmente (botão "Já paguei? Verificar" no
// Modal ou pelo link copiado). TODO #14: configurar successUrl no payload
// Asaas pra Asaas redirecionar automaticamente após o pagamento.
// ============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import { supabaseAdmin } from "@/app/lib/supabase-server";

export const dynamic = "force-dynamic";

type Pagamento = {
  asaas_payment_id: string;
  tipo: string;
  valor_centavos: number;
  status: "pendente" | "pago" | "vencido" | "estornado" | "cancelado";
  metodo: string;
};

const DESCRICAO_POR_TIPO: Record<string, string> = {
  pacote_leads_5: "Pacote de 5 pedidos extras",
  pacote_leads_10: "Pacote de 10 pedidos extras",
  pacote_leads_25: "Pacote de 25 pedidos extras",
  assinatura_starter: "Plano Starter",
  assinatura_pro: "Plano Pro",
};

export default async function PaginaPagamentoSucesso({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const fornecedor = await exigirFornecedorAtual();
  const params = await searchParams;
  const id = params.id;

  if (!id) {
    redirect("/fornecedor/painel/plano");
  }

  const { data: pag } = await supabaseAdmin
    .from("pagamentos_asaas")
    .select("asaas_payment_id, tipo, valor_centavos, status, metodo")
    .eq("asaas_payment_id", id)
    .eq("fornecedor_id", fornecedor.id)
    .maybeSingle<Pagamento>();

  if (!pag) {
    return (
      <section className="px-5 md:px-8 pt-8 pb-12 max-w-2xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <p className="text-gray-700 text-sm mb-4">
            Pagamento não encontrado.
          </p>
          <Link
            href="/fornecedor/painel/plano"
            className="inline-block text-sm text-[#1D9E75] hover:underline"
          >
            ← Voltar pra meu plano
          </Link>
        </div>
      </section>
    );
  }

  const descricao = DESCRICAO_POR_TIPO[pag.tipo] ?? pag.tipo;
  const valorBRL = (pag.valor_centavos / 100)
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return (
    <section className="px-5 md:px-8 pt-8 pb-12 max-w-2xl mx-auto">
      <div className="bg-white border border-gray-200 rounded-2xl p-8">
        {pag.status === "pago" && (
          <div className="text-center">
            <div className="text-5xl mb-3">✅</div>
            <h1 className="text-gray-900 text-2xl font-medium mb-2">
              Pagamento confirmado!
            </h1>
            <p className="text-gray-700 text-sm mb-1">{descricao}</p>
            <p className="text-gray-500 text-sm mb-6">R$ {valorBRL}</p>
            {pag.tipo.startsWith("pacote_leads_") ? (
              <p className="text-gray-600 text-sm leading-relaxed mb-6">
                Seus pedidos extras já foram creditados na sua conta.
                Você pode ver eles na seção &ldquo;Seus pedidos extras disponíveis&rdquo;.
              </p>
            ) : (
              <p className="text-gray-600 text-sm leading-relaxed mb-6">
                Seu plano foi ativado. A partir de agora você recebe a cota
                completa de pedidos do plano contratado.
              </p>
            )}
            <Link
              href="/fornecedor/painel/plano"
              className="inline-block px-5 py-2.5 rounded-xl text-sm font-medium bg-[#1D9E75] text-white"
            >
              Ver meu plano
            </Link>
          </div>
        )}

        {pag.status === "pendente" && (
          <div className="text-center">
            <div className="text-5xl mb-3">⏳</div>
            <h1 className="text-gray-900 text-2xl font-medium mb-2">
              Pagamento em processamento
            </h1>
            <p className="text-gray-700 text-sm mb-1">{descricao}</p>
            <p className="text-gray-500 text-sm mb-6">R$ {valorBRL}</p>
            <p className="text-gray-600 text-sm leading-relaxed mb-6">
              {pag.metodo === "boleto"
                ? "Aguardando confirmação do banco. Boleto pode levar até 3 dias úteis pra processar."
                : "Aguardando confirmação. Geralmente leva poucos minutos."}
            </p>
            <form action="" className="inline-block">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700"
              >
                Verificar status
              </button>
            </form>
          </div>
        )}

        {(pag.status === "vencido" || pag.status === "cancelado") && (
          <div className="text-center">
            <div className="text-5xl mb-3">❌</div>
            <h1 className="text-gray-900 text-2xl font-medium mb-2">
              Pagamento não concluído
            </h1>
            <p className="text-gray-700 text-sm mb-1">{descricao}</p>
            <p className="text-gray-500 text-sm mb-6">R$ {valorBRL}</p>
            <p className="text-gray-600 text-sm leading-relaxed mb-6">
              {pag.status === "vencido"
                ? "O prazo de pagamento expirou."
                : "Pagamento foi cancelado."}
            </p>
            <Link
              href="/fornecedor/painel/plano"
              className="inline-block px-5 py-2.5 rounded-xl text-sm font-medium bg-[#1D9E75] text-white"
            >
              Tentar novamente
            </Link>
          </div>
        )}

        {pag.status === "estornado" && (
          <div className="text-center">
            <div className="text-5xl mb-3">↩️</div>
            <h1 className="text-gray-900 text-2xl font-medium mb-2">
              Pagamento estornado
            </h1>
            <p className="text-gray-700 text-sm mb-1">{descricao}</p>
            <p className="text-gray-500 text-sm mb-6">R$ {valorBRL}</p>
            <Link
              href="/fornecedor/painel/plano"
              className="inline-block px-5 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700"
            >
              Voltar pra meu plano
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
