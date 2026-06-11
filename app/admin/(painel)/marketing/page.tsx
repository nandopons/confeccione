// app/admin/(painel)/marketing/page.tsx
// Painel de Marketing: KPIs, funil e base completa de leads do chat.
import { dadosMarketing } from '@/app/lib/marketing'
import MarketingAdmin from './MarketingAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function Page() {
  const dados = await dadosMarketing()
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <MarketingAdmin dados={dados} />
    </div>
  )
}
