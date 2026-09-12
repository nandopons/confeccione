<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Confeccione — como trabalhar neste repo

Marketplace B2B de confecção (Recife/PE). Cliente monta pedido por chat, o Luigi
atende no WhatsApp, o pedido vai a leilão pras confecções. Quem opera é o
Fernando, sozinho. **Nada aqui é laboratório: tem cliente do outro lado.**

## Onde as coisas moram

| o quê | onde |
|---|---|
| migrations do Supabase | `supabase/migrations/` (NÃO `migrations/` na raiz) |
| agente do WhatsApp | `app/lib/luigi.ts` |
| cron principal | `app/api/cron/scheduler/route.ts` + `vercel.json` (`*/15`) |
| pedidos vivos | tabela `pedidos_assistente` + view `pedidos_assistente_etapas` |

Projeto Supabase `oumfvryxxxfgflvpqeow`. Vercel: team `team_w61bCCYbamjhUMFpg9UySFbS`,
projeto `prj_OK1W2iHYHy1Bby7VnmrIftjV6ch6`.

## Armadilhas que já custaram noites

**Os logs de runtime da Vercel deste projeto NÃO capturam `console.log`.** Só
aparecem as linhas de request. Diagnóstico escrito em `console.*` é diagnóstico
perdido, e motivo enterrado no JSON de resposta de um cron é quase o mesmo —
ninguém lê depois do fato. **Rotina que roda sozinha grava uma linha por execução
no Postgres** (ver `fechamento_automatico_log`), com o que fez e o motivo de cada
item pulado. O banco é o canal que se enxerga.

**Cheque `error` ANTES de usar `data`.** O PostgREST não erra calado: coluna
que não existe volta HTTP 400 com `42703` e o nome da coluna, seja no `select`,
no filtro ou no `order`. Quem engole isso somos nós — o supabase-js põe a falha
em `error` e deixa `data` como `null`, e o nosso `const x = (data ?? [])` vira
lista vazia. Aí um erro explícito (RLS, timeout, tipo errado) passa a parecer
"não tem dado". Se a consulta pode falhar, trate `error` e **mande o erro pro
Postgres, não pro console** — no console ele não existe. Falham calados de
verdade só dois: `NOT IN`, que exclui NULL sem avisar, e filtro em embed
aninhado, que não filtra a linha pai sem `!inner`.

**O scheduler aborta TUDO fora do horário comercial** (seg–sex, 8h–20h), logo no
topo do handler. Tarefa nova colocada depois dessa porteira simplesmente não
roda à noite nem no fim de semana. Se a tarefa é RESPOSTA a um cliente que está
esperando (e não abordagem), ela vai antes da porteira, com janela própria.

**Há duas eras de pedido.** `pedidos`/`ofertas` são a **era legada com call
sites vivos**: não recebem linha nova desde 28/06, mas ~20 pontos do código
ainda leem e escrevem nelas (`ofertas.ts`, `matching.ts`, `orfaos.ts`,
`planos.ts`, `fila.ts`, a TAREFA 1 do scheduler) e `/api/pedidos/criar` ainda
grava lá. Então: pra saber de pedido de hoje, leia
`pedidos_assistente`/`ofertas_pedido_assistente` — ler a tabela errada devolve
"nenhum pedido" com o pedido aberto na tela ao lado. Mas **não trate o código da
era legada como morto**: ele roda.

**Nono dígito:** o mesmo cliente aparece com 12 e com 13 dígitos. Case por
telefone sempre pelos **últimos 8 dígitos**, nunca por igualdade exata.

**Formato de imagem:** o `midia_mime` que a Meta manda mente. Detecte pelos bytes.

## Regras de comportamento do Luigi

Efeito de ferramenta se trava DENTRO da ferramenta, nunca só no prompt. Toda vez
que uma regra virou só instrução de texto, ela foi desobedecida em produção — e
o custo apareceu em cliente real. Se a regra importa, ela é código.

O que eu escrevo em resultado de ferramenta é **nota interna**, não frase pronta:
o modelo copia verbatim pro cliente se deixarem. Já saiu nome de coluna do banco
em mensagem de WhatsApp.

Quem tira o Luigi de uma conversa é o **clique** no "Devolver"/escalada
(`wa_conversas.luigi_escalado_em`), não o Fernando digitar. Ele digita pra cobrir
o Luigi, não pra assumir.

## Fluxo de trabalho

- **Use `npm run ship -- "mensagem em uma linha"`.** Ele roda `tsc`, roda
  `eslint` nos arquivos alterados, **para se qualquer um falhar**, e só então
  commita e empurra. Em 12/09 a regra "tsc limpo antes de commitar" morava só
  aqui neste arquivo, e foi quebrada juntando tudo numa linha: o commit
  aconteceu antes de alguém ler a saída do tsc e o build da Vercel falhou.
  Produção não serviu código quebrado por sorte do pipeline. Agora juntar as
  etapas numa linha É o caminho certo, porque a linha é o `ship`.
  `--no-push` no fim commita local. É a mesma regra do resto do projeto: efeito
  se trava dentro da ferramenta, nunca só no texto.
- Commit em **UMA linha**, sem `->`, sem aspas internas (o `ship` recusa os
  dois). Multi-linha já criou arquivo fantasma e engoliu o comando seguinte.
- `npx tsc --noEmit` acusa 3–4 erros em `.next/**/validator.ts` de páginas
  deletadas. É cache de build, não é seu código. **Zero erros fora de `.next/`**
  é o que conta.
- Mudou schema pelo SQL editor ou por MCP? **Crie o arquivo em
  `supabase/migrations/` também.** Banco novo precisa subir igual.
- Tabela nova nasce com `enable row level security`. O conteúdo aqui é dado
  operacional de cliente.
- Nunca rode `git` a partir de um container que monta esta pasta: ele escreve mas
  não apaga, quebra no meio e deixa `.git/index.lock` órfão travando o repo.

## Antes de teorizar sobre o Luigi, leia o log

`luigi_whatsapp_log` tem `status`, `escalado`, `rodadas`, `ferramentas`, `erro` e
`pedido_id` por turno. Quase toda suspeita de "o prompt está ruim" morre aí: o
que parecia teimosia do modelo costuma ser erro 400 da API, trava do código ou
turno estourando orçamento de tempo.
