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
import BaixarTudoButton from './BaixarTudoButton'

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

  // 5. Arquivos da conta + signed URLs de 1h. Duas variantes por arquivo:
  //    - preview: abre inline no browser (clicar no card)
  //    - download: Content-Disposition attachment com nome amigável (botão
  //      "Baixar"), espelhando api/cliente/arquivos/[id]/download.
  const { arquivos } = await listarArquivos(comp.conta_id)
  const comUrls = await Promise.all(
    arquivos.map(async (a) => {
      const [preview, download] = await Promise.all([
        supabaseAdmin.storage
          .from(BUCKET_ARTES)
          .createSignedUrl(a.storage_path, SIGNED_URL_TTL),
        supabaseAdmin.storage
          .from(BUCKET_ARTES)
          .createSignedUrl(a.storage_path, SIGNED_URL_TTL, {
            download: a.display_name,
          }),
      ])
      return {
        id: a.id,
        nome: a.display_name,
        mime: a.mime_type,
        tamanho: a.tamanho_bytes,
        url: preview.data?.signedUrl ?? null,
        urlDownload: download.data?.signedUrl ?? null,
        isImagem: (a.mime_type ?? '').startsWith('image/'),
      }
    }),
  )

  // Nome do .zip: slug do fornecedor (já exibido na página) quando houver;
  // fallback genérico. NUNCA usar nome do cliente aqui — contrato de privacidade.
  const fornecedorSlug = fornecedorNome ? slugify(fornecedorNome) : ''
  const zipNome = fornecedorSlug
    ? `artes-${fornecedorSlug}.zip`
    : 'artes-confeccione.zip'

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
          <>
            {comUrls.length > 1 && (
              <div className="mb-4 flex justify-end">
                <BaixarTudoButton
                  arquivos={comUrls
                    .filter((f) => f.url)
                    .map((f) => ({ nome: f.nome, url: f.url as string }))}
                  zipNome={zipNome}
                />
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {comUrls.map((f) => (
                <div
                  key={f.id}
                  className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-gray-300 hover:shadow-sm transition flex flex-col"
                >
                  <a
                    href={f.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
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
                        <span
                          className="text-4xl text-gray-400"
                          aria-hidden="true"
                        >
                          📄
                        </span>
                      )}
                    </div>
                  </a>
                  <div className="p-3 flex flex-col gap-2">
                    <div>
                      <div
                        className="text-sm text-gray-900 truncate"
                        title={f.nome}
                      >
                        {f.nome}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatarTamanho(f.tamanho)}
                      </div>
                    </div>
                    {f.urlDownload && (
                      <a
                        href={f.urlDownload}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium px-3 py-2 hover:bg-gray-50 transition"
                      >
                        ⬇ Baixar
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
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

// Slug simples p/ nome de arquivo: minúsculas, sem acentos, espaços → hífen.
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
