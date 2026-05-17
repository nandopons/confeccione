// app/fornecedor/painel/plano/PedidosExtrasDisponiveis.tsx
// ============================================================================
// Lista os lotes ativos de creditos_avulsos do fornecedor.
// Server component (apenas leitura). Não renderiza nada se zero lotes.
// ============================================================================

import { type LoteAvulso } from "@/app/lib/planos";

export default function PedidosExtrasDisponiveis({ lotes }: { lotes: LoteAvulso[] }) {
  if (lotes.length === 0) return null;

  const totalDisponivel = lotes.reduce(
    (sum, l) => sum + l.quantidade_disponivel,
    0
  );
  const agora = Date.now();

  return (
    <div className="mt-8 bg-white border border-gray-200 rounded-2xl p-6">
      <h2 className="text-gray-900 text-base font-medium mb-4">
        🎟️ Seus pedidos extras disponíveis
      </h2>

      <ul className="flex flex-col gap-3 text-sm">
        {lotes.map((lote) => {
          const diasDesdeCompra = Math.floor(
            (agora - new Date(lote.criado_em).getTime()) / (1000 * 60 * 60 * 24)
          );
          const diasAteVencer = Math.floor(
            (new Date(lote.expira_em).getTime() - agora) / (1000 * 60 * 60 * 24)
          );
          const venceEmBreve = diasAteVencer <= 14;
          const dataVence = new Date(lote.expira_em).toLocaleDateString("pt-BR");

          return (
            <li
              key={lote.id}
              className="flex items-start justify-between border-b border-gray-100 pb-3 last:border-0 last:pb-0"
            >
              <div>
                <div className="text-gray-900 font-medium">
                  {lote.quantidade_inicial} pedidos
                </div>
                <div className="text-gray-500 text-xs mt-0.5">
                  Comprados há {diasDesdeCompra}{" "}
                  {diasDesdeCompra === 1 ? "dia" : "dias"} · válidos até{" "}
                  {dataVence}
                </div>
                {venceEmBreve && (
                  <div className="text-orange-700 text-xs mt-1">
                    ⚠️ Vence em {diasAteVencer}{" "}
                    {diasAteVencer === 1 ? "dia" : "dias"}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-gray-900 font-medium">
                  {lote.quantidade_disponivel}/{lote.quantidade_inicial}
                </div>
                <div className="text-gray-500 text-xs">disponível</div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 pt-3 border-t border-gray-200 text-sm text-gray-700">
        Total disponível:{" "}
        <span className="font-medium">{totalDisponivel} pedidos</span>
      </div>
    </div>
  );
}
