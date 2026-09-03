import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import { getAllPosts, getAllSlugs, getPostBySlug } from "@/app/lib/blog";

const SITE_URL = "https://confeccione.com.br";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const slugs = await getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};

  const url = `${SITE_URL}/saiba-mais/${slug}`;
  const ogImage = post.metadata.image
    ? post.metadata.image.startsWith("http")
      ? post.metadata.image
      : `${SITE_URL}${post.metadata.image}`
    : undefined;

  return {
    title: post.metadata.title,
    description: post.metadata.description,
    keywords: post.metadata.keywords,
    authors: [{ name: post.metadata.author }],
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "Confeccione",
      title: post.metadata.title,
      description: post.metadata.description,
      url,
      locale: "pt_BR",
      publishedTime: `${post.metadata.date}T00:00:00-03:00`,
      authors: [post.metadata.author],
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: post.metadata.title,
      description: post.metadata.description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

function formatarData(iso: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  } catch {
    return iso;
  }
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const { metadata: meta, contentHtml } = post;
  const relacionados = (await getAllPosts()).filter((p) => p.slug !== slug).slice(0, 3);
  const url = `${SITE_URL}/saiba-mais/${slug}`;
  const ogImage = meta.image
    ? meta.image.startsWith("http")
      ? meta.image
      : `${SITE_URL}${meta.image}`
    : undefined;

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: `${meta.date}T00:00:00-03:00`,
    dateModified: `${meta.date}T00:00:00-03:00`,
    inLanguage: "pt-BR",
    author: { "@type": "Organization", name: meta.author, url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "Confeccione",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icons/icon-512.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    ...(ogImage ? { image: ogImage } : {}),
    ...(meta.keywords.length > 0 ? { keywords: meta.keywords.join(", ") } : {}),
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Saiba mais", item: `${SITE_URL}/saiba-mais` },
      { "@type": "ListItem", position: 3, name: meta.title, item: url },
    ],
  };

  return (
    <main className="min-h-screen bg-white font-sans">
      <SiteHeader />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <article className="px-6 pt-8 pb-16 max-w-2xl mx-auto">
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-gray-400">
          <ol className="flex items-center gap-1.5 flex-wrap">
            <li>
              <Link href="/" className="hover:text-[#0F6E56]">Início</Link>
            </li>
            <li aria-hidden="true">›</li>
            <li>
              <Link href="/saiba-mais" className="hover:text-[#0F6E56]">Saiba mais</Link>
            </li>
            <li aria-hidden="true">›</li>
            <li className="text-gray-600 truncate max-w-[60vw]" aria-current="page">{meta.title}</li>
          </ol>
        </nav>

        <header className="mb-8">
          <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full inline-block mb-4">
            {meta.category}
          </span>
          <h1 className="text-gray-900 text-2xl md:text-4xl font-medium leading-tight mb-4">
            {meta.title}
          </h1>
          <p className="text-gray-500 text-sm md:text-base leading-relaxed mb-5">
            {meta.description}
          </p>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>{meta.author}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={meta.date}>{formatarData(meta.date)}</time>
            <span aria-hidden="true">·</span>
            <span>{meta.readingTime}</span>
          </div>
        </header>

        {ogImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ogImage}
            alt={meta.title}
            className="w-full rounded-2xl mb-8 border border-gray-200"
          />
        )}

        <div
          className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-headings:font-medium prose-a:text-[#0F6E56] prose-a:no-underline hover:prose-a:underline prose-code:text-[#0F6E56] prose-blockquote:border-l-[#1D9E75] prose-blockquote:text-gray-600"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />

        {relacionados.length > 0 && (
          <aside className="mt-12 border-t border-gray-200 pt-8" aria-labelledby="leia-tambem">
            <h2 id="leia-tambem" className="text-gray-900 text-lg font-medium mb-4">Leia também</h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {relacionados.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/saiba-mais/${r.slug}`}
                    className="block h-full border border-gray-200 rounded-2xl p-4 hover:border-[#1D9E75] transition-colors"
                  >
                    <span className="text-[11px] text-[#0F6E56] font-medium">{r.category}</span>
                    <p className="text-gray-900 text-sm font-medium leading-snug mt-1">{r.title}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <footer className="mt-12 border-t border-gray-200 pt-8">
          <div className="bg-[#F7FBF9] border border-[#E1F5EE] rounded-2xl p-6 text-center">
            <p className="text-gray-900 font-medium mb-2">Pronto para produzir suas peças?</p>
            <p className="text-gray-500 text-sm mb-5">
              Receba orçamentos de fornecedores verificados em até 24h.
            </p>
            <Link
              href="/#pedido"
              className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-medium px-6 py-3 rounded-xl text-sm transition-colors"
            >
              Faça seu pedido
            </Link>
            <p className="text-xs text-gray-400 mt-4">
              É confecção ou facção?{" "}
              <Link href="/fornecedor/cadastro" className="text-[#0F6E56] font-medium hover:underline">
                Cadastre-se para receber pedidos
              </Link>
            </p>
          </div>
        </footer>
      </article>
      <SiteFooter />
    </main>
  );
}
