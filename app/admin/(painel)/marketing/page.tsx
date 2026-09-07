// app/admin/(painel)/marketing/page.tsx
// Painel de Marketing em abas:
//   Visão geral      — KPIs e funil dos pedidos
//   Base de leads    — leads_marketing (chat + conta + manual + importados)
//   Campanhas        — disparo/agendamento por segmento (WhatsApp ou e-mail)
//   Nutrição         — retomada automática de pedido parado
//   Pedidos do chat  — tabela por pedido, com reativação e histórico
import { dadosMarketing } from '@/app/lib/marketing'
import { obterConfigNutricao, resumoContatosPorLead } from '@/app/lib/marketing-contatos'
import { listarLeads, resumoBaseLeads } from '@/app/lib/leads-marketing'
import { listarCampanhas } from '@/app/lib/campanhas-marketing'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import MarketingAdmin from './MarketingAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function listarSegmentos() {
  const { data } = await supabaseAdmin
    .from('segmentos_marketing')
    .select('id, nome, filtro')
    .order('nome')
  return (data ?? []) as Array<{ id: string; nome: string; filtro: Record<string, unknown> }>
}

export default async function Page() {
  const [dados, config, contatos, resumoBase, leadsIniciais, campanhas, segmentos] = await Promise.all([
    dadosMarketing(),
    obterConfigNutricao(),
    resumoContatosPorLead(),
    resumoBaseLeads(),
    listarLeads({}, 0, 50),
    listarCampanhas(),
    listarSegmentos(),
  ])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <MarketingAdmin
        dados={dados}
        config={config}
        contatos={contatos}
        resumoBase={resumoBase}
        leadsIniciais={leadsIniciais}
        campanhas={campanhas}
        segmentos={segmentos}
      />
    </div>
  )
}
