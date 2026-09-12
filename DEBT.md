# Débito técnico — Confeccione

Registro de débitos e decisões adiadas. Cada item diz **o que**, **por que importa** e **como revisitar**.

---

## 🔴 A FAMÍLIA: entregar errado em silêncio

Três casos já aconteceram, e são a mesma doença — o sistema entrega ao cliente uma coisa
diferente do que ele pediu, **sem que nenhum dos dois lados tenha como saber**. Não há erro, não
há log, não há reclamação: o cliente supõe que foi atendido. É a classe mais cara do projeto
porque o custo só aparece quando ele some.

| # | caso | o que o cliente recebia | como se descobriu |
|---|---|---|---|
| 1 | **PDF da prévia velha** | o resumo mostrava a prévia ANTERIOR junto com a nova — o Wesley viu lado a lado a versão que ele tinha mandado mudar | o Fernando abriu o PDF na mão |
| 2 | **`descricao` que não gravava** | a peça saía sem os detalhes que ele descreveu | — |
| 3 | **"Atualizar mockup" que regerava do zero** | pedia um retoque e recebia **outra peça** | caiu por acaso, olhando outro problema |

### O caso 3, o mais caro da rodada de 12/09
Em 5 pedidos, `mockups[i].ia[].url` estava no formato de URL de exibição. `lerImagem` devolvia
`null` pra esse formato **sem uma linha de log**, e o `carregarImagens` faz
`.filter((x) => x !== null)` — engole calado. Resultado: `baseAjuste` chegava nulo em
`gerarMockupDoModelo`, e o "Atualizar mockup" caía no galho de geração NOVA em vez de ajuste.

O cliente clicava em "Atualizar", esperava, e recebia uma peça diferente — não a dele retocada.
Do lado dele parece que a gente não entendeu. Do nosso lado, não existia.

### O que as três têm em comum
**Um `null`, um `catch` ou um `?? []` tratado como "não tem", quando na verdade era "deu erro".**
É o mesmo parágrafo do AGENTS.md sobre `(data ?? [])`, aplicado a imagem em vez de consulta.

### Como não ter o quarto
Filtro que descarta item de uma lista **tem que dizer quantos descartou** quando o número não
for zero — no Postgres, não no console (ver a armadilha dos logs no AGENTS.md). Silêncio só é
aceitável quando "vazio" e "falhou" são a mesma resposta, e quase nunca são.

---

## 🔴 Geração de mockup estoura o tempo da função — e mata o turno no meio

**Descoberto em:** 12/09/2026. Reformula um diagnóstico anterior que estava errado.

### O quê
Gerar mockups é lento e a dispersão é enorme. Medido em `luigi_whatsapp_log`, 15 dias:

```
6 mockups → 127.011 ms   (pedido 20260900291)
6 mockups → 108.515 ms
5 mockups →  81.383 / 63.119 ms
2 mockups →  78.188 / 75.125 / 73.732 / 30.620 / 21.125 ms
1 mockup  →  63.162 / 34.132 / 19.255 ms
```

Dois mockups já levaram de 21 s a 78 s. Não há tempo por imagem estável.

### O DIAGNÓSTICO QUE ISTO CORRIGE
Atribuímos ao agente: *"o Luigi confirma a correção do cliente verbalmente, passa a instrução certa pro gerador de imagem, e não grava no pedido"*. Formulado assim, o conserto seria mexer no prompt.

**Era runtime.** No pedido 20260900291 o turno levou 127.011 ms com `maxDuration = 120`. As 6 imagens saíram; a gravação da `descricao` não — a função morreu entre uma coisa e outra. O agente fez a parte dele.

Registrado porque a formulação errada mandaria a gente otimizar prompt para resolver morte por timeout — e o sintoma (dado desatualizado enquanto a imagem está certa) é idêntico nos dois casos.

### O QUE O INSTRUMENTO NÃO VÊ
`duracao_ms` é gravado no FIM do turno. Turno morto pela Vercel **não deixa linha** — esta medição só enxerga sobreviventes. Distribuição de 7 dias:

