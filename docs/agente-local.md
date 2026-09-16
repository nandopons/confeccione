# Agente local no Windows — o que é, o que NÃO é, e por onde começar

Escrito em 16/09/2026 pra uma sessão nova (Claude Code ou Cowork) abrir no
Windows do Fernando e já saber o que fazer. **Leia inteiro antes de escrever
código.** Tudo aqui foi medido no banco de produção; nada é palpite.

## Por que existe

A conta de IA está cara pro tamanho da operação. Medido em `uso_ia`, 14 dias
até 16/09 (`custo_micro` é **USD × 100.000** — `uso-ia.ts`; não é ×1e6, e esse
erro de leitura já custou uma decisão errada):

```
rota                 chamadas   USD/14d   %      USD/chamada   cache
luigi-responde         1.092    46,12    53%      0,042        22%
gestao-whatsapp          352    23,03    27%      0,065         9%
captacao-busca            26     9,89    12%      0,380         0%
assistente               157     3,11     4%      0,020        49%
captacao-resposta        133     2,63     3%      0,020         0%
outros                                   <2%
                                 ─────
                                 85,58   → ~US$ 180–200/mês neste ritmo
```

## A decisão: o que vai pro Windows e o que fica

**Luigi FICA na nuvem.** Em 30 dias, de 1.292 mensagens de cliente, **36%
chegaram entre 20h e 7h e 21% em fim de semana.** Cliente que escreve às 23h e
é respondido às 9h já falou com duas outras confecções. Em 15/09 o Guilherme
ficou 12h sem resposta por um apagão de saldo — é isso que um PC desligado
faria todo dia. Responder rápido é o produto, não é custo.

**Vai pro Windows o que não precisa de tempo real — 42% da conta:**

| rota | por quê pode | o que faz |
|---|---|---|
| `gestao-whatsapp` | só existe quando o Fernando conversa com ele | responde o Fernando no WhatsApp: consultas, pauta, ações no admin |
| `captacao-busca` | é cron; a chamada mais cara do sistema (US$ 0,38, cache 0) | busca confecções na web/Places pra um pedido e extrai nome/cidade/telefone |
| `assistente` | batch | assistente pessoal (ver `assistente-pessoal-projeto`) |

Quando o PC está desligado, essas três simplesmente esperam. É aceitável por
desenho — o Fernando disse que "eventualmente" o PC fica ligado, e nenhuma das
três tem cliente do outro lado esperando.

**E o corte mais barato vem ANTES de qualquer hardware:** rodada do Luigi sem
ferramenta em modelo menor (Haiku). A maioria das rodadas da noite não chama
ferramenta nenhuma — "qual a grade?", "e o público?". Zero risco no turno
difícil, que continua no modelo forte. Isso é a **Fase 0** e é independente do
Windows.

## A máquina: 64 GB de RAM, NVIDIA de 8 GB

Os 8 GB de VRAM são o limite, não os 64 de RAM:

- **7–9B em Q4 (~5 GB) cabe inteiro na GPU** → rápido (dezenas de tok/s).
  Qwen2.5 7B / Qwen3 8B / Llama 3.1 8B. É o ponto de partida.
- **14B em Q4 (~9 GB) não cabe** → parte vai pra CPU via RAM. Com 64 GB é
  possível, mas cai pra ~5–10 tok/s. Aceitável pra `captacao-busca` (batch),
  ruim pra gestão (o Fernando esperando resposta no WhatsApp).
- **32B+ é inviável** nessa placa pra uso interativo.

O que precisa de cada rota:

- `captacao-busca`: pesquisa (ferramenta) + extrair campos de texto. **Um 8B
  faz.** O difícil já está no código (as travas do `cadastrar_confeccao`,
  `pecaValida`, mínimo numérico) — o modelo só precisa preencher direito.
