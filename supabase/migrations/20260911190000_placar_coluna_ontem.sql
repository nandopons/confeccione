-- ============================================================================
-- COLUNA "ONTEM" NO PLACAR — 11/09/2026.
--
-- A tabela "Agora" do diário mostrava só 7 e 30 dias. Faltava o dia civil
-- fechado: a janela em que dá pra perguntar "o que aconteceu ontem" e ter uma
-- resposta que não muda mais.
--
-- ONTEM É `janela(1, meia-noite de hoje em Recife)` — não precisa de função
-- nova pra janela: `calcular_placar_janela(p_dias, p_ref)` já calcula
-- [p_ref - p_dias, p_ref). Passando a meia-noite de hoje como referência, o
-- intervalo vira exatamente o dia civil de ontem no fuso de Recife. Mesma
-- definição de cada indicador; só a janela muda, que era o pedido.
--
-- O PROBLEMA DOS INDICADORES QUE SÃO SALDO, NÃO FLUXO
-- Dois indicadores da tabela são foto do momento, e numa coluna de dia fechado
-- eles mentiriam:
--
--   • "Ofertas no ar" — a janela conta ofertas CRIADAS no período que estão
--     abertas AGORA. Numa coluna ONTEM isso vira "ofertas de ontem que ainda
--     não responderam", que não é o que o rótulo promete. Aqui dá pra fazer
--     certo: `respondido_em` marca a saída (143 das 144 ofertas terminais têm
--     o campo preenchido; as 36 abertas têm nulo), então o saldo no fechamento
--     de ontem é reconstruível — criada antes da meia-noite e ainda sem
--     resposta naquele instante. É isso que a coluna passa a mostrar.
--
--   • "Aguardando pagamento" — mesma forma, mas NÃO é reconstruível: o schema
--     não guarda histórico de `orcamento_status` nem de `pagamento_status`, só
--     o valor atual. Não existe como saber quanto estava aguardando pagamento
--     à meia-noite. Então vai NULO, e a tela mostra "—". Número inventado com
--     rótulo de número fechado é a mesma classe de mentira do semáforo verde.
--
-- (Há ainda quatro linhas que são saldo puro e já ignoram a janela hoje —
-- `fornecedores.ativos`, `nutricao.leads_total`, `com_primeiro_toque` e
-- `opt_out`. Elas repetem o mesmo valor em 7 e 30 dias. A tela passa a marcar
-- as três colunas como não-aplicáveis pra elas; consertar o significado nas
-- colunas de 7/30 é decisão à parte.)
-- ============================================================================

create or replace function public.calcular_placar_ontem(p_hoje0 timestamptz)
returns jsonb
language sql
stable
as $function$
  select jsonb_set(
           jsonb_set(
             jsonb_set(t.base, '{ofertas,no_ar}', to_jsonb(t.saldo_no_ar)),
             '{pedidos,aguardando_pgto}', 'null'::jsonb
           ),
           '{pedidos,aguardando_pgto_centavos}', 'null'::jsonb
         )
    from (
      select
        public.calcular_placar_janela(1, p_hoje0) as base,
        -- Saldo no instante do fechamento: já existia e ainda não tinha saído.
        (select count(*)
           from public.ofertas_pedido_assistente o
          where o.criado_em < p_hoje0
            and (o.respondido_em is null or o.respondido_em >= p_hoje0)
        ) as saldo_no_ar
    ) t;
$function$;

comment on function public.calcular_placar_ontem(timestamptz) is
  'Placar do dia civil fechado anterior a p_hoje0 (meia-noite de hoje em Recife). Iguala calcular_placar_janela(1, p_hoje0), com "ofertas.no_ar" trocado pelo saldo real no fechamento e "aguardando_pgto" anulado por não ser reconstruível.';

create or replace function public.calcular_placar(p_ref timestamp with time zone default now())
returns jsonb
language sql
stable
as $function$
select jsonb_build_object(
  'referencia', p_ref,
  'semana_inicio', (date_trunc('week', (p_ref at time zone 'America/Recife')))::date,
  'ontem', public.calcular_placar_ontem(
             date_trunc('day', (p_ref at time zone 'America/Recife')) at time zone 'America/Recife'
           ),
  'd7', public.calcular_placar_janela(7, p_ref),
  'd30', public.calcular_placar_janela(30, p_ref),
  'agora', public.calcular_placar_agora(p_ref)
);
$function$;
