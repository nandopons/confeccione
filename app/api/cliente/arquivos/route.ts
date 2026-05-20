// app/api/cliente/arquivos/route.ts
// ============================================================================
// GET /api/cliente/arquivos
// Lista os arquivos do repositório da conta logada + uso de quota.
// Retorno: { usado_bytes, quota_bytes, arquivos: [{ id, display_name,
//            mime_type, tamanho_bytes, criado_em }] }
// ============================================================================

import { NextResponse } from 'next/server'
import { getContaAtual } from '@/app/lib/cliente-auth'
import { listarArquivos, QUOTA_BYTES } from '@/app/lib/arquivos-cliente'

export const dynamic = 'force-dynamic'

export async function GET() {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  const { arquivos, usadoBytes } = await listarArquivos(conta.id)

  return NextResponse.json({
    usado_bytes: usadoBytes,
    quota_bytes: QUOTA_BYTES,
    arquivos: arquivos.map((a) => ({
      id: a.id,
      display_name: a.display_name,
      mime_type: a.mime_type,
      tamanho_bytes: a.tamanho_bytes,
      criado_em: a.criado_em,
    })),
  })
}
