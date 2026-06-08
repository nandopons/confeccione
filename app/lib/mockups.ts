// app/lib/mockups.ts
// ============================================================================
// Biblioteca de mockups da Confeccione, organizada por CATEGORIA (T-Shirt,
// Polo, Bolsas, Bonés…). Cada peça tem VISTAS (frente/costas/lateral) e cada
// vista tem ZONAS de estampa nomeadas (peito_esquerdo, peito_centro,
// costas_centro, centro), em coordenadas normalizadas 0..1 sobre a imagem.
//
// Para adicionar peça: recorte as vistas, salve em public/mockups/, e
// acrescente um item aqui com as zonas calibradas.
// ============================================================================

export type Vista = "frente" | "costas" | "lateral";
export type ZonaNome = "peito_esquerdo" | "peito_centro" | "costas_centro" | "centro";
export type CorLogoSugerida = "preto" | "branco";

export interface Zona { x: number; y: number; w: number; h: number }

export interface MockupView {
  arquivo: string;
  zonas: Partial<Record<ZonaNome, Zona>>;
  zonaPadrao: ZonaNome;
}

export interface MockupTemplate {
  id: string;
  nome: string;
  categoria: string; // id da categoria
  corLogoSugerida: CorLogoSugerida;
  vistas: Partial<Record<Vista, MockupView>>;
  vistaPadrao: Vista;
}

export interface Categoria { id: string; nome: string }

export const CATEGORIAS: Categoria[] = [
  { id: "tshirt", nome: "T-Shirt" },
  { id: "polo", nome: "Polo" },
  { id: "moletom", nome: "Moletom" },
  { id: "bones", nome: "Bonés" },
  { id: "bolsas", nome: "Bolsas" },
];

export const MOCKUPS: MockupTemplate[] = [
  {
    id: "oversized-offwhite",
    nome: "Oversized Off-White",
    categoria: "tshirt",
    corLogoSugerida: "preto",
    vistaPadrao: "frente",
    vistas: {
      frente: {
        arquivo: "/mockups/oversized-offwhite-frente.jpg",
        zonaPadrao: "peito_esquerdo",
        zonas: {
          // peito esquerdo de quem veste = lado direito da imagem
          peito_esquerdo: { x: 0.60, y: 0.225, w: 0.135, h: 0.105 },
          peito_centro: { x: 0.33, y: 0.27, w: 0.34, h: 0.26 },
        },
      },
      costas: {
        arquivo: "/mockups/oversized-offwhite-costas.jpg",
        zonaPadrao: "costas_centro",
        zonas: {
          costas_centro: { x: 0.30, y: 0.18, w: 0.40, h: 0.30 },
        },
      },
      lateral: {
        arquivo: "/mockups/oversized-offwhite-lateral.jpg",
        zonaPadrao: "centro",
        zonas: {
          centro: { x: 0.42, y: 0.30, w: 0.18, h: 0.14 },
        },
      },
    },
  },
];

export function getMockup(id: string): MockupTemplate | undefined {
  return MOCKUPS.find((m) => m.id === id);
}