```
78,1%  até 45 s
16,2%  45–60 s
 5,5%  60–120 s   (27 turnos passam do ORCAMENTO_MS e sobreviviam pelo maxDuration antigo)
 0,2%  120–300 s  (1 turno, o de 127 s)
```

O número real de turnos mortos é desconhecido e ≥ 1. Para medir de verdade seria preciso um sinal escrito no COMEÇO do turno (uma linha "comecei", fechada no fim), que hoje não existe.

### Metade já está tapada
`maxDuration` subiu de 120 para 300 em 22ecea8 (12/09), junto com `ORCAMENTO_MS` de 45 para 60. O turno de 127 s agora sobrevive. **O que continua aberto:** 5,5% dos turnos passam do `ORCAMENTO_MS` de 60 s, e o orçamento é conferido ENTRE rodadas — não interrompe geração em curso. Gerar 6 mockups em lote dentro de um turno de conversa continua sendo mais tempo do que o orçamento prevê.

### Como revisitar
Tirar a geração em lote de dentro do turno de conversa (fechador automático já roda no cron e tem 300 s), e instrumentar início/fim do turno para que morte por timeout deixe rastro.

---

## 🔴 Mockup gerado nunca é conferido — 4 de 4 atributos divergiam

**Descoberto em:** 12/09/2026, no pedido 20260900291, modelo 0 (scrub cargo azul marinho).

### O quê
Ninguém olha a imagem gerada — nem o Luigi, nem o sistema. Gera, manda, confia. Conferindo a prévia que ia para a cliente contra a descrição da peça:

| atributo | pedido | na imagem |
|---|---|---|
| manga | curta | **longa** |
| blusa | transpassada | reta, sem transpasse |
| bolso frontal | tem | não aparece |
| calça | cargo | bolsos laterais sem cara de cargo |

**Quatro de quatro.** A conversa inteira tinha girado em torno da manga; ninguém tinha visto os outros três.

### Verificação por visão é factível e barata
Medido contra a imagem real: `claude-sonnet-4-6` com a imagem + a descrição pegou a manga e os outros três em **5,0 s** e **US$ 0,0084** (1.523 tokens de entrada, 258 de saída). Seis modelos: ~30 s, ~US$ 0,05.

### Como revisitar
Verificação DENTRO de `gerarMockupDoModelo`, antes de gravar em `mk.ia` — efeito de ferramenta se trava na ferramenta. Com três cuidados decididos em 12/09: lista de atributos **binários** explícita no código e curta (manga curta/longa, gola V/careca, com/sem bolso frontal, com/sem estampa), teto de 2 tentativas, e a escalada nomeando o que divergiu ("a prévia saiu com manga longa e o pedido pede curta"), nunca "não consegui gerar". E **fora do turno de conversa** — ver o item acima: a geração sozinha já estoura o orçamento.

---

## 🔴 Pedido duplicado: a janela anti-duplicata não cobre conversa longa

**Descoberto em:** 11–12/09/2026, medindo 14 dias de pedidos.

### O quê
`criarPedidoParaContato` (`app/lib/pedido-fechamento.ts:370-386`) recusa criar pedido novo quando já existe um do mesmo telefone criado **nos últimos 15 minutos**, com `origem = 'whatsapp_luigi'`. Duas limitações:

1. **A janela é curta demais.** Foi dimensionada para double-click do modelo — duas chamadas no mesmo turno. Os intervalos reais entre duplicados medidos foram **1 min, 5 min, 2 h e 4 h**. Quinze minutos não cobre metade dos casos.
2. **O filtro de origem cega a trava.** Só enxerga pedido criado pelo próprio Luigi; duplicata entre canais (`home_chat` + `whatsapp_luigi`) passa. Seis dos oito pares medidos não envolviam o Luigi em ambos os lados.

### Por que importa
Em 12/09, às 23:04, o Luigi criou o `20260900293` com os mesmos 6 modelos do `20260900291` (21:16) — quase 2 h de intervalo, fora da janela. O 293 nasceu sem CPF e sem `conta_id`.

