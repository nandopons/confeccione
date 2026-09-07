'use client'

// ============================================================================
// AUTOMAÇÃO (aba "Automação") — os fluxos que rodam sozinhos.
//
// Um fluxo = GATILHO (o que faz o lead entrar) + PÚBLICO (filtro da base) +
// PASSOS (sequência de esperas e templates). O robô roda de hora em hora,
// inscreve quem passou a ser elegível e manda os passos vencidos.
//
// A tela mostra a prévia ANTES de ativar: quantos leads entrariam agora e
// quantos deles têm o canal do primeiro passo.
// ============================================================================

import { useState } from 'react'
import type { Automacao, EstatisticaFluxo, Gatilho, StatusAutomacao } from '@/app/lib/automacoes-marketing'
import type { FiltroLeads } from '@/app/lib/leads-marketing'
import type { TemplateMarketing } from '@/app/lib/templates-marketing'

const GATILHOS: Array<{ id: Gatilho; label: string; ajuda: string }> = [
  {
    id: 'lead_novo',
    label: 'Lead novo entrou na base',
    ajuda: 'Só entram leads cadastrados nos últimos X dias — assim ligar o fluxo não dispara pra base inteira de uma vez.',
  },
  {
    id: 'pedido_parado',
    label: 'Pedido parado sem pagar',
    ajuda: 'Entra quem montou pedido no chat, não pagou e está parado há X dias.',
  },
  {
    id: 'pos_compra',
    label: 'Depois da compra',
    ajuda: 'Entra quem pagou há X dias. É o fluxo de recompra e de pedido de feedback.',
  },
  {
    id: 'lead_frio',
    label: 'Está na base e nunca comprou',
    ajuda: 'Entra quem está na base há X dias, nunca fechou e não recebeu contato nesse período.',
  },
  // Por etapa do pedido (D-8): entra quem está na etapa há X dias, sai quando muda de etapa.
  {
    id: 'etapa_captado',
    label: 'Pedido captado (peça incompleta)',
    ajuda: 'Deixou nome e WhatsApp, mas a peça está sem modelo, cor ou quantidade há X dias. Objetivo: completar o pedido.',
  },
  {
    id: 'etapa_pedido_completo',
    label: 'Pedido completo sem confirmar',
    ajuda: 'Peça completa e não clicou em "Buscar fornecedor" há X dias. Objetivo: confirmar.',
  },
  {
    id: 'etapa_sem_resposta',
    label: 'Orçamento sem resposta',
    ajuda: 'Recebeu o orçamento e está há X dias sem responder. Objetivo: entender o motivo e fechar.',
  },
  {
    id: 'etapa_orcamento_vencido',
    label: 'Orçamento vencido (21 dias)',
    ajuda: 'Orçamento há mais de 21 dias sem pagamento, há X dias nessa situação. Objetivo: recuperar ou encerrar.',
  },
  {
    id: 'etapa_inativo',
    label: 'Pedido inativo (30 dias sem toque)',
    ajuda: 'Captado ou completo há 30 dias sem nenhum contato, há X dias nessa situação. Objetivo: reengajar.',
  },
  {
    id: 'etapa_em_negociacao',
    label: 'Em negociação com o fornecedor',
    ajuda: 'Fornecedor aceitou há X dias e o orçamento ainda não saiu. Com 3 dias: perguntar ao cliente se a conversa deu certo (D-9).',
  },
  {
    id: 'etapa_sem_fornecedor',
    label: 'Pedido sem fornecedor',
    ajuda: 'Confirmado há X dias sem fornecedor aceito. Mensagem pro cliente: "estamos buscando" — a captação é por dentro.',
  },
]

const STATUS_BADGE: Record<StatusAutomacao, string> = {
  rascunho: 'bg-gray-100 text-gray-600',
  ativa: 'bg-[#E1F5EE] text-[#0F6E56]',
  pausada: 'bg-amber-50 text-amber-700',
}

