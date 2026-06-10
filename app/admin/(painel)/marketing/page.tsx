// app/admin/(painel)/marketing/page.tsx
// Painel de Marketing: KPIs, funil e base completa de leads do chat.
import { dadosMarketing } from '@/app/lib/marketing'
import MarketingAdmin from './MarketingAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function Page() {
  const dados = await dadosMarketing()
  return <MarketingAdmin dados={dados} />
}
