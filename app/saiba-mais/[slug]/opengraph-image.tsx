import { ImageResponse } from "next/og";
import { getPostBySlug } from "@/app/lib/blog";

// og:image por artigo: título do post sobre o fundo da marca.
export const alt = "Artigo do blog da Confeccione";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  const titulo = post?.metadata.title ?? "Saiba mais — Confeccione";
  const categoria = post?.metadata.category ?? "Blog";
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
          <div style={{ width: 36, height: 36, borderRadius: 999, border: "5px solid #1D9E75", display: "flex" }} />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>CONFECCIONE</div>
          <div
            style={{
              marginLeft: 18,
              fontSize: 22,
              color: "#0F6E56",
              background: "#E1F5EE",
              padding: "6px 16px",
              borderRadius: 999,
            }}
          >
            {categoria}
          </div>
        </div>
        <div style={{ fontSize: titulo.length > 70 ? 50 : 60, fontWeight: 700, lineHeight: 1.12, maxWidth: 1040 }}>
          {titulo}
        </div>
        <div style={{ fontSize: 26, color: "#2DD4A7" }}>confeccione.com.br/saiba-mais</div>
      </div>
    ),
    size
  );
}
