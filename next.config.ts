import type { NextConfig } from "next";

/* ===========================================================================
 * 301 da loja: confeccione.com.br  ->  loja.confeccione.com.br
 * ---------------------------------------------------------------------------
 * 16/08/2026. A loja Nuvemshop saiu da raiz e do www e foi para o subdominio
 * loja.confeccione.com.br. A raiz e o www agora sao deste app (o sistema).
 *
 * As URLs antigas da loja continuam sendo pedidas neste dominio por um bom
 * tempo: links indexados, backlinks, anuncios antigos, historico do navegador.
 * Sem estas regras, todas viram 404 aqui.
 *
 * A estrutura de caminho e identica nos dois dominios, entao o mapa e 1:1.
 * As 17 URLs de destino foram testadas em 16/08/2026 - todas respondem 200
 * em loja.confeccione.com.br.
 *
 * ---------------------------------------------------------------------------
 * O QUE **NAO** ENTRA AQUI
 * ---------------------------------------------------------------------------
 * /saiba-mais/*  ->  e o blog DESTE app (app/saiba-mais). Redirecionar esse
 * prefixo derrubaria 5 paginas vivas e indexadas do sistema.
 *
 * Tambem ficam de fora, porque sao rotas do app:
 *   /  /admin  /alinhar  /api  /artes  /cliente  /fornecedor  /inscricao
 *   /orcamento  /porto-digital  /privacidade  /sobre  /visualizador
 *
 * ---------------------------------------------------------------------------
 * O INTERRUPTOR
 * ---------------------------------------------------------------------------
 * As regras so existem quando a variavel de ambiente LOJA_MIGRADA estiver com
 * valor "1" no projeto da Vercel. Se algo der errado, desliga a variavel e o
 * deploy seguinte volta ao estado anterior, sem reverter commit.
 *
 * Vercel > Project confeccione > Settings > Environment Variables
 *   LOJA_MIGRADA = 1     (Production)
 * ---------------------------------------------------------------------------
 */

const LOJA = "https://loja.confeccione.com.br";

// Paginas de nivel raiz que pertenciam a loja. Vieram do sitemap.xml de
// confeccione.com.br lido em 15/08/2026 (74 URLs no total).
const PAGINAS_DA_LOJA = [
  // institucionais
  "contato",
  "quem-somos",
  "perguntas-frequentes",
  "trocas-e-devolucoes",
  "politica-de-privacidade",
  "politicas-de-entrega",
  // categorias sem subcaminho no sitemap
  "infantil",
  "design",
  "modelista",
];

// Prefixos com subcaminho: /produtos/camiseta-x/, /masculino/algo/ etc.
const PREFIXOS_DA_LOJA = ["produtos", "masculino", "feminino"];

/* ---------------------------------------------------------------------------
 * ARTIGOS: FICAM NO SISTEMA
 * ---------------------------------------------------------------------------
 * 16/08/2026. Decisao do Fernando: o blog continua sendo o do sistema, em
 * /saiba-mais/<slug> (content/blog, markdown). A loja tem copias dos mesmos
 * quatro artigos, e ate agora estas quatro URLs de raiz apontavam para la -
 * o que mandava a autoridade dos links antigos para a copia, e nao para o
 * original.
 *
 * Agora a raiz aponta para o blog deste app. O destino e relativo de
 * proposito: o visitante nao troca de dominio no meio do caminho.
 * ---------------------------------------------------------------------------
 */
const ARTIGOS_DO_BLOG = [
  "como-criar-uma-marca-de-roupas",
  "por-que-gola-da-camisa-esgarca",
  "silk-dtf-dtg-tecnicas-estampa",
  "tingimento-sob-demanda-marcas-iniciantes",
];

function redirecionamentosDaLoja() {
  if (process.env.LOJA_MIGRADA !== "1") return [];

  return [
    // /produtos, /produtos/qualquer/coisa
    ...PREFIXOS_DA_LOJA.flatMap((p) => [
      { source: `/${p}`, destination: `${LOJA}/${p}`, permanent: true },
      {
        source: `/${p}/:path*`,
        destination: `${LOJA}/${p}/:path*`,
        permanent: true,
      },
    ]),
    // paginas soltas
    ...PAGINAS_DA_LOJA.map((p) => ({
      source: `/${p}`,
      destination: `${LOJA}/${p}`,
      permanent: true,
    })),
    // artigos: continuam neste dominio, no blog do sistema
    ...ARTIGOS_DO_BLOG.map((slug) => ({
      source: `/${slug}`,
      destination: `/saiba-mais/${slug}`,
      permanent: true,
    })),
    // sitemap do blog da loja
    {
      source: "/sitemap_blog.xml",
      destination: `${LOJA}/sitemap_blog.xml`,
      permanent: true,
    },
  ];
}

/* Se um dia o sistema quiser usar /design ou /modelista como rota propria,
 * tire o nome de PAGINAS_DA_LOJA - senao a rota nova nunca sera alcancada,
 * porque o redirect vem antes.
 */

/* ===========================================================================
 * DOMINIOS DA VERCEL FORA DO INDICE
 * ---------------------------------------------------------------------------
 * 16/08/2026. confeccione.vercel.app respondia 200 com o site inteiro e sem
 * nenhum sinal de noindex - ou seja, o Google podia indexar uma copia
 * completa do site num dominio que nao e o nosso. O mesmo vale para as URLs
 * de preview de cada deploy.
 *
 * O X-Robots-Tag resolve no cabecalho, sem tocar em nenhuma pagina. O regex
 * pega qualquer subdominio .vercel.app; o dominio proprio nao casa e continua
 * indexavel normalmente.
 * ---------------------------------------------------------------------------
 */
function cabecalhosDeIndexacao() {
  return [
    {
      source: "/:path*",
      has: [
        {
          type: "host" as const,
          value: "(?<vercelsub>.*)\\.vercel\\.app",
        },
      ],
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 85],
  },
  async redirects() {
    return redirecionamentosDaLoja();
  },
  async headers() {
    return cabecalhosDeIndexacao();
  },
};

export default nextConfig;
