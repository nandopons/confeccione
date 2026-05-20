// app/lib/arquivos-upload.ts
// ============================================================================
// Helper client-safe de upload de arquivo do cliente. Centraliza a chamada à
// API (/api/cliente/arquivos/upload) pra reuso entre o repositório e o card
// de biblioteca do painel — sem duplicar a lógica.
// ============================================================================

export type ArquivoUpload = {
  id: string
  display_name: string
  mime_type: string | null
  tamanho_bytes: number
  criado_em: string
}

export type UploadResult =
  | { ok: true; arquivo: ArquivoUpload; usado_bytes: number }
  | { ok: false; erro: string; status: number }

export async function enviarArquivo(file: File): Promise<UploadResult> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/cliente/arquivos/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      erro:
        j.erro ??
        (r.status === 413
          ? 'Espaço insuficiente para este arquivo.'
          : 'Erro ao enviar arquivo.'),
    }
  }
  return { ok: true, arquivo: j.arquivo, usado_bytes: j.usado_bytes }
}
