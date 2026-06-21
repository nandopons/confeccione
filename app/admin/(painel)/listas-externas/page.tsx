// /admin/listas-externas — todas as listas de coleta (Listas Externas) e seus
// inscritos, agrupadas por pedido. Dados de pessoas que o grupo informou.
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import ListasExternasAdmin, { type ListaAdmin } from './ListasExternasAdmin'

export const dynamic = 'force-dynamic'

function corLabel(s?: string | null): string {
  return (s || '').replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, ' ').replace(/#[0-9a-fA-F]{6}/g, '').replace(/\s{2,}/g, ' ').trim()
}

export default async function ListasExternasPage() {
  if (!(await eAdminLogado())) redirect('/admin/login')

  const { data: listas } = await supabaseAdmin
    .from('listas_externas')
    .select('id, pedido_id, linha_index, modelo_nome, cor, titulo, token, ativa, criado_em')
    .order('criado_em', { ascending: false })

  const listasArr = (listas ?? []) as Record<string, unknown>[]
  const pedidoIds = Array.from(new Set(listasArr.map((l) => String(l.pedido_id))))

  const { data: insc } = pedidoIds.length
    ? await supabaseAdmin
        .from('inscricoes_externas')
        .select('id, lista_id, nome, tamanho, numero, observacao, whatsapp, email, criado_em')
        .in('pedido_id', pedidoIds)
        .order('criado_em', { ascending: true })
    : { data: [] as Record<string, unknown>[] }

  const { data: peds } = pedidoIds.length
    ? await supabaseAdmin.from('pedidos_assistente').select('id, codigo, nome').in('id', pedidoIds)
    : { data: [] as Record<string, unknown>[] }

  const pedMap = new Map<string, { codigo: string | null; nome: string | null }>()
  for (const p of peds ?? []) pedMap.set(String((p as { id: string }).id), { codigo: (p as { codigo: string | null }).codigo, nome: (p as { nome: string | null }).nome })

  const inscPorLista = new Map<string, Record<string, unknown>[]>()
  for (const r of insc ?? []) {
    const k = String((r as { lista_id: string }).lista_id)
    const arr = inscPorLista.get(k) ?? []
    arr.push(r)
    inscPorLista.set(k, arr)
  }

  const out: ListaAdmin[] = listasArr.map((l) => ({
    id: String(l.id),
    pedido_id: String(l.pedido_id),
    pedido_codigo: pedMap.get(String(l.pedido_id))?.codigo ?? null,
    organizador: pedMap.get(String(l.pedido_id))?.nome ?? null,
    modelo: [l.modelo_nome as string | null, corLabel(l.cor as string | null)].filter(Boolean).join(' · ') || (l.titulo as string | null) || `Modelo ${(l.linha_index as number) + 1}`,
    token: String(l.token),
    ativa: Boolean(l.ativa),
    criado_em: String(l.criado_em),
    inscritos: (inscPorLista.get(String(l.id)) ?? []).map((r) => ({
      id: String(r.id),
      nome: String(r.nome),
      tamanho: String(r.tamanho),
      numero: (r.numero as string | null) ?? null,
      observacao: (r.observacao as string | null) ?? null,
      whatsapp: (r.whatsapp as string | null) ?? null,
      email: (r.email as string | null) ?? null,
    })),
  }))

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h2 className="text-lg font-semibold text-gray-900">Listas Externas</h2>
      <p className="text-sm text-gray-500 mt-1 mb-5">
        Coletas de tamanhos por modelo (interclasse, corridas, grupos). Cada inscrição soma no pedido automaticamente.
      </p>
      <ListasExternasAdmin listas={out} />
    </div>
  )
}
