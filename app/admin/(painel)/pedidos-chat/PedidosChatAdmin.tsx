'use client'

import { useEffect, useState } from 'react'

type Resumo = {
  id: string; criadoEm: string; nome: string | null; telefone: string | null; email: string | null
  status: string | null; pagamentoStatus: string | null; valorCentavos: number | null
  totalPecas: number; resumo: string; concluido: boolean
}
type Linha = {
  modelo?: string | null; cor?: string | null; material?: string | null; publico?: string | null
  total?: number | null; tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null
  estampado?: boolean | null; descricao?: string | null
}
type Detalhe = {
  id: string
  contato: { nome: string | null; telefone: string | null; email: string | null; cep: string | null; complemento: string | null; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; prazoDias: number | null }
  linhas: Linha[]
  conversa: Array<{ role: 'user' | 'assistant'; texto: string }>
  mockups: Array<{ index: number; temLiso: boolean; temArte: boolean }>
}

function brl(c: number | null | undefined) { if (c == null) return '—'; return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function data(s: string) { try { return new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) } catch { return s } }

function statusLabel(p: Resumo): { txt: string; cor: string } {
  if (p.pagamentoStatus === 'pago') return { txt: 'pago', cor: 'bg-green-100 text-green-800' }
  if (p.pagamentoStatus === 'gerado') return { txt: 'aguardando pagamento', cor: 'bg-amber-100 text-amber-800' }
  return { txt: 'não concluído', cor: 'bg-gray-100 text-gray-600' }
}

