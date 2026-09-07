'use client'

// ============================================================================
// BASE DE LEADS (aba "Base") — a lista unificada de leads_marketing.
// Junta quem veio do chat, quem criou conta, quem você cadastrou na mão e
// quem entrou por importação de CSV. É daqui que as campanhas tiram o público.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import type { Lead, OrigemLead, ResumoBaseLeads, StatusLead } from '@/app/lib/leads-marketing'
import ImportarLeads from './ImportarLeads'

const ORIGEM_LABEL: Record<OrigemLead, string> = {
  chat: 'Chat',
  conta: 'Conta',
  manual: 'Manual',
  importacao: 'Importado',
}

const STATUS_BADGE: Record<StatusLead, string> = {
  lead: 'bg-gray-100 text-gray-700',
  cliente: 'bg-[#E1F5EE] text-[#0F6E56]',
  descadastrado: 'bg-red-50 text-red-600',
}

function telBR(s: string | null): string {
  if (!s) return ''
  const d = s.replace(/\D/g, '').replace(/^55/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s
}
function dataBR(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
}

type Filtros = {
  busca: string
  origem: 'todas' | OrigemLead
  status: 'todos' | StatusLead
  canal: 'todos' | 'whatsapp' | 'email'
  uf: string
  optout: boolean
}

const FILTRO_VAZIO: Filtros = { busca: '', origem: 'todas', status: 'todos', canal: 'todos', uf: '', optout: false }

function queryDosFiltros(f: Filtros, pagina = 0): string {
  const p = new URLSearchParams()
  if (f.busca.trim()) p.set('busca', f.busca.trim())
  if (f.origem !== 'todas') p.set('origem', f.origem)
  if (f.status !== 'todos') p.set('status', f.status)
  if (f.canal !== 'todos') p.set('canal', f.canal)
  if (f.uf) p.set('uf', f.uf)
  if (f.optout) p.set('optout', '1')
  if (pagina) p.set('pagina', String(pagina))
  return p.toString()
}

const CAMPO = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]'