- `gestao-whatsapp`: SQL via ferramentas + resumir + redigir pro Fernando.
  8B dá pra começar; se ficar burro, 14B com offload e aceitar a espera.
- Nenhuma das três precisa de **visão**. Foto de cliente é Luigi, que fica.

**Não compre nada antes de medir.** Se o 8B não servir, o upgrade natural é
uma placa de 24 GB (RTX 3090 usada), não um PC novo — mas isso só depois da
Fase 1 dizer que precisa.

## Arquitetura: o PC PUXA, nunca recebe

Não exponha porta nenhuma no Windows. Nem túnel. O desenho que funciona pra
máquina que liga e desliga:

```
Meta → webhook (Vercel) → grava na fila (Supabase) ──┐
                                                     │  o PC lê quando está ligado
Windows: worker Node ←── poll a cada N s ────────────┘
         │
         ├─ chama o modelo em localhost (Ollama / llama.cpp)
         ├─ executa as mesmas ferramentas (mesmo código de app/lib)
         └─ envia pelo WhatsApp Cloud API direto (saída não precisa de porta)
```

- `gestao-whatsapp`: hoje o webhook chama `responderGestao` em `after()`.
  Passa a **enfileirar** (uma tabela `fila_agente` ou flag em `wa_mensagens`),
  e o worker do PC consome. Vercel nunca chama o PC.
- `captacao-busca`: hoje é `app/api/cron/captacao-pedidos`. O worker roda a
  mesma função no próprio relógio. **Uma flag em `agentes_config` decide quem
  é o dono** (`executor: 'vercel' | 'pc'`) — os dois rodando ao mesmo tempo é
  oferta em dobro pra confecção, e confecção é o ativo escasso.
- Se o PC ficar 3 dias desligado, a fila acumula e o cron da Vercel NÃO
  assume sozinho. Isso é decisão do Fernando, não fallback automático — um
  fallback silencioso é exatamente o tipo de coisa que este repo aprendeu a
  não ter (ver AGENTS.md, "Armadilhas").

## O modelo fala Anthropic, o servidor local fala OpenAI

Seis lugares criam `new Anthropic({ apiKey })`:

```
app/lib/luigi.ts:3304            (fica)
app/lib/captacao-pedido.ts:566   captacao-busca  ← vai
app/lib/captacao-pedido.ts:2312  captacao-resposta (fica: tempo real)
app/lib/gestao-whatsapp.ts:1270  gestão          ← vai
app/lib/pesquisa-preco.ts:58
app/lib/verificar-mockup.ts:233
```

Ollama/vLLM/llama.cpp expõem API **OpenAI-compatível**; o código usa o SDK da
Anthropic (blocos `tool_use`, `cache_control`). Duas saídas, a decidir na
primeira sessão:

1. **Proxy LiteLLM no Windows** expondo `/v1/messages` no formato Anthropic e
   traduzindo pro Ollama. O código muda só o `baseURL` por rota, via env.
   Menos código; a tradução de tool-calling é do LiteLLM — **conferir que
   funciona com as ferramentas reais antes de confiar**.
2. **Adaptador próprio** (`app/lib/ia-provider.ts`), no mesmo padrão do
   `mockup-image.ts`: "trocar provedor = um arquivo + env". Mais código, sem
   dependência.

Em qualquer caso: **um único ponto** que devolve o cliente por rota. Seis
`new Anthropic` espalhados é o mesmo defeito que já custou noites em
`linhasComAjuste`.

## Fases, nesta ordem

**Fase 0 — Luigi em modelo menor nas rodadas simples.** Nuvem, sem hardware.
Critério de "simples": rodada que não chama ferramenta (medir a proporção
antes). Mede custo por rodada antes/depois, e a taxa de `chamar_humano` — se
subir, o modelo menor está errando.

