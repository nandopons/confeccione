'use client'

// Painel de Marketing (client): KPIs, funil, nutrição automática, disparo em
// massa por segmento, base de leads com filtro/busca, histórico de contatos
// por lead, reativação por WhatsApp e export CSV.
import { useMemo, useState } from 'react'
import type { DadosMarketing, FaseLead } from '@/app/lib/marketing'
import type {
  ConfigNutricao,
  ContatoMarketing,
  ResumoContatos,
} from '@/app/lib/marketing-contatos'

const FASE_BADGE: Record<FaseLead, { label: string; cls: string }> = {
  montado: { label: 'Pedido montado', cls: 'bg-gray-100 text-gray-700' },
  visualizador: { label: 'Visualizador', cls: 'bg-blue-50 text-blue-700' },
  cobranca: { label: 'Aguard. pagamento', cls: 'bg-amber-50 text-amber-700' },
  pago: { label: 'Pago', cls: 'bg-[#E1F5EE] text-[#0F6E56]' },
}

const TIPO_CONTATO_LABEL: Record<string, string> = {
  lembrete: 'Reativação',
  nutricao: 'Nutrição automática',
  oferta: 'Oferta',
  feedback: 'Pedido de feedback',
}

function brl(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function dataHoraBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function telBR(s: string | null): string {
  if (!s) return ''
  const d = s.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s
}

type PreviaDisparo = {
  total: number
  amostra: Array<{ nome: string | null; cidade: string | null; uf: string | null }>
  exemplo: string | null
  cap: number
}

export default function MarketingAdmin({
  dados,
  config,
  contatos,
}: {
  dados: DadosMarketing
  config: ConfigNutricao
  contatos: ResumoContatos
}) {
  const { kpis, funil, leads } = dados
  const [filtroFase, setFiltroFase] = useState<'todas' | FaseLead>('todas')
  const [busca, setBusca] = useState('')
  const [agindo, setAgindo] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [toques, setToques] = useState<ResumoContatos>(contatos)

  // ── nutrição ──
  const [nAtiva, setNAtiva] = useState(config.ativa)
  const [nDias, setNDias] = useState(config.diasParado)
  const [nMax, setNMax] = useState(config.maxToques)
  const [nOcupada, setNOcupada] = useState(false)
  const [nMsg, setNMsg] = useState<string | null>(null)

  // ── disparo ──
  const [dMensagem, setDMensagem] = useState('')
  const [dFase, setDFase] = useState<'todas' | FaseLead>('todas')
  const [dUf, setDUf] = useState('')
  const [dBusca, setDBusca] = useState('')
  const [dPrevia, setDPrevia] = useState<PreviaDisparo | null>(null)
  const [dOcupado, setDOcupado] = useState(false)
  const [dMsg, setDMsg] = useState<string | null>(null)

  // ── histórico ──
  const [histLead, setHistLead] = useState<{ id: string; nome: string | null } | null>(null)
  const [histItens, setHistItens] = useState<ContatoMarketing[] | null>(null)

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return leads.filter((l) => {
      if (filtroFase !== 'todas' && l.fase !== filtroFase) return false
      if (!q) return true
      return [l.nome, l.email, l.telefone, l.cidade, l.interesse].some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [leads, filtroFase, busca])

  function registraToqueLocal(id: string) {
    setToques((t) => ({
      ...t,
      [id]: { toques: (t[id]?.toques ?? 0) + 1, ultimoEm: new Date().toISOString() },
    }))
  }

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
      if (j.whats) registraToqueLocal(id)
      setMsg(j.whats ? `Mensagem de reativação enviada pro WhatsApp de ${nome ?? 'cliente'}.` : 'Pedido sem WhatsApp — nenhuma mensagem enviada.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao enviar.')
    } finally {
      setAgindo(null)
    }
  }

  async function salvarNutricao() {
    if (nOcupada) return
    setNOcupada(true)
    setNMsg(null)
    try {
      const r = await fetch('/api/admin/marketing/nutricao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'salvar', ativa: nAtiva, diasParado: nDias, maxToques: nMax }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao salvar')
      setNMsg(nAtiva ? 'Salvo — nutrição LIGADA (roda todo dia às 10h).' : 'Salvo — nutrição desligada.')
    } catch (e) {
      setNMsg(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setNOcupada(false)
    }
  }

  async function rodarNutricaoAgora() {
    if (nOcupada) return
    if (!window.confirm('Rodar a nutrição agora? Vai mandar WhatsApp pros leads parados elegíveis.')) return
    setNOcupada(true)
    setNMsg(null)
    try {
      const r = await fetch('/api/admin/marketing/nutricao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'executar' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao executar')
      const res = j.resultado as { candidatos: number; enviados: number; restantes: number; erros: number }
      setNMsg(
        res.candidatos === 0
          ? 'Nenhum lead elegível agora (travas anti-spam respeitadas).'
          : `Enviadas ${res.enviados} de ${res.candidatos} elegíveis${res.erros ? ` · ${res.erros} falhas` : ''}${res.restantes ? ` · ${res.restantes} ficam pra próxima rodada` : ''}.`
      )
      if (res.enviados > 0) setTimeout(() => window.location.reload(), 2500)
    } catch (e) {
      setNMsg(e instanceof Error ? e.message : 'Erro ao executar.')
    } finally {
      setNOcupada(false)
    }
  }

  async function previaOuEnvio(confirmar: boolean) {
    if (dOcupado) return
    setDOcupado(true)
    setDMsg(null)
    try {
      const r = await fetch('/api/admin/marketing/disparo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagem: dMensagem,
          filtro: { fase: dFase, uf: dUf || undefined, busca: dBusca || undefined },
          confirmar,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha no disparo')
      if (!confirmar) {
        setDPrevia(j.previa as PreviaDisparo)
        if ((j.previa as PreviaDisparo).total === 0) setDMsg('Nenhum lead com WhatsApp nesse segmento.')
      } else {
        const res = j.resultado as { total: number; enviados: number; erros: number; restantes: number }
        setDPrevia(null)
        setDMsg(
          `Oferta enviada pra ${res.enviados} ${res.enviados === 1 ? 'lead' : 'leads'}${res.erros ? ` · ${res.erros} falhas` : ''}${res.restantes ? ` · ${res.restantes} além do limite da rodada — dispare de novo pra continuar` : ''}.`
        )
        if (res.enviados > 0) setTimeout(() => window.location.reload(), 2500)
      }
    } catch (e) {
      setDMsg(e instanceof Error ? e.message : 'Erro no disparo.')
    } finally {
      setDOcupado(false)
    }
  }

  async function abrirHistorico(id: string, nome: string | null) {
    setHistLead({ id, nome })
    setHistItens(null)
    try {
      const r = await fetch(`/api/admin/marketing/contatos?pedido=${id}`)
      const j = await r.json()
      setHistItens(r.ok ? (j.contatos as ContatoMarketing[]) : [])
    } catch {
      setHistItens([])
    }
  }

  const maxFunil = Math.max(...funil.map((f) => f.quantidade), 1)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Marketing</h1>
          <p className="text-sm text-gray-500">Base de clientes, funil, nutrição e reativação de pedidos parados.</p>
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
      </div>

      {/* NUTRIÇÃO + DISPARO */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Nutrição automática */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-1">
            <p className="text-sm font-semibold text-gray-900">Nutrição automática</p>
            <button
              type="button"
              role="switch"
              aria-checked={nAtiva}
              onClick={() => setNAtiva((v) => !v)}
              className={
                'relative w-11 h-6 rounded-full transition-colors shrink-0 ' +
                (nAtiva ? 'bg-[#1D9E75]' : 'bg-gray-300')
              }
            >
              <span
                className={
                  'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ' +
                  (nAtiva ? 'left-[22px]' : 'left-0.5')
                }
              />
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Roda todo dia às 10h e manda a mensagem simples de reativação pra quem parou. Travas: só não-pagos com WhatsApp, parado há {nDias}+ dias, máx. {nMax} {nMax === 1 ? 'toque' : 'toques'} por lead (espaçados), até 15 envios por rodada.
          </p>

          <div className="flex items-end gap-3 flex-wrap">
            <label className="text-xs text-gray-600">
              Parado há (dias)
              <input
                type="number"
                min={1}
                max={60}
                value={nDias}
                onChange={(e) => setNDias(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                className="block mt-1 w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-[#1D9E75]"
              />
            </label>
            <label className="text-xs text-gray-600">
              Máx. toques/lead
              <input
                type="number"
                min={1}
                max={5}
                value={nMax}
                onChange={(e) => setNMax(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                className="block mt-1 w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-[#1D9E75]"
              />
            </label>
            <button
              type="button"
              onClick={() => void salvarNutricao()}
              disabled={nOcupada}
              className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={() => void rodarNutricaoAgora()}
              disabled={nOcupada}
              className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {nOcupada ? 'Aguarde…' : 'Rodar agora'}
            </button>
          </div>

          {nMsg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2 mt-3">{nMsg}</p>}
        </div>

        {/* Disparo em massa */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-gray-900 mb-1">Disparo de oferta em massa</p>
          <p className="text-xs text-gray-500 mb-3">
            Escreva a oferta, filtre o segmento e veja a prévia antes de confirmar. Use <code className="bg-gray-100 px-1 rounded">#nome</code> pro primeiro nome do cliente.
          </p>

          <textarea
            value={dMensagem}
            onChange={(e) => { setDMensagem(e.target.value); setDPrevia(null) }}
            rows={3}
            placeholder="Oi, #nome! Essa semana liberamos uma condição especial pra fechar seu pedido. Quer que eu te mande os detalhes? 😊"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-[#1D9E75] resize-y"
          />

          <div className="flex items-center gap-2 flex-wrap mt-2">
            <select
              value={dFase}
              onChange={(e) => { setDFase(e.target.value as 'todas' | FaseLead); setDPrevia(null) }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
            >
              <option value="todas">Todas as fases</option>
              <option value="montado">Pedido montado</option>
              <option value="visualizador">Visualizador</option>
              <option value="cobranca">Aguard. pagamento</option>
              <option value="pago">Pago (recompra)</option>
            </select>
            <input
              value={dUf}
              onChange={(e) => { setDUf(e.target.value.toUpperCase().slice(0, 2)); setDPrevia(null) }}
              placeholder="UF"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-16 text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-[#1D9E75]"
            />
            <input
              value={dBusca}
              onChange={(e) => { setDBusca(e.target.value); setDPrevia(null) }}
              placeholder="Produto/interesse…"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[140px] text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-[#1D9E75]"
            />
            <button
              type="button"
              onClick={() => void previaOuEnvio(false)}
              disabled={dOcupado || dMensagem.trim().length < 10}
              className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-50"
            >
              Pré-visualizar
            </button>
          </div>

          {dPrevia && dPrevia.total > 0 && (
            <div className="mt-3 border border-[#1D9E75]/30 bg-[#E1F5EE]/40 rounded-lg p-3">
              <p className="text-xs text-gray-700">
                Vai pra <strong>{Math.min(dPrevia.total, dPrevia.cap)}</strong> {dPrevia.total === 1 ? 'lead' : 'leads'} com WhatsApp
                {dPrevia.total > dPrevia.cap && <> (de {dPrevia.total} — limite de {dPrevia.cap} por rodada)</>}
                : {dPrevia.amostra.map((a) => a.nome ?? 'sem nome').join(', ')}{dPrevia.total > dPrevia.amostra.length ? '…' : ''}
              </p>
              {dPrevia.exemplo && (
                <p className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-2.5 py-2 mt-2 whitespace-pre-wrap">
                  {dPrevia.exemplo}
                </p>
              )}
              <div className="flex gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => void previaOuEnvio(true)}
                  disabled={dOcupado}
                  className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {dOcupado ? 'Enviando…' : `Confirmar envio (${Math.min(dPrevia.total, dPrevia.cap)})`}
                </button>
                <button
                  type="button"
                  onClick={() => setDPrevia(null)}
                  disabled={dOcupado}
                  className="text-sm text-gray-500 hover:text-gray-700 px-2"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {dMsg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2 mt-3">{dMsg}</p>}
        </div>
      </div>

      {/* BASE DE LEADS */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <p className="text-sm font-semibold text-gray-900 mr-auto">Base de clientes ({filtrados.length})</p>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, contato, produto…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-56 text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-[#1D9E75]"
          />
          <select
            value={filtroFase}
            onChange={(e) => setFiltroFase(e.target.value as 'todas' | FaseLead)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
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
              {filtrados.map((l) => {
                const ctt = toques[l.id]
                return (
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
                      <button
                        type="button"
                        onClick={() => void abrirHistorico(l.id, l.nome)}
                        className="block ml-auto mt-1 text-[11px] text-gray-400 hover:text-gray-600 underline decoration-dotted"
                      >
                        {ctt ? `${ctt.toques} ${ctt.toques === 1 ? 'toque' : 'toques'} · ${dataBR(ctt.ultimoEm)}` : 'sem contatos'}
                      </button>
                    </td>
                  </tr>
                )
              })}
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
          <li>Integração Facebook/Instagram (públicos personalizados a partir da base)</li>
        </ul>
      </div>

      {/* MODAL HISTÓRICO */}
      {histLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setHistLead(null)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Histórico de contatos</p>
                <p className="text-xs text-gray-500">{histLead.nome ?? 'Lead sem nome'}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistLead(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
              >
                ✕
              </button>
            </div>

            {histItens === null && <p className="text-sm text-gray-400 py-6 text-center">Carregando…</p>}
            {histItens !== null && histItens.length === 0 && (
              <p className="text-sm text-gray-400 py-6 text-center">Nenhum contato registrado ainda.</p>
            )}
            {histItens !== null && histItens.length > 0 && (
              <ul className="space-y-3">
                {histItens.map((c) => (
                  <li key={c.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#E1F5EE] text-[#0F6E56]">
                        {TIPO_CONTATO_LABEL[c.tipo] ?? c.tipo}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {c.origem === 'automatico' ? '🤖 automático' : '👤 manual'} · {c.canal} · {dataHoraBR(c.enviadoEm)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap">{c.mensagem}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
