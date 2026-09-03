import type { Metadata } from "next";

// Rota privada / com token na URL. Já está no Disallow do robots.ts, mas isso
// só impede o rastreio: se alguém compartilhar o link (WhatsApp, e-mail), o
// Google ainda pode indexar a URL "às cegas". noindex fecha a porta.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
