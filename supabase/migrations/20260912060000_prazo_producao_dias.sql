-- O PRAZO QUE A CONFECÇÃO ASSUME — 12/09/2026.
--
-- Hoje o único prazo é `pedidos_assistente.prazo_dias`, que é o DESEJO DO
-- CLIENTE. Quem vai produzir nunca assume prazo por escrito: o orçamento tem
-- preço e frete, e a data fica no acordo verbal. Conferido antes de escrever:
-- não existia campo de prazo em `orcamento_versoes`, em
-- `ofertas_pedido_assistente` nem em `orcamentos`.
--
-- DOIS LUGARES, pelo mesmo motivo do `valor_repasse_centavos`:
--   ofertas_pedido_assistente  → ESTADO VIVO. É a linha da confecção que
--                                assumiu, e é de lá que sai o "a receber" dela.
--   orcamento_versoes          → SNAPSHOT. Prazo e preço mudam juntos; a versão
--                                guarda o que foi prometido em cada revisão.
--
-- Não pode morar SÓ na versão: `registrarVersaoOrcamento` é um insert dentro de
-- try/catch que engole o erro em `console.error` — canal morto neste projeto
-- (ver AGENTS.md). Prazo que some em silêncio é pior que prazo que não existe.
--
-- ANULÁVEL, E O NOT NULL FICA PENDENTE. O app mobile
-- (/api/fornecedor/pedido-assistente/[id]/orcar) também grava orçamento e está
-- FORA deste repositório: se a coluna nascesse obrigatória, ele quebraria e a
-- gente não teria como saber. A trava fica na aplicação, nos caminhos que a
-- gente controla. Ver DEBT.md.
--
-- FAIXA 1–180: não é previsão, é guarda contra digitação errada. O teto é o
-- mesmo de `leads_fornecedores_prazo_minimo_ck` de propósito — com 90 aqui, uma
-- confecção que declara mínimo 120 no cadastro não conseguiria gravar 120 na
-- oferta, e as duas réguas de prazo discordariam dentro do mesmo banco.

alter table ofertas_pedido_assistente
  add column if not exists prazo_producao_dias integer;

alter table orcamento_versoes
  add column if not exists prazo_producao_dias integer;

alter table ofertas_pedido_assistente
  drop constraint if exists ofertas_pa_prazo_producao_ck;
alter table ofertas_pedido_assistente
  add constraint ofertas_pa_prazo_producao_ck
  check (prazo_producao_dias is null or (prazo_producao_dias >= 1 and prazo_producao_dias <= 180));

alter table orcamento_versoes
  drop constraint if exists orcamento_versoes_prazo_producao_ck;
alter table orcamento_versoes
  add constraint orcamento_versoes_prazo_producao_ck
  check (prazo_producao_dias is null or (prazo_producao_dias >= 1 and prazo_producao_dias <= 180));

comment on column ofertas_pedido_assistente.prazo_producao_dias is
  'Dias de PRODUÇÃO que a confecção assumiu no orçamento. Não é o prazo do cliente (pedidos_assistente.prazo_dias) nem o do frete.';
