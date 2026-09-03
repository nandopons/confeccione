import type { MetadataRoute } from "next";
import { getAllPosts } from "@/app/lib/blog";

/* ===========================================================================
 * sitemap.xml do sistema  -  confeccione.com.br
 * ---------------------------------------------------------------------------
 * 16/08/2026. Ate esta data o dominio nao tinha sitemap (404). Quem tinha era
 * so a loja, em loja.confeccione.com.br/sitemap.xml.
 *
 * Entram aqui apenas paginas publicas, sem login e sem token na URL. Tudo o
 * que esta no PRIVADO do robots.ts fica de fora - as duas listas precisam
 * continuar concordando uma com a outra.
 *
 * Os artigos vem de content/blog (markdown), pela mesma funcao que monta o
 * blog. Artigo novo entra no sitemap sozinho, sem editar este arquivo.
 * ---------------------------------------------------------------------------
 */

const SITE = "https://confeccione.com.br";

// Regerado uma vez por dia. O conteudo muda pouco e isso evita ler o disco
// a cada requisicao.
export const revalidate = 86400;

// `atualizado`: data da última mudança real de conteúdo. Antes era "agora" em
// toda regeneração, e o Google passa a ignorar lastModified quando ele muda
// todo dia sem a página mudar. Atualize a mão quando editar a página.
const PAGINAS: Array<{
  caminho: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  atualizado: string;
}> = [
  { caminho: "/", priority: 1.0, changeFrequency: "weekly", atualizado: "2026-09-03" },
  { caminho: "/saiba-mais", priority: 0.8, changeFrequency: "weekly", atualizado: "2026-09-03" },
  { caminho: "/sobre", priority: 0.6, changeFrequency: "yearly", atualizado: "2026-09-03" },
  { caminho: "/fornecedor/cadastro", priority: 0.7, changeFrequency: "monthly", atualizado: "2026-09-03" },
  { caminho: "/porto-digital", priority: 0.3, changeFrequency: "yearly", atualizado: "2026-08-16" },
  { caminho: "/privacidade", priority: 0.2, changeFrequency: "yearly", atualizado: "2026-09-03" },
  { caminho: "/termos", priority: 0.2, changeFrequency: "yearly", atualizado: "2026-09-03" },
];

/* A data do artigo vem do frontmatter e e digitada a mao. Se vier em formato
 * que o JS nao entende, o sitemap inteiro quebraria na serializacao - por isso
 * o fallback silencioso para agora. */
function dataSegura(valor: string): Date {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paginas: MetadataRoute.Sitemap = PAGINAS.map((p) => ({
    url: `${SITE}${p.caminho}`,
    lastModified: dataSegura(p.atualizado),
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  let artigos: MetadataRoute.Sitemap = [];
  try {
    const posts = await getAllPosts();
    artigos = posts.map((post) => ({
      url: `${SITE}/saiba-mais/${post.slug}`,
      lastModified: dataSegura(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.7,
    }));
  } catch {
    // Se a leitura do markdown falhar no build, e melhor publicar um sitemap
    // so com as paginas fixas do que derrubar a rota inteira.
    artigos = [];
  }

  return [...paginas, ...artigos];
}
