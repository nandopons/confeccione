// app/fornecedor/painel/plano/CardPlanoAtual.tsx
// ============================================================================
// Card grande mostrando o plano atual do fornecedor + cota + trial countdown.
// Server component (apenas leitura). Todos os planos têm cota numérica.
// ============================================================================

import { type CotaInfo, formatarDataAmigavel, diasAte } from "@/app/lib/cota";

export default function CardPlanoAtual({ cota }: { cota: CotaInfo }) {
  const dias = cota.trialExpiraEm ? diasAte(cota.trialExpiraEm) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
      <div className="mb-4">
        <div className="text-xs text-gray-400 mb-1">Plano atual</div>
        <div className="flex items-center gap-2">
          <span className="text-gray-900 text-3xl font-medium">{cota.planoNome}</span>
          {cota.emTrial && (
            <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-0.5 rounded-full">
              TRIAL
            </span>
          )}
        </div>
        {cota.emTrial && cota.trialExpiraEm && (
          <div className="text-sm text-gray-500 mt-1">
            Trial até {formatarDataAmigavel(cota.trialExpiraEm)}
            {" · "}
            <span className={dias <= 7 ? "text-orange-600 font-medium" : ""}>
              {dias > 0 ? `faltam ${dias} ${dias === 1 ? "dia" : "dias"}` : "expirado"}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-gray-900 text-2xl font-medium">{cota.leadsUsados}</span>
          <span className="text-gray-500 text-sm"> / {cota.leadsInclusos} pedidos aceitos este mês</span>
        </div>
        {cota.creditosExtras > 0 && (
          <div className="text-xs text-gray-500">
            +{cota.creditosExtras} {cota.creditosExtras === 1 ? "extra" : "extras"}
          </div>
        )}
      </div>
      <div className="bg-gray-100 h-2 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${
            cota.cotaEstourada ? "bg-orange-400" : "bg-[#1D9E75]"
          }`}
          style={{ width: `${cota.porcentagemUsada}%` }}
        />
      </div>

      {cota.proximaRenovacao && (
        <div className="text-xs text-gray-500 mt-2">
          Próxima renovação: {textoProximaRenovacao(cota.proximaRenovacao)}
        </div>
      )}

      {cota.cotaEstourada && cota.creditosExtras === 0 && (
        <div className="mt-4 bg-orange-50 border border-orange-200 rounded-xl p-4">
          <div className="text-orange-900 font-medium text-sm mb-1">
            Cota mensal esgotada
          </div>
          <p className="text-orange-800 text-xs leading-relaxed">
            Você não recebe mais pedidos até o próximo mês ou até comprar pedidos extras.
            Veja os pacotes abaixo.
          </p>
        </div>
      )}
      {cota.cotaEstourada && cota.creditosExtras > 0 && (
        <div className="mt-3 text-xs text-gray-500">
          Cota mensal esgotada · usando seus {cota.creditosExtras} pedidos extras
        </div>
      )}
    </div>
  );
}

function textoProximaRenovacao(p: { data: string; diasRestantes: number }): string {
  if (p.diasRestantes === 0) return "hoje";
  if (p.diasRestantes === 1) return "amanhã";
  const d = new Date(p.data);
  const dia = String(d.getUTCDate()).padStart(2, "0");
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes} (em ${p.diasRestantes} dias)`;
}
