// app/fornecedor/painel/plano/TabelaPlanos.tsx
// ============================================================================
// Grid comparativo dos planos pagos (Starter/Pro). Free é omitido — sem
// upgrade pra Free. Plano atual destacado com borda verde + badge "ATUAL".
// Botão "Assinar" abre ModalCheckout via BotaoAssinarPlano (client).
// ============================================================================

import { PLANOS_CONFIG, type Plano } from "@/app/lib/planos";
import BotaoAssinarPlano from "./BotaoAssinarPlano";

const ORDEM: Array<Exclude<Plano, "free">> = ["starter", "pro"];

const BENEFICIOS: Record<Exclude<Plano, "free">, string[]> = {
  starter: [
    "Selo verificado no perfil",
    "Prioridade média na fila",
    "Suporte por WhatsApp",
  ],
  pro: [
    "Prioridade alta na fila",
    "Primeiro do raio de atendimento",
    "Perfil destacado",
    "Métricas detalhadas",
  ],
};

const DESTAQUE: Record<Exclude<Plano, "free">, string | null> = {
  starter: "Mais escolhido",
  pro: "Mais resultados",
};

const TOOLTIP_LEADS_GENERICO =
  "Cota renovada todo mês. Cada pedido aceito consome 1 da cota. Recusar ou ignorar não consome.";

function tooltipDinamico(diaAniversario: number | null | undefined): string {
  if (!diaAniversario) return TOOLTIP_LEADS_GENERICO;
  return `Cota renovada a cada dia ${diaAniversario} do mês (aniversário do seu plano). Cada pedido aceito consome 1 da cota. Recusar ou ignorar não consome.`;
}

function precoFormatado(preco: number): string {
  if (preco === 0) return "Grátis";
  return `R$ ${preco}`;
}

export default function TabelaPlanos({
  planoAtual,
  diaAniversario,
  jaTemCpfCnpj,
}: {
  planoAtual: Plano;
  diaAniversario?: number | null;
  jaTemCpfCnpj: boolean;
}) {
  const tooltipLeads = tooltipDinamico(diaAniversario);
  return (
    <div>
      <h2 className="text-gray-900 text-lg font-medium mb-4">Comparar planos</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ORDEM.map((id) => {
          const config = PLANOS_CONFIG[id];
          const ehAtual = id === planoAtual;

          return (
            <div
              key={id}
              className={`bg-white rounded-2xl p-5 flex flex-col ${
                ehAtual
                  ? "border-2 border-[#1D9E75]"
                  : "border border-gray-200"
              }`}
            >
              <div className="mb-3">
                {DESTAQUE[id] && (
                  <div className="text-xs text-gray-400 mb-1">{DESTAQUE[id]}</div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-gray-900 text-xl font-medium">{config.nome}</span>
                  {ehAtual && (
                    <span className="bg-[#E1F5EE] text-[#0F6E56] text-[10px] font-medium px-2 py-0.5 rounded-full">
                      ATUAL
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <div className="text-gray-900 text-2xl font-medium">
                  {precoFormatado(config.preco_mes)}
                </div>
                {config.preco_mes > 0 && (
                  <div className="text-xs text-gray-500">por mês</div>
                )}
              </div>

              <div className="text-sm text-gray-600 mb-4 flex items-center gap-1.5">
                <span>
                  <span className="font-medium">{config.leads_inclusos}</span> pedidos/mês
                </span>
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] font-medium cursor-help"
                  title={tooltipLeads}
                  aria-label={tooltipLeads}
                >
                  i
                </span>
              </div>

              <ul className="flex flex-col gap-2 mb-5 flex-1">
                {BENEFICIOS[id].map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              {ehAtual ? (
                <button
                  disabled
                  className="w-full py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-400 cursor-not-allowed"
                >
                  Plano atual
                </button>
              ) : (
                <BotaoAssinarPlano
                  plano={id}
                  nome={config.nome}
                  valorCentavos={config.preco_mes * 100}
                  jaTemCpfCnpj={jaTemCpfCnpj}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
