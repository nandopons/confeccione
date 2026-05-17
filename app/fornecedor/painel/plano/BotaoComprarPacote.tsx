// app/fornecedor/painel/plano/BotaoComprarPacote.tsx
// ============================================================================
// Botão "Comprar" + ModalCheckout pra pacote de pedidos extras.
// Client component — server passa props prontas.
// ============================================================================

"use client";

import { useState } from "react";
import ModalCheckout from "./ModalCheckout";

type Props = {
  tipo: "pacote_leads_5" | "pacote_leads_10" | "pacote_leads_25";
  quantidade: number;
  valorCentavos: number;
  jaTemCpfCnpj: boolean;
};

export default function BotaoComprarPacote({
  tipo,
  quantidade,
  valorCentavos,
  jaTemCpfCnpj,
}: Props) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="w-full py-2.5 rounded-xl text-sm font-medium bg-[#1D9E75] text-white hover:bg-[#178761]"
      >
        Comprar
      </button>
      {aberto && (
        <ModalCheckout
          tipo={tipo}
          valorCentavos={valorCentavos}
          descricao={`Pacote de ${quantidade} pedidos extras`}
          jaTemCpfCnpj={jaTemCpfCnpj}
          onClose={() => setAberto(false)}
        />
      )}
    </>
  );
}
