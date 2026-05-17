// app/fornecedor/painel/plano/page.tsx
// ============================================================================
// Página de gestão de plano do fornecedor (server component).
// - Card do plano atual (cota + trial)
// - Tabela comparativa dos 3 planos com botão "Assinar"
// - Pacotes de pedidos extras com botão "Comprar"
// ============================================================================

import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import { calcularCotaInfo } from "@/app/lib/cota";
import {
  PLANOS_CONFIG,
  PACOTES_LEADS_EXTRAS,
  listarLotesAtivos,
} from "@/app/lib/planos";
import { PRECO_PACOTES_CENTAVOS } from "@/app/lib/asaas-payments";
import { supabaseAdmin } from "@/app/lib/supabase-server";
import BotaoComprarPacote from "./BotaoComprarPacote";
import CardPlanoAtual from "./CardPlanoAtual";
import PedidosExtrasDisponiveis from "./PedidosExtrasDisponiveis";
import TabelaPlanos from "./TabelaPlanos";

export const dynamic = "force-dynamic";

export default async function PaginaPlano() {
  const fornecedor = await exigirFornecedorAtual();
  const [cota, lotesAtivos, fornFull] = await Promise.all([
    calcularCotaInfo(fornecedor.id),
    listarLotesAtivos(fornecedor.id),
    supabaseAdmin
      .from("leads_fornecedores")
      .select("cpf_cnpj")
      .eq("id", fornecedor.id)
      .single(),
  ]);
  const jaTemCpfCnpj = !!(fornFull.data?.cpf_cnpj && fornFull.data.cpf_cnpj.length > 0);

  if (!cota) {
    return (
      <section className="px-5 md:px-8 pt-8 pb-12 max-w-4xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <p className="text-gray-500 text-sm">Não foi possível carregar seu plano.</p>
        </div>
      </section>
    );
  }

  // Preço por lead extra varia pelo plano efetivo do fornecedor
  const configPlano = PLANOS_CONFIG[cota.plano] ?? PLANOS_CONFIG["free"];
  const precoPorLead = configPlano.preco_lead_extra;

  return (
    <section className="px-5 md:px-8 pt-8 pb-12 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-2xl font-medium mb-1">Plano</h1>
        <p className="text-gray-500 text-sm">
          Gerencie seu plano e veja seus pedidos usados este mês.
        </p>
      </div>

      <CardPlanoAtual cota={cota} />

      <TabelaPlanos
        planoAtual={cota.plano}
        diaAniversario={cota.diaAniversario}
        jaTemCpfCnpj={jaTemCpfCnpj}
      />

      {/* Como funciona sua cota */}
      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-2xl p-6">
        <h2 className="text-gray-900 text-base font-medium mb-4">
          💡 Como funciona sua cota
        </h2>
        <dl className="flex flex-col gap-4 text-sm">
          <div>
            <dt className="text-gray-700 font-medium mb-1">
              Quando o pedido é contado?
            </dt>
            <dd className="text-gray-600 leading-relaxed">
              Quando um pedido compatível chega pra você e você aceita atender.
              Recusar ou ignorar NÃO consome.
            </dd>
          </div>
          <div>
            <dt className="text-gray-700 font-medium mb-1">Renovação:</dt>
            <dd className="text-gray-600 leading-relaxed">
              Sua cota mensal é renovada todo mês. Cota não usada NÃO acumula no
              próximo mês.
            </dd>
          </div>
          <div>
            <dt className="text-gray-700 font-medium mb-1">
              Atingiu a cota antes do fim do mês?
            </dt>
            <dd className="text-gray-600 leading-relaxed">
              Você pode adquirir pacotes avulsos de pedidos abaixo.
            </dd>
          </div>
        </dl>
      </div>

      <PedidosExtrasDisponiveis lotes={lotesAtivos} />

      {/* Pacotes de leads extras */}
      <div className="mt-10">
        <h2 className="text-gray-900 text-lg font-medium mb-1">Pedidos extras</h2>
        <p className="text-gray-500 text-sm">
          Pedidos extras comprados ficam disponíveis por 3 meses ou até serem consumidos. Use quando estourar a cota mensal.
        </p>
        <p className="text-gray-400 text-xs mb-4 mt-1">
          Preços do seu plano <span className="text-gray-700 font-medium">{cota.planoNome}</span>
          {" · "}R$ {precoPorLead.toFixed(2).replace(".", ",")}/pedido
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PACOTES_LEADS_EXTRAS.map((pacote) => {
            const tipo = `pacote_leads_${pacote.quantidade}` as
              | "pacote_leads_5"
              | "pacote_leads_10"
              | "pacote_leads_25";
            const valorCentavos = PRECO_PACOTES_CENTAVOS[tipo][cota.plano];
            const precoTotal = valorCentavos / 100;
            return (
              <div
                key={tipo}
                className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col"
              >
                <div className="text-gray-900 text-2xl font-medium mb-1">
                  {pacote.quantidade} pedidos
                </div>
                <div className="text-gray-500 text-sm mb-4">
                  R$ {precoTotal.toFixed(2).replace(".", ",")}
                </div>
                <BotaoComprarPacote
                  tipo={tipo}
                  quantidade={pacote.quantidade}
                  valorCentavos={valorCentavos}
                  jaTemCpfCnpj={jaTemCpfCnpj}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