export default function BaseLeads({
  resumo,
  inicial,
}: {
  resumo: ResumoBaseLeads
  inicial: { leads: Lead[]; total: number }
}) {
  const [filtros, setFiltros] = useState<Filtros>(FILTRO_VAZIO)
  const [pagina, setPagina] = useState(0)
  const [leads, setLeads] = useState<Lead[]>(inicial.leads)
  const [total, setTotal] = useState(inicial.total)
  const [carregando, setCarregando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editando, setEditando] = useState<Lead | 'novo' | null>(null)
  const [importando, setImportando] = useState(false)

  const buscar = useCallback(async (f: Filtros, p: number) => {
    setCarregando(true)
    try {
      const r = await fetch(`/api/admin/marketing/leads?${queryDosFiltros(f, p)}`)
      const j = await r.json()
      if (r.ok) {
        setLeads(j.leads as Lead[])
        setTotal(j.total as number)
      }
    } finally {
      setCarregando(false)
    }
  }, [])

  // Debounce da busca: espera parar de digitar pra bater na API.
  useEffect(() => {
    const t = setTimeout(() => void buscar(filtros, pagina), 300)
    return () => clearTimeout(t)
  }, [filtros, pagina, buscar])

  function mudaFiltro(patch: Partial<Filtros>) {
    setPagina(0)
    setFiltros((f) => ({ ...f, ...patch }))
  }

  async function sincronizar() {
    setCarregando(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/marketing/leads/sincronizar', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao sincronizar')
      const res = j.resultado as { lidos: number; criados: number; atualizados: number }
      setMsg(`Sincronizado: ${res.criados} novos, ${res.atualizados} atualizados (${res.lidos} registros lidos).`)
      await buscar(filtros, 0)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao sincronizar.')
    } finally {
      setCarregando(false)
    }
  }

  async function alternarOptOut(l: Lead) {
    await fetch(`/api/admin/marketing/leads/${l.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optOut: !l.optOut }),
    })
    await buscar(filtros, pagina)
  }

  async function excluir(l: Lead) {
    if (!confirm(`Remover ${l.nome ?? 'este lead'} da base de marketing?`)) return
    await fetch(`/api/admin/marketing/leads/${l.id}`, { method: 'DELETE' })
    await buscar(filtros, pagina)
  }

  const paginas = Math.ceil(total / 50)

  return (
    <div className="space-y-4">
      {/* Resumo da base */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card titulo="Na base" valor={resumo.total} nota="leads únicos" />
        <Card titulo="Com WhatsApp" valor={resumo.comWhatsapp} nota="alcançáveis por zap" />
        <Card titulo="Com e-mail" valor={resumo.comEmail} nota="alcançáveis por e-mail" />
        <Card titulo="Clientes" valor={resumo.clientes} nota="já compraram" destaque />
        <Card titulo="Descadastrados" valor={resumo.optOut} nota="fora das campanhas" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        {/* Ações */}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-900 mr-auto">
            Base de leads <span className="text-gray-400 font-normal">({total})</span>
          </p>
          <button
            type="button"
            onClick={() => setEditando('novo')}
            className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Novo lead
          </button>
          <button
            type="button"
            onClick={() => setImportando(true)}
            className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg"
          >
            Importar CSV
          </button>
          <button
            type="button"
            onClick={() => void sincronizar()}
            disabled={carregando}
            className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            title="Traz pra base quem já pediu orçamento no chat ou criou conta no site"
          >
            Sincronizar do site
          </button>
          <a
            href={`/api/admin/marketing/leads/export?${queryDosFiltros(filtros)}`}
            className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg"
          >
            Exportar CSV
          </a>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={filtros.busca}
            onChange={(e) => mudaFiltro({ busca: e.target.value })}
            placeholder="Buscar nome, empresa, e-mail, telefone…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-64 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
          />
          <Select valor={filtros.origem} onChange={(v) => mudaFiltro({ origem: v as Filtros['origem'] })}
            opcoes={[['todas', 'Todas as origens'], ['chat', 'Chat'], ['conta', 'Conta'], ['manual', 'Manual'], ['importacao', 'Importado']]} />
          <Select valor={filtros.status} onChange={(v) => mudaFiltro({ status: v as Filtros['status'] })}
            opcoes={[['todos', 'Todos os status'], ['lead', 'Lead'], ['cliente', 'Cliente']]} />
          <Select valor={filtros.canal} onChange={(v) => mudaFiltro({ canal: v as Filtros['canal'] })}
            opcoes={[['todos', 'Qualquer canal'], ['whatsapp', 'Tem WhatsApp'], ['email', 'Tem e-mail']]} />
          <input
            value={filtros.uf}
            onChange={(e) => mudaFiltro({ uf: e.target.value.toUpperCase().slice(0, 2) })}
            placeholder="UF"
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-16 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={filtros.optout} onChange={(e) => mudaFiltro({ optout: e.target.checked })} />
            mostrar descadastrados
          </label>
        </div>

        {msg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2">{msg}</p>}

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-3 font-semibold">Lead</th>
                <th className="py-2 pr-3 font-semibold">Local</th>
                <th className="py-2 pr-3 font-semibold">Origem</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Contatos</th>
                <th className="py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className={'border-b border-gray-50 align-top ' + (l.optOut ? 'opacity-50' : '')}>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-gray-900">{l.nome ?? '—'}</p>
                    {l.empresa && <p className="text-[11px] text-gray-400">{l.empresa}</p>}
                    <p className="text-xs text-gray-500">
                      {telBR(l.telefone)}
                      {l.telefone && l.email ? ' · ' : ''}
                      {l.email ?? ''}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500 whitespace-nowrap">
                    {[l.cidade, l.uf].filter(Boolean).join('/') || '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500">{ORIGEM_LABEL[l.origem]}</td>
                  <td className="py-2.5 pr-3">
                    <span className={'text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap ' + STATUS_BADGE[l.status]}>
                      {l.optOut ? 'Descadastrado' : l.status === 'cliente' ? 'Cliente' : 'Lead'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500 whitespace-nowrap">
                    {l.toques > 0 ? `${l.toques} · ${dataBR(l.ultimoContatoEm)}` : '—'}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setEditando(l)} className="text-xs text-[#0F6E56] underline mr-3">
                      editar
                    </button>
                    <button type="button" onClick={() => void alternarOptOut(l)} className="text-xs text-gray-500 hover:text-gray-700 underline mr-3">
                      {l.optOut ? 'reativar' : 'descadastrar'}
                    </button>
                    <button type="button" onClick={() => void excluir(l)} className="text-xs text-red-400 hover:text-red-600 underline">
                      excluir
                    </button>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && !carregando && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-gray-400">
                    Nenhum lead com esse filtro. Se a base está vazia, clique em <strong>Sincronizar do site</strong>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {paginas > 1 && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Página {pagina + 1} de {paginas}</span>
            <div className="flex gap-2">
              <button type="button" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}
                className="border border-gray-200 rounded-lg px-3 py-1 disabled:opacity-40">anterior</button>
              <button type="button" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}
                className="border border-gray-200 rounded-lg px-3 py-1 disabled:opacity-40">próxima</button>
            </div>
          </div>
        )}
      </div>

      {editando && (
        <ModalLead
          lead={editando === 'novo' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null)
            await buscar(filtros, pagina)
          }}
        />
      )}

      {importando && (
        <ImportarLeads
          onFechar={() => setImportando(false)}
          onImportado={async (resumoTxt) => {
            setImportando(false)
            setMsg(resumoTxt)
            await buscar(filtros, 0)
          }}
        />
      )}
    </div>
  )
}

function Card({ titulo, valor, nota, destaque }: { titulo: string; valor: number; nota: string; destaque?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{titulo}</p>
      <p className={'text-2xl font-bold mt-1 ' + (destaque ? 'text-[#0F6E56]' : 'text-gray-900')}>{valor}</p>
      <p className="text-[11px] text-gray-400">{nota}</p>
    </div>
  )
}

function Select({ valor, onChange, opcoes }: { valor: string; onChange: (v: string) => void; opcoes: Array<[string, string]> }) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
    >
      {opcoes.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  )
}

// ─────────────────────────────────────────────────────────────
// Cadastro / edição
// ─────────────────────────────────────────────────────────────

function ModalLead({ lead, onFechar, onSalvo }: { lead: Lead | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(lead?.nome ?? '')
  const [empresa, setEmpresa] = useState(lead?.empresa ?? '')
  const [telefone, setTelefone] = useState(lead?.telefone ?? '')
  const [email, setEmail] = useState(lead?.email ?? '')
  const [cidade, setCidade] = useState(lead?.cidade ?? '')
  const [uf, setUf] = useState(lead?.uf ?? '')
  const [observacao, setObservacao] = useState(lead?.observacao ?? '')
  const [tags, setTags] = useState((lead?.tags ?? []).join(', '))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    const corpo = {
      nome,
      empresa,
      telefone,
      email,
      cidade,
      uf,
      observacao,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
    }
    try {
      const r = await fetch(lead ? `/api/admin/marketing/leads/${lead.id}` : '/api/admin/marketing/leads', {
        method: lead ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não deu pra salvar')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={lead ? 'Editar lead' : 'Novo lead'} onFechar={onFechar}>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-gray-500 sm:col-span-2">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} placeholder="Maria Souza" />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">
          Empresa / marca
          <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={CAMPO} placeholder="Ateliê da Maria" />
        </label>
        <label className="text-xs text-gray-500">
          WhatsApp
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={CAMPO} placeholder="(81) 99999-0000" />
        </label>
        <label className="text-xs text-gray-500">
          E-mail
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={CAMPO} placeholder="maria@exemplo.com" />
        </label>
        <label className="text-xs text-gray-500">
          Cidade
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} className={CAMPO} placeholder="Recife" />
        </label>
        <label className="text-xs text-gray-500">
          UF
          <input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} className={CAMPO} placeholder="PE" />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">
          Tags (separadas por vírgula)
          <input value={tags} onChange={(e) => setTags(e.target.value)} className={CAMPO} placeholder="feira-2026, uniformes" />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">
          Observação
          <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} className={CAMPO} />
        </label>
      </div>

      <p className="text-[11px] text-gray-400 mt-2">
        Precisa de pelo menos um WhatsApp ou e-mail válido. Se o contato já estiver na base, os dados são completados no
        registro existente em vez de criar um duplicado.
      </p>

      {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">{erro}</p>}

      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando}
          className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onFechar} className="text-sm text-gray-500 hover:text-gray-700 px-2">
          Cancelar
        </button>
      </div>
    </Modal>
  )
}

export function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Fechar" onClick={onFechar} className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-sm font-semibold text-gray-900">{titulo}</p>
          <button type="button" onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
