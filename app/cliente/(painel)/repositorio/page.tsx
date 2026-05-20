// app/cliente/(painel)/repositorio/page.tsx
// ============================================================================
// Repositório de arquivos do cliente. SSR da lista inicial + quota; a
// interação (upload/renomear/excluir) acontece no RepositorioClient.
// ============================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getContaAtual, perfilCompleto } from '@/app/lib/cliente-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { listarArquivos, QUOTA_BYTES, BUCKET_ARTES } from '@/app/lib/arquivos-cliente'
import { ehImagem } from '@/app/lib/arquivos-format'
import RepositorioClient from './RepositorioClient'

export const dynamic = 'force-dynamic'

export default async function RepositorioPage() {
  const conta = await getContaAtual()
  if (!conta) return null // layout redireciona
  if (!perfilCompleto(conta)) redirect('/cliente/perfil?completar=1')

  const { arquivos, usadoBytes } = await listarArquivos(conta.id)

  // Signed URLs (1h) só pras imagens, geradas no servidor (igual /artes/[token]).
  const arquivosComUrl = await Promise.all(
    arquivos.map(async (a) => {
      let url: string | null = null
      if (ehImagem(a.display_name)) {
        const { data } = await supabaseAdmin.storage
          .from(BUCKET_ARTES)
          .createSignedUrl(a.storage_path, 3600)
        url = data?.signedUrl ?? null
      }
      return {
        id: a.id,
        display_name: a.display_name,
        mime_type: a.mime_type,
        tamanho_bytes: a.tamanho_bytes,
        criado_em: a.criado_em,
        url,
      }
    }),
  )

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href="/cliente/painel"
        className="text-sm text-gray-600 hover:text-gray-900 inline-block mb-4 transition-colors"
      >
        ← Voltar
      </Link>

      <h2 className="text-lg font-semibold text-gray-900 mb-1">Meus arquivos</h2>
      <p className="text-sm text-gray-500 mb-4">
        Guarde suas artes e modelos aqui. Você pode compartilhá-los com o
        fornecedor direto na página do pedido.
      </p>

      <RepositorioClient
        arquivosIniciais={arquivosComUrl}
        usadoInicial={usadoBytes}
        quotaBytes={QUOTA_BYTES}
      />
    </section>
  )
}