export default function PedidosChatAdmin() {
  const [filtro, setFiltro] = useState<'incompletos' | 'todos'>('incompletos')
  const [pedidos, setPedidos] = useState<Resumo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aberto, setAberto] = useState<string | null>(null)
  const [det, setDet] = useState<Record<string, Detalhe>>({})
  const [acaoMsg, setAcaoMsg] = useState<string | null>(null)
  const [agindo, setAgindo] = useState<string | null>(null)

  async function acao(id: string, ac: 'excluir' | 'lembrete' | 'feedback') {
    if (ac === 'excluir' && !confirm('Excluir este pedido? Não dá pra desfazer.')) return
    setAgindo(id + ac); setAcaoMsg(null)
    try {
      const r = await fetch(`/api/admin/pedidos-assistente/${id}/acao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: ac }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha')
      if (ac === 'excluir') { setPedidos((ps) => ps.filter((x) => x.id !== id)); setAcaoMsg('Pedido excluído.') }
      else setAcaoMsg(`${ac === 'lembrete' ? 'Lembrete' : 'Pedido de feedback'} enviado` + (j.whats || j.email ? ` (${[j.whats ? 'WhatsApp' : null, j.email ? 'e-mail' : null].filter(Boolean).join(' + ')}).` : ', mas nenhum canal disponível.'))
    } catch (e: any) { setAcaoMsg(e.message || 'Erro') }
    finally { setAgindo(null) }
  }

  async function carregar() {
    setCarregando(true)
    try {
      const r = await fetch(`/api/admin/pedidos-assistente?filtro=${filtro}`, { cache: 'no-store' })
      const j = await r.json()
      setPedidos(j.pedidos || [])
    } finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [filtro]) // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(id: string) {
    if (aberto === id) { setAberto(null); return }
    setAberto(id)
    if (!det[id]) {
      const r = await fetch(`/api/admin/pedidos-assistente/${id}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) setDet((m) => ({ ...m, [id]: j }))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pedidos do chat</h1>
          <p className="text-sm text-gray-500">Pedidos iniciados (etapa 1) — veja a conversa, os mockups e as artes, mesmo os não concluídos.</p>
        </div>
        <div className="flex gap-1">
          {(['incompletos', 'todos'] as const).map((f) => (
            <button key={f} onClick={() => setFiltro(f)} className={'text-sm px-3 py-1.5 rounded-md ' + (filtro === f ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100')}>
              {f === 'incompletos' ? 'Não concluídos' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {acaoMsg && <div className="mb-4 text-sm rounded-md bg-blue-50 text-blue-800 px-3 py-2">{acaoMsg}</div>}
      {carregando && <p className="text-sm text-gray-500">Carregando…</p>}
      {!carregando && pedidos.length === 0 && <p className="text-sm text-gray-400">Nenhum pedido.</p>}

      <div className="space-y-3">
        {pedidos.map((p) => {
          const st = statusLabel(p)
          const d = det[p.id]
          return (
            <div key={p.id} className="rounded-xl border border-gray-200 bg-white">
              <button onClick={() => abrir(p.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-gray-50">
                <div className="min-w-0">
                  <div className="text-xs text-gray-400">{data(p.criadoEm)}</div>
                  <div className="font-medium text-gray-900 truncate">{p.nome || 'Sem nome'} · {p.totalPecas} peças{p.valorCentavos ? ` · ${brl(p.valorCentavos)}` : ''}</div>
                  <div className="text-xs text-gray-500 truncate">{p.resumo || '—'}</div>
                </div>
                <span className={'text-xs px-2 py-1 rounded-full whitespace-nowrap ' + st.cor}>{st.txt}</span>
              </button>

              {aberto === p.id && (
                <div className="border-t border-gray-100 px-4 py-4 space-y-5">
                  {!d ? <p className="text-sm text-gray-400">Carregando detalhe…</p> : (
                    <>
                      {/* contato */}
                      <div className="text-sm text-gray-700">
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Contato</div>
                        <div>{d.contato.nome} · {d.contato.telefone} · {d.contato.email}</div>
                        <div className="text-gray-500">{[d.contato.logradouro, d.contato.bairro, [d.contato.cidade, d.contato.uf].filter(Boolean).join('/'), d.contato.cep, d.contato.complemento].filter(Boolean).join(', ')}</div>
                        {d.contato.prazoDias ? <div className="text-gray-500">Prazo: {d.contato.prazoDias} dias</div> : null}
                      </div>

                      {/* produtos + mockups */}
                      <div>
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Produtos e mockups</div>
                        <div className="space-y-4">
                          {d.linhas.map((l, i) => {
                            const mk = d.mockups.find((m) => m.index === i)
                            return (
                              <div key={i} className="rounded-lg border border-gray-100 p-3">
                                <div className="text-sm font-medium text-gray-900">
                                  {l.total ?? '?'}× {l.modelo || 'peça'}{l.publico && l.publico !== 'unissex' ? ` ${l.publico}` : ''}{l.cor ? ` · ${l.cor}` : ''}{l.material ? ` · ${l.material}` : ''}{l.estampado ? ' (estampado)' : ''}
                                </div>
                                {l.descricao && <div className="text-xs text-gray-500 mt-0.5">{l.descricao}</div>}
                                <div className="flex flex-wrap gap-3 mt-2">
                                  {mk?.temLiso && (
                                    <figure className="text-center">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={`/api/admin/pedidos-assistente/${p.id}/img?linha=${i}&tipo=liso`} alt="liso" className="h-28 rounded border border-gray-200" />
                                      <figcaption className="text-[10px] text-gray-400 mt-0.5">liso</figcaption>
                                    </figure>
                                  )}
                                  {mk?.temArte && (
                                    <figure className="text-center">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={`/api/admin/pedidos-assistente/${p.id}/img?linha=${i}&tipo=arte`} alt="arte" className="h-28 rounded border border-[#1D9E75]/40" />
                                      <figcaption className="text-[10px] text-[#0F6E56] mt-0.5">com arte</figcaption>
                                    </figure>
                                  )}
                                  {!mk?.temLiso && !mk?.temArte && <span className="text-xs text-gray-400">sem mockup gerado</span>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* conversa */}
                      <div>
                        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Conversa</div>
                        {d.conversa.length === 0 ? <p className="text-xs text-gray-400">Sem transcrição (pedido anterior à gravação do chat).</p> : (
                          <div className="space-y-2 max-h-96 overflow-y-auto rounded-lg bg-gray-50 border border-gray-100 p-3">
                            {d.conversa.map((c, k) => (
                              <div key={k} className={c.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                                <div className={'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap ' + (c.role === 'user' ? 'bg-[#1D9E75] text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm')}>
                                  {c.texto}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                        <a href={`/visualizador/${p.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-[#0F6E56] underline mr-auto">Abrir visualizador do cliente ↗</a>
                        <button type="button" onClick={() => acao(p.id, 'lembrete')} disabled={agindo === p.id + 'lembrete'} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">{agindo === p.id + 'lembrete' ? '…' : 'Lembrar de continuar'}</button>
                        <button type="button" onClick={() => acao(p.id, 'feedback')} disabled={agindo === p.id + 'feedback'} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">{agindo === p.id + 'feedback' ? '…' : 'Pedir feedback do mockup'}</button>
                        <button type="button" onClick={() => acao(p.id, 'excluir')} disabled={agindo === p.id + 'excluir'} className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">Excluir</button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
