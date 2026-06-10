'use client'

// Painel de Marketing (client): KPIs, funil, base de leads com filtro/busca,
// reativação por WhatsApp (mensagem simples) e export CSV.
import { useMemo, useState } from 'react'
import type { DadosMarketing, FaseLead } from '@/app/lib/marketing'

const FASE_BADGE: Record<FaseLead, { label: string; cls: string }> = {
  montado: { label: 'Pedido montado', cls: 'bg-gray-100 text-gray-700' },
  visualizador: { label: 'Visualizador', cls: 'bg-blue-50 text-blue-700' },
  cobranca: { label: 'Aguard. pagamento', cls: 'bg-amber-50 text-amber-700' },
  pago: { label: 'Pago', cls: 'bg-[#E1F5EE] text-[#0F6E56]' },
}

function brl(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function telBR(s: string | null): string {
  if (!s) return ''
  const d = s.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s
}

export default function MarketingAdmin({ dados }: { dados: DadosMarketing }) {
  const { kpis, funil, leads } = dados
  const [filtroFase, setFiltroFase] = useState<'todas' | FaseLead>('todas')
  const [busca, setBusca] = useState('')
  const [agindo, setAgindo] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return leads.filter((l) => {
      if (filtroFase !== 'todas' && l.fase !== filtroFase) return false
      if (!q) return true
      return [l.nome, l.email, l.telefone, l.cidade, l.interesse].some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [leads, filtroFase, busca])

  async function reativar(id: string, nome: string | null) {
    if (agindo) return
    setAgindo(id)
    setMsg(null)
    try {
      const r = await fetch(`/api/admin/pedidos-assistente/${id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'lembrete' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao enviar')
      setMsg(j.whats ? `Mensagem de reativação enviada pro WhatsApp de ${nome ?? 'cliente'}.` : 'Pedido sem WhatsApp — nenhuma mensagem enviada.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao enviar.')
    } finally {
      setAgindo(null)
    }
  }

  const maxFunil = Math.max(...funil.map((f) => f.quantidade), 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Marketing</h1>
          <p className="text-sm text-gray-500">Base de clientes, funil e reativação de pedidos parados.</p>
        </div>
        <a
          href="/api/admin/marketing/export"
          className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 text-sm font-medium px-4 py-2 rounded-lg"
        >
          ⬇️ Exportar base (CSV)
        </a>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Leads</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.leads}</p>
          <p className="text-[11px] text-gray-400">pedidos iniciados</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Faturamento</p>
          <p className="text-2xl font-bold text-[#0F6E56] mt-1">{brl(kpis.faturamentoCentavos)}</p>
          <p className="text-[11px] text-gray-400">{kpis.pagos} {kpis.pagos === 1 ? 'pedido pago' : 'pedidos pagos'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">A receber</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{brl(kpis.aReceberCentavos)}</p>
          <p className="text-[11px] text-gray-400">{kpis.cobrancas} aguardando pagamento</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Sem cobrança</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.semCobranca}</p>
          <p className="text-[11px] text-gray-400">pararam antes de pagar</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Conversão</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.conversaoPct}%</p>
          <p className="text-[11px] text-gray-400">lead → pago</p>
        </div>
      </div>

      {/* FUNIL */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-900 mb-3">Funil</p>
        <div className="space-y-2">
          {funil.map((f) => (
            <div key={f.fase} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-xs text-gray-500">{f.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                <div
                  className={'h-5 rounded-full text-[11px] text-white px-2 flex items-center ' + (f.fase === 'pago' ? 'bg-[#1D9E75]' : 'bg-gray-400')}
                  style={{ width: `${Math.max((f.quantidade / maxFunil) * 100, 6)}%` }}
                >
                  {f.quantidade}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Reative quem parou: o botão <strong>Reativar</strong> manda &ldquo;Oi, [nome]! Vi que você realizou um pedido em nosso site. Gostaria de ajuda para finalizar?&rdquo; no WhatsApp — sem link; quando o cliente responder, você manda o link manualmente.
        </p>
      </div>

      {/* BASE DE LEADS */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <p className="text-sm font-semibold text-gray-900 mr-auto">Base de clientes ({filtrados.length})</p>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, contato, produto…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-[#1D9E75]"
          />
          <select
            value={filtroFase}
            onChange={(e) => setFiltroFase(e.target.value as 'todas' | FaseLead)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white"
          >
            <option value="todas">Todas as fases</option>
            <option value="montado">Pedido montado</option>
            <option value="visualizador">Visualizador</option>
            <option value="cobranca">Aguard. pagamento</option>
            <option value="pago">Pago</option>
          </select>
        </div>

        {msg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2 mb-3">{msg}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-3 font-semibold">Cliente</th>
                <th className="py-2 pr-3 font-semibold">Interesse</th>
                <th className="py-2 pr-3 font-semibold">Fase</th>
                <th className="py-2 pr-3 font-semibold">Valor</th>
                <th className="py-2 pr-3 font-semibold">Criado</th>
                <th className="py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.id} className="border-b border-gray-50 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-gray-900">{l.nome ?? '—'}</p>
                    <p className="text-xs text-gray-500">{telBR(l.telefone)}{l.email ? ` · ${l.email}` : ''}</p>
                    {(l.cidade || l.uf) && <p className="text-[11px] text-gray-400">{[l.cidade, l.uf].filter(Boolean).join('/')}</p>}
                  </td>
                  <td className="py-2.5 pr-3 max-w-[260px]">
                    <p className="text-xs text-gray-600 leading-snug">{l.interesse}</p>
                    {l.totalPecas > 0 && <p className="text-[11px] text-gray-400">{l.totalPecas} peças</p>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={'text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap ' + FASE_BADGE[l.fase].cls}>{FASE_BADGE[l.fase].label}</span>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-gray-700">{l.valorCentavos != null ? brl(l.valorCentavos) : '—'}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-gray-500 text-xs">{dataBR(l.criadoEm)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <a href={`/visualizador/${l.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0F6E56] underline mr-3">ver ↗</a>
                    {l.fase !== 'pago' && l.telefone && (
                      <button
                        type="button"
                        onClick={() => void reativar(l.id, l.nome)}
                        disabled={agindo === l.id}
                        className="text-xs border border-[#1D9E75]/40 text-[#0F6E56] hover:bg-[#E1F5EE]/50 px-2.5 py-1 rounded-lg disabled:opacity-50"
                      >
                        {agindo === l.id ? 'Enviando…' : 'Reativar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400">Nenhum lead com esse filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ROADMAP */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-900 mb-2">Próximos passos do Marketing 🚧</p>
        <ul className="text-xs text-gray-500 space-y-1 list-disc pl-4">
          <li>Fluxos automáticos de nutrição (reativação programada por fase e tempo parado)</li>
          <li>Disparo de ofertas em massa por segmento (fase, interesse, região)</li>
          <li>Integração Facebook/Instagram (públicos personalizados a partir da base)</li>
          <li>Histórico de contatos por lead (quem já recebeu reativação e quando)</li>
        </ul>
      </div>
    </div>
  )
}
