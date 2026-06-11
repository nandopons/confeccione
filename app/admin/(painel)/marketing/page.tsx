// app/admin/(painel)/marketing/page.tsx
// Painel de Marketing: KPIs, funil, nutrição automática, disparo em massa e
// base completa de leads do chat com histórico de contatos.
import { dadosMarketing } from '@/app/lib/marketing'
import { obterConfigNutricao, resumoContatosPorLead } from '@/app/lib/marketing-contatos'
import MarketingAdmin from './MarketingAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function Page() {
  const [dados, config, contatos] = await Promise.all([
    dadosMarketing(),
    obterConfigNutricao(),
    resumoContatosPorLead(),
  ])
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <MarketingAdmin dados={dados} config={config} contatos={contatos} />
    </div>
  )
}
