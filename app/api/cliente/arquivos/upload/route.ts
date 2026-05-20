// app/api/cliente/arquivos/upload/route.ts
// ============================================================================
// POST /api/cliente/arquivos/upload  (multipart/form-data, campo "file")
//
// Fluxo:
//   1. Auth (getContaAtual)
//   2. Lê o File do FormData
//   3. Valida quota ANTES de aceitar: soma atual + novo arquivo <= 50MB → senão 413
//   4. AWAIT upload no Storage (path determinístico {conta_id}/{uuid}_{sanitized})
//   5. Só após sucesso do Storage, INSERT na tabela arquivos_cliente
//   6. Retorna o arquivo criado + novo uso de quota
//
// Sem limite por arquivo nem whitelist de MIME — único teto é a quota total.
// mime_type salvo como null quando o browser não informa o tipo.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { getContaAtual } from '@/app/lib/cliente-auth'
import {
  BUCKET_ARTES,
  QUOTA_BYTES,
  listarArquivos,
  normalizarDisplayName,
  sanitizeFilename,
} from '@/app/lib/arquivos-cliente'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const conta = await getContaAtual()
  if (!conta) {
    return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })
  }

  // 1. Lê o arquivo do FormData
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { erro: 'Nenhum arquivo enviado' },
      { status: 400 },
    )
  }

  const tamanho = file.size

  // 2. Valida quota ANTES de aceitar
  const { usadoBytes } = await listarArquivos(conta.id)
  if (usadoBytes + tamanho > QUOTA_BYTES) {
    return NextResponse.json(
      {
        erro: 'Quota de armazenamento excedida',
        usado_bytes: usadoBytes,
        quota_bytes: QUOTA_BYTES,
        tamanho_arquivo: tamanho,
      },
      { status: 413 },
    )
  }

  // 3. Path determinístico + upload (AWAIT — fire-and-forget morre em serverless)
  const sanitized = sanitizeFilename(file.name)
  const storagePath = `${conta.id}/${randomUUID()}_${sanitized}`
  const contentType = file.type && file.type.length > 0 ? file.type : 'application/octet-stream'
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: errUp } = await supabaseAdmin.storage
    .from(BUCKET_ARTES)
    .upload(storagePath, buffer, { contentType, upsert: false })

  if (errUp) {
    console.error('[arquivos/upload] storage falhou:', errUp)
    return NextResponse.json({ erro: 'Erro ao salvar arquivo' }, { status: 500 })
  }

  // 4. INSERT no banco só após Storage OK
  const mimeType = file.type && file.type.length > 0 ? file.type : null
  const { data: arquivo, error: errIns } = await supabaseAdmin
    .from('arquivos_cliente')
    .insert({
      conta_id: conta.id,
      storage_path: storagePath,
      display_name: normalizarDisplayName(file.name),
      mime_type: mimeType,
      tamanho_bytes: tamanho,
    })
    .select('id, display_name, mime_type, tamanho_bytes, criado_em')
    .single()

  if (errIns || !arquivo) {
    // Rollback best-effort do Storage pra não deixar objeto órfão
    console.error('[arquivos/upload] insert falhou, removendo do storage:', errIns)
    await supabaseAdmin.storage.from(BUCKET_ARTES).remove([storagePath])
    return NextResponse.json({ erro: 'Erro ao salvar arquivo' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    arquivo,
    usado_bytes: usadoBytes + tamanho,
    quota_bytes: QUOTA_BYTES,
  })
}
