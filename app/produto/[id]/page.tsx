// app/produto/[id]/page.tsx
// ============================================================================
// Página pública de um produto do portfólio de um fornecedor.
//
// Decisão do Fernando (04/09/2026): o card da home deixa de jogar o cliente no
// chat genérico. Ele abre ESTE produto, vê a ficha e pede DIRETO pra aquela
// confecção — o pedido nasce vinculado só a ela.
//
// Preço não aparece: continua saindo apenas na oferta, como no resto do
// marketplace. A página vende a peça e a confecção, não um número.
// ============================================================================

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import { getOutrosDoFornecedor, getProdutoPublico } from "@/app/lib/portfolio-fornecedor";
import { SITE_URL } from "@/app/lib/url";
import FormPedidoProduto from "./FormPedidoProduto";

export const revalidate = 300;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await getProdutoPublico(id);
  if (!p?.nome) return { title: "Produto | Confeccione", robots: { index: false } };

  const local = [p.fornecedorCidade, p.fornecedorUf].filter(Boolean).join("/");
  const descricao = [
    `${p.nome} produzida por confecção parceira da Confeccione${local ? ` em ${local}` : ""}.`,
    p.pedidoMinimo ? `Pedido mínimo de ${p.pedidoMinimo} peças.` : null,
    "Peça um orçamento sem compromisso.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: `${p.nome} | Confeccione`,
    description: descricao,
    alternates: { canonical: `${SITE_URL}/produto/${p.id}` },
    openGraph: {
      title: `${p.nome} | Confeccione`,
      description: descricao,
      url: `${SITE_URL}/produto/${p.id}`,
      images: [{ url: p.url, width: p.largura, height: p.altura }],
      type: "article",
    },
  };
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <dt className="text-gray-500 text-sm w-32 shrink-0">{rotulo}</dt>
      <dd className="text-gray-900 text-sm">{valor}</dd>
    </div>
  );
}

export default async function ProdutoPage({ params }: Props) {
  const { id } = await params;
  const p = await getProdutoPublico(id);
  // Sem ficha preenchida não existe página: seria só uma foto grande, e o card
  // da home nem oferece o link nesse caso.
  if (!p?.nome) notFound();

  const outros = await getOutrosDoFornecedor(p.fornecedorId, p.id);
  const local = [p.fornecedorCidade, p.fornecedorUf].filter(Boolean).join("/");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.nome,
    image: p.url,
    description: [p.tecido, p.cores, p.tecnicas].filter(Boolean).join(" · ") || p.nome,
    // O JSON-LD continua declarando a categoria: ela é sinal pro buscador,
    // que entende taxonomia, e não ocupa espaço na página.
    category: p.tipo ?? undefined,
    brand: { "@type": "Organization", name: "Confeccione" },
    manufacturer: p.fornecedorNome
      ? { "@type": "Organization", name: p.fornecedorNome }
      : undefined,
  };

  return (
    <main className="bg-white min-h-screen font-sans">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />

      <div className="max-w-5xl mx-auto px-5 md:px-8 py-8 md:py-12">
        <nav className="text-xs text-gray-400 mb-6">
          <Link href="/" className="hover:text-gray-700">
            Início
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-gray-600">{p.nome}</span>
        </nav>

        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          <div className="rounded-2xl overflow-hidden bg-gray-100">
            <Image
              src={p.url}
              alt={p.nome}
              width={p.largura}
              height={p.altura}
              sizes="(min-width: 768px) 45vw, 100vw"
              priority
              className="w-full object-cover aspect-[4/5]"
            />
          </div>

          {/* Sem etiqueta de categoria acima do título (05/09/2026). "Private
              Label" é jargão de quem produz, não de quem compra, e dizia menos
              sobre a peça do que a própria foto e o nome logo abaixo. */}
          <div>
            <h1 className="text-gray-900 text-2xl md:text-3xl font-medium leading-tight">
              {p.nome}
            </h1>
            <p className="text-gray-500 text-sm mt-2">
              Produzido por {p.fornecedorNome ?? "confecção parceira"}
              {local ? ` · ${local}` : ""}
            </p>

            <dl className="mt-6 border-t border-gray-100">
              <Linha rotulo="Tecido" valor={p.tecido} />
              <Linha rotulo="Cores" valor={p.cores} />
              <Linha rotulo="Tamanhos" valor={p.tamanhos} />
              <Linha rotulo="Personalização" valor={p.tecnicas} />
              <Linha
                rotulo="Pedido mínimo"
                valor={p.pedidoMinimo ? `${p.pedidoMinimo} peças` : null}
              />
              <Linha
                rotulo="Prazo"
                valor={p.prazoDias ? `${p.prazoDias} dias úteis (estimado)` : null}
              />
            </dl>

            {p.observacoes && (
              <p className="text-gray-600 text-sm leading-relaxed mt-5 whitespace-pre-line">
                {p.observacoes}
              </p>
            )}

            <p className="text-gray-400 text-xs mt-5 leading-relaxed">
              O preço sai no orçamento: a confecção responde com o valor depois de ver a
              quantidade e a personalização que você precisa. Sem compromisso.
            </p>
          </div>
        </div>

        <div className="mt-10 md:mt-14 border-t border-gray-100 pt-8">
          <h2 className="text-gray-900 text-lg md:text-xl font-medium mb-1">
            Pedir para esta confecção
          </h2>
          <p className="text-gray-500 text-sm mb-5">
            Seu pedido vai direto para {p.fornecedorNome ?? "esta confecção"}. Se ela não puder
            atender, a gente te avisa e busca outra opção.
          </p>
          <FormPedidoProduto
            produtoId={p.id}
            produtoNome={p.nome}
            pedidoMinimo={p.pedidoMinimo}
            fornecedorNome={p.fornecedorNome}
          />
        </div>

        {outros.length > 0 && (
          <div className="mt-12 border-t border-gray-100 pt-8">
            <h2 className="text-gray-900 text-lg font-medium mb-4">
              Outras peças desta confecção
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {outros.map((o) => (
                <li key={o.id} className="rounded-xl overflow-hidden bg-gray-100 relative group">
                  <Link href={`/produto/${o.id}`} className="block">
                    <Image
                      src={o.url}
                      alt={o.nome ?? "Outra peça desta confecção"}
                      width={o.largura}
                      height={o.altura}
                      sizes="(min-width: 640px) 22vw, 45vw"
                      loading="lazy"
                      className="w-full object-cover aspect-[4/5]"
                    />
                    {o.nome && (
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 text-white text-xs font-medium">
                        <span className="block truncate">{o.nome}</span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}
