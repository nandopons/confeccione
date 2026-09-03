import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import { getAllPosts } from "@/app/lib/blog";

export const metadata: Metadata = {
  title: "Blog de Confecção: Produção, Estampa e Marca Própria",
  description:
    "Guias escritos por quem está dentro da indústria têxtil: como criar sua marca, escolher estampa (silk, DTF, DTG), tingimento, qualidade de costura e como contratar uma fábrica.",
  alternates: {
    canonical: "/saiba-mais",
  },
  openGraph: {
    type: "website",
    siteName: "Confeccione",
    title: "Blog de Confecção: Produção, Estampa e Marca Própria | Confeccione",
    description:
      "Guias de quem está dentro da indústria têxtil: marca própria, estampa, tingimento, costura e como contratar uma fábrica.",
    url: "/saiba-mais",
    locale: "pt_BR",
  },
};

function formatarData(iso: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
}

export default async function SaibaMaisIndex() {
  const posts = await getAllPosts();

  return (
    <main className="min-h-screen bg-white font-sans">
      <SiteHeader />

      <section className="px-6 pt-10 pb-16 max-w-3xl mx-auto">
        <h1 className="text-gray-900 text-2xl md:text-3xl font-medium mb-2">Saiba mais</h1>
        <p className="text-gray-500 text-sm md:text-base mb-10">
          Guias práticos de quem está dentro da indústria têxtil: produção, estampa, tecidos, marca própria e como contratar uma confecção.
        </p>

        {posts.length === 0 ? (
          <div className="border border-gray-200 rounded-2xl p-8 text-center">
            <p className="text-gray-500 text-sm">Nenhum artigo publicado ainda. Volte em breve.</p>
          </div>
        ) : (
          <ul className="space-y-5">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/saiba-mais/${post.slug}`}
                  className="block border border-gray-200 rounded-2xl p-6 hover:border-[#1D9E75] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">
                      {post.category}
                    </span>
                    <span className="text-xs text-gray-400">{post.readingTime}</span>
                  </div>
                  <h2 className="text-gray-900 text-lg md:text-xl font-medium mb-2 leading-tight">
                    {post.title}
                  </h2>
                  <p className="text-gray-500 text-sm leading-relaxed mb-3">{post.description}</p>
                  <p className="text-xs text-gray-400">
                    <time dateTime={post.date}>{formatarData(post.date)}</time>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