### Como revisitar
Ao mexer, **medir a distribuição do intervalo entre duplicados reais antes de escolher o número novo** — não herdar os 15 min nem chutar. E tirar o `.eq('origem', ...)` exige mais que remover a cláusula: o caminho de "devolve o existente" hoje assume pedido fresco e editável (a janela curta garantia isso) e não tem guarda de status; pedido de outra origem pode estar já liberado, orçado ou pago. Ver a análise em `app/lib/pedido-fechamento.ts`.

---

## 🔴 Hard delete de pedido deixa o agente perseguindo fantasma

**Descoberto em:** 12/09/2026, consequência observada em produção.

### O quê
O pedido `20260900287` foi apagado à mão (hard delete, sem `encerrado_em`). Com `HISTORICO_MENSAGENS = 100`, o id dele (`7b287c46…`) continuou no histórico que vai ao modelo. O Luigi seguiu citando esse id na conversa, tentou trabalhar nele, não achou — e criou outro pedido.

### Por que importa
É o argumento mais forte a favor de `substituido_por` em vez de delete, e vale para pedido **e** para orçamento avulso: **id marcado continua resolvendo**; id apagado vira fantasma que o agente persegue. O histórico longo, que existe para o agente lembrar, passa a ser o mecanismo que o faz insistir no que não existe mais.

Some-se a isso o que já se sabia: apagar é irreversível e a escolha do vencedor é fácil de errar — o 287 era justamente o lado que tinha o CPF.

### Como revisitar
Junto com o desenho de `substituido_por`. Enquanto ele não existir, encerrar pedido com status (`cancelado`, `encerrado_em`) em vez de deletar.

---

## ⚪ Assimetria de limite de modelos entre canais: ferramenta 20, site 31

**Descoberto em:** 12/09/2026, de brinde, ao dimensionar o teto de tokens do Luigi.

### O quê
As ferramentas `criar_pedido` e `definir_pecas_pedido` declaram `maxItems: 20` para a lista de peças. O site não tem esse limite: o maior pedido real da base tem **31 modelos**, criado via `home_chat`.

Distribuição medida (229 pedidos com linhas): mediana **1**, p95 **7,6**, p99 **20,2**, máximo **31**. Acima de 12 modelos: 7 pedidos. O maior pedido feito pelo Luigi tem **6** — o `maxItems: 20` nunca chegou a morder na prática.

### Por que importa
O mesmo cliente tem limites diferentes conforme o canal por onde entra. Se alguém montar pelo site um pedido de 25 modelos e depois pedir um ajuste pelo WhatsApp, o Luigi não consegue reescrever a lista inteira com `definir_pecas_pedido` — a ferramenta recusa acima de 20. Não é hipótese distante: 7 pedidos reais já passaram de 12.

Não conserta baixando o limite da ferramenta. Isso foi considerado em 12/09 para comprar folga no orçamento de tempo e **descartado com dado**: cortar para 12 excluiria 7 pedidos reais, e pioraria a assimetria em vez de resolvê-la.

### Como revisitar
Decidir qual é o limite do produto — não o limite de cada canal — e aplicar nos dois lados. Se for maior que 20, refazer a conta das três fatias em `app/lib/luigi.ts` (ver o comentário de `ORCAMENTO_MS`): mais modelos significa geração mais longa no pior caso.

---

## 🔴 App cliente ainda cria pedido na era legada (repo separado)

**Descoberto em:** auditoria de 2026-09-11. Confirmado pelo Fernando no monorepo dos apps.

### O quê
`POST /api/pedidos/criar` foi fechada com **410** em 2026-09-11 (commit `1e24094`): ela gravava na tabela `pedidos`, era legada, que nenhuma automação observa desde 28/06 — pedido criado ali ficava parado pra sempre.

O app cliente **chama essa rota**: `apps/cliente/src/app/novo/resumo.tsx:139`, no ramo `else` de quando o pedido não é "rico". O ramo rico já usa `/api/cliente/pedidos-assistente`, que grava em `pedidos_assistente` e está certo.

