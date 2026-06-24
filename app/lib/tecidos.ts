// app/lib/tecidos.ts
// ============================================================================
// Biblioteca de tecidos/malhas TÍPICOS por produto e por categoria. Usada pelo
// chat de alinhamento pra SUGERIR o tecido — o cliente sempre pode indicar
// outro. Não é regra rígida, é ponto de partida.
// ============================================================================

function norm(s?: string | null): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Por PRODUTO (palavras-chave no modelo) — checado primeiro.
const POR_PRODUTO: Array<{ termos: string[]; tecidos: string[] }> = [
  { termos: ["top", "legging", "short fitness", "regata cavada"], tecidos: ["Suplex", "Poliamida com elastano", "Dry-fit"] },
  { termos: ["oversized", "boxy", "babylook", "baby look"], tecidos: ["Algodão 30.1 penteado", "Algodão premium", "Malhão (acima de 200g)"] },
  { termos: ["camiseta", "tshirt", "t-shirt", "basica", "gola", "dry"], tecidos: ["Algodão 30.1 penteado", "Malha PV (poliéster/viscose)", "Algodão premium"] },
  { termos: ["polo"], tecidos: ["Piquet algodão", "Piquet PV", "Piquet poliéster"] },
  { termos: ["moletom", "blusa de frio", "canguru", "careca"], tecidos: ["Moletom flanelado", "Moletom 3 cabos", "Moletom peluciado"] },
  { termos: ["jaqueta", "casaco", "corta vento", "corta-vento", "colete"], tecidos: ["Tactel", "Nylon", "Moletom 3 cabos"] },
  { termos: ["camisa social", "camisa botao", "camisa botão", "jaleco"], tecidos: ["Tricoline", "Oxford", "Linho"] },
  { termos: ["uv"], tecidos: ["Poliamida UV", "Dry UV (poliéster UV)"] },
  { termos: ["biquini", "biquíni", "maio", "maiô", "sunga", "saida de praia", "saída"], tecidos: ["Poliamida com elastano", "Lycra"] },
  { termos: ["calcinha", "sutia", "sutiã", "pijama", "camisola", "boxer"], tecidos: ["Microfibra", "Algodão", "Viscolycra", "Liganete"] },
  { termos: ["bone", "boné", "trucker", "bucket"], tecidos: ["Brim", "Sarja", "Algodão"] },
  { termos: ["regata"], tecidos: ["Algodão 30.1 penteado", "Dry-fit", "Malha PV"] },
  { termos: ["short", "bermuda"], tecidos: ["Tactel", "Moletom", "Helanca"] },
  { termos: ["calca", "calça"], tecidos: ["Moletom", "Suplex", "Helanca"] },
];

// Por CATEGORIA (nicho) — fallback quando o modelo não bate.
const POR_CATEGORIA: Record<string, string[]> = {
  fitness: ["Suplex", "Poliamida com elastano", "Dry-fit"],
  "private label": ["Algodão 30.1 penteado", "Malha PV", "Algodão premium"],
  "moda praia": ["Poliamida com elastano", "Lycra"],
  "moda intima": ["Microfibra", "Algodão", "Viscolycra"],
  interclasse: ["Algodão 30.1 penteado", "Malha PV", "Dry (para esporte)"],
  "padrao esportivo": ["Dry-fit", "Poliéster", "Malha PV"],
  fardamento: ["Tricoline", "Piquet", "Brim"],
  inverno: ["Moletom flanelado", "Moletom 3 cabos"],
  "roupas uv": ["Poliamida UV", "Dry UV"],
  bones: ["Brim", "Sarja"],
};

const PADRAO = ["Algodão 30.1 penteado", "Malha PV", "Dry-fit"];

/** Tecidos sugeridos pra um produto (pelo modelo) e/ou categoria. */
export function tecidosSugeridos(modelo?: string | null, categoria?: string | null): string[] {
  const m = norm(modelo);
  if (m) {
    for (const p of POR_PRODUTO) {
      if (p.termos.some((t) => m.includes(norm(t)))) return p.tecidos;
    }
  }
  const c = norm(categoria);
  for (const key of Object.keys(POR_CATEGORIA)) {
    if (c === key || (c.length > 0 && c.includes(key))) return POR_CATEGORIA[key];
  }
  return PADRAO;
}

/** Bloco de texto compacto pro system prompt do operador (modo alinhar). */
export function hintsTecidoTexto(categoria?: string | null): string {
  const linhas = POR_PRODUTO.map((p) => `- ${p.termos[0]}: ${p.tecidos.join(", ")}`);
  const cat = norm(categoria);
  let catLinha = "";
  for (const key of Object.keys(POR_CATEGORIA)) {
    if (cat === key || (cat.length > 0 && cat.includes(key))) {
      catLinha = `\nPra a categoria deste pedido (${categoria}), os mais comuns: ${POR_CATEGORIA[key].join(", ")}.`;
      break;
    }
  }
  return `BIBLIOTECA DE TECIDOS (sugestões típicas por produto — o cliente pode escolher outro):\n${linhas.join("\n")}${catLinha}`;
}
