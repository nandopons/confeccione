'use client'

// ============================================================================
// Captação puxada pelo pedido — o painel do agente que sai atrás de confecção
// quando um pedido fica sem fornecedor. Modo (desligado / sugere / responde),
// tetos, pedidos na fila com os candidatos achados e o que cada um respondeu,
// e as últimas buscas (o que o Claude pesquisou e por quê descartou).
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { MODO_LUIGI_LABEL, MODOS_LUIGI, type ModoLuigi } from '@/app/lib/luigi-catalogo'

type Candidato = {
  id: string
  nome: string | null
  email: string | null
  whatsapp: string | null
  cidade: string | null
  uf: string | null
  resposta: string | null
  status: string
  ultimo_contato_em: string | null
  instagram?: string | null
  site?: string | null
  evidencia?: string | null
  ultimo_erro?: string | null
}

type PedidoFila = {
  id: string
  codigo: string | null
  nome: string | null
  cidade: string | null
  uf: string | null
  etapa: string
  desde: string
  descricao: string
  confirmado_em?: string | null
  elegivel?: boolean
  buscas: number
  candidatos: Candidato[]
}

type Busca = {
  id: string
  criado_em: string
  pedido_id: string
  regiao: 'uf' | 'pe' | 'brasil'
  origem: string
  encontrados: number
  novos: number
  contatados: number
  resumo: string | null
  erro: string | null
  consultas: string[]
  descartados: Array<{ nome: string; motivo: string }>
}

type Estado = {
  modo: ModoLuigi
  config: { max_por_pedido: number; max_por_dia: number; regioes: string[]; horas_entre_buscas: number; idade_max_dias: number }
  hoje: { contatados: number; teto: number }
  pedidos: PedidoFila[]
  buscas: Busca[]
}

const AJUDA: Record<ModoLuigi, string> = {
  desligado: 'Nada acontece. Pedido sem fornecedor fica esperando você.',
  sugere: 'O sistema busca as confecções e lista aqui; você clica em Abordar em quem quiser.',
  responde: 'O sistema busca e manda a sondagem sozinho (e-mail com o PDF; WhatsApp quando o template for aprovado), dentro dos tetos. Quem responde é atendido pelo Luigi e você recebe aviso.',
}

const REGIAO: Record<string, string> = { uf: 'estado do cliente', pe: 'polo de PE', brasil: 'Brasil' }

const RESPOSTA: Record<string, { rotulo: string; cor: string }> = {
  interessado: { rotulo: 'Disse sim', cor: 'bg-emerald-50 text-emerald-700' },
  depois: { rotulo: 'Agora não', cor: 'bg-amber-50 text-amber-700' },
  nao_produz: { rotulo: 'Não produz', cor: 'bg-gray-100 text-gray-600' },
  recusou: { rotulo: 'Recusou', cor: 'bg-red-50 text-red-700' },
  opt_out: { rotulo: 'Pediu pra sair', cor: 'bg-red-50 text-red-700' },
}

function dias(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000))
}