### Por que importa agora: não importa
O app não está nas lojas (sem `eas.json`, feed da Home ainda mock), então o 410 não atinge cliente nenhum hoje. Por isso a rota subiu mesmo assim.

**O que importa é o par que ficou faltando:** o caminho do "pedido simples" precisa morrer no app também, do mesmo jeito que morreu no site quando o passo 4 virou handoff pro WhatsApp. Enquanto ele existir no app, é uma entrada que volta a funcionar no dia em que alguém reabrir a rota — ou um 410 na cara do usuário no dia em que o app for publicado.

### Como revisitar
No monorepo dos apps, não neste. Remover o ramo `else` de `resumo.tsx:139` e deixar o fluxo inteiro cair no assistente. Depois disso, `NovoPedidoForm.tsx` (que ficou órfão neste repo) pode ir junto com o resto da era legada.

---

## 🔴 DESTAQUE — Over-share de artes per-conta entre fornecedores (decisão de PRODUTO)

**Descoberto em:** Sprint "UX pós-aceite" (Item 2), 2026-05-20.
**Não é trivial — é decisão de produto, não só refactor.**

### O quê
O repositório de arquivos do cliente (`arquivos_cliente`) é **por conta**, não por pedido — não existe vínculo `pedido_id` no schema. A página pública de artes (`/artes/[token]`) serve `listarArquivos(conta_id)`, ou seja, **o repositório inteiro da conta**.

Cada compartilhamento (`compartilhamentos_artes`) é por pedido + por fornecedor, com token aleatório de 24 bytes (validade 7d). O token isola o **link** (fornecedor A nunca obtém o token do B), mas **não** isola o **conteúdo**: abrir qualquer token mostra todas as artes da conta.

### Por que importa
Todo fornecedor que algum dia recebeu um link de compartilhamento de um cliente consegue ver **todas** as artes daquele cliente — inclusive artes enviadas pensando em outro pedido / outro fornecedor. Hoje isso já acontece via o link do WhatsApp (feature da Sprint 3). O botão "Ver artes compartilhadas" do painel (Item 2) **não cria nem agrava** isso — apenas surfaça o mesmo link que o fornecedor já tem.

### A pergunta de produto a decidir
**As artes devem ser escopadas por pedido, ou seguir como repositório por conta (compartilhado entre os fornecedores do cliente)?**

- Se **por pedido**: muda schema (vincular `arquivos_cliente` a pedido, ou tabela de associação), o fluxo de upload, a rota `compartilhar-artes` e a página pública `/artes/[token]`. **É sprint própria** — não cabe num item pequeno de UX.
- Se **repositório por conta** (como hoje): documentar como comportamento intencional ("biblioteca de marca do cliente, compartilhada com seus fornecedores") e, idealmente, deixar isso explícito na UI do cliente ao compartilhar.

### Como revisitar
Decisão de produto do Fernando, **fora desta sprint**. Não tocar sem essa decisão.

---

## ⚪ Tokens de cor de texto — sem hierarquia (design system)

**Descoberto em:** Sprint "UX pós-aceite" (Item 4), 2026-05-20.

### O quê
Não existe token/variável de "texto secundário/muted". O projeto (Tailwind v4) só define `--color-background` e `--color-foreground` no `globals.css`. As cores de texto são utilitárias cruas espalhadas inline: ~26 arquivos com `text-gray-400`, ~39 com `text-gray-500`, ~34 com `text-gray-600`.

### Por que importa
Ajustes de contraste/acessibilidade viram caça pontual arquivo por arquivo (foi o caso do Item 4, resolvido só em `/cliente/login`). Sem hierarquia, é fácil reintroduzir cinzas que reprovam WCAG AA e gerar inconsistência.

### Como revisitar
Sprint própria: definir hierarquia (`text-primary` / `text-secondary` / `text-muted`), fixar o contraste AA de cada nível, e migrar os ~90 usos de uma vez.

---

## ⚪ Régua de follow-up do cliente — código/dado morto pós-redesenho

**Descoberto/criado em:** Sprint "régua do cliente calma", 2026-05-21.

