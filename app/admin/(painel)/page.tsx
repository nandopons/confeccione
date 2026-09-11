// app/admin/(painel)/page.tsx
// ============================================================================
// Dashboard /admin — semáforo de saúde + 4 cards resumo + KPIs de marketing.
//
// Server Component. Lê métricas via supabaseAdmin (queries paralelas + 1
// sequencial dependente) e a contagem "Precisa de atenção" via lib (mesmo
// núcleo da aba). Determinismo: agoraMs capturado UMA vez no início do
// render e propagado pras funções puras de admin-saude.ts.
// KPIs de marketing vêm de dadosMarketing() (mesma fonte da aba Marketing).
// O card de IA mostra o gasto MEDIDO por nós (uso_ia). Saldo de crédito não
// tem API pública na Anthropic — por isso o card linka pro Console.
// ============================================================================

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { numerosDoTopo } from '@/app/lib/admin-topo'
import { dadosMarketing } from '@/app/lib/marketing'
import { resumoUsoIa } from '@/app/lib/uso-ia'
import { BotaoDispararCron } from './BotaoDispararCron'

function brlC(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function AdminDashboardPage() {
  if (!(await eAdminLogado())) {
    redirect('/admin/login')
  }

  // ─────────────────────────────────────────────────────────────
  // O TOPO PASSOU A MEDIR A ERA VIVA — 11/09/2026.
  //
  // O que havia aqui: sete consultas em `pedidos`, `ofertas` e `pedidos_orfaos`
  // alimentando quatro cards e um semáforo. A última linha de `pedidos` é de
  // 08/06 e a de `ofertas` de 28/06 — o topo do painel media um sistema parado
  // há 75 dias. "Em oferta" e "Aguardando expediente" mostravam zero, e o
  // zero parecia calmaria em vez de tabela morta.
  //
  // O semáforo saiu inteiro. Das cinco métricas que ele usava, quatro só
  // existem na era morta, e a principal — oferta vencida sem resposta — não tem
  // como ser medida hoje: `expira_em` é NULL nas 180 linhas de
  // `ofertas_pedido_assistente`. Ele ficaria verde pelo mesmo motivo de antes,
  // e verde falso é pior que não ter semáforo: ele diz pra não olhar.
  //
  // Os quatro números novos vivem em app/lib/admin-topo.ts, com o critério de
  // seleção escrito lá.
  // ─────────────────────────────────────────────────────────────
  // O topo estoura quando não consegue ler (é a regra do repo: trava cega não
  // devolve zero). Mas estourar aqui derrubaria a home inteira do admin, então
  // a falha vira uma tarja vermelha no lugar dos cards — o resto da página
  // segue de pé, e o motivo aparece escrito em vez de virar quatro zeros.
  const [topoRes, mkt] = await Promise.all([
    numerosDoTopo().then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, erro: e instanceof Error ? e.message : String(e) }),
    ),
    dadosMarketing(),
  ])

  const ia = await resumoUsoIa()
  const usd = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

  const kpisMkt: Array<{ label: string; valor: string; sub: string; cor: string }> = [
    {
      label: 'Leads',
      valor: String(mkt.kpis.leads),
      sub: 'pedidos iniciados no chat',
      cor: 'text-gray-900',
    },
    {
      label: 'Faturamento',
      valor: brlC(mkt.kpis.faturamentoCentavos),
      sub: `${mkt.kpis.pagos} ${mkt.kpis.pagos === 1 ? 'pedido pago' : 'pedidos pagos'}`,
      cor: 'text-[#0F6E56]',
    },
    {
      label: 'A receber',
      valor: brlC(mkt.kpis.aReceberCentavos),
      sub: `${mkt.kpis.cobrancas} aguardando pagamento`,
      cor: 'text-amber-600',
    },
    {
      label: 'Conversão',
      valor: `${mkt.kpis.conversaoPct}%`,
      sub: 'lead → pago',
      cor: 'text-gray-900',
    },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
          O que precisa de você agora
        </h2>
        <BotaoDispararCron />
      </div>

      {!topoRes.ok && (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded-lg p-4 text-sm">
          <strong>Não consegui ler os números do topo.</strong> Eles não estão
          zerados — não foram lidos. {topoRes.erro}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(topoRes.ok ? topoRes.v : []).map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow flex flex-col"
          >
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
              {c.label}
            </div>
            <div className={`text-4xl font-bold mt-2 ${c.valor === 0 ? 'text-gray-300' : 'text-gray-900'}`}>
              {c.valor}
            </div>
            {/* A nota diz o que fazer com o número, não o que ele é. Sem ela,
                "31" é só um número grande e o operador tem que lembrar por quê. */}
            <div className="text-xs text-gray-500 mt-2 leading-snug">{c.nota}</div>
          </Link>
        ))}
      </div>

      {/* ───────── Marketing ───────── */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Marketing
          </h2>
          <Link
            href="/admin/marketing"
            className="text-sm text-[#0F6E56] font-medium hover:underline"
          >
            Ver painel →
          </Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpisMkt.map((k) => (
            <Link
              key={k.label}
              href="/admin/marketing"
              className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
            >
              <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
                {k.label}
              </div>
              <div className={`text-3xl font-bold mt-2 ${k.cor}`}>{k.valor}</div>
              <div className="text-[11px] text-gray-400 mt-1">{k.sub}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* ───────── Custo de IA ───────── */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Consumo da API do Claude
          </h2>
          <a
            href="https://platform.claude.com/cost"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#0F6E56] font-medium hover:underline"
          >
            Ver custo e saldo no Console ↗
          </a>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Gasto no mês</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{usd(ia.mesUsd)}</div>
            <div className="text-[11px] text-gray-400 mt-1">
              {ia.mesChamadas} {ia.mesChamadas === 1 ? 'chamada' : 'chamadas'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Hoje</div>
            <div className="text-3xl font-bold text-gray-900 mt-2">{usd(ia.hojeUsd)}</div>
            <div className="text-[11px] text-gray-400 mt-1">
              {ia.hojeChamadas} {ia.hojeChamadas === 1 ? 'chamada' : 'chamadas'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Projeção do mês</div>
            <div className="text-3xl font-bold text-amber-600 mt-2">{usd(ia.projecaoMesUsd)}</div>
            <div className="text-[11px] text-gray-400 mt-1">no ritmo atual</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Onde gasta mais</div>
            {ia.porRota.length > 0 ? (
              <>
                <div className="text-lg font-bold text-gray-900 mt-2 truncate">{ia.porRota[0].rota}</div>
                <div className="text-[11px] text-gray-400 mt-1">
                  {usd(ia.porRota[0].usd)} · {ia.porRota[0].chamadas} chamadas
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400 mt-2">sem chamadas ainda</div>
            )}
          </div>
        </div>

        {ia.porRota.length > 1 && (
          <div className="mt-3 bg-white border border-gray-200 rounded-lg p-4">
            <div className="space-y-1.5">
              {ia.porRota.map((r) => (
                <div key={r.rota} className="flex items-center gap-3 text-xs">
                  <span className="w-40 shrink-0 text-gray-600">{r.rota}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-[#1D9E75]"
                      style={{ width: `${Math.max((r.usd / (ia.porRota[0].usd || 1)) * 100, 2)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-gray-500">{usd(r.usd)}</span>
                  <span className="w-16 text-right text-gray-400">{r.chamadas}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          Custo estimado a partir dos tokens que cada resposta devolve, pela tabela de preços da Anthropic. É medição
          nossa, não a fatura — serve pra saber qual parte do site gasta mais. O saldo de crédito não é exposto por API
          e só aparece no Console.
        </p>
      </div>

      {/* ───────── Comportamento dos usuários (Microsoft Clarity) ───────── */}
      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Comportamento dos usuários</h2>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900">🎥 Gravações de sessão & heatmaps</p>
            <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">Veja replays das sessões reais, mapas de calor de cliques/scroll e onde os usuários travam no fluxo de pedido. Os dados ficam no Microsoft Clarity (abre em nova aba — exige login Microsoft).</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <a href="https://clarity.microsoft.com/projects/view/x9qlu1huv8/impressions" target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 whitespace-nowrap">Gravações →</a>
            <a href="https://clarity.microsoft.com/projects/view/x9qlu1huv8/heatmaps" target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap">Heatmaps →</a>
            <a href="https://clarity.microsoft.com/projects/view/x9qlu1huv8/dashboard" target="_blank" rel="noopener noreferrer"
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap">Painel Clarity →</a>
          </div>
        </div>
      </div>
    </div>
  )
}
