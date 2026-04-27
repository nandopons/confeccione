import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { estaEmHorarioComercial } from '@/app/lib/horario'
import { criarEDispararOferta } from '@/app/lib/ofertas'
import { enviarMensagem } from '@/app/lib/zapi'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HORAS_24 = 24 * 60 * 60 * 1000
const HORAS_48 = 48 * 60 * 60 * 1000

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
    pedidos_buscar_apos: 0,
    followups_24h_enviados: 0,
    followups_48h_enviados: 0,
    pedidos_expirados_sem_resposta: 0,
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
  // TAREFA 1: ofertas expiradas (4h sem resposta do fornecedor)
  // ===========================================================
  const { data: expiradas, error: errExpiradas } = await supabase
    .from('ofertas')
    .select('id, pedido_id')
    .eq('status', 'enviada')
    .lt('expira_em', agoraISO)

  if (errExpiradas) {
    resumo.erros.push(`buscar expiradas: ${errExpiradas.message}`)
  } else if (expiradas && expiradas.length > 0) {
    for (const oferta of expiradas) {
      const { error: errUpdate } = await supabase
        .from('ofertas')
        .update({ status: 'expirada' })
        .eq('id', oferta.id)

      if (errUpdate) {
        resumo.erros.push(`update oferta ${oferta.id}: ${errUpdate.message}`)
        continue
      }

      resumo.ofertas_expiradas += 1

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

  // ===========================================================
  // TAREFA 3: follow-up 24h após fornecedor aceitar
  // ===========================================================
  // Pedidos com status=aguardando_contato OU em_negociacao,
  // cuja oferta foi aceita há 24h+, e ainda não receberam o
  // follow-up correspondente.
  const corte24h = new Date(agora.getTime() - HORAS_24).toISOString()

  // Busca pedidos elegíveis pra follow-up
  // (pra cada um, conferir individualmente se já tem follow-up e qual)
  const { data: pedidosFollowup, error: errFollowup } = await supabase
    .from('pedidos')
    .select('id, nome, whatsapp, status, fornecedor_aceito_id')
    .in('status', ['aguardando_contato', 'em_negociacao'])
    .not('fornecedor_aceito_id', 'is', null)

  if (errFollowup) {
    resumo.erros.push(`buscar pedidos pra followup: ${errFollowup.message}`)
  } else if (pedidosFollowup && pedidosFollowup.length > 0) {
    for (const pedido of pedidosFollowup) {
      // Busca a oferta aceita mais recente desse pedido
      const { data: ofertaAceita } = await supabase
        .from('ofertas')
        .select('enviada_em')
        .eq('pedido_id', pedido.id)
        .eq('status', 'aceita')
        .order('enviada_em', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!ofertaAceita) continue

      // Determina qual follow-up disparar baseado no status
      // - status=aguardando_contato → tentar mandar 24h_inicial (se ainda não mandou)
      // - status=em_negociacao → tentar mandar 48h_lembrete (24h após o '2' do cliente)
      const tipoEsperado =
        pedido.status === 'aguardando_contato' ? '24h_inicial' : '48h_lembrete'

      // Pra '24h_inicial': verifica se passaram 24h desde a oferta aceita
      // Pra '48h_lembrete': verifica se passaram 24h desde o último follow-up respondido com '2'
      let referenciaTempo: string

      if (tipoEsperado === '24h_inicial') {
        referenciaTempo = ofertaAceita.enviada_em
      } else {
        // pra 48h_lembrete: usa o respondido_em do follow-up anterior (que foi respondido com '2')
        const { data: ultimoFollowup } = await supabase
          .from('followups')
          .select('respondido_em')
          .eq('pedido_id', pedido.id)
          .not('respondido_em', 'is', null)
          .order('respondido_em', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!ultimoFollowup || !ultimoFollowup.respondido_em) continue
        referenciaTempo = ultimoFollowup.respondido_em
      }

      // Já passou 24h desde a referência?
      if (new Date(referenciaTempo).getTime() > new Date(corte24h).getTime()) {
        continue // ainda não passou 24h
      }

      // Já existe follow-up desse tipo pra esse pedido? (idempotência)
      const { data: jaExiste } = await supabase
        .from('followups')
        .select('id')
        .eq('pedido_id', pedido.id)
        .eq('tipo', tipoEsperado)
        .maybeSingle()

      if (jaExiste) continue

      // Inserir follow-up ANTES de enviar a mensagem (evita duplicidade
      // se a mensagem demorar e o cron rodar de novo)
      const { error: errInsert } = await supabase
        .from('followups')
        .insert({ pedido_id: pedido.id, tipo: tipoEsperado })

      if (errInsert) {
        resumo.erros.push(`insert followup ${pedido.id}: ${errInsert.message}`)
        continue
      }

      // Monta e envia a mensagem
      const mensagem =
        tipoEsperado === '24h_inicial'
          ? `Oi ${pedido.nome}! 👋 Faz 24h que te conectei com um fornecedor. Como tá indo? Responde com:\n\n1 - DEU CERTO, fechei\n2 - AINDA AGUARDANDO, ele falou comigo, estamos conversando\n3 - NÃO DEU CERTO, quero outro fornecedor`
          : `Oi ${pedido.nome}! Tô passando aqui de novo pra ver como ficou com o fornecedor. Responde com:\n\n1 - DEU CERTO, fechei\n2 - AINDA AGUARDANDO, ainda estamos conversando\n3 - NÃO DEU CERTO, quero outro fornecedor`

      try {
        await enviarMensagem(pedido.whatsapp, mensagem)
        if (tipoEsperado === '24h_inicial') {
          resumo.followups_24h_enviados += 1
        } else {
          resumo.followups_48h_enviados += 1
        }
      } catch (err) {
        resumo.erros.push(
          `envio followup ${pedido.id}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  // ===========================================================
  // TAREFA 4: expirar pedidos sem resposta após 48h do lembrete
  // ===========================================================
  // Pedido recebeu '48h_lembrete' há mais de 24h e ainda não respondeu
  // → marca como expirado_sem_resposta
  const corte48h = new Date(agora.getTime() - HORAS_48).toISOString()

  const { data: paraExpirar, error: errExpirar } = await supabase
    .from('followups')
    .select('pedido_id, enviado_em')
    .eq('tipo', '48h_lembrete')
    .is('respondido_em', null)
    .lt('enviado_em', corte48h)

  if (errExpirar) {
    resumo.erros.push(`buscar pra expirar: ${errExpirar.message}`)
  } else if (paraExpirar && paraExpirar.length > 0) {
    for (const fu of paraExpirar) {
      const { error: errUpdate } = await supabase
        .from('pedidos')
        .update({ status: 'expirado_sem_resposta' })
        .eq('id', fu.pedido_id)
        .in('status', ['aguardando_contato', 'em_negociacao'])

      if (errUpdate) {
        resumo.erros.push(`expirar pedido ${fu.pedido_id}: ${errUpdate.message}`)
        continue
      }

      resumo.pedidos_expirados_sem_resposta += 1
    }
  }

  return NextResponse.json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    ...resumo,
  })
}