### O quê
Os follow-ups 24h/48h do cliente foram removidos (TAREFA 3 do scheduler) e a expiração automática (TAREFA 4) acabou removida por completo. Com isso ficaram mortos:
- **Tabela `followups`** — não é mais escrita por nada. Sem schema change (não dropada).
- **ROTA 2 do webhook** (`app/api/fornecedor/webhook/route.ts`) + **`tratarRespostaCliente`** — só disparavam quando existia um `followups` sem resposta pro telefone do cliente; como nenhum é mais criado, viraram inalcançáveis. (Já estavam marcados "legacy" no histórico.)

### Por que importa
Não quebra nada: a ROTA 1 (resposta do fornecedor, SIM/NÃO) é checada **antes** e é independente; um cliente que escreve cai no `return ok` silencioso. Mas é código/dado morto que confunde e merece limpeza.

### Como revisitar
Sprint **dedicada** (mexe no webhook, que tem o fluxo do fornecedor — risco): remover ROTA 2 + `tratarRespostaCliente` e decidir dropar/arquivar a tabela `followups` (migration). **Não tocar junto com mudanças do fornecedor.**

---

## 🟡 Expiração automática de pedidos — DESATIVADA por decisão de produto

**Decidido em:** 2026-05-21 (sprint "régua do cliente calma").

### O quê
Não existe mais expiração automática de pedidos. A TAREFA 4 do scheduler foi **removida por completo** — nada expira sozinho. Pedido só sai do fluxo **manualmente**.

### Por quê
Base de pedidos ainda pequena; cada pedido é dado valioso. Preferimos não perder nenhum por inatividade enquanto o volume é baixo.

### Como revisitar
Reativar quando o volume crescer. **A lógica já foi validada:** expira pedido aceito que o cliente nunca acessou no painel após **7 dias** (acesso ≥ aceite = vivo); dry-run em produção conferido (pegava os abandonados certos, nenhum vivo por engano). Está pronta no histórico pra reaproveitar, no commit **`96b7ae8`** (`feat(scheduler): nova regra de expiracao do cliente`). O status `expirado_sem_resposta` segue no schema — só não é atribuído automaticamente; pode ser usado manualmente.

---

## 🔴 `mockups[i].ia` — seis leitores, três políticas, nenhuma combinada

**Registrado em:** 2026-09-11. **Risco DORMENTE** — só acorda se `MAX_IA` voltar a ser > 1.

### O quê
Depois do caso do Wesley (PDF mostrou a prévia velha junto com a nova), `mockup-pedido.ts`
passou a ter `MAX_IA = 1` e a geração nova **substitui** (`mk.ia = [novoItem]`, linha 414)
em vez de empilhar. Com no máximo um item, todo mundo que lê `ia` concorda.

O que ninguém combinou é o que fazer quando há **dois**. Hoje os leitores fazem três
coisas diferentes:

| política | onde | quem vê |
|---|---|---|
| **o ÚLTIMO** | `resumo-pdf.ts:76`, `luigi.ts:2101` | o cliente, no PDF e no WhatsApp |
| **o PRIMEIRO** | `inscricao/[token]/page.tsx:25` | o grupo do cliente, escolhendo tamanho |
| **TODOS** | `pedido-visuais.ts:27`, `VisualizadorCliente.tsx:411`, `api/visualizador/[id]/gerar-mockup/route.ts:43` | a confecção, e o painel |

(Não contam: `luigi.ts:871`, `luigi.ts:2066` e `fechar-pedido-automatico.ts:120` só checam
existência; `pedido-assistente-oferta.ts:971` só conta o tamanho pra saber se tem foto.)

### Por que importa
Se alguém afrouxar o `MAX_IA` — pra "deixar o Fernando comparar gerações", que é o motivo
mais provável — a divergência entra em produção **calada**: o cliente vê a versão nova, o
grupo dele vê a versão velha (a que já estava errada), e a confecção vê as duas e escolhe.
Exatamente o bug do Wesley, agora repartido em três superfícies em vez de uma. Nada quebra,
nada loga, e o sintoma chega como "a confecção fez diferente do que eu pedi".

