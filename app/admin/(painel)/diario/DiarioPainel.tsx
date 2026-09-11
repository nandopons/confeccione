'use client'

// ============================================================================
// Diário de bordo — client. Quatro abas:
//   Placar    → os nove indicadores (ontem / 7 d / 30 d) + histórico das fotos
//   Decisões  → registro de decisão (filtro por status, nova, revisar/revogar)
//   Atas      → reuniões com pendências (nova ata)
//   Filas     → cobrança, sem resposta, sem fornecedor — o que vira alerta
//
// Tudo vem de GET /api/admin/diario numa chamada; ações vão por POST na mesma
// rota e recarregam. Sem estado local além do formulário aberto.
// ============================================================================

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConversaSemResposta,
  Decisao,
  ItemCobranca,
  PedidoSemFornecedor,
  Placar,
  PlacarGravado,
  Reuniao,
} from '@/app/lib/diario'

type Dados = {
  placar: Placar
  placares: PlacarGravado[]
  decisoes: Decisao[]
  reunioes: Reuniao[]
  filas: { cobranca: ItemCobranca[]; semResposta: ConversaSemResposta[]; semFornecedor: PedidoSemFornecedor[] }
}

type Aba = 'placar' | 'decisoes' | 'atas' | 'filas'

const TEMAS = ['gestao', 'marketing', 'whatsapp', 'produto', 'fornecedores', 'financeiro', 'engenharia']
const TIPOS: Array<{ v: Reuniao['tipo']; label: string }> = [
  { v: 'segunda', label: 'Segunda — placar e prioridades' },
  { v: 'sexta', label: 'Sexta — fechamento' },
  { v: 'mensal', label: 'Mensal — financeiro' },
  { v: 'sessao', label: 'Sessão de trabalho' },
  { v: 'manha', label: 'Manhã (07:00) — fila do dia' },
  { v: 'tarde', label: 'Tarde (17:30) — fechamento do dia' },
]

// ─── Formatação ─────────────────────────────────────────────────────────────