**Fase 1 — servidor de inferência no Windows + benchmark com casos reais.**
Instala Ollama (ou llama.cpp), puxa um 8B, e roda **os prompts reais** de
`captacao-busca` e `gestao-whatsapp` contra 20 casos do log
(`luigi_whatsapp_log` não tem a captação — ela grava só em `wa_mensagens`;
gestão está em `gestao_whatsapp_log`). Compara saída com o que o Claude deu.
Sem isso, o resto é fé.

**Fase 2 — o ponto único de provedor** (item acima). Sobe com tudo ainda
apontando pra Anthropic; zero mudança de comportamento. `npm run ship`.

**Fase 3 — worker no PC + fila.** `scripts/worker-local.mjs` (ou pasta
própria): poll na fila, roda a função da rota, envia. Flag `executor` em
`agentes_config`. Começa por `captacao-busca` (batch, sem ninguém esperando);
gestão depois.

**Fase 4 — duas semanas medindo.** Custo por rota, latência, e qualidade:
pra captação, quantas confecções encontradas passam nas travas do cadastro;
pra gestão, quantas respostas o Fernando teve que corrigir. Só então decidir
se vale mexer no Luigi — e provavelmente não vale.

## O que NÃO fazer

- Não mover o Luigi. Os números acima explicam.
- Não expor porta nem túnel no Windows.
- Não deixar Vercel e PC donos da mesma rota ao mesmo tempo.
- Não pôr segredo neste arquivo. Envs necessárias no PC, só o nome:
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, as do WhatsApp
  Cloud API, e `WHATSAPP_GESTAO_NUMEROS` — esta última **existe em produção e
  NÃO existe no `.env.local`**; script que filtra por ela roda vazio em
  silêncio (já aconteceu, ver `confeccione-imagem-do-cliente`).
- Não rodar `git` de container/sandbox — trava `index.lock`. Commit é
  `npm run ship` (tsc → eslint → commit → push, parando se qualquer um falhar).

## Regras do repo que valem aqui igual

Estão no `AGENTS.md`; as que mais mordem neste trabalho:

- **Se o código PRECISA que o modelo faça algo, não é campo opcional — é
  erro.** Um 8B obedece menos que o Claude; as travas importam mais, não menos.
- **Mede antes de desenhar.** Toda afirmação sobre campo do banco: ache quem
  escreve nele primeiro (`confeccione-campos-fantasma`).
- **Confecção é o ativo escasso.** Nada do que o worker fizer pode mandar
  oferta ou sondagem sem passar pelas mesmas travas de hoje.
- Fuso: banco em UTC, tela em Recife. `(now() at time zone 'America/Recife')::date + interval '21 hours'` vira UTC por baixo do pano.

## Linha de base (16/09/2026), pra comparar depois

- `uso_ia` 14 dias: US$ 85,58; gestão 27%, captacao-busca 12%. **Atenção ao
  comparar: 15/09 fechou em US$ 3,25 porque o saldo zerou das 10:55 às 13:22 —
  foi dia PARADO, não dia barato.** Dia útil com movimento fica em US$ 10–18;
  o pico de 27,68 (09/09) foi o agente de gestão descontrolado.
- captacao-busca: 26 chamadas, US$ 0,38 cada, cache 0%.
- Sondagem 7 dias: 80 → 50 entregues → 24 responderam → **0 cadastros**
  (o fechamento da captação é problema separado, pendente — ver
  `confeccione-captacao-sem-link`; não é o modelo, é roteamento e registro).
- Luigi: mediana de rodadas por turno 1,0; ~9 s de modelo por turno.

## Pendências que NÃO são deste trabalho (pra não misturar)

Fila de oferta automática em andamento (passo 2 de 5 fechou em `2381c12`,
16/09 — o estado dela muda todo dia, não confie neste parágrafo, confie no
`DEBT.md`); captação itens 1, 2, 4, 6, 7; portfólio da confecção por foto; os
26 em `pedido_completo`.
Estão no `DEBT.md` e nas memórias do Cowork. Este documento é só o agente
local.
