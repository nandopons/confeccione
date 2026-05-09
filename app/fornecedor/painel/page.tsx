// app/fornecedor/painel/page.tsx
// ============================================================================
// Dashboard do painel do fornecedor (server component).
// - Card grande: pedidos pendentes (status='enviada' não expirados)
// - Card pequeno: cota mensal usada (com progress bar)
// - Card pequeno: plano atual (com badge de trial se aplicável)
// - Aviso se conta está inativa
// ============================================================================

import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import { calcularCotaInfo, formatarDataAmigavel, diasAte } from "@/app/lib/cota";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export default async function PainelDashboard() {
  const fornecedor = await exigirFornecedorAtual();

  // Conta pedidos pendentes (status='enviada' e não-expirados)
  const agoraISO = new Date().toISOString();
  const { count: pedidosPendentes } = await supabase
    .from("ofertas")
    .select("*", { count: "exact", head: true })
    .eq("fornecedor_id", fornecedor.id)
    .eq("status", "enviada")
    .gt("expira_em", agoraISO);

  // Conta pedidos aceitos (histórico)
  const { count: pedidosAceitos } = await supabase
    .from("ofertas")
    .select("*", { count: "exact", head: true })
    .eq("fornecedor_id", fornecedor.id)
    .eq("status", "aceita");

  const cota = await calcularCotaInfo(fornecedor.id);
  const inativo = fornecedor.status === "inativo";

  return (
    <section className="px-5 md:px-8 pt-8 pb-12 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-2xl font-medium mb-1">
          Olá, {primeiroNome(fornecedor.nome)}!
        </h1>
        <p className="text-gray-500 text-sm">Aqui é seu resumo de hoje.</p>
      </div>

      {inativo && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⏸</div>
            <div>
              <div className="text-orange-900 font-medium mb-1">Sua conta está pausada</div>
              <p className="text-orange-800 text-sm leading-relaxed">
                Enquanto pausada, você não recebe pedidos novos. Pra reativar, vá em{" "}
                <Link href="/fornecedor/painel/dados" className="underline font-medium">
                  Dados
                </Link>{" "}
                e clique em &ldquo;Reativar conta&rdquo;.
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
            {(pedidosPendentes ?? 0) === 0 ? (
              <>
                <div className="text-gray-900 text-2xl font-medium mb-1">
                  Nenhum pedido agora
                </div>
                <div className="text-gray-500 text-sm">
                  A gente avisa por WhatsApp quando chegar um que bate com seu perfil.
                </div>
              </>
            ) : (
              <>
                <div className="text-gray-900 text-3xl font-medium mb-1">
                  {pedidosPendentes} {pedidosPendentes === 1 ? "pedido" : "pedidos"}
                </div>
                <div className="text-[#0F6E56] text-sm font-medium">
                  Toque para responder →
                </div>
              </>
            )}
          </div>
          {(pedidosPendentes ?? 0) > 0 && (
            <div className="bg-[#E1F5EE] rounded-2xl p-3 flex-shrink-0">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          )}
        </div>
      </Link>

      {/* Cards menores: cota + plano */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Cota */}
        {cota && (
          <Link
            href="/fornecedor/painel/plano"
            className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition-colors"
          >
            <div className="text-xs text-gray-400 mb-1">Cota deste mês</div>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-gray-900 text-2xl font-medium">{cota.leadsUsados}</span>
              <span className="text-gray-500 text-sm">/ {cota.leadsInclusos} leads</span>
            </div>
            <div className="bg-gray-100 h-2 rounded-full overflow-hidden mb-2">
              <div
                className={`h-full transition-all ${
                  cota.cotaEstourada ? "bg-orange-400" : "bg-[#1D9E75]"
                }`}
                style={{ width: `${cota.porcentagemUsada}%` }}
              />
            </div>
            {cota.creditosExtras > 0 && (
              <div className="text-xs text-gray-500">
                +{cota.creditosExtras} {cota.creditosExtras === 1 ? "lead extra" : "leads extras"}
              </div>
            )}
            {cota.cotaEstourada && cota.creditosExtras === 0 && (
              <div className="text-xs text-orange-600 font-medium">
                Cota mensal esgotada · ver pacotes
              </div>
            )}
          </Link>
        )}

        {/* Plano */}
        {cota && (
          <Link
            href="/fornecedor/painel/plano"
            className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition-colors"
          >
            <div className="text-xs text-gray-400 mb-1">Plano atual</div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-900 text-2xl font-medium">{cota.planoNome}</span>
              {cota.emTrial && (
                <span className="bg-[#E1F5EE] text-[#0F6E56] text-[10px] font-medium px-2 py-0.5 rounded-full">
                  TRIAL
                </span>
              )}
            </div>
            {cota.emTrial && cota.trialExpiraEm ? (
              <div className="text-xs text-gray-500">
                Trial até {formatarDataAmigavel(cota.trialExpiraEm)}
                {" · "}
                {diasAte(cota.trialExpiraEm)} {diasAte(cota.trialExpiraEm) === 1 ? "dia" : "dias"}
              </div>
            ) : (
              <div className="text-xs text-gray-500">Gerenciar plano →</div>
            )}
          </Link>
        )}
      </div>

      {/* Mini-stat: pedidos aceitos no histórico */}
      {(pedidosAceitos ?? 0) > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="text-xs text-gray-400 mb-1">Pedidos aceitos no total</div>
          <div className="text-gray-900 text-xl font-medium">
            {pedidosAceitos}
          </div>
        </div>
      )}
    </section>
  );
}

function primeiroNome(nome: string): string {
  return (nome || "").split(" ")[0] || nome;
}
