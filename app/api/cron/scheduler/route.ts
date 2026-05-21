import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { estaEmHorarioComercial, estaEmJanelaRetryPassivo } from '@/app/lib/horario'
import { criarEDispararOferta } from '@/app/lib/ofertas'
import { enviarMensagem, whatsappAdminFornecedorExpirou } from '@/app/lib/zapi'
import { emailAdminFornecedorExpirou } from '@/app/lib/email'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Pedido aceito que o cliente nunca acessou no painel expira após este prazo.
const PRAZO_EXPIRACAO_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias

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
    pedidos_expirados_sem_resposta: 0,
    trials_expirados: 0,
    pedidos_retry_passivo: 0,
    pedidos_retry_pulado: false,
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

      // Notifica admin SOMENTE em ofertas normais expiradas.
      // Ofertas sem_credito que expiram não geram alerta (esperado: fornecedor
      // não decidiu comprar, segue o jogo).
      if (oferta.tipo_oferta === 'normal') {
        try {
          const [{ data: fornecedor }, { data: pedido }] = await Promise.all([
            supabase
              .from('leads_fornecedores')
              .select('id, nome, whatsapp')
              .eq('id', oferta.fornecedor_id)
              .single(),
            supabase
              .from('pedidos')
              .select('id, nome, tipo')
              .eq('id', oferta.pedido_id)
              .single(),
          ])

          if (fornecedor && pedido) {
            await Promise.allSettled([
              whatsappAdminFornecedorExpirou({
                fornecedorId: fornecedor.id,
                nomeFornecedor: fornecedor.nome,
                whatsappFornecedor: fornecedor.whatsapp,
                pedidoId: pedido.id,
                nomeCliente: pedido.nome,
                tipo: pedido.tipo,
              }),
              emailAdminFornecedorExpirou({
                fornecedorId: fornecedor.id,
                nomeFornecedor: fornecedor.nome,
                whatsappFornecedor: fornecedor.whatsapp,
                pedidoId: pedido.id,
                nomeCliente: pedido.nome,
                tipo: pedido.tipo,
              }),
            ])
            resumo.notificacoes_expiracao += 1
          }
        } catch (err) {
          // Não interrompe o reenvio se a notificação falhar
          console.error('[scheduler] notificação expiração falhou:', err)
        }
      }

      try {
        await criarEDispararOferta(oferta.pedido_id)
        resumo.ofertas_reenviadas += 1
      } catch (err) {
        resumo.erros.push(
          `reenvio pedido ${oferta.pedido_id}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
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

      try {
        await criarEDispararOferta(pedido.id)
        resumo.pedidos_buscar_apos += 1
      } catch (err) {
        resumo.erros.push(
          `disparo pedido ${pedido.id}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  // TAREFA 3 (follow-ups 24h/48h do cliente) REMOVIDA — o cliente agora conta
  // só com a notificação de aceite + o painel pra se autogerenciar. Sem
  // cutucadas. (A nova regra de expiração vive na TAREFA 4, abaixo.)

  // ===========================================================
  // TAREFA 4: expira pedido aceito que o cliente NUNCA acessou no painel
  // ===========================================================
  // Sem follow-ups, a expiração é silenciosa e depende só de:
  //   1) houve aceite (fornecedor_aceito_id, status não-terminal);
  //   2) o cliente NUNCA acessou o painel após o aceite;
  //   3) o aceite já tem mais que PRAZO_EXPIRACAO_MS.
  // Acessou o painel em qualquer momento >= aceite → VIVO, nunca expira por
  // inatividade. Continua silenciosa (só muda o status).
  const corteExpiracao = new Date(
    agora.getTime() - PRAZO_EXPIRACAO_MS,
  ).toISOString()

  const { data: aceitosPendentes, error: errExpirar } = await supabase
    .from('pedidos')
    .select('id, status, ultimo_acesso_painel')
    .in('status', ['aguardando_contato', 'em_negociacao'])
    .not('fornecedor_aceito_id', 'is', null)

  if (errExpirar) {
    resumo.erros.push(`buscar pra expirar: ${errExpirar.message}`)
  } else if (aceitosPendentes && aceitosPendentes.length > 0) {
    for (const ped of aceitosPendentes) {
      // Momento do aceite = quando o fornecedor respondeu SIM (oferta aceita).
      const { data: ofertaAceita } = await supabase
        .from('ofertas')
        .select('respondida_em, enviada_em')
        .eq('pedido_id', ped.id)
        .eq('status', 'aceita')
        .order('respondida_em', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!ofertaAceita) continue
      const aceiteISO = ofertaAceita.respondida_em ?? ofertaAceita.enviada_em
      if (!aceiteISO) continue

      // VIVO: acessou o painel em qualquer momento >= aceite → nunca expira.
      if (
        ped.ultimo_acesso_painel &&
        new Date(ped.ultimo_acesso_painel).getTime() >=
          new Date(aceiteISO).getTime()
      ) {
        continue
      }

      // Nunca acessou: só expira quando o aceite já passou do prazo.
      if (new Date(aceiteISO).getTime() > new Date(corteExpiracao).getTime()) {
        continue
      }

      const { error: errUpdate } = await supabase
        .from('pedidos')
        .update({ status: 'expirado_sem_resposta' })
        .eq('id', ped.id)
        .in('status', ['aguardando_contato', 'em_negociacao'])

      if (errUpdate) {
        resumo.erros.push(`expirar pedido ${ped.id}: ${errUpdate.message}`)
        continue
      }

      resumo.pedidos_expirados_sem_resposta += 1
    }
  }

  // ===========================================================
  // TAREFA 5: expirar trial Pro (vira free automaticamente)
  // ===========================================================
  // Fornecedores que ainda estão como 'pro' mas com plano_expira_em
  // no passado → vira 'free'. Notificação por WhatsApp.
  const { data: trialsExpirando, error: errTrials } = await supabase
    .from('leads_fornecedores')
    .select('id, nome, whatsapp, plano')
    .eq('status', 'ativo')
    .neq('plano', 'free')
    .not('plano_expira_em', 'is', null)
    .lt('plano_expira_em', agoraISO)

  if (errTrials) {
    resumo.erros.push(`buscar trials: ${errTrials.message}`)
  } else if (trialsExpirando && trialsExpirando.length > 0) {
    for (const f of trialsExpirando) {
      const { error: errUpdate } = await supabase
        .from('leads_fornecedores')
        .update({
          plano: 'free',
          plano_ativado_em: new Date().toISOString(),
          plano_expira_em: null,
        })
        .eq('id', f.id)

      if (errUpdate) {
        resumo.erros.push(`expirar trial ${f.id}: ${errUpdate.message}`)
        continue
      }

      resumo.trials_expirados += 1

      // Notifica fornecedor que o trial acabou
      try {
        await enviarMensagem(
          f.whatsapp,
          `Olá ${f.nome}! 👋\n\nSeu trial de 90 dias do plano *Pro* terminou. A partir de hoje você está no plano *Free* (3 pedidos por mês).\n\nQuer continuar recebendo mais pedidos? Responda aqui que te conto sobre os planos pagos.`
        )
      } catch (err) {
        console.error('[scheduler] notificar trial expirado falhou:', err)
      }
    }
  }

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

  return NextResponse.json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    ...resumo,
  })
}