### DECIDIDO — 2026-09-12, pelo Fernando
**Não guardamos histórico de geração; o estado atual da peça é a única imagem.** O histórico
servia pra depurar prompt, e isso já vive no `luigi_whatsapp_log` — as chamadas de ferramenta
guardam o texto que gerou cada imagem. Assunto fechado: `MAX_IA = 1` é escolha, não remendo.

### Como revisitar
Só se a decisão acima for revertida. E aí **não volta afrouxando o `MAX_IA`**: volta como campo
próprio (`mockups[i].ia_historico`), que só o painel lê — o `ia` continua sendo "o estado atual
da peça, uma imagem". Antes de qualquer mudança aqui, os seis leitores acima viram um helper só.

---

## 🟡 Régua de encerramento por desistência — MEDIDA, não vale a pena ainda

**Medido em:** 2026-09-11.

### O quê
Ideia: encerrar pedido sozinho quando o cliente diz que desistiu. Medido no histórico inteiro,
com rede larga de frases ("não tenho mais interesse", "desisti", "pode cancelar", "não quero
mais", "deixa pra lá", "outro fornecedor", "já resolvi", "finalizar o atendimento"):
**3 mensagens, em 3 conversas.** Um número anterior de "9 casos" circulou nesta sprint e é
**falso** — não reproduz.

Das 3, só **1** (Thaís Santos, 11/09) foi a **última palavra** do cliente, e o pedido dela
(`20260900240`) já está `encerrado`. As outras 2 continuaram conversando depois: a Nany mandou
**50** mensagens depois de "Desisti", e o Andre Filipe **12** depois de "cancelei aquele" — que
nem era desistência, era ele contando que tinha cancelado um pedido *anterior*.

### Por que importa
A regra ingênua ("encerra quando ouvir a frase") erra em **2 de 3** e fecharia dois pedidos
vivos: `20260900268` (sem_fornecedor) e `20260900285` (pedido_completo). A regra correta
("encerra quando a frase for a **última palavra**") acerta, e rende **zero** — porque o único
caso já foi fechado à mão. Escrever agora é risco sem ganho.

### Como revisitar
Quando o volume subir. O critério já está validado: **não é ouvir a frase, é a frase ser a
última palavra** — exige silêncio do cliente depois dela (janela a definir), nunca só o match
de texto.

---

## 🟡 Prompt caching — duas rotas fora, uma medida ruim

**Registrado em:** 2026-09-11, junto com o marco de cache nas ferramentas do Luigi.

### O quê
O `luigi.ts` ganhou `cache_control` no fim das ferramentas. Duas outras rotas ficaram de fora:

- **`gestao-whatsapp`** — 9,8% de aproveitamento de cache. Marca posta, prefixo instável.
- **`captacao-busca`** — **113k tokens por chamada**, cache nenhum.

### Por que importa
O Luigi é ~53% da conta de IA e agora tem marco; a `captacao-busca` é a maior chamada única do
sistema e não tem. Enquanto ninguém mede depois do deploy, "ligamos o cache" é fé, não número.

### Como revisitar
A tabela `uso_ia` tem as colunas de cache. Rodar a comparação **antes/depois** por rota —
sem 24h de tráfego real depois do deploy, o número não significa nada.

---

## 🟡 `luigi_whatsapp_log.duracao_ms` mede LATÊNCIA, não trabalho

**Registrado em:** 2026-09-12.

### O quê
`inicio = Date.now()` nasce na **linha 3662** de `luigi.ts`, logo na entrada de `responderCliente`.
O `esperarOClienteTerminar` (o debounce, teto de 60 s) só é chamado na **linha 3788**. Ou seja:
**o debounce está DENTRO da medição.**

### Por que importa
Quem olhar esse número amanhã pra dimensionar orçamento vai **superestimar o trabalho em até
60 s** e cortar tempo do modelo achando que ele demora mais do que demora. O pior turno medido
(127,0 s, 14 dias) tem até 60 s de espera dentro — o trabalho puro foi ~67 s.

Pra latência percebida pelo cliente o número é **bom**: é quase exatamente o que ele espera.
São duas perguntas diferentes e a coluna só responde uma.

### Como revisitar
Se um dia a distinção importar, são duas colunas (`espera_ms` e `trabalho_ms`), não uma
reinterpretação da mesma. Enquanto for uma só, o nome honesto dela é latência.

---

## ✅ `mockups[i].ia[].url` guardava dois formatos — RESOLVIDO em 2026-09-12

**O quê:** 64 linhas em `storage:pedidos/<id>/<hash>.jpg` e 5 em URL de exibição
(`/api/pedido/assistente/<id>/arquivo?f=<hash>.jpg`). Mesmo `storage:` vs URL que já tinha sido
consertado uma vez — no LEITOR (`lerImagem`). O campo continuou guardando as duas coisas, e o
conserto anterior não alcançava quem escrevesse um leitor novo.

**De onde vinham as 5:** `app/api/pedido/assistente/[id]/mockup/route.ts` gravava `novo.ia =
p.data.ia` **cru, vindo do navegador** — enquanto o `fotos` logo acima passava por
`guardarImagens`. O navegador tem a URL de exibição (`iaParaExibicao` a gerou), então todo
round-trip por essa rota escrevia o formato errado de volta.

**O custo, que era invisível:** é o caso 3 da FAMÍLIA lá no topo deste arquivo — o "Atualizar
mockup" regerava do zero em vez de ajustar. Os arquivos nunca faltaram: a rota devolve HTTP 200
com o JPEG (conferido nos 4 ids).

**Consertado:** (a) `lerImagem` passou a aceitar os dois formatos, tirando o id de dentro da
própria URL; (b) a rota de mockup passou o `ia` por `guardarImagem`, igual ao `fotos`;
(c) as 5 linhas migraram pra `storage:`, cada uma relida antes de gravar. O campo hoje é
**69 de 69 em `storage:`**.

**A lição, que vale além deste campo:** consertar o leitor não conserta o dado. Enquanto o
campo aceitar dois formatos, todo leitor novo é uma chance nova de cair no mesmo buraco — e o
verificador de visão foi o leitor novo que quase caiu.

---

## 🟠 Três superfícies ainda leem a tabela `pedidos`, congelada em 28/06

**Registrado em:** 2026-09-12, ao fazer a Fase 2 do vocabulário de peças.

### O quê
`/admin/ofertar`, `/admin/fornecedores-compativeis` e `orfaos.ts` leem
`from('pedidos')` — **104 pedidos de um mundo que acabou em junho**. A era viva
(`pedidos_assistente`) tem 229. E o desequilíbrio aparece também nas ofertas:

```
pedidos                    104 linhas   última: 2026-06-28
ofertas                    298 linhas
ofertas_pedido_assistente  180 linhas   última: 2026-09-12
```

A era morta tem **298 ofertas** contra **180** da viva — quem abre essas telas vê
mais movimento lá do que aqui, e nada disso é de hoje.

### Por que importa
Não quebra: as três funcionam, sobre dados corretos para junho. O risco é de
decisão — abrir `/admin/fornecedores-compativeis` e concluir algo sobre um pedido
que não existe mais. É primo do que já aconteceu no painel do inbox.

Efeito colateral da Fase 2: o `pecasDoPedido` passou a exigir `linhas` no tipo, e
as três recebem `linhas: null` **de propósito** — a tabela `pedidos` não tem essa
coluna. Caem no piso (`peca`/`pecas` declarados), que é o comportamento de
sempre. O `linhas: null` está comentado em cada uma pra deixar escrito que a
ausência é do schema, não um `select` esquecido.

### Como revisitar
**Não é trocar o nome da tabela.** Os `PedidoRow` de lá têm `tipo`, `quantidade`
e `estado` como colunas próprias; na era viva essas três viraram campos dentro de
`linhas` (`tipo` não existe, `quantidade` é soma de `tamanhos`). É **porte de
superfície**, uma tela por vez, com a regra de match já pronta em
`match-fornecedor.ts`. Antes de portar, vale medir se alguém ainda clica nelas —
isso o banco não responde.

---
