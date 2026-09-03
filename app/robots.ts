import type { MetadataRoute } from "next";

/* ===========================================================================
 * robots.txt do sistema  -  confeccione.com.br
 * ---------------------------------------------------------------------------
 * 16/08/2026. Ate esta data o dominio nao tinha robots.txt (404). Sem ele o
 * Google encontra o site, mas nao encontra o sitemap - e os rastreadores
 * entram nas areas internas (admin, painel do fornecedor, area do cliente).
 *
 * Gerado pelo Next em /robots.txt.
 *
 * ---------------------------------------------------------------------------
 * RASTREADORES DE IA - LIBERADOS DE PROPOSITO
 * ---------------------------------------------------------------------------
 * O bloco de baixo repete a mesma permissao para os robos de IA. Isso NAO e
 * redundante: pela especificacao, quando existe um grupo com o nome do robo,
 * ele passa a ignorar o grupo "*". Se um dia alguem apertar as regras do "*",
 * os robos de IA continuam com uma regra explicita e nao ficam de fora.
 *
 * A escolha e deliberada: queremos que o ChatGPT, o Claude, o Perplexity e o
 * Gemini consigam ler e citar o blog. E o mesmo conteudo que ja esta aberto
 * pro Google - nao ha nada exclusivo sendo entregue.
 *
 * Para BLOQUEAR treinamento de IA um dia, o caminho e trocar allow por
 * disallow neste segundo grupo. Vale saber o que se perde: sair do indice
 * dessas ferramentas tambem tira a marca das respostas delas.
 * ---------------------------------------------------------------------------
 */

const SITE = "https://confeccione.com.br";

/* Areas internas: exigem login, nao tem valor de busca e algumas expoem
 * dados de pedido em URL com token. Ficam fora do rastreamento. */
const PRIVADO = [
  "/admin",
  "/api/",
  "/cliente",
  "/artes/",
  "/alinhar/",
  "/visualizador/",
  "/inscricao/",
  "/orcamento/",
  "/fornecedor/painel",
  "/fornecedor/entrar",
  "/sonda-teclado.html",
];

/* Robos de IA e de busca por IA. Nomes conforme a documentacao publica de
 * cada empresa em 16/08/2026 - vale reconferir de tempos em tempos. */
const ROBOS_DE_IA = [
  "GPTBot", // OpenAI - treinamento
  "OAI-SearchBot", // OpenAI - indice do ChatGPT Search
  "ChatGPT-User", // OpenAI - visita quando o usuario pede
  "ClaudeBot", // Anthropic
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot", // Perplexity - indice
  "Perplexity-User",
  "Google-Extended", // Gemini / Vertex
  "Applebot-Extended", // Apple Intelligence
  "meta-externalagent", // Meta AI
  "Amazonbot",
  "CCBot", // Common Crawl - alimenta varios modelos
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVADO,
      },
      {
        userAgent: ROBOS_DE_IA,
        allow: "/",
        disallow: PRIVADO,
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
