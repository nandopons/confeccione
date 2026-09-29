"use client";
// ============================================================================
// "FAZER PEDIDO" DA VITRINE VAI DIRETO PRO WHATSAPP DO LUIGI — 29/09/2026
// (decisão do Fernando). Nada de formulário: o cliente clica, o WhatsApp abre
// com a mensagem pronta citando o produto ("(vitrine 8hex)"), o Luigi lê o
// marcador, sabe a peça e a confecção, e conduz o pedido dando preferência a
// ela. O clique também vai pro rastro (vitrine_cliques) por sendBeacon.
// ============================================================================
import type { ReactNode } from "react";
import { linkWhatsAppSuporte } from "@/app/lib/contatos";

export function mensagemPedidoVitrine(itemId: string, nome: string | null): string {
  const peca = nome ? `"${nome}"` : "um modelo";
  return `Oi! Vi ${peca} na vitrine da Confeccione e quero fazer um pedido parecido. (vitrine ${itemId.slice(0, 8)})`;
}

export default function BotaoPedidoVitrine({
  itemId,
  nome,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  itemId: string;
  nome: string | null;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <a
      href={linkWhatsAppSuporte(mensagemPedidoVitrine(itemId, nome))}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={ariaLabel}
      onClick={() => {
        try {
          navigator.sendBeacon?.("/api/vitrine/clique", new Blob([JSON.stringify({ item: itemId })], { type: "application/json" }));
        } catch {
          /* rastro é bônus */
        }
      }}
    >
      {children ?? "Fazer pedido →"}
    </a>
  );
}
