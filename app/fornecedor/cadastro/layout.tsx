// app/fornecedor/cadastro/layout.tsx
// ============================================================================
// Layout server-component da rota /fornecedor/cadastro.
//
// Existe por um motivo so: dar metadata propria a essa pagina.
//
// A page.tsx e "use client" e client-component nao pode exportar `metadata`.
// Sem este arquivo, a rota herdava tudo do layout raiz - inclusive o `title`
// da home e o `alternates.canonical: "/"`.
//
// Efeito ate 19/08/2026: a pagina de cadastro dizia ao Google que a versao
// canonica dela era a home, e se apresentava com o titulo da home. Nunca
// ranqueou para "cadastrar confeccao", "quero ser fornecedor" e afins.
//
// O texto abaixo fala com quem produz - o outro lado do marketplace. A home
// fala com quem contrata. Intencoes de busca diferentes, paginas diferentes.
// ============================================================================

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cadastre sua confecção ou facção e receba pedidos",
  description:
    "Confecção, facção, ateliê ou costureira: cadastro gratuito para receber pedidos de uniformes, camisetas e marca própria direto no WhatsApp, com pagamento garantido.",
  alternates: { canonical: "/fornecedor/cadastro" },
  openGraph: {
    type: "website",
    siteName: "Confeccione",
    locale: "pt_BR",
    url: "/fornecedor/cadastro",
    title: "Cadastre sua confecção ou facção e receba pedidos | Confeccione",
    description:
      "Cadastro gratuito para confecções, facções, ateliês e costureiras receberem pedidos com pagamento garantido.",
  },
};

export default function CadastroFornecedorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
