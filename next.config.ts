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
 * prefixo derrubaria 5 paginas vivas e indexadas do sistema. Os artigos da
 * loja que um dia moraram em /saiba-mais/<slug> hoje sao atendidos pelo blog
 * do sistema com conteudo equivalente - ninguem cai em 404.
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
  // artigos do blog da loja, na raiz
  "como-criar-uma-marca-de-roupas",
  "por-que-gola-da-camisa-esgarca",
  "silk-dtf-dtg-tecnicas-estampa",
  "tingimento-sob-demanda-marcas-iniciantes",
];

// Prefixos com subcaminho: /produtos/camiseta-x/, /masculino/algo/ etc.
const PREFIXOS_DA_LOJA = ["produtos", "masculino", "feminino"];

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

const nextConfig: NextConfig = {
  images: {
    qualities: [75, 85],
  },
  async redirects() {
    return redirecionamentosDaLoja();
  },
};

export default nextConfig;
