// app/lib/ofertas-painel.ts
// ============================================================================
// Helpers SERVER-SIDE para listar ofertas no painel do fornecedor.
// Use apenas em Server Components e API routes.
//
// Uso típico:
//
//   const ofertas = await buscarOfertasFornecedor(fornecedorId, 'pendentes')
//   const ofertas = await buscarOfertasFornecedor(fornecedorId, 'aceitas')
//   const ofertas = await buscarOfertasFornecedor(fornecedorId, 'historico')
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ============================================================
// Tipos
// ============================================================

/**
 * Categorias de ofertas exibidas no painel:
 * - pendentes: status='enviada' E expira_em > now (aguardando ação)
 * - aceitas: status='aceita' (mostra dados do cliente)
 * - historico: status IN ('recusada','expirada','recusada_sem_credito')
 *              dos últimos 90 dias
 */
export type StatusOfertaPainel = 'pendentes' | 'aceitas' | 'historico'

/**
 * Oferta enriquecida com dados do pedido associado.
 * Para ofertas 'aceitas' inclui também whatsapp/email do cliente.
 */
export type OfertaPainel = {
  // Da oferta
  id: string
  status: string
  tipo_oferta: string
  expira_em: string
  criado_em: string
  // Do pedido
  pedido_id: string
  pedido_tipo: string
  pedido_quantidade: number | null
  pedido_prazo: string
  pedido_estado: string
  pedido_descricao: string | null
  pedido_status: string
  // Dados do cliente — só preenchidos se oferta foi aceita
  cliente_nome: string | null
  cliente_whatsapp: string | null
  cliente_email: string | null
}

// ============================================================
// Helpers
// ============================================================

/**
 * Busca ofertas de um fornecedor por categoria.
 * Retorna ofertas mais recentes primeiro.
 */
export async function buscarOfertasFornecedor(
  fornecedorId: string,
  categoria: StatusOfertaPainel
): Promise<OfertaPainel[]> {
  // Monta query base — sempre traz dados do pedido
  let query = supabase
    .from('ofertas')
    .select(
      `
      id,
      status,
      tipo_oferta,
      expira_em,
      enviada_em,
      pedido_id,
      pedidos!inner (
        tipo,
        quantidade,
        prazo,
        estado,
        descricao,
        status,
        nome,
        whatsapp,
        email
      )
    `
    )
    .eq('fornecedor_id', fornecedorId)

  // Filtra por categoria
  const agora = new Date().toISOString()
  const noventaDiasAtras = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000
  ).toISOString()

  if (categoria === 'pendentes') {
    query = query
      .eq('status', 'enviada')
      .gt('expira_em', agora)
      .order('enviada_em', { ascending: false })
  } else if (categoria === 'aceitas') {
    query = query
      .eq('status', 'aceita')
      .order('enviada_em', { ascending: false })
  } else {
    // histórico: recusadas + expiradas dos últimos 90 dias
    query = query
      .in('status', ['recusada', 'expirada', 'recusada_sem_credito'])
      .gte('enviada_em', noventaDiasAtras)
      .order('enviada_em', { ascending: false })
  }

  const { data, error } = await query

  if (error) {
    console.error('buscarOfertasFornecedor: erro', error)
    return []
  }

  if (!data) return []

  // Normaliza: Supabase com !inner pode retornar pedidos como array OU objeto
  // dependendo da versão. Tratamos os dois casos.
  return data.map((row) => {
    const pedido = Array.isArray(row.pedidos) ? row.pedidos[0] : row.pedidos

    // Para ofertas aceitas, libera contato do cliente.
    // Para outras categorias, esconde (não vaza dados).
    const ehAceita = categoria === 'aceitas'

    return {
      id: row.id,
      status: row.status,
      tipo_oferta: row.tipo_oferta,
      expira_em: row.expira_em,
      criado_em: row.enviada_em,
      pedido_id: row.pedido_id,
      pedido_tipo: pedido?.tipo ?? '',
      pedido_quantidade: pedido?.quantidade ?? null,
      pedido_prazo: pedido?.prazo ?? '',
      pedido_estado: pedido?.estado ?? '',
      pedido_descricao: pedido?.descricao ?? null,
      pedido_status: pedido?.status ?? '',
      cliente_nome: ehAceita ? pedido?.nome ?? null : null,
      cliente_whatsapp: ehAceita ? pedido?.whatsapp ?? null : null,
      cliente_email: ehAceita ? pedido?.email ?? null : null,
    }
  })
}

/**
 * Calcula tempo restante de uma oferta pendente em horas/minutos.
 * Retorna null se já expirou.
 */
export function calcularTempoRestante(expiraEm: string): {
  horas: number
  minutos: number
  totalMs: number
} | null {
  const restante = new Date(expiraEm).getTime() - Date.now()
  if (restante <= 0) return null

  const horas = Math.floor(restante / (60 * 60 * 1000))
  const minutos = Math.floor((restante % (60 * 60 * 1000)) / (60 * 1000))

  return { horas, minutos, totalMs: restante }
}
