// app/fornecedor/painel/envio/page.tsx
// Conexão do fornecedor com o Melhor Envio (OAuth via app da Confeccione).
// Conectado: cotação integrada no orçamento; fase 2 traz etiqueta e rastreio.
import { exigirFornecedorAtual } from '@/app/lib/auth-server'
import { fornecedorConectado, melhorEnvioConfigurado } from '@/app/lib/melhorenvio'

export const dynamic = 'force-dynamic'

export default async function EnvioPage({ searchParams }: { searchParams: Promise<{ me?: string }> }) {
  const fornecedor = await exigirFornecedorAtual()
  const { me } = await searchParams
  const conectado = melhorEnvioConfigurado() && (await fornecedorConectado(fornecedor.id))

  return (
    <section className="px-5 md:px-8 pt-8 pb-24 max-w-3xl mx-auto">
      <h1 className="text-gray-900 text-2xl font-medium mb-1">Envio</h1>
      <p className="text-gray-500 text-sm mb-6">Cote fretes no orçamento e (em breve) emita etiquetas direto por aqui.</p>

      {me === 'ok' && (
        <div className="mb-4 rounded-xl border border-[#1D9E75]/30 bg-[#E1F5EE] px-4 py-3 text-sm text-gray-800">
          ✅ Conta do Melhor Envio conectada! Agora a cotação de frete aparece nos seus orçamentos.
        </div>
      )}
      {me === 'erro' && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Não deu pra conectar agora. Tente de novo — se persistir, fale com a Confeccione.
        </div>
      )}

      {conectado ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-full bg-[#E1F5EE] flex items-center justify-center text-xl">📦</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Melhor Envio conectado ✓</h2>
              <p className="text-[13px] text-gray-500">Sua conta está autorizada pra cotação de fretes.</p>
            </div>
          </div>
          <ul className="text-sm text-gray-600 space-y-1.5 mb-4 list-disc pl-5">
            <li>No orçamento de cada pedido, use <strong>Calcular com Melhor Envio</strong>: você informa caixas e peso, escolhe a transportadora e o valor entra no orçamento.</li>
            <li>A etiqueta é paga com o saldo da <strong>sua</strong> conta Melhor Envio — o frete cobrado do cliente entra no seu repasse.</li>
            <li>Em breve: emissão e impressão da etiqueta direto por aqui, com rastreio automático avisando o cliente.</li>
          </ul>
          <a
            href="/api/fornecedor/melhorenvio/conectar?voltar=/fornecedor/painel/envio"
            className="text-[13px] text-gray-500 underline hover:text-gray-700"
          >
            Reconectar / trocar de conta
          </a>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Conecte sua conta do Melhor Envio</h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed mb-5">
            Com a conta conectada, você cota o frete com os preços da sua conta na hora de montar o orçamento
            (Correios, Jadlog e outras), escolhe a transportadora e o valor já vai incluído pro cliente pagar junto.
            Não tem conta? Dá pra criar grátis durante a conexão.
          </p>
          <a
            href="/api/fornecedor/melhorenvio/conectar?voltar=/fornecedor/painel/envio"
            className="inline-block bg-[#1D9E75] text-white text-sm font-medium rounded-lg px-5 py-2.5 hover:bg-[#178761]"
          >
            Conectar Melhor Envio
          </a>
        </div>
      )}
    </section>
  )
}
