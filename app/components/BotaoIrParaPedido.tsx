"use client";

import type { ReactNode } from "react";

// Único pedaço interativo do hero da home. Extraído em 03/09/2026 pra que
// app/page.tsx pudesse virar server component e exportar a própria metadata
// (title/description/canonical/OG da home ficavam no layout raiz e vazavam pra
// toda página filha que esquecesse de sobrescrever — foi o que tirou /sobre do
// índice em agosto).
//
// `rolarAtePedido` é reutilizado pelos cards de segmento (SegmentosEFaq): um
// <Link href="/#pedido"> na própria home só troca o hash e não rola de forma
// confiável — o clique parecia não fazer nada.
export function rolarAtePedido() {
  const el = document.getElementById("pedido");
  if (!el) return;
  const isMobile = window.innerWidth < 768;
  const vh = window.innerHeight;
  const offset = isMobile ? -Math.round(vh * 0.02) : -80 + Math.round(vh * 0.07);
  const y = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: y, behavior: "smooth" });
}

export default function BotaoIrParaPedido({
  className,
  children = "Fazer meu pedido →",
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button type="button" onClick={rolarAtePedido} className={className}>
      {children}
    </button>
  );
}
