import { ImageResponse } from "next/og";

// Imagem Open Graph padrão do site (03/09/2026). Até esta data nenhuma página
// tinha og:image — links compartilhados no WhatsApp/LinkedIn saíam sem
// thumbnail. Páginas filhas herdam esta; artigos do blog têm a própria em
// app/saiba-mais/[slug]/opengraph-image.tsx.
export const runtime = "edge";
export const alt = "Confeccione — confecções e costureiras verificadas em todo o Brasil";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #111 60%, #0F3D30 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "6px solid #1D9E75",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 4 }}>CONFECCIONE</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, maxWidth: 1000 }}>
            Confecção de roupas sob demanda
          </div>
          <div style={{ fontSize: 30, color: "#B7C4BE", maxWidth: 960, lineHeight: 1.3 }}>
            Uniformes, camisetas, fardamento e marca própria com confecções e costureiras
            verificadas em todo o Brasil. Pagamento garantido.
          </div>
        </div>
        <div style={{ fontSize: 26, color: "#2DD4A7" }}>confeccione.com.br</div>
      </div>
    ),
    size
  );
}
