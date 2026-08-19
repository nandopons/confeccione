import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import Script from "next/script";
import Rastreio from "./components/Rastreio";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Confeccione | Encontre fornecedores de confecção",
  description: "Encontre confecções para fabricar suas peças. Orçamento rápido pelo WhatsApp.",
  metadataBase: new URL("https://confeccione.com.br"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Confeccione",
    locale: "pt_BR",
    url: "/",
    title: "Confeccione | Encontre fornecedores de confecção",
    description:
      "Encontre confecções para fabricar suas peças. Orçamento rápido pelo WhatsApp.",
  },
  verification: {
    other: {
      "p:domain_verify": "d43c634ff3dd0e303a70944d1854ebf3",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
    >
      <head>
        {/* Dados estruturados da empresa - 16/08/2026.
            Ate esta data o site so tinha JSON-LD nos artigos do blog. A home, o
            /sobre e o resto nao diziam a nenhuma maquina o que a Confeccione e.
            Isso vale tanto para o Google quanto para ChatGPT, Perplexity e
            Gemini, que leem estes dados para decidir se citam a marca.

            Se o telefone de atendimento mudar, muda aqui tambem. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Confeccione",
              url: "https://confeccione.com.br",
              logo: "https://confeccione.com.br/icon.svg",
              description:
                "Plataforma brasileira que conecta marcas, lojistas e criadores a confecções e costureiras para fabricação de roupas sob demanda.",
              areaServed: { "@type": "Country", name: "Brasil" },
              knowsLanguage: "pt-BR",
              contactPoint: [
                {
                  "@type": "ContactPoint",
                  contactType: "customer support",
                  telephone: "+55-81-99593-2695",
                  availableLanguage: ["Portuguese"],
                },
              ],
            }),
          }}
        />
        <Script id="gtm-script" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-T59XPSZ');`}
        </Script>
        {/* Microsoft Clarity REMOVIDO daqui em 19/08/2026.
            Estava duplicado: este bloco carregava clarity.ms/tag/ e a tag
            "Microsoft Clarity - Official" dentro do GTM-T59XPSZ carregava o
            mesmo ID de novo. Medido ao vivo na home: 2 carregamentos de
            clarity.ms/tag/ e 5 requisicoes a dominios do Clarity na mesma pagina.
            Ficou o do GTM, que a integracao oficial instalou e gerencia.
            O opt-out ?clarity=off se perde - para excluir as proprias sessoes,
            use Clarity > Settings > Bloqueio de IP. */}
      </head>
      <body className="min-h-full flex flex-col">
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-T59XPSZ"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        {/* Tracker 1st-party do funil (/admin/funil) — pageviews do site público. */}
        <Rastreio />
        {children}
      </body>
    </html>
  );
}
