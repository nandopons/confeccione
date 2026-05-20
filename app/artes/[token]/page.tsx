// app/artes/[token]/page.tsx
// ============================================================================
// Página PÚBLICA (sem auth) — fornecedor abre o link compartilhado e vê as
// artes do cliente. Única superfície sem autenticação desta sprint.
//
// PRIVACIDADE: NUNCA exibir email, telefone ou nome do cliente aqui. Apenas
// "Artes compartilhadas com {fornecedor_nome}".
//
// Token de 24 bytes, validade 7 dias. Signed URLs de 1h pra cada arquivo.
// ============================================================================

import { supabaseAdmin } from '@/app/lib/supabase-server'
import { BUCKET_ARTES, listarArquivos } from '@/app/lib/arquivos-cliente'

export const dynamic = 'force-dynamic'

const SIGNED_URL_TTL = 3600 // 1 hora

type Compartilhamento = {
  id: string
  conta_id: string
  fornecedor_id: string | null
  expira_em: string
  acessos_count: number
}

export default async function ArtesPublicasPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // 1. Busca o compartilhamento pelo token
  const { data: comp } = await supabaseAdmin
    .from('compartilhamentos_artes')
    .select('id, conta_id, fornecedor_id, expira_em, acessos_count')
    .eq('link_token', token)
    .maybeSingle<Compartilhamento>()

  if (!comp) {
    return <TelaAviso titulo="Link inválido" texto="Este link de artes não existe ou foi removido." />
  }

  // 2. Expirado?
  if (new Date(comp.expira_em).getTime() < Date.now()) {
    return (
      <TelaAviso
        titulo="Link expirado"
        texto="Este link de artes expirou. Peça ao cliente para gerar um novo."
      />
    )
  }

  // 3. Registra acesso (best-effort, não bloqueia a página)
  await supabaseAdmin
    .from('compartilhamentos_artes')
    .update({
      acessos_count: comp.acessos_count + 1,
      ultimo_acesso_em: new Date().toISOString(),
    })
    .eq('id', comp.id)

  // 4. Nome do fornecedor (sem nenhum dado do cliente)
  let fornecedorNome: string | null = null
  if (comp.fornecedor_id) {
    const { data: forn } = await supabaseAdmin
      .from('leads_fornecedores')
      .select('nome')
      .eq('id', comp.fornecedor_id)
      .maybeSingle<{ nome: string | null }>()
    fornecedorNome = forn?.nome ?? null
  }

  // 5. Arquivos da conta + signed URLs de 1h
  const { arquivos } = await listarArquivos(comp.conta_id)
  const comUrls = await Promise.all(
    arquivos.map(async (a) => {
      const { data } = await supabaseAdmin.storage
        .from(BUCKET_ARTES)
        .createSignedUrl(a.storage_path, SIGNED_URL_TTL)
      return {
        id: a.id,
        nome: a.display_name,
        mime: a.mime_type,
        tamanho: a.tamanho_bytes,
        url: data?.signedUrl ?? null,
        isImagem: (a.mime_type ?? '').startsWith('image/'),
      }
    }),
  )

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Confeccione</h1>
          <p className="text-sm text-gray-600 mt-1">
            Artes compartilhadas
            {fornecedorNome ? ` com ${fornecedorNome}` : ''}
          </p>
        </div>

        {comUrls.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-500 text-sm">
            Nenhum arquivo disponível neste compartilhamento.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {comUrls.map((f) => (
              <a
                key={f.id}
                href={f.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-gray-300 hover:shadow-sm transition"
              >
                <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                  {f.isImagem && f.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.url}
                      alt={f.nome}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl text-gray-400" aria-hidden="true">
                      📄
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <div className="text-sm text-gray-900 truncate" title={f.nome}>
                    {f.nome}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatarTamanho(f.tamanho)}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">
          Os links de download são temporários e expiram em 1 hora. Recarregue a
          página para renová-los.
        </p>
      </div>
    </div>
  )
}

function TelaAviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">{titulo}</h1>
        <p className="text-sm text-gray-600">{texto}</p>
      </div>
    </div>
  )
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
