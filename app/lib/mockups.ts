// app/lib/mockups.ts
// ============================================================================
// Biblioteca de mockups da Confeccione. Cada item é uma peça em branco
// (imagem em public/mockups) com a ÁREA DE ESTAMPA marcada (printArea, em
// coordenadas normalizadas 0..1 sobre a imagem). O estúdio compõe a logo do
// cliente dentro dessa área via canvas.
//
// Para adicionar uma peça nova: recorte a vista frontal, salve em
// public/mockups/, e acrescente um item aqui com a printArea calibrada.
// ============================================================================

export type CorLogoSugerida = "preto" | "branco";

export interface MockupTemplate {
  id: string;
  nome: string;
  descricao: string;
  /** caminho público da imagem (em /public) */
  arquivo: string;
  /** cor base da peça — usada pra sugerir a cor da logo por contraste */
  corPeca: string;
  /** logo recomendada por contraste (peça clara -> preto; escura -> branco) */
  corLogoSugerida: CorLogoSugerida;
  /** área de estampa, normalizada (0..1) sobre a imagem do mockup */
  printArea: { x: number; y: number; w: number; h: number };
}

export const MOCKUPS: MockupTemplate[] = [
  {
    id: "oversized-offwhite-frente",
    nome: "Oversized Off-White",
    descricao: "Camiseta oversized, gola careca — vista frontal",
    arquivo: "/mockups/oversized-offwhite-frente.jpg",
    corPeca: "#efe9dd",
    corLogoSugerida: "preto",
    // centro do peito (calibrado sobre a imagem 760x1043)
    printArea: { x: 0.31, y: 0.26, w: 0.38, h: 0.27 },
  },
];

export function getMockup(id: string): MockupTemplate | undefined {
  return MOCKUPS.find((m) => m.id === id);
}