function quando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function CaptacaoPorPedido() {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [verBuscas, setVerBuscas] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/captacao/pedido', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro ?? 'falha')
      setEstado(j as Estado)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu pra carregar')
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void carregar(), 0)
    return () => clearTimeout(t)
  }, [carregar])

  async function salvar(patch: Record<string, unknown>) {
    setOcupado('config')
    try {
      const r = await fetch('/api/admin/captacao/pedido', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      if (!r.ok) setErro((await r.json().catch(() => null))?.erro ?? 'Não deu pra salvar')
      await carregar()
    } finally {
      setOcupado(null)
    }
  }

  async function acao(corpo: Record<string, unknown>, chave: string) {
    setOcupado(chave)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/captacao/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const j = await r.json().catch(() => null)
      if (!r.ok) setErro(j?.erro ?? 'Falhou')
      else if (corpo.acao === 'buscar') {
        const res = j.resultado
        setMsg(res.erro ? `Busca (${REGIAO[res.regiao]}): ${res.erro}` : `Busca (${REGIAO[res.regiao]}): ${res.encontrados} encontradas, ${res.novos} novas, ${res.contatados} abordadas.`)
      } else if (corpo.acao === 'rodar') {
        const res = j.resultado
        setMsg(res.pulado ? `Rodada: ${res.pulado}.` : `Rodada: ${res.buscas.length} busca(s) em ${res.pedidos_olhados} pedido(s) sem fornecedor.`)
      } else if (corpo.acao === 'abordar') {
        setMsg(j.ok ? 'Sondagem enviada.' : `Não saiu: ${j.resultado?.erro ?? 'erro'}`)
      }
      await carregar()
    } finally {
      setOcupado(null)
    }
  }

  if (!estado) {
    return (
      <section className="mb-10 rounded-xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-500">{erro ?? 'Carregando a captação por pedido…'}</p>
      </section>
    )
  }

  const responde = estado.modo === 'responde'

  return (
    <section className="mb-10 rounded-xl border border-gray-200 bg-white">
      <div className="p-5 border-b border-gray-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-gray-900">Puxada pelo pedido</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Pedido confirmado há mais de 24 h sem confecção: o sistema procura na web quem produz e manda a sondagem.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Agente</span>
            <select
              value={estado.modo}
              disabled={ocupado === 'config'}
              onChange={(e) => void salvar({ modo: e.target.value })}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
            >
              {MODOS_LUIGI.map((m) => (
                <option key={m} value={m}>{m === 'responde' ? 'Busca e aborda sozinho' : m === 'sugere' ? 'Busca, eu abordo' : MODO_LUIGI_LABEL[m]}</option>
              ))}
            </select>
          </div>
        </div>
        <p className={'mt-3 rounded-lg px-3 py-2 text-[12.5px] ' + (responde ? 'bg-[#E1F5EE]/70 text-[#0F6E56]' : 'bg-gray-50 text-gray-600')}>{AJUDA[estado.modo]}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-700">
          <label className="flex items-center gap-1.5">
            Por pedido
            <input
              type="number"
              min={1}
              max={50}
              defaultValue={estado.config.max_por_pedido}
              onBlur={(e) => Number(e.target.value) !== estado.config.max_por_pedido && void salvar({ max_por_pedido: Number(e.target.value) })}
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Por dia
            <input
              type="number"
              min={1}
              max={200}
              defaultValue={estado.config.max_por_dia}
              onBlur={(e) => Number(e.target.value) !== estado.config.max_por_dia && void salvar({ max_por_dia: Number(e.target.value) })}
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <span className="text-gray-500">
            Hoje: <strong className="text-gray-900">{estado.hoje.contatados}</strong> de {estado.hoje.teto} abordadas
          </span>
          <span className="text-gray-500">
            Ordem: {estado.config.regioes.map((r) => REGIAO[r] ?? r).join(' → ')} · nova busca a cada {estado.config.horas_entre_buscas} h · sozinho só em pedido confirmado há até {estado.config.idade_max_dias} d
          </span>
          <button
            onClick={() => void acao({ acao: 'rodar' }, 'rodar')}
            disabled={ocupado !== null || estado.modo === 'desligado'}
            className="ml-auto rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            title="Faz agora o que o cron faria às 09:00 e 15:00"
          >
            {ocupado === 'rodar' ? 'Rodando…' : 'Rodar agora'}
          </button>
        </div>
        {msg && <p className="mt-3 text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2">{msg}</p>}
        {erro && <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}
      </div>

      {/* pedidos na fila */}
      <div className="divide-y divide-gray-100">
        {estado.pedidos.length === 0 && <p className="p-5 text-sm text-gray-500">Nenhum pedido esperando confecção agora.</p>}
        {estado.pedidos.map((p) => {
          const contatados = p.candidatos.filter((c) => c.ultimo_contato_em).length
          const sim = p.candidatos.filter((c) => c.resposta === 'interessado').length
          const sugeridos = p.candidatos.filter((c) => c.status === 'sugerido').length
          const expandido = aberto === p.id
          return (
            <div key={p.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {p.descricao} <span className="text-gray-400">· {[p.cidade, p.uf].filter(Boolean).join('/') || 'sem local'}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {p.codigo ?? p.id.slice(0, 8)} · {p.nome ?? 'sem nome'} · {p.etapa === 'sem_fornecedor' ? `sem fornecedor há ${dias(p.desde)} d` : 'buscando fornecedor'} · {p.buscas} busca(s) · {contatados} abordada(s)
                    {sim > 0 && <span className="ml-1 font-semibold text-emerald-700">· {sim === 1 ? '1 disse sim' : `${sim} disseram sim`}</span>}
                    {sugeridos > 0 && <span className="ml-1 font-semibold text-amber-700">· {sugeridos} pra abordar</span>}
                    {p.elegivel === false && <span className="ml-1 text-gray-400">· antigo: só pelo Buscar agora</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {p.candidatos.length > 0 && (
                    <button onClick={() => setAberto(expandido ? null : p.id)} className="text-sm text-gray-600 hover:text-gray-900 underline">
                      {expandido ? 'esconder' : `ver ${p.candidatos.length}`}
                    </button>
                  )}
                  <button
                    onClick={() => void acao({ acao: 'buscar', pedidoId: p.id }, `buscar-${p.id}`)}
                    disabled={ocupado !== null || estado.modo === 'desligado'}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    title="Roda a busca agora pra este pedido (próxima região da ordem)"
                  >
                    {ocupado === `buscar-${p.id}` ? 'Buscando…' : 'Buscar agora'}
                  </button>
                </div>
              </div>

              {expandido && (
                <ul className="mt-3 divide-y divide-gray-50 rounded-lg border border-gray-100">
                  {p.candidatos.map((c) => {
                    const r = c.resposta ? RESPOSTA[c.resposta] : null
                    return (
                      <li key={c.id} className="px-3 py-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-gray-900">{c.nome ?? 'sem nome'}</span>
                          <span className="text-gray-400">{[c.cidade, c.uf].filter(Boolean).join('/')}</span>
                          {c.whatsapp && (
                            <span className="text-[11px] rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                              {c.whatsapp.startsWith('55') ? 'wa' : 'tel'} {c.whatsapp}
                            </span>
                          )}
                          {c.email && <span className="text-[11px] rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{c.email}</span>}
                          {c.instagram && (
                            <a href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer" className="text-[11px] text-[#0F6E56] underline">
                              @{c.instagram}
                            </a>
                          )}
                          {c.site && (
                            <a href={c.site} target="_blank" rel="noreferrer" className="text-[11px] text-[#0F6E56] underline">site</a>
                          )}
                          {r && <span className={'text-[11px] font-semibold rounded px-1.5 py-0.5 ' + r.cor}>{r.rotulo}</span>}
                          {!r && c.ultimo_contato_em && <span className="text-[11px] text-gray-500">abordada {quando(c.ultimo_contato_em)}</span>}
                          {c.status === 'sugerido' && (
                            <button
                              onClick={() => void acao({ acao: 'abordar', candidatoId: c.id }, `abordar-${c.id}`)}
                              disabled={ocupado !== null}
                              className="ml-auto rounded-md bg-[#1D9E75] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-50"
                            >
                              {ocupado === `abordar-${c.id}` ? 'Enviando…' : 'Abordar'}
                            </button>
                          )}
                          {c.status === 'erro' && <span className="text-[11px] text-red-600" title={c.ultimo_erro ?? ''}>não saiu</span>}
                        </div>
                        {c.evidencia && <p className="mt-0.5 text-xs text-gray-500">{c.evidencia}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* últimas buscas */}
      <div className="border-t border-gray-100 p-5">
        <button onClick={() => setVerBuscas((v) => !v)} className="text-sm text-gray-600 hover:text-gray-900 underline">
          {verBuscas ? 'Esconder as últimas buscas' : `Ver as últimas buscas (${estado.buscas.length})`}
        </button>
        {verBuscas && (
          <ul className="mt-3 space-y-3">
            {estado.buscas.map((b) => (
              <li key={b.id} className="rounded-lg border border-gray-100 p-3 text-sm">
                <p className="text-gray-900">
                  <span className="text-gray-400">{quando(b.criado_em)}</span> · {REGIAO[b.regiao]} · {b.origem} · {b.encontrados} encontradas, {b.novos} novas, {b.contatados} abordadas
                  {b.erro && <span className="ml-1 text-red-600">· {b.erro}</span>}
                </p>
                {b.resumo && <p className="mt-1 text-xs text-gray-600">{b.resumo}</p>}
                {b.consultas?.length > 0 && <p className="mt-1 text-xs text-gray-400">Consultas: {b.consultas.join(' · ')}</p>}
                {b.descartados?.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400">Descartadas: {b.descartados.map((d) => `${d.nome} (${d.motivo})`).join(' · ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