const CAMPO =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]'

type PassoForm = { esperaDias: number; templateId: string | null }

type Rascunho = {
  id: string | null
  nome: string
  descricao: string
  gatilho: Gatilho
  gatilhoDias: number
  publico: FiltroLeads
  maxToques: number
  horaInicio: number
  horaFim: number
  passos: PassoForm[]
}

function novoRascunho(): Rascunho {
  return {
    id: null,
    nome: '',
    descricao: '',
    gatilho: 'pos_compra',
    gatilhoDias: 30,
    publico: {},
    maxToques: 3,
    horaInicio: 9,
    horaFim: 20,
    passos: [{ esperaDias: 0, templateId: null }],
  }
}

function doFluxo(a: Automacao): Rascunho {
  return {
    id: a.id,
    nome: a.nome,
    descricao: a.descricao ?? '',
    gatilho: a.gatilho,
    gatilhoDias: a.gatilhoDias,
    publico: a.publico,
    maxToques: a.maxToques,
    horaInicio: a.horaInicio,
    horaFim: a.horaFim,
    passos: a.passos.map((p) => ({ esperaDias: p.esperaDias, templateId: p.templateId })),
  }
}

type Detalhe = {
  regras: string[]
  entrariam: Array<{ leadId: string; nome: string | null; telefone: string | null; email: string | null; etapa: string | null; diasNaEtapa: number | null; alcancavel: boolean }>
  totalEntrariam: number
  receberiamAgora: Array<{ leadId: string; nome: string | null; passoOrdem: number; enviados: number }>
  totalReceberiamAgora: number
  aguardando: number
  janelaAbertaAgora: boolean
}

