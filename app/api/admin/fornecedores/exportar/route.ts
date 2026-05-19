/**
 * GET /api/admin/fornecedores/exportar
 * CSV com BOM UTF-8 (Excel PT-BR), respeita mesmos filtros do GET base.
 * Limite 5000 linhas. Grava audit 'fornecedor.exportar'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { COOKIE_ADMIN, ehTokenAdminValido } from '@/app/lib/admin-auth'
import { registrarAudit } from '@/app/lib/audit'

const LIMITE = 5000

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(COOKIE_ADMIN)?.value
  if (!ehTokenAdminValido(cookieValue)) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const url = req.nextUrl
  const status = url.searchParams.get('status') ?? 'todos'
  const busca = url.searchParams.get('busca')?.trim() ?? ''
  const vertical = url.searchParams.get('vertical')?.trim() ?? ''

  let q = supabaseAdmin
    .from('leads_fornecedores')
    .select(
      'nome, whatsapp, email, cidade, estado, plano, status, ' +
        'tipos_produto, raio_atendimento, pedido_minimo, ' +
        'ultimo_lead_em, criado_em, motivo_pausa',
    )
    .limit(LIMITE)

  if (status === 'ativo' || status === 'pausado') q = q.eq('status', status)
  if (busca) {
    const esc = busca.replace(/[,%_]/g, ' ')
    q = q.or(`nome.ilike.%${esc}%,cidade.ilike.%${esc}%`)
  }
  if (vertical) q = q.contains('tipos_produto', [vertical])

  q = q.order('nome', { ascending: true, nullsFirst: false })

  const { data, error } = await q
  if (error) {
    console.error('[exportar] erro:', error)
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  const linhas = data ?? []

  const cabecalho = [
    'nome',
    'whatsapp',
    'email',
    'cidade',
    'estado',
    'plano',
    'status',
    'tipos_produto',
    'raio_atendimento',
    'pedido_minimo',
    'ultimo_lead_em',
    'criado_em',
    'motivo_pausa',
  ]

  const corpo = linhas.map((row) =>
    cabecalho
      .map((c) => csvCell((row as unknown as Record<string, unknown>)[c]))
      .join(','),
  )

  // BOM UTF-8 explícito pra Excel PT-BR abrir corretamente em Windows
  const BOM = String.fromCharCode(0xfeff)
  const csv = BOM + cabecalho.join(',') + '\n' + corpo.join('\n') + '\n'

  await registrarAudit({
    ator: 'admin',
    acao: 'fornecedor.exportar',
    entidade_tipo: 'leads_fornecedores',
    entidade_id: null,
    mudancas: null,
    metadata: {
      filtros: { status, busca, vertical },
      total_exportado: linhas.length,
      truncado: linhas.length >= LIMITE,
      user_agent: req.headers.get('user-agent') ?? null,
    },
  })

  const nomeArquivo = `fornecedores_${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function csvCell(v: unknown): string {
  if (v == null) return ''
  let s: string
  if (Array.isArray(v)) s = v.join('; ')
  else s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}