function brl(centavos: number | null | undefined): string {
  return ((centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function dataBR(iso: string | null | undefined, comHora = false): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00-03:00' : iso)
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Recife',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}
function n(v: unknown): string {
  return typeof v === 'number' ? v.toLocaleString('pt-BR') : v == null ? '—' : String(v)
}
/**
 * Nulo aqui significa NÃO MEDIDO, e tem que aparecer como "—".
 *
 * Sem isto, `aguardando_pgto_centavos` nulo na coluna de ontem sairia como
 * "R$ 0,00" pelo formatador de moeda — um valor que parece medido e é zero.
 * Zero e "não sei" não podem ter a mesma cara.
 */
function cel(fmt: (v: unknown) => string, v: unknown) {
  return v == null ? <span className="text-gray-300">—</span> : fmt(v)
}

function pega(obj: Record<string, unknown> | undefined, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj)
}
function minutos(v: unknown): string {
  if (typeof v !== 'number') return '—'
  if (v < 90) return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`
  return `${(v / 60).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
}

// ─── Componente ─────────────────────────────────────────────────────────────

export default function DiarioPainel() {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('placar')
  const [ocupado, setOcupado] = useState(false)
  // Incrementar recarrega tudo (depois de uma ação). O efeito só reage à rede:
  // setState acontece nos callbacks da promise, nunca no corpo do efeito.
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let ativo = true
    fetch('/api/admin/diario', { cache: 'no-store' })
      .then(async (r) => {
        if (!ativo) return
        if (!r.ok) {
          setErro(`Não deu pra carregar (${r.status})`)
          return
        }
        const d = (await r.json()) as Dados
        if (!ativo) return
        setDados(d)
        setErro(null)
      })
      .catch(() => {
        if (ativo) setErro('Sem conexão com o servidor')
      })
    return () => {
      ativo = false
    }
  }, [versao])

  const agir = useCallback(async (corpo: Record<string, unknown>) => {
    setOcupado(true)
    setErro(null)
    try {
      const r = await fetch('/api/admin/diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      })
      const j = (await r.json().catch(() => ({}))) as { erro?: string }
      if (!r.ok) throw new Error(j.erro ?? `Falhou (${r.status})`)
      setVersao((v) => v + 1)
      return true
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha inesperada')
      return false
    } finally {
      setOcupado(false)
    }
  }, [])

  const agora = dados?.placar.agora
  const filas = dados?.filas

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-gray-900 text-2xl font-medium mb-1">Diário de bordo</h1>
          <p className="text-gray-500 text-sm max-w-2xl leading-relaxed">
            Placar da semana, decisões e atas — no mesmo banco que os números. O que está aqui é o que o
            assistente lê pelo MCP antes de qualquer reunião.
          </p>
        </div>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void agir({ acao: 'gravar_placar' })}
          className="shrink-0 bg-[#1D9E75] hover:bg-[#178a65] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl"
        >
          {ocupado ? 'Gravando…' : 'Gravar foto da semana'}
        </button>
      </div>

      {erro && (
        <div className="mb-5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{erro}</div>
      )}

      {/* Filas abertas — sempre visíveis, são o alerta do dia */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Cartao
          rotulo="Aguardando pagamento"
          valor={n(agora?.aguardando_pgto_total)}
          detalhe={agora ? brl(agora.aguardando_pgto_total_centavos) : '—'}
          alerta={(agora?.aguardando_pgto_mais_3d ?? 0) > 0}
          onClick={() => setAba('filas')}
        />
        <Cartao
          rotulo="Confirmados sem fornecedor"
          valor={n(agora?.confirmados_sem_aceite_24h)}
          detalhe="há mais de 24 h"
          alerta={(agora?.confirmados_sem_aceite_24h ?? 0) > 0}
          onClick={() => setAba('filas')}
        />
        <Cartao
          rotulo="Sem resposta no WhatsApp"
          valor={n(agora?.wa_sem_resposta_2h)}
          detalhe={`há mais de 2 h · ${n(agora?.wa_nao_lidas)} não lidas`}
          alerta={(agora?.wa_sem_resposta_2h ?? 0) > 0}
          onClick={() => setAba('filas')}
        />
        <Cartao
          rotulo="Decisões pra revisar"
          valor={n(agora?.decisoes_para_revisar)}
          detalhe={`${n(agora?.ofertas_no_ar_mais_24h)} ofertas no ar > 24 h`}
          alerta={(agora?.decisoes_para_revisar ?? 0) > 0}
          onClick={() => setAba('decisoes')}
        />
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(
          [
            ['placar', 'Placar'],
            ['decisoes', `Decisões${dados ? ` (${dados.decisoes.length})` : ''}`],
            ['atas', `Atas${dados ? ` (${dados.reunioes.length})` : ''}`],
            ['filas', 'Filas'],
          ] as Array<[Aba, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setAba(k)}
            className={
              'px-3.5 py-2 text-sm -mb-px border-b-2 transition-colors ' +
              (aba === k
                ? 'border-[#1D9E75] text-[#0F6E56] font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {!dados ? (
        <p className="text-sm text-gray-400 py-10 text-center">Carregando…</p>
      ) : aba === 'placar' ? (
        <AbaPlacar placar={dados.placar} placares={dados.placares} />
      ) : aba === 'decisoes' ? (
        <AbaDecisoes decisoes={dados.decisoes} reunioes={dados.reunioes} agir={agir} ocupado={ocupado} />
      ) : aba === 'atas' ? (
        <AbaAtas reunioes={dados.reunioes} placares={dados.placares} agir={agir} ocupado={ocupado} />
      ) : (
        filas && <AbaFilas filas={filas} />
      )}
    </>
  )
}

function Cartao({
  rotulo,
  valor,
  detalhe,
  alerta,
  onClick,
}: {
  rotulo: string
  valor: string
  detalhe: string
  alerta: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'text-left bg-white border rounded-2xl px-4 py-3.5 hover:border-gray-300 transition-colors ' +
        (alerta ? 'border-amber-300' : 'border-gray-200')
      }
    >
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={'text-2xl font-medium mt-1 ' + (alerta ? 'text-amber-700' : 'text-gray-900')}>{valor}</p>
      <p className="text-xs text-gray-400 mt-0.5">{detalhe}</p>
    </button>
  )
}

// ─── Aba: Placar ────────────────────────────────────────────────────────────

type Linha = {
  rotulo: string
  caminho: string
  fmt?: (v: unknown) => string
  meta?: string
  /** Indicador que é FOTO DO MOMENTO, não acumulado da janela: o SQL o calcula
   *  sem olhar o período, então ele repete o mesmo valor em toda coluna. Marcado
   *  aqui pra não passar por fluxo — na coluna de dia fechado vira "—". */
  saldo?: true
}

const LINHAS: Array<{ grupo: string; linhas: Linha[] }> = [
  {
    grupo: '1 · Site',
    linhas: [
      { rotulo: 'Sessões', caminho: 'site.sessoes' },
      { rotulo: 'Sessões pagas (Ads)', caminho: 'site.sessoes_pagas' },
      { rotulo: 'Assistente iniciado', caminho: 'site.assistente_iniciado', meta: 'zero = rastreio quebrado' },
    ],
  },
  {
    grupo: '2 · Pedidos',
    linhas: [
      { rotulo: 'Criados', caminho: 'pedidos.criados' },
      { rotulo: 'Confirmados', caminho: 'pedidos.confirmados' },
      { rotulo: 'Pela metade', caminho: 'pedidos.pela_metade', meta: '3 · retomados = automação' },
    ],
  },
  {
    grupo: '4 · Fornecedor encontrado',
    linhas: [
      { rotulo: 'Ofertas aceitas', caminho: 'ofertas.aceitas' },
      { rotulo: 'Ofertas no ar', caminho: 'ofertas.no_ar' },
      { rotulo: 'Mediana de resposta do fornecedor', caminho: 'ofertas.mediana_min_resposta', fmt: minutos },
    ],
  },
  {
    grupo: '5 · Orçamento e cobrança',
    linhas: [
      { rotulo: 'Orçamentos definidos (pedidos)', caminho: 'pedidos.com_orcamento' },
      { rotulo: 'Aguardando pagamento', caminho: 'pedidos.aguardando_pgto_centavos', fmt: (v) => brl(v as number) },
      { rotulo: 'Avulsos com cobrança aberta', caminho: 'orcamentos_avulsos.cobranca_aberta_centavos', fmt: (v) => brl(v as number) },
    ],
  },
  {
    grupo: '6 · Pagos',
    linhas: [
      { rotulo: 'Pedidos pagos', caminho: 'pedidos.pagos' },
      { rotulo: 'GMV pago (pedidos)', caminho: 'pedidos.gmv_pago_centavos', fmt: (v) => brl(v as number) },
      { rotulo: 'Avulsos pagos', caminho: 'orcamentos_avulsos.pagos_centavos', fmt: (v) => brl(v as number) },
    ],
  },
  {
    grupo: '7 · Fornecedores',
    linhas: [
      { rotulo: 'Ativos aprovados', caminho: 'fornecedores.ativos', saldo: true },
      { rotulo: 'Novos', caminho: 'fornecedores.novos' },
      { rotulo: 'Responderam oferta', caminho: 'fornecedores.responderam' },
    ],
  },
  {
    grupo: '8 · Atendimento',
    linhas: [
      { rotulo: 'Entradas', caminho: 'atendimento.entradas' },
      { rotulo: 'Sem resposta', caminho: 'atendimento.sem_resposta' },
      { rotulo: 'Mediana / p90 de resposta', caminho: 'atendimento.mediana_min', fmt: minutos },
      { rotulo: 'p90', caminho: 'atendimento.p90_min', fmt: minutos },
    ],
  },
  {
    grupo: '9 · Nutrição',
    linhas: [
      { rotulo: 'Leads na base', caminho: 'nutricao.leads_total', saldo: true },
      { rotulo: 'Com 1º toque', caminho: 'nutricao.com_primeiro_toque', saldo: true },
      { rotulo: 'Disparos de campanha', caminho: 'nutricao.disparos_campanha' },
      { rotulo: 'Disparos de automação', caminho: 'nutricao.disparos_automacao' },
      { rotulo: 'Opt-out', caminho: 'nutricao.opt_out', saldo: true },
    ],
  },
  {
    grupo: 'Guardrails',
    linhas: [
      { rotulo: 'Mensagens com erro', caminho: 'atendimento.erros' },
      { rotulo: 'Custo de IA (US$)', caminho: 'guardrails.ia_usd' },
      { rotulo: 'Crons com falha', caminho: 'guardrails.cron_falhas' },
    ],
  },
]

function AbaPlacar({ placar, placares }: { placar: Placar; placares: PlacarGravado[] }) {
  const ontem = placar.ontem as Record<string, unknown> | undefined
  const d7 = placar.d7 as Record<string, unknown>
  const d30 = placar.d30 as Record<string, unknown>
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5">
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-baseline justify-between gap-3">
          <h2 className="text-gray-900 text-base font-medium">Agora</h2>
          <p className="text-xs text-gray-400">semana de {dataBR(placar.semana_inicio)} · calculado {dataBR(placar.referencia, true)}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="text-left px-5 py-2 font-medium">Indicador</th>
              <th className="text-right px-3 py-2 font-medium w-24">Ontem</th>
              <th className="text-right px-3 py-2 font-medium w-24">7 dias</th>
              <th className="text-right px-5 py-2 font-medium w-24">30 dias</th>
            </tr>
          </thead>
          <tbody>
            {LINHAS.map((g) => (
              <Grupo key={g.grupo} titulo={g.grupo}>
                {g.linhas.map((l) => {
                  const f = l.fmt ?? n
                  return (
                    <tr key={l.caminho} className="border-t border-gray-50">
                      <td className="px-5 py-2 text-gray-700">
                        {l.rotulo}
                        {l.meta && <span className="ml-2 text-[11px] text-gray-400">{l.meta}</span>}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums text-gray-900"
                        title={l.saldo ? 'Foto do momento, não acumulado: não existe valor "de ontem" pra este indicador.' : undefined}
                      >
                        {l.saldo ? <span className="text-gray-300">—</span> : cel(f, pega(ontem, l.caminho))}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900 tabular-nums">{cel(f, pega(d7, l.caminho))}</td>
                      <td className="px-5 py-2 text-right text-gray-900 tabular-nums">{cel(f, pega(d30, l.caminho))}</td>
                    </tr>
                  )
                })}
              </Grupo>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden self-start">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-gray-900 text-base font-medium">Fotos gravadas</h2>
          <p className="text-xs text-gray-500 mt-0.5">Uma por semana. É o que vira tendência.</p>
        </div>
        {placares.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">Nenhuma foto ainda — grave a semana zero.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {placares.map((p) => {
              const i = p.indicadores as Placar
              const d = i?.d30 as Record<string, unknown> | undefined
              return (
                <li key={p.id} className="px-5 py-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm text-gray-900">Semana de {dataBR(p.semana_inicio)}</p>
                    <span className="text-[11px] text-gray-400">{p.origem}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    30 d: {n(pega(d, 'pedidos.criados'))} pedidos · {n(pega(d, 'pedidos.pagos'))} pagos ·{' '}
                    {brl(pega(d, 'pedidos.aguardando_pgto_centavos') as number)} aguardando
                  </p>
                  {p.observacoes && <p className="text-xs text-gray-600 mt-1 italic">{p.observacoes}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-[#F7FAF8]">
        <td colSpan={3} className="px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#0F6E56]">
          {titulo}
        </td>
      </tr>
      {children}
    </>
  )
}

// ─── Aba: Decisões ──────────────────────────────────────────────────────────

type Agir = (corpo: Record<string, unknown>) => Promise<boolean>

function AbaDecisoes({
  decisoes,
  reunioes,
  agir,
  ocupado,
}: {
  decisoes: Decisao[]
  reunioes: Reuniao[]
  agir: Agir
  ocupado: boolean
}) {
  const [filtro, setFiltro] = useState<'vigente' | 'todas'>('vigente')
  const [aberto, setAberto] = useState(false)
  const [f, setF] = useState({ tema: 'gestao', titulo: '', decisao: '', contexto: '', alternativas: '', motivo: '', revisar_em: '', documento: '', reuniao_id: '' })

  const lista = useMemo(() => (filtro === 'todas' ? decisoes : decisoes.filter((d) => d.status === 'vigente')), [decisoes, filtro])

  async function salvar() {
    const ok = await agir({ acao: 'nova_decisao', ...f, reuniao_id: f.reuniao_id || undefined })
    if (ok) {
      setAberto(false)
      setF({ tema: 'gestao', titulo: '', decisao: '', contexto: '', alternativas: '', motivo: '', revisar_em: '', documento: '', reuniao_id: '' })
    }
  }

  async function mudarStatus(d: Decisao, status: 'revisada' | 'revogada') {
    const motivo = window.prompt(`Por que a D-${d.numero} passa a "${status}"?`, '')
    if (motivo === null) return
    await agir({ acao: 'atualizar_decisao', id: d.id, status, motivo: motivo || undefined })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1">
          {(['vigente', 'todas'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFiltro(k)}
              className={'px-3 py-1 text-xs rounded-lg ' + (filtro === k ? 'bg-[#E1F5EE] text-[#0F6E56] font-medium' : 'text-gray-500')}
            >
              {k === 'vigente' ? 'Vigentes' : 'Todas'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="text-sm text-[#0F6E56] font-medium hover:underline"
        >
          {aberto ? 'Fechar' : '+ Nova decisão'}
        </button>
      </div>

      {aberto && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 grid gap-3">
          <div className="grid sm:grid-cols-[160px_1fr] gap-3">
            <Campo rotulo="Tema">
              <select value={f.tema} onChange={(e) => setF({ ...f, tema: e.target.value })} className={INPUT}>
                {TEMAS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Título">
              <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={INPUT} placeholder="WhatsApp só pela API oficial" />
            </Campo>
          </div>
          <Campo rotulo="Decisão (o que passa a valer)">
            <textarea value={f.decisao} onChange={(e) => setF({ ...f, decisao: e.target.value })} className={INPUT + ' min-h-[70px]'} />
          </Campo>
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo rotulo="Contexto">
              <textarea value={f.contexto} onChange={(e) => setF({ ...f, contexto: e.target.value })} className={INPUT + ' min-h-[70px]'} />
            </Campo>
            <Campo rotulo="Alternativas descartadas">
              <textarea value={f.alternativas} onChange={(e) => setF({ ...f, alternativas: e.target.value })} className={INPUT + ' min-h-[70px]'} />
            </Campo>
          </div>
          <Campo rotulo="Motivo">
            <textarea value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} className={INPUT + ' min-h-[56px]'} />
          </Campo>
          <div className="grid sm:grid-cols-3 gap-3">
            <Campo rotulo="Revisar em">
              <input type="date" value={f.revisar_em} onChange={(e) => setF({ ...f, revisar_em: e.target.value })} className={INPUT} />
            </Campo>
            <Campo rotulo="Documento (opcional)">
              <input value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} className={INPUT} placeholder="claude/…md" />
            </Campo>
            <Campo rotulo="Ata (opcional)">
              <select value={f.reuniao_id} onChange={(e) => setF({ ...f, reuniao_id: e.target.value })} className={INPUT}>
                <option value="">—</option>
                {reunioes.slice(0, 15).map((r) => (
                  <option key={r.id} value={r.id}>{dataBR(r.realizada_em)} · {r.titulo}</option>
                ))}
              </select>
            </Campo>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={ocupado || f.titulo.trim().length < 3 || f.decisao.trim().length < 3}
              onClick={() => void salvar()}
              className="bg-[#1D9E75] hover:bg-[#178a65] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl"
            >
              Registrar decisão
            </button>
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Nenhuma decisão registrada.</p>
      ) : (
        <ul className="space-y-3">
          {lista.map((d) => (
            <li key={d.id} className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-gray-500">D-{d.numero}</span>
                <span className="bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full">{d.tema}</span>
                <span
                  className={
                    'px-2 py-0.5 rounded-full ' +
                    (d.status === 'vigente' ? 'bg-gray-100 text-gray-600' : d.status === 'revisada' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')
                  }
                >
                  {d.status}
                </span>
                <span className="text-gray-400">decidida em {dataBR(d.decidido_em)}</span>
                {d.revisar_em && <span className="text-gray-400">· revisar em {dataBR(d.revisar_em)}</span>}
                <span className="text-gray-300">· {d.origem}</span>
              </div>
              <p className="text-gray-900 font-medium mt-2">{d.titulo}</p>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{d.decisao}</p>
              {(d.contexto || d.alternativas || d.motivo) && (
                <details className="mt-2">
                  <summary className="text-xs text-[#0F6E56] cursor-pointer">Contexto, alternativas e motivo</summary>
                  <div className="mt-2 space-y-2 text-sm text-gray-600">
                    {d.contexto && <p><span className="text-gray-400">Contexto:</span> {d.contexto}</p>}
                    {d.alternativas && <p><span className="text-gray-400">Alternativas:</span> {d.alternativas}</p>}
                    {d.motivo && <p><span className="text-gray-400">Motivo:</span> {d.motivo}</p>}
                    {d.numeros && <p className="font-mono text-xs text-gray-500">{JSON.stringify(d.numeros)}</p>}
                    {d.documento && <p className="text-xs text-gray-400">Documento: {d.documento}</p>}
                  </div>
                </details>
              )}
              {d.status === 'vigente' && (
                <div className="mt-3 flex gap-3 text-xs">
                  <button type="button" disabled={ocupado} onClick={() => void mudarStatus(d, 'revisada')} className="text-amber-700 hover:underline">
                    Marcar revisada
                  </button>
                  <button type="button" disabled={ocupado} onClick={() => void mudarStatus(d, 'revogada')} className="text-red-700 hover:underline">
                    Revogar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Aba: Atas ──────────────────────────────────────────────────────────────

function AbaAtas({
  reunioes,
  placares,
  agir,
  ocupado,
}: {
  reunioes: Reuniao[]
  placares: PlacarGravado[]
  agir: Agir
  ocupado: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [f, setF] = useState({ tipo: 'segunda' as Reuniao['tipo'], titulo: '', pauta: '', resumo: '', pendencias: '', placar_id: '' })

  async function salvar() {
    // Uma pendência por linha: "descrição | dono | AAAA-MM-DD"
    const pendencias = f.pendencias
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [descricao, dono, prazo] = l.split('|').map((s) => s.trim())
        return { descricao, dono: dono || undefined, prazo: prazo || undefined }
      })
    const ok = await agir({ acao: 'nova_reuniao', ...f, pendencias, placar_id: f.placar_id || undefined })
    if (ok) {
      setAberto(false)
      setF({ tipo: 'segunda', titulo: '', pauta: '', resumo: '', pendencias: '', placar_id: '' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setAberto((v) => !v)} className="text-sm text-[#0F6E56] font-medium hover:underline">
          {aberto ? 'Fechar' : '+ Nova ata'}
        </button>
      </div>

      {aberto && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 grid gap-3">
          <div className="grid sm:grid-cols-[240px_1fr] gap-3">
            <Campo rotulo="Tipo">
              <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Reuniao['tipo'] })} className={INPUT}>
                {TIPOS.map((t) => (
                  <option key={t.v} value={t.v}>{t.label}</option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Título">
              <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={INPUT} placeholder="Segunda 14/09 — placar e prioridades" />
            </Campo>
          </div>
          <Campo rotulo="Pauta (opcional)">
            <input value={f.pauta} onChange={(e) => setF({ ...f, pauta: e.target.value })} className={INPUT} />
          </Campo>
          <Campo rotulo="Ata (markdown): o que foi olhado, decidido e o que ficou pendente">
            <textarea value={f.resumo} onChange={(e) => setF({ ...f, resumo: e.target.value })} className={INPUT + ' min-h-[160px] font-mono text-[13px]'} />
          </Campo>
          <div className="grid sm:grid-cols-[1fr_260px] gap-3">
            <Campo rotulo="Pendências — uma por linha: descrição | dono | AAAA-MM-DD">
              <textarea value={f.pendencias} onChange={(e) => setF({ ...f, pendencias: e.target.value })} className={INPUT + ' min-h-[90px] font-mono text-[13px]'} />
            </Campo>
            <Campo rotulo="Foto do placar usada">
              <select value={f.placar_id} onChange={(e) => setF({ ...f, placar_id: e.target.value })} className={INPUT}>
                <option value="">—</option>
                {placares.map((p) => (
                  <option key={p.id} value={p.id}>Semana de {dataBR(p.semana_inicio)}</option>
                ))}
              </select>
            </Campo>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={ocupado || f.titulo.trim().length < 3 || f.resumo.trim().length < 10}
              onClick={() => void salvar()}
              className="bg-[#1D9E75] hover:bg-[#178a65] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-xl"
            >
              Registrar ata
            </button>
          </div>
        </div>
      )}

      {reunioes.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Nenhuma ata ainda.</p>
      ) : (
        <ul className="space-y-3">
          {reunioes.map((r) => (
            <li key={r.id} className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="bg-[#E1F5EE] text-[#0F6E56] px-2 py-0.5 rounded-full">{r.tipo}</span>
                <span className="text-gray-400">{dataBR(r.realizada_em, true)}</span>
                <span className="text-gray-300">· {r.origem}</span>
              </div>
              <p className="text-gray-900 font-medium mt-2">{r.titulo}</p>
              {r.pauta && <p className="text-xs text-gray-500 mt-0.5">Pauta: {r.pauta}</p>}
              <details className="mt-2" open={reunioes[0]?.id === r.id}>
                <summary className="text-xs text-[#0F6E56] cursor-pointer">Ata</summary>
                <pre className="mt-2 text-[13px] text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{r.resumo}</pre>
              </details>
              {r.pendencias?.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {r.pendencias.map((p, i) => (
                    <li key={i} className={'text-sm flex gap-2 ' + (p.feita ? 'text-gray-400 line-through' : 'text-gray-700')}>
                      <span>{p.feita ? '☑' : '☐'}</span>
                      <span>
                        {p.descricao}
                        {(p.dono || p.prazo) && (
                          <span className="text-gray-400"> — {[p.dono, p.prazo ? dataBR(p.prazo) : null].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Aba: Filas ─────────────────────────────────────────────────────────────

function AbaFilas({ filas }: { filas: Dados['filas'] }) {
  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <Lista titulo="Cobrança" subtitulo={`${filas.cobranca.length} em aberto · ${brl(filas.cobranca.reduce((a, i) => a + i.valor_centavos, 0))}`}>
        {filas.cobranca.map((i) => (
          <li key={i.fonte + i.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-gray-900 truncate">{i.cliente ?? 'sem nome'}</p>
              <p className="text-sm text-gray-900 tabular-nums shrink-0">{brl(i.valor_centavos)}</p>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {i.fonte === 'pedido' ? 'pedido' : 'orçamento avulso'} {i.referencia} · {i.dias_em_aberto ?? '—'} d em aberto
            </p>
            <div className="mt-1.5 flex gap-3 text-xs">
              {i.telefone && (
                <Link href={`/admin/whatsapp?abrir=${encodeURIComponent(i.telefone)}&nome=${encodeURIComponent(i.cliente ?? '')}`} className="text-[#0F6E56] hover:underline">
                  Conversar
                </Link>
              )}
              {i.fonte === 'pedido' ? (
                <Link href={`/admin/pedidos-pagos?pedido=${i.id}`} className="text-gray-500 hover:underline">Ver pedido</Link>
              ) : (
                <Link href="/admin/orcamentos" className="text-gray-500 hover:underline">Ver orçamentos</Link>
              )}
              {i.link_pagamento && (
                <a href={i.link_pagamento} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:underline">Link de pagamento ↗</a>
              )}
            </div>
          </li>
        ))}
      </Lista>

      <Lista titulo="Sem resposta no WhatsApp" subtitulo={`${filas.semResposta.length} há mais de 2 h`}>
        {filas.semResposta.map((c) => (
          <li key={c.conversa_id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-gray-900 truncate">
                {c.contato ?? c.wa_id ?? 'contato'}
                {c.vinculo && <span className="ml-1.5 text-[11px] text-gray-400">{c.vinculo}</span>}
              </p>
              <p className="text-xs text-amber-700 shrink-0">{c.horas_esperando} h</p>
            </div>
            {c.preview && <p className="text-xs text-gray-500 mt-0.5 truncate">“{c.preview}”</p>}
            {c.wa_id && (
              <Link href={`/admin/whatsapp?abrir=${encodeURIComponent(c.wa_id)}&nome=${encodeURIComponent(c.contato ?? '')}`} className="text-xs text-[#0F6E56] hover:underline mt-1 inline-block">
                Responder
              </Link>
            )}
          </li>
        ))}
      </Lista>

      <Lista titulo="Sem fornecedor" subtitulo={`${filas.semFornecedor.length} confirmados há mais de 24 h`}>
        {filas.semFornecedor.map((p) => (
          <li key={p.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-gray-900 truncate">{p.cliente ?? 'sem nome'} {p.uf && <span className="text-gray-400">· {p.uf}</span>}</p>
              <p className="text-xs text-amber-700 shrink-0">{Math.round(p.horas_esperando / 24)} d</p>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{p.resumo}{p.categoria ? ` · ${p.categoria}` : ''}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {p.ofertas_no_ar} no ar · {p.ofertas_recusadas} recusadas
            </p>
            <Link href={`/admin/pedidos-pagos?pedido=${p.id}`} className="text-xs text-[#0F6E56] hover:underline mt-1 inline-block">
              Ver pedido
            </Link>
          </li>
        ))}
      </Lista>
    </div>
  )
}

function Lista({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden self-start">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-gray-900 text-base font-medium">{titulo}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>
      </div>
      {children.length === 0 ? (
        <p className="px-5 py-8 text-sm text-gray-400 text-center">Fila vazia.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[560px] overflow-y-auto">{children}</ul>
      )}
    </div>
  )
}

// ─── Miúdos ─────────────────────────────────────────────────────────────────

const INPUT =
  'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/30 focus:border-[#1D9E75] placeholder:text-gray-400'

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{rotulo}</span>
      {children}
    </label>
  )
}