export default function Automacoes({
  iniciais,
  estatisticasIniciais,
  templates,
}: {
  iniciais: Automacao[]
  estatisticasIniciais: Record<string, EstatisticaFluxo>
  templates: TemplateMarketing[]
}) {
  const [fluxos, setFluxos] = useState(iniciais)
  const [stats, setStats] = useState(estatisticasIniciais)
  const [editor, setEditor] = useState<Rascunho | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  // Detalhe do fluxo (D-10): regras e quem entra na próxima rodada — só quando clica.
  const [aberto, setAberto] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<Record<string, Detalhe | 'carregando' | 'erro'>>({})

  async function abrirDetalhe(a: Automacao) {
    if (aberto === a.id) { setAberto(null); return }
    setAberto(a.id)
    if (detalhes[a.id] && detalhes[a.id] !== 'erro') return
    setDetalhes((d) => ({ ...d, [a.id]: 'carregando' }))
    try {
      const r = await fetch(`/api/admin/marketing/automacoes/${a.id}/detalhe`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha')
      setDetalhes((d) => ({ ...d, [a.id]: j.detalhe as Detalhe }))
    } catch {
      setDetalhes((d) => ({ ...d, [a.id]: 'erro' }))
    }
  }

  async function recarregar() {
    const r = await fetch('/api/admin/marketing/automacoes')
    const j = await r.json()
    if (r.ok) {
      setFluxos(j.automacoes as Automacao[])
      setStats(j.estatisticas as Record<string, EstatisticaFluxo>)
    }
  }

  async function acao(a: Automacao, tipo: 'ativar' | 'pausar' | 'rodar') {
    if (tipo === 'ativar' && !confirm(`Ativar "${a.nome}"? A partir de agora o robô manda sozinho.`)) return
    setOcupado(a.id)
    setMsg(null)
    try {
      const r = await fetch(`/api/admin/marketing/automacoes/${a.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: tipo }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha na ação')
      if (j.resultado) {
        const res = j.resultado as {
          inscritos: number
          enviados: number
          erros: number
          sairam: number
          pendentes: number
          observacao?: string
        }
        setMsg(
          res.observacao
            ? `Nada enviado: ${res.observacao}.`
            : `${res.inscritos} entraram no fluxo, ${res.enviados} mensagens enviadas, ${res.erros} com erro, ${res.sairam} saíram. ${res.pendentes} ainda vencidos.`
        )
      }
      await recarregar()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro na ação.')
    } finally {
      setOcupado(null)
    }
  }

  async function excluir(a: Automacao) {
    if (!confirm(`Excluir o fluxo "${a.nome}"? O histórico de quem já recebeu vai junto.`)) return
    await fetch(`/api/admin/marketing/automacoes/${a.id}`, { method: 'DELETE' })
    await recarregar()
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="mr-auto">
            <p className="text-sm font-semibold text-gray-900">Fluxos</p>
            <p className="text-xs text-gray-500">
              O robô roda de hora em hora, só entre {fluxos[0]?.horaInicio ?? 9}h e {fluxos[0]?.horaFim ?? 20}h, e
              respeita descadastro e teto de toques por lead.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditor(novoRascunho())}
            className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Novo fluxo
          </button>
        </div>

        {msg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2">{msg}</p>}

        <div className="space-y-2">
          {fluxos.map((a) => {
            const s = stats[a.id] ?? { ativos: 0, concluidos: 0, sairam: 0, enviados: 0 }
            const g = GATILHOS.find((x) => x.id === a.gatilho)
            return (
              <div key={a.id} className="border border-gray-100 rounded-lg p-3.5">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 text-sm">{a.nome}</p>
                      <span className={'text-[11px] font-medium px-2 py-0.5 rounded-full ' + STATUS_BADGE[a.status]}>
                        {a.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {g?.label} · há {a.gatilhoDias} {a.gatilhoDias === 1 ? 'dia' : 'dias'} · {a.passos.length}{' '}
                      {a.passos.length === 1 ? 'passo' : 'passos'} · teto de {a.maxToques} toques
                    </p>
                    {a.descricao && <p className="text-xs text-gray-400 mt-0.5">{a.descricao}</p>}

                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {a.passos.map((p) => {
                        const t = templates.find((x) => x.id === p.templateId)
                        return (
                          <span
                            key={p.id}
                            className="text-[11px] border border-gray-200 rounded-full px-2.5 py-1 text-gray-600"
                          >
                            {p.esperaDias === 0 ? 'na hora' : `+${p.esperaDias}d`} · {t?.nome ?? '⚠ sem template'}
                          </span>
                        )
                      })}
                    </div>

                    <p className="text-[11px] text-gray-400 mt-2">
                      {s.ativos} no fluxo · {s.enviados} mensagens enviadas · {s.concluidos} concluíram · {s.sairam} saíram
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => void acao(a, a.status === 'ativa' ? 'pausar' : 'ativar')}
                      disabled={ocupado === a.id}
                      className={
                        'text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 ' +
                        (a.status === 'ativa'
                          ? 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                          : 'bg-[#1D9E75] hover:bg-[#178A65] text-white')
                      }
                    >
                      {a.status === 'ativa' ? 'Pausar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void acao(a, 'rodar')}
                      disabled={ocupado === a.id}
                      className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      title="Roda uma vez agora, mesmo pausado — mas com todas as travas de sempre"
                    >
                      {ocupado === a.id ? 'Rodando…' : 'Rodar agora'}
                    </button>
                    <button type="button" onClick={() => void abrirDetalhe(a)} className="text-xs text-[#0F6E56] underline">
                      {aberto === a.id ? 'fechar detalhes' : 'regras e quem recebe'}
                    </button>
                    <button type="button" onClick={() => setEditor(doFluxo(a))} className="text-xs text-[#0F6E56] underline">
                      editar
                    </button>
                    <button type="button" onClick={() => void excluir(a)} className="text-xs text-red-400 hover:text-red-600 underline">
                      excluir
                    </button>
                  </div>
                </div>

                {aberto === a.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3 grid gap-4 md:grid-cols-2">
                    {detalhes[a.id] === 'carregando' || !detalhes[a.id] ? (
                      <p className="text-xs text-gray-400">Calculando quem entraria…</p>
                    ) : detalhes[a.id] === 'erro' ? (
                      <p className="text-xs text-red-500">Não deu pra calcular a prévia agora.</p>
                    ) : (
                      (() => {
                        const d = detalhes[a.id] as Detalhe
                        return (
                          <>
                            <div>
                              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Regras deste fluxo</p>
                              <ol className="space-y-1 text-xs text-gray-700 list-decimal pl-4">
                                {d.regras.map((r, i) => <li key={i}>{r}</li>)}
                              </ol>
                              <p className="text-[11px] text-gray-400 mt-2">
                                {d.janelaAbertaAgora ? 'Dentro da janela de envio agora.' : 'Fora da janela de envio agora — nada sai até abrir.'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                                Próxima rodada: {d.totalEntrariam} {d.totalEntrariam === 1 ? 'pessoa entraria' : 'pessoas entrariam'}
                                {d.totalReceberiamAgora > 0 ? ` · ${d.totalReceberiamAgora} já dentro com mensagem vencida` : ''}
                                {d.aguardando > 0 ? ` · ${d.aguardando} esperando o próximo passo` : ''}
                              </p>
                              {d.entrariam.length === 0 && d.receberiamAgora.length === 0 ? (
                                <p className="text-xs text-gray-400">Ninguém se encaixa no gatilho neste momento.</p>
                              ) : (
                                <ul className="space-y-1 text-xs text-gray-700 max-h-64 overflow-auto pr-1">
                                  {d.receberiamAgora.map((r) => (
                                    <li key={'r' + r.leadId} className="flex items-center gap-2">
                                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">recebe agora</span>
                                      <span>{r.nome ?? 'Sem nome'}</span>
                                      <span className="text-gray-400">passo {r.passoOrdem + 1} · {r.enviados} já enviados</span>
                                    </li>
                                  ))}
                                  {d.entrariam.map((e) => (
                                    <li key={'e' + e.leadId} className="flex items-center gap-2">
                                      <span className={'text-[10px] font-medium px-1.5 py-0.5 rounded ' + (e.alcancavel ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-gray-100 text-gray-400')}>
                                        {e.alcancavel ? 'entra' : 'sem contato pro canal'}
                                      </span>
                                      <span>{e.nome ?? 'Sem nome'}</span>
                                      {e.etapa && <span className="text-gray-400">{e.etapa}{e.diasNaEtapa != null ? ` · ${e.diasNaEtapa} d` : ''}</span>}
                                    </li>
                                  ))}
                                  {d.totalEntrariam > d.entrariam.length && (
                                    <li className="text-gray-400">… e mais {d.totalEntrariam - d.entrariam.length}.</li>
                                  )}
                                </ul>
                              )}
                            </div>
                          </>
                        )
                      })()
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {fluxos.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-400">
              Nenhum fluxo ainda. Comece por um de pós-compra: é o que traz cliente de volta.
            </p>
          )}
        </div>
      </div>

      {editor && (
        <EditorFluxo
          rascunho={editor}
          templates={templates}
          onFechar={() => setEditor(null)}
          onSalvo={async () => {
            setEditor(null)
            await recarregar()
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Editor de fluxo
// ─────────────────────────────────────────────────────────────

function EditorFluxo({
  rascunho,
  templates,
  onFechar,
  onSalvo,
}: {
  rascunho: Rascunho
  templates: TemplateMarketing[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const [f, setF] = useState<Rascunho>(rascunho)
  const [previa, setPrevia] = useState<{ total: number; alcancaveis: number; amostra: string[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const usaveis = templates.filter((t) => t.status !== 'arquivado')
  const gatilho = GATILHOS.find((g) => g.id === f.gatilho)!
  const canalPrimeiro = usaveis.find((t) => t.id === f.passos[0]?.templateId)?.canal

  function muda(patch: Partial<Rascunho>) {
    setF((v) => ({ ...v, ...patch }))
    setPrevia(null)
  }
  function mudaPasso(i: number, patch: Partial<PassoForm>) {
    setF((v) => ({ ...v, passos: v.passos.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
    setPrevia(null)
  }

  async function verPrevia() {
    const r = await fetch('/api/admin/marketing/automacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acao: 'previa',
        gatilho: f.gatilho,
        gatilhoDias: f.gatilhoDias,
        publico: f.publico,
        canal: canalPrimeiro,
      }),
    })
    const j = await r.json()
    if (r.ok) setPrevia(j.previa)
  }

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const r = await fetch(
        f.id ? `/api/admin/marketing/automacoes/${f.id}` : '/api/admin/marketing/automacoes',
        {
          method: f.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(f.id ? {} : { acao: 'criar' }),
            nome: f.nome,
            descricao: f.descricao || null,
            gatilho: f.gatilho,
            gatilhoDias: f.gatilhoDias,
            publico: f.publico,
            maxToques: f.maxToques,
            horaInicio: f.horaInicio,
            horaFim: f.horaFim,
            passos: f.passos,
          }),
        }
      )
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Fechar" onClick={onFechar} className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-sm font-semibold text-gray-900">{f.id ? 'Editar fluxo' : 'Novo fluxo'}</p>
          <button type="button" onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">
              Nome do fluxo
              <input value={f.nome} onChange={(e) => muda({ nome: e.target.value })} className={CAMPO} placeholder="Recompra — 30 dias depois" />
            </label>
            <label className="text-xs text-gray-500">
              Pra que serve
              <input value={f.descricao} onChange={(e) => muda({ descricao: e.target.value })} className={CAMPO} placeholder="Traz de volta quem já produziu com a gente." />
            </label>
          </div>

          {/* Gatilho */}
          <div className="border border-gray-200 rounded-lg p-3.5">
            <p className="text-xs font-semibold text-gray-700 mb-2">1. Quem entra no fluxo</p>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={f.gatilho}
                onChange={(e) => muda({ gatilho: e.target.value as Gatilho })}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
              >
                {GATILHOS.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
              <label className="text-xs text-gray-500 flex items-center gap-1.5">
                há
                <input
                  value={f.gatilhoDias}
                  onChange={(e) => muda({ gatilhoDias: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-16 text-gray-900"
                />
                dias
              </label>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">{gatilho.ajuda}</p>

            <div className="flex items-center gap-2 flex-wrap mt-3">
              <span className="text-[11px] text-gray-400">filtrar ainda mais:</span>
              <select
                value={f.publico.origem ?? 'todas'}
                onChange={(e) => muda({ publico: { ...f.publico, origem: e.target.value as FiltroLeads['origem'] } })}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
              >
                <option value="todas">Todas as origens</option>
                <option value="chat">Veio do chat</option>
                <option value="conta">Criou conta</option>
                <option value="manual">Cadastro manual</option>
                <option value="importacao">Importado</option>
              </select>
              <input
                value={f.publico.uf ?? ''}
                onChange={(e) => muda({ publico: { ...f.publico, uf: e.target.value.toUpperCase().slice(0, 2) } })}
                placeholder="UF"
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-16 text-gray-900 placeholder:text-gray-400"
              />
              <input
                value={f.publico.tag ?? ''}
                onChange={(e) => muda({ publico: { ...f.publico, tag: e.target.value } })}
                placeholder="tag"
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-28 text-gray-900 placeholder:text-gray-400"
              />
              <button type="button" onClick={() => void verPrevia()} className="text-xs text-[#0F6E56] underline ml-auto">
                ver quantos entrariam agora
              </button>
            </div>

            {previa && (
              <p className="text-xs text-gray-700 bg-[#E1F5EE]/50 border border-[#1D9E75]/25 rounded-lg px-3 py-2 mt-2">
                <strong>{previa.total}</strong> {previa.total === 1 ? 'lead entraria' : 'leads entrariam'} agora
                {canalPrimeiro && (
                  <> · <strong>{previa.alcancaveis}</strong> com o canal do primeiro passo</>
                )}
                {previa.amostra.length > 0 && <> · ex.: {previa.amostra.join(', ')}</>}
              </p>
            )}
          </div>

          {/* Passos */}
          <div className="border border-gray-200 rounded-lg p-3.5">
            <p className="text-xs font-semibold text-gray-700 mb-2">2. O que ele recebe</p>
            <div className="space-y-2">
              {f.passos.map((p, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-gray-400 w-14 shrink-0">passo {i + 1}</span>
                  <label className="text-xs text-gray-500 flex items-center gap-1.5">
                    esperar
                    <input
                      value={p.esperaDias}
                      onChange={(e) => mudaPasso(i, { esperaDias: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-14 text-gray-900"
                    />
                    dias
                  </label>
                  <select
                    value={p.templateId ?? ''}
                    onChange={(e) => mudaPasso(i, { templateId: e.target.value || null })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white flex-1 min-w-[180px]"
                  >
                    <option value="">— escolha o template —</option>
                    {usaveis.map((t) => (
                      <option key={t.id} value={t.id}>
                        [{t.canal === 'email' ? 'e-mail' : t.canal === 'whatsapp' ? 'zap' : 'mala'}] {t.nome}
                      </option>
                    ))}
                  </select>
                  {f.passos.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setF((v) => ({ ...v, passos: v.passos.filter((_, j) => j !== i) }))}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      remover
                    </button>
                  )}
                </div>
              ))}
            </div>
            {f.passos.length < 8 && (
              <button
                type="button"
                onClick={() => setF((v) => ({ ...v, passos: [...v.passos, { esperaDias: 7, templateId: null }] }))}
                className="text-xs text-[#0F6E56] underline mt-2"
              >
                + adicionar passo
              </button>
            )}
            <p className="text-[11px] text-gray-400 mt-2">
              O passo 1 conta a partir da entrada no fluxo; os seguintes contam a partir do passo anterior. Passo de
              mala direta não sai sozinho — ele é pulado e a peça entra na sua lista de postagem.
            </p>
          </div>

          {/* Travas */}
          <div className="border border-gray-200 rounded-lg p-3.5">
            <p className="text-xs font-semibold text-gray-700 mb-2">3. Travas</p>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs text-gray-500 flex items-center gap-1.5">
                máx.
                <input
                  value={f.maxToques}
                  onChange={(e) => muda({ maxToques: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-14 text-gray-900"
                />
                mensagens por lead neste fluxo
              </label>
              <label className="text-xs text-gray-500 flex items-center gap-1.5">
                enviar entre
                <input
                  value={f.horaInicio}
                  onChange={(e) => muda({ horaInicio: Math.min(23, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-14 text-gray-900"
                />
                h e
                <input
                  value={f.horaFim}
                  onChange={(e) => muda({ horaFim: Math.min(24, Number(e.target.value.replace(/\D/g, '')) || 24) })}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-14 text-gray-900"
                />
                h
              </label>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Além disso, sempre: quem se descadastrou não recebe, ninguém entra duas vezes no mesmo fluxo, e o gatilho
              é reconferido na hora do envio — quem comprou sai do fluxo de retomada em vez de receber cobrança de um
              pedido já pago.
            </p>
          </div>

          {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={salvando || f.nome.trim().length < 3}
              className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar fluxo'}
            </button>
            <button type="button" onClick={onFechar} className="text-sm text-gray-500 hover:text-gray-700 px-2">
              Cancelar
            </button>
            <span className="text-[11px] text-gray-400 self-center ml-auto">
              Salvar não ativa — o fluxo só começa a mandar quando você clicar em Ativar.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
