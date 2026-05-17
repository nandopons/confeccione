// app/fornecedor/painel/plano/BotaoAssinarPlano.tsx
// ============================================================================
// Botão "Assinar" + ModalCheckout pra plano (Starter/Pro).
// Client component — server passa props prontas.
// ============================================================================

"use client";

import { useState } from "react";
import ModalCheckout from "./ModalCheckout";

type Props = {
  plano: "starter" | "pro";
  nome: string; // "Starter" | "Pro"
  valorCentavos: number;
  jaTemCpfCnpj: boolean;
};

export default function BotaoAssinarPlano({
  plano,
  nome,
  valorCentavos,
  jaTemCpfCnpj,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const tipo = plano === "starter" ? "assinatura_starter" : "assinatura_pro";

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#1D9E75] text-white hover:bg-[#178761]"
      >
        Assinar
      </button>
      {aberto && (
        <ModalCheckout
          tipo={tipo}
          valorCentavos={valorCentavos}
          descricao={`Plano ${nome}`}
          jaTemCpfCnpj={jaTemCpfCnpj}
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}
