import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { estaEmHorarioComercial } from '@/app/lib/horario'
import { criarEDispararOferta } from '@/app/lib/ofertas'

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
    pedidos_buscar_apos: 0,
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

  const agora = new Date().toISOString()

  // ===========================================================
  // TAREFA 1: ofertas expiradas (4h sem resposta)
  // ===========================================================
  // Busca ofertas com status=enviada cujo expira_em já passou.
  const { data: expiradas, error: errExpiradas } = await supabase
    .from('ofertas')
    .select('id, pedido_id')
    .eq('status', 'enviada')
    .lt('expira_em', agora)

  if (errExpiradas) {
    resumo.erros.push(`buscar expiradas: ${errExpiradas.message}`)
  } else if (expiradas && expiradas.length > 0) {
    for (const oferta of expiradas) {
      // Marca a oferta como expirada
      const { error: errUpdate } = await supabase
        .from('ofertas')
        .update({ status: 'expirada' })
        .eq('id', oferta.id)

      if (errUpdate) {
        resumo.erros.push(`update oferta ${oferta.id}: ${errUpdate.message}`)
        continue
      }

      resumo.ofertas_expiradas += 1

      // Tenta disparar oferta pro próximo fornecedor compatível.
      // criarEDispararOferta já é idempotente: se o pedido não está mais
      // em buscando_fornecedor, ela retorna sem fazer nada. E o matching
      // já exclui fornecedores que receberam oferta antes desse pedido.
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
  // Pedidos que entraram fora do horário comercial ficam com buscar_apos
  // setado pra próxima abertura. Quando a hora chega, processamos.
  const { data: pendentes, error: errPendentes } = await supabase
    .from('pedidos')
    .select('id')
    .eq('status', 'buscando_fornecedor')
    .not('buscar_apos', 'is', null)
    .lte('buscar_apos', agora)

  if (errPendentes) {
    resumo.erros.push(`buscar pendentes: ${errPendentes.message}`)
  } else if (pendentes && pendentes.length > 0) {
    for (const pedido of pendentes) {
      // Limpa buscar_apos primeiro pra não reprocessar se a oferta falhar
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

  return NextResponse.json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    ...resumo,
  })
}
