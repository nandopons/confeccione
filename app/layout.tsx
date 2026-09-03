import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import Script from "next/script";
import Rastreio from "./components/Rastreio";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// preload: false desde 20/08/2026.
// O Geist Mono era pre-carregado em TODA pagina - inclusive na home, onde
// `font-mono` nao aparece em lugar nenhum (nem em page.tsx, SiteHeader,
// SiteFooter ou PedidoSteps). Ele so e usado em tres campos de codigo OTP:
// /cliente/login, /fornecedor/entrar e /admin/captacao.
//
// Custava caro no lugar errado: 23.108 bytes com `as="font" crossorigin`, que
// o navegador trata com prioridade MAXIMA, e o <link> saia ANTES do preload da
// imagem da LCP no <head>. Em 4G lento isso e banda tomada exatamente na
// janela que decide o LCP - o atraso de carregamento do recurso estava em
// 450 ms no PageSpeed de 19/08 23:09.
//
// Com preload: false a variavel CSS continua funcionando; a fonte passa a ser
// buscada so quando alguma pagina de fato usa `font-mono`. O custo e um FOUT
// breve nesses tres campos, que ficam atras de login e nao sao elemento de LCP.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// 03/09/2026: o layout raiz NÃO define mais canonical nem og:url. Antes ele
// declarava "/" e toda página que esquecesse de sobrescrever dizia ao Google
// que a home era a versão canônica dela (foi assim que /sobre saiu do índice
// em agosto e que /termos e /privacidade publicavam og:url da home). Agora a
// home tem metadata própria em app/page.tsx e cada rota pública declara a sua.
export const metadata: Metadata = {
  title: {
    default: "Confecção de Uniformes, Camisetas e Private Label | Confeccione",
    template: "%s | Confeccione",
  },
  description:
    "Conectamos sua empresa a confecções, facções e costureiras verificadas em todo o Brasil. Orçamento de uniformes, camisetas personalizadas, fardamento e marca própria com pagamento garantido.",
  metadataBase: new URL("https://confeccione.com.br"),
  applicationName: "Confeccione",
  openGraph: {
    type: "website",
    siteName: "Confeccione",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
  },
  verification: {
    other: {
      "p:domain_verify": "d43c634ff3dd0e303a70944d1854ebf3",
    },
  },
};

const ORGANIZATION_JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://confeccione.com.br/#organization",
      name: "Confeccione",
      url: "https://confeccione.com.br",
      logo: {
        "@type": "ImageObject",
        url: "https://confeccione.com.br/icons/icon-512.png",
        width: 512,
        height: 512,
      },
      description:
        "Marketplace brasileiro que conecta empresas, marcas e escolas a confecções, facções e costureiras verificadas para fabricar uniformes, camisetas, fardamento e marca própria sob demanda.",
      areaServed: { "@type": "Country", name: "Brasil" },
      knowsLanguage: "pt-BR",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Travessa do Amorim, 66",
        addressLocality: "Recife",
        addressRegion: "PE",
        postalCode: "50030-070",
        addressCountry: "BR",
      },
      contactPoint: [
        {
          "@type": "ContactPoint",
          contactType: "customer support",
          telephone: "+55-81-99593-2695",
          email: "contato@confeccione.com.br",
          availableLanguage: ["Portuguese"],
        },
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://confeccione.com.br/#website",
      url: "https://confeccione.com.br",
      name: "Confeccione",
      inLanguage: "pt-BR",
      publisher: { "@id": "https://confeccione.com.br/#organization" },
    },
  ],
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSONLD) }}
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
