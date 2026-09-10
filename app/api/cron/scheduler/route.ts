import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { estaEmHorarioComercial, estaEmJanelaRetryPassivo } from '@/app/lib/horario'
import { rodarCutucadaPosResumo } from '@/app/lib/cutucada-pos-resumo'
// criarEDispararOferta, avisarGestor, enviarTextoSimples e
// emailAdminFornecedorExpirou saíram em 10/09/2026 junto com o reenvio da era
// antiga (ver TAREFA 1). Quem oferta hoje é app/lib/oferta-automatica.ts.
import {
  dispararToqueCaptacao,
  proximoAgendamento,
  jaConverteu,
} from '@/app/lib/captacao'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  // Validação de segurança: só aceita chamadas com o secret correto.
  // O Vercel Cron envia automaticamente o header Authorization: Bearer <CRON_SECRET>.
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  const resumo = {
    ofertas_expiradas: 0,
    ofertas_reenviadas: 0,
    notificacoes_expiracao: 0,
    pedidos_buscar_apos: 0,
    trials_expirados: 0,
    pedidos_retry_passivo: 0,
    pedidos_retry_pulado: false,
    captacao_followups_enviados: 0,
    captacao_convertidos: 0,
    captacao_esgotados: 0,
    erros: [] as string[],
  }

  // Fora do horário comercial: cron acorda mas não dispara nada novo.
  // Apenas registra que rodou e sai. Isso evita mandar WhatsApp de madrugada.
  if (!estaEmHorarioComercial()) {
    return NextResponse.json({
      ok: true,
      pulado: 'fora do horário comercial',
      duracao_ms: Date.now() - inicio,
    })
  }

  const agora = new Date()
  const agoraISO = agora.toISOString()

  // ===========================================================
  // TAREFA 1: ofertas expiradas (4h normal / 3h sem crédito)
  // ===========================================================
  const { data: expiradas, error: errExpiradas } = await supabase
    .from('ofertas')
    .select('id, pedido_id, fornecedor_id, tipo_oferta')
    .eq('status', 'enviada')
    .lt('expira_em', agoraISO)

  if (errExpiradas) {
    resumo.erros.push(`buscar expiradas: ${errExpiradas.message}`)
  } else if (expiradas && expiradas.length > 0) {
    for (const oferta of expiradas) {
      // Status diferente conforme o tipo da oferta:
      // - tipo='normal'      → status='expirada'              (definitivo)
      // - tipo='sem_credito' → status='expirada_sem_credito'  (re-ofertável se ganhar crédito)
      const novoStatus =
        oferta.tipo_oferta === 'sem_credito' ? 'expirada_sem_credito' : 'expirada'

      const { error: errUpdate } = await supabase
        .from('ofertas')
        .update({ status: novoStatus })
        .eq('id', oferta.id)

      if (errUpdate) {
        resumo.erros.push(`update oferta ${oferta.id}: ${errUpdate.message}`)
        continue
      }

      resumo.ofertas_expiradas += 1

      // =========================================================
      // O REENVIO AUTOMÁTICO DA ERA ANTIGA SAIU DAQUI — 10/09/2026
      //
      // Esta tarefa reofertava pedidos da tabela `pedidos`, que é a primeira
      // era do produto. Ela NÃO RECEBE UM PEDIDO DESDE 28/06/2026 — zero nos
      // últimos 30 dias, contra 73 em `pedidos_assistente`, que é o que o
      // painel mostra hoje. O cron continuou rodando a cada 15 minutos por
      // dois meses e meio reofertando um acervo parado.
      //
      // E reofertava mal: `criarEDispararOferta` manda TEXTO LIVRE, sem
      // template (ofertas.ts, linhas 150 e 252). Fora da janela de 24 h isso
      // não é entregue, e só 3 das 42 confecções têm janela aberta num dia
      // qualquer — ou seja, a mensagem quase sempre morria no caminho, sem
      // erro visível. O texto ainda oferecia "upgrade pro plano" com preço
      // mensal, produto encerrado em 25/08.
      //
      // O QUE FICOU: a marcação de expirada logo acima. Ela não escreve pra
      // ninguém, só mantém o estado coerente pra quem lê o histórico.
      //
      // O QUE ASSUMIU: `oferta-automatica.ts` (cron próprio, 20 min), que
      // roda sobre `pedidos_assistente` e manda pelo template `oferta_pedido_v4`
      // antes de tentar texto livre. Liga com OFERTA_AUTOMATICA_ATIVA=1.
      //
      // As rotas manuais da era antiga (/api/admin/ofertar, fila.ts) seguem
      // no lugar, inertes: quem dispara sozinho era só este ponto.
      // =========================================================
    }
  }

  // ===========================================================
  // TAREFA 2: pedidos com buscar_apos no passado (fora de hora)
  // ===========================================================
  const { data: pendentes, error: errPendentes } = await supabase
    .from('pedidos')
    .select('id')
    .eq('status', 'buscando_fornecedor')
    .not('buscar_apos', 'is', null)
    .lte('buscar_apos', agoraISO)

  if (errPendentes) {
    resumo.erros.push(`buscar pendentes: ${errPendentes.message}`)
  } else if (pendentes && pendentes.length > 0) {
    for (const pedido of pendentes) {
      const { error: errLimpa } = await supabase
        .from('pedidos')
        .update({ buscar_apos: null })
        .eq('id', pedido.id)

      if (errLimpa) {
        resumo.erros.push(`limpar buscar_apos ${pedido.id}: ${errLimpa.message}`)
        continue
      }

      // O DISPARO SAIU DAQUI TAMBÉM — 10/09/2026, mesma razão da TAREFA 1.
      // Continua limpando `buscar_apos` acima pra não deixar pedido preso num
      // agendamento vencido; o que não acontece mais é o envio por texto livre
      // sobre a tabela `pedidos`, parada desde 28/06.
      resumo.pedidos_buscar_apos += 1
    }
  }

  // TAREFAS 3 e 4 (follow-ups 24h/48h + expiração automática do cliente)
  // REMOVIDAS. O cliente conta só com a notificação de aceite + o painel pra
  // se autogerenciar, e NADA expira automaticamente — decisão de produto:
  // base pequena, cada pedido é dado valioso, pedido só sai do fluxo
  // manualmente. A lógica de expiração validada (7 dias sem acesso ao painel,
  // dry-run conferido) está no histórico pra reaproveitar — ver DEBT.md.
  // O status 'expirado_sem_resposta' segue no schema, só não é mais atribuído
  // automaticamente.

  // ===========================================================
  // TAREFA 5: DESLIGADA — o plano Pro não existe mais (26/08/2026)
  // ===========================================================
  // A tarefa rebaixava o fornecedor pra 'free' quando o trial de 90 dias
  // vencia e mandava no WhatsApp: "Seu trial de 90 dias do plano *Pro*
  // terminou... quer continuar recebendo mais pedidos? Responda aqui que te
  // conto sobre os planos pagos."
  //
  // Em 25/08/2026 o Fernando encerrou o plano Pro — a monetização passou a
  // ser % no orçamento — e a mensagem de aprovação parou de prometê-lo. Mas
  // o cadastro seguia gravando o trial, e em 26/08 havia 20 trials ativos
  // com o primeiro vencendo em 29/08. Essa mensagem seria a primeira cobrança
  // que a base veria, por um produto que a empresa não vende.
  //
  // Desligada aqui, e o cadastro parou de gravar `plano_expira_em`
  // (`api/fornecedor/cadastro`). Os 20 registros existentes tiveram a data
  // limpa pela migration `20260826230000_encerrar_trial_pro.sql` — sem isso,
  // `planoEfetivo()` (app/lib/planos.ts) rebaixaria pra 'free' sozinho, com
  // ou sem esta tarefa, e o fornecedor cairia de 30 pra 3 pedidos por mês em
  // silêncio.
  //
  // O que sobreviveu de propósito: as colunas, o PLANOS_CONFIG e o
  // `planoEfetivo`. Se um dia voltar a existir plano pago, a estrutura está
  // aqui — o que não pode voltar sozinha é a mensagem.
  resumo.trials_expirados = 0

  // ===========================================================
  // TAREFA 6: retry passivo de pedidos sem fornecedor
  // ===========================================================
  // Reativa pedidos em buscando_fornecedor que não receberam oferta nas
  // últimas 6h, marcando buscar_apos = NOW(). A TAREFA 2 do próximo ciclo
  // (15 min depois) processa em seguida.
  //
  // Executa só nas janelas 08:00-08:14 e 15:00-15:14 BRT (dia útil), pra
  // pegar fornecedores recém-cadastrados sem ação manual nem flooding.
  if (estaEmJanelaRetryPassivo()) {
    try {
      const seisHorasAtras = new Date(agora.getTime() - 6 * 60 * 60 * 1000).toISOString()

      const { data: ofertasRecentes, error: errOfertas } = await supabase
        .from('ofertas')
        .select('pedido_id')
        .gte('criado_em', seisHorasAtras)

      if (errOfertas) {
        resumo.erros.push(`retry passivo (ofertas recentes): ${errOfertas.message}`)
      } else {
        const pedidosComOfertaRecente = new Set(
          (ofertasRecentes ?? []).map((o) => (o as { pedido_id: string }).pedido_id)
        )

        const { data: candidatos, error: errCandidatos } = await supabase
          .from('pedidos')
          .select('id')
          .eq('status', 'buscando_fornecedor')
          .is('buscar_apos', null)

        if (errCandidatos) {
          resumo.erros.push(`retry passivo (candidatos): ${errCandidatos.message}`)
        } else {
          const pedidosParaReativar = (candidatos ?? [])
            .map((p) => (p as { id: string }).id)
            .filter((id) => !pedidosComOfertaRecente.has(id))

          if (pedidosParaReativar.length > 0) {
            const { error: errUpdate } = await supabase
              .from('pedidos')
              .update({ buscar_apos: agoraISO })
              .in('id', pedidosParaReativar)

            if (errUpdate) {
              resumo.erros.push(`retry passivo (update): ${errUpdate.message}`)
            } else {
              resumo.pedidos_retry_passivo = pedidosParaReativar.length
            }
          }
        }
      }
    } catch (err) {
      resumo.erros.push(
        `retry passivo (exception): ${err instanceof Error ? err.message : String(err)}`
      )
    }
  } else {
    resumo.pedidos_retry_pulado = true
  }

  // ===========================================================
  // TAREFA 7: follow-ups de captação de fornecedores
  // ===========================================================
  // Fila = contatos 'ativo' com proximo_envio_em vencido. Pra cada um: checa
  // conversão (já virou lead), senão dispara o follow-up da próxima etapa e
  // reagenda/esgota. Teto por execução protege o rate limit da Z-API. Já roda
  // só em horário comercial (o handler retorna cedo fora dele).
  {
    const { data: fila } = await supabase
      .from('captacao_fornecedores')
      .select('id, nome, email, whatsapp, segmento, etapa, canal_email, canal_whatsapp')
      .eq('status', 'ativo')
      .lte('proximo_envio_em', agoraISO)
      .limit(40)

    for (const c of fila ?? []) {
      // 1) já se cadastrou? marca convertido e para.
      const converteu = await jaConverteu(c.email, c.whatsapp)
      if (converteu) {
        await supabase
          .from('captacao_fornecedores')
          .update({
            status: 'convertido',
            convertido_em: agoraISO,
            proximo_envio_em: null,
            atualizado_em: agoraISO,
          })
          .eq('id', c.id)
        resumo.captacao_convertidos += 1
        continue
      }

      // 2) próxima etapa a enviar = etapa atual + 1 (1, 2 ou 3)
      const etapaAEnviar = c.etapa + 1

      const envio = await dispararToqueCaptacao({
        id: c.id,
        nome: c.nome,
        email: c.email,
        whatsapp: c.whatsapp,
        segmento: c.segmento,
        etapa: etapaAEnviar,
        canal_email: c.canal_email,
        canal_whatsapp: c.canal_whatsapp,
      })

      // 3) reagenda o toque seguinte ou esgota
      const { proximoEnvioEm } = proximoAgendamento(etapaAEnviar)

      await supabase
        .from('captacao_fornecedores')
        .update({
          etapa: etapaAEnviar,
          ultimo_envio_em: agoraISO,
          proximo_envio_em: proximoEnvioEm,
          status: proximoEnvioEm ? 'ativo' : 'esgotado',
          atualizado_em: agoraISO,
          ...(envio.enviouAlgo ? {} : { ultimo_erro: 'falha no follow-up' }),
        })
        .eq('id', c.id)

      if (envio.enviouAlgo) resumo.captacao_followups_enviados += 1
      if (!proximoEnvioEm) resumo.captacao_esgotados += 1
    }
  }

  // TAREFA 8: a pergunta que faltou depois do resumo (10/09/2026)
  //
  // O Luigi só fala quando alguém escreve pra ele — então o cliente que recebe
  // o PDF e some deixa o pedido completo parado pra sempre. Esta tarefa é a
  // única parte do sistema que faz o Luigi puxar assunto: uma vez, uma hora
  // depois, e só se o cliente não escreveu nada nesse meio-tempo.
  let cutucada: Awaited<ReturnType<typeof rodarCutucadaPosResumo>> | { erro: string }
  try {
    cutucada = await rodarCutucadaPosResumo()
  } catch (e) {
    // Falhar aqui não pode derrubar as sete tarefas acima.
    cutucada = { erro: e instanceof Error ? e.message : String(e) }
  }

  return NextResponse.json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    ...resumo,
    cutucada_pos_resumo: cutucada,
  })
}
