'use client'

// app/admin/(painel)/produtos/ProdutosAdmin.tsx
// ============================================================================
// Cadastro técnico do PCP: parque de máquinas + ficha técnica dos produtos.
//
// DUAS ABAS PORQUE SÃO DUAS FREQUÊNCIAS
// Máquina você cadastra uma vez por ano. Roteiro você mexe toda vez que muda o
// jeito de montar a peça. Misturar as duas na mesma tela faria a parte que
// muda pouco atrapalhar a que muda sempre.
//
// O TEMPO VAZIO APARECE
// Operação sem tempo cronometrado é a diferença entre um PCP que funciona e um
// que mente. Por isso o campo vazio não fica discreto: o produto ganha um selo
// "faltam N tempos" e não entra em cálculo de capacidade nenhum enquanto isso.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

type Maquina = {
  id: string
  codigo: string
  nome: string
  quantidade: number
  horasDia: number
  setupTrocaMin: number
  observacao: string | null
  ordem: number
  ativo: boolean
  capacidadeHorasDia: number
}

type Operacao = {
  id: string
  ordem: number
  descricao: string
  maquinaId: string | null
  maquinaNome: string | null
  tempoSegundos: number | null
  observacao: string | null
}

type Medida = { tamanho: string; comprimentoCm: number | null }

type Componente = {
  id: string
  nome: string
  larguraCm: number | null
  observacao: string | null
  ordem: number
  medidas: Medida[]
}

type Produto = {
  id: string
  codigo: string
  nome: string
  descricao: string | null
  ativo: boolean
  operacoes: Operacao[]
  componentes: Componente[]
  tempoTotalSegundos: number | null
  operacoesSemTempo: number
  prontoParaCalculo: boolean
}

const VERDE = '#1D9E75'
const VERDE_ESCURO = '#0F6E56'

/** Segundos → "1min 20s". Minuto e segundo são a régua do chão de fábrica. */
function tempoLegivel(seg: number | null): string {
  if (seg == null) return '—'
  if (seg < 60) return `${seg}s`
  const m = Math.floor(seg / 60)
  const s = seg % 60
  return s ? `${m}min ${s}s` : `${m}min`
}

function nInput(v: string): number | null {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export default function ProdutosAdmin() {
  const [aba, setAba] = useState<'produtos' | 'maquinas'>('produtos')
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const r = await fetch('/api/admin/pcp', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.erro || 'Falha ao carregar')
      setMaquinas(d.maquinas ?? [])
      setProdutos(d.produtos ?? [])
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const enviar = useCallback(async (corpo: Record<string, unknown>) => {
    const r = await fetch('/api/admin/pcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.erro || 'Não foi possível salvar')
    if (d?.maquinas) setMaquinas(d.maquinas)
    if (d?.produtos) setProdutos(d.produtos)
  }, [])

  if (carregando && !produtos.length && !maquinas.length) {
    return <p className="text-sm text-gray-500">Carregando o cadastro…</p>
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900">Produtos e ficha técnica</h1>
      <p className="text-sm text-gray-600 mt-1 max-w-3xl">
        O roteiro de operações de cada modelo e o parque de máquinas. É daqui que sai o cálculo de
        quanta hora de costura um lote pede e qual máquina vira gargalo.
      </p>

      <div className="flex gap-1 mt-5 border-b border-gray-200">
        {(['produtos', 'maquinas'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className="px-4 py-2 text-sm font-medium border-b-2 -mb-px"
            style={
              aba === a
                ? { borderColor: VERDE, color: VERDE_ESCURO }
                : { borderColor: 'transparent', color: '#6b7280' }
            }
          >
            {a === 'produtos' ? 'Produtos' : 'Máquinas'}
          </button>
        ))}
      </div>

      {erro && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div className="mt-5">
        {aba === 'maquinas' ? (
          <AbaMaquinas maquinas={maquinas} onEnviar={enviar} onErro={setErro} />
        ) : (
          <AbaProdutos produtos={produtos} maquinas={maquinas} onEnviar={enviar} onErro={setErro} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Máquinas
// ---------------------------------------------------------------------------
type Enviar = (corpo: Record<string, unknown>) => Promise<void>

function AbaMaquinas({
  maquinas,
  onEnviar,
  onErro,
}: {
  maquinas: Maquina[]
  onEnviar: Enviar
  onErro: (e: string | null) => void
}) {
  const [editando, setEditando] = useState<Maquina | null>(null)
  const [novo, setNovo] = useState(false)

  const capacidadeTotal = maquinas.reduce((s, m) => s + m.capacidadeHorasDia, 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-600">
          <strong className="text-gray-900">{maquinas.length}</strong> tipos ·{' '}
          <strong className="text-gray-900">{capacidadeTotal.toLocaleString('pt-BR')}h</strong> de
          máquina por dia no total
        </p>
        <button
          onClick={() => {
            setNovo(true)
            setEditando(null)
          }}
          className="text-sm px-4 py-2 rounded-lg text-white"
          style={{ backgroundColor: VERDE }}
        >
          Nova máquina
        </button>
      </div>

      {(novo || editando) && (
        <FormMaquina
          maquina={editando}
          onCancelar={() => {
            setNovo(false)
            setEditando(null)
          }}
          onSalvar={async (dados) => {
            try {
              await onEnviar({ acao: 'salvar_maquina', ...dados })
              setNovo(false)
              setEditando(null)
              onErro(null)
            } catch (e) {
              onErro(e instanceof Error ? e.message : 'Não foi possível salvar')
            }
          }}
        />
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Máquina</th>
                <th className="px-4 py-2.5 font-semibold text-right">Qtd</th>
                <th className="px-4 py-2.5 font-semibold text-right">Horas/dia</th>
                <th className="px-4 py-2.5 font-semibold text-right">Capacidade</th>
                <th className="px-4 py-2.5 font-semibold text-right">Troca de linha</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {maquinas.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5">
                    <span className="text-gray-900">{m.nome}</span>
                    <span className="text-[11px] font-mono text-gray-400 ml-2">{m.codigo}</span>
                    {m.observacao && (
                      <p className="text-xs text-gray-500 mt-0.5">{m.observacao}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.quantidade}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{m.horasDia}h</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-900">
                    {m.capacidadeHorasDia}h/dia
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {m.setupTrocaMin > 0 ? (
                      `${m.setupTrocaMin} min`
                    ) : (
                      <span className="text-amber-700">a medir</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => {
                        setEditando(m)
                        setNovo(false)
                      }}
                      className="text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-3 leading-relaxed max-w-3xl">
        <strong>Troca de linha</strong> é o tempo pra trocar a cor nessa máquina — overloque de 4
        cones demora mais que uma reta. É esse número que mostra por que 10 pretas + 10 brancas não
        custa o mesmo que 20 pretas. Enquanto estiver zerado, o cálculo vai ignorar o setup.
      </p>
    </div>
  )
}

function FormMaquina({
  maquina,
  onSalvar,
  onCancelar,
}: {
  maquina: Maquina | null
  onSalvar: (dados: Record<string, unknown>) => Promise<void>
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(maquina?.nome ?? '')
  const [codigo, setCodigo] = useState(maquina?.codigo ?? '')
  const [quantidade, setQuantidade] = useState(String(maquina?.quantidade ?? 1))
  const [horasDia, setHorasDia] = useState(String(maquina?.horasDia ?? 8))
  const [setup, setSetup] = useState(String(maquina?.setupTrocaMin ?? 0))
  const [obs, setObs] = useState(maquina?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        {maquina ? `Editar ${maquina.nome}` : 'Nova máquina'}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-xs text-gray-600">
          Nome
          <input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value)
              if (!maquina && !codigo) setCodigo(e.target.value)
            }}
            placeholder="Overloque"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
        <label className="text-xs text-gray-600">
          Código
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="overloque"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono"
          />
        </label>
        <label className="text-xs text-gray-600">
          Quantas você tem
          <input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
        <label className="text-xs text-gray-600">
          Horas por dia (cada uma)
          <input
            value={horasDia}
            onChange={(e) => setHorasDia(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
        <label className="text-xs text-gray-600">
          Troca de linha (minutos)
          <input
            value={setup}
            onChange={(e) => setSetup(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
        <label className="text-xs text-gray-600">
          Observação
          <input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
          />
        </label>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          disabled={salvando}
          onClick={async () => {
            setSalvando(true)
            await onSalvar({
              id: maquina?.id ?? null,
              nome,
              codigo: codigo || nome,
              quantidade: Math.max(0, Math.round(nInput(quantidade) ?? 0)),
              horasDia: nInput(horasDia) ?? 0,
              setupTrocaMin: nInput(setup) ?? 0,
              observacao: obs || null,
            })
            setSalvando(false)
          }}
          className="text-sm px-4 py-2 rounded-lg text-white disabled:opacity-50"
          style={{ backgroundColor: VERDE }}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          onClick={onCancelar}
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------
function AbaProdutos({
  produtos,
  maquinas,
  onEnviar,
  onErro,
}: {
  produtos: Produto[]
  maquinas: Maquina[]
  onEnviar: Enviar
  onErro: (e: string | null) => void
}) {
  const [abertoId, setAbertoId] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const [nomeNovo, setNomeNovo] = useState('')

  const faltando = useMemo(
    () => produtos.filter((p) => !p.prontoParaCalculo).length,
    [produtos],
  )

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-600">
          <strong className="text-gray-900">{produtos.length}</strong>{' '}
          {produtos.length === 1 ? 'produto' : 'produtos'}
          {faltando > 0 && (
            <>
              {' · '}
              <span className="text-amber-800">{faltando} sem tempo completo</span>
            </>
          )}
        </p>
        <button
          onClick={() => setNovo((v) => !v)}
          className="text-sm px-4 py-2 rounded-lg text-white"
          style={{ backgroundColor: VERDE }}
        >
          Novo produto
        </button>
      </div>

      {novo && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 mb-3">
          <label className="text-xs text-gray-600">
            Nome do produto
            <input
              value={nomeNovo}
              onChange={(e) => setNomeNovo(e.target.value)}
              placeholder="Camisa gola polo"
              autoFocus
              className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
          </label>
          <div className="flex gap-2 mt-3">
            <button
              onClick={async () => {
                try {
                  await onEnviar({ acao: 'salvar_produto', codigo: nomeNovo, nome: nomeNovo })
                  setNomeNovo('')
                  setNovo(false)
                  onErro(null)
                } catch (e) {
                  onErro(e instanceof Error ? e.message : 'Não foi possível criar')
                }
              }}
              className="text-sm px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: VERDE }}
            >
              Criar
            </button>
            <button
              onClick={() => setNovo(false)}
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {produtos.map((p) => (
          <CardProduto
            key={p.id}
            produto={p}
            maquinas={maquinas}
            aberto={abertoId === p.id}
            onAbrir={() => setAbertoId((id) => (id === p.id ? null : p.id))}
            onEnviar={onEnviar}
            onErro={onErro}
          />
        ))}
      </div>
    </div>
  )
}

function CardProduto({
  produto,
  maquinas,
  aberto,
  onAbrir,
  onEnviar,
  onErro,
}: {
  produto: Produto
  maquinas: Maquina[]
  aberto: boolean
  onAbrir: () => void
  onEnviar: Enviar
  onErro: (e: string | null) => void
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={onAbrir}
        className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{produto.nome}</h3>
          <p className="text-xs text-gray-500">
            {produto.operacoes.length} operações · {produto.componentes.length} peças de corte
          </p>
        </div>
        <div className="flex items-center gap-2">
          {produto.prontoParaCalculo ? (
            <span
              className="text-[11px] px-2 py-1 rounded-full"
              style={{ backgroundColor: '#E1F5EE', color: VERDE_ESCURO }}
            >
              {tempoLegivel(produto.tempoTotalSegundos)} por peça
            </span>
          ) : (
            <span className="text-[11px] px-2 py-1 rounded-full bg-amber-100 text-amber-800">
              faltam {produto.operacoesSemTempo}{' '}
              {produto.operacoesSemTempo === 1 ? 'tempo' : 'tempos'}
            </span>
          )}
          <span className="text-gray-400 text-sm">{aberto ? '▲' : '▼'}</span>
        </div>
      </button>

      {aberto && (
        <div className="border-t border-gray-100 p-4">
          <EditorRoteiro
            produto={produto}
            maquinas={maquinas}
            onEnviar={onEnviar}
            onErro={onErro}
          />
          <EditorComponentes produto={produto} onEnviar={onEnviar} onErro={onErro} />
        </div>
      )}
    </section>
  )
}

type LinhaOp = {
  descricao: string
  maquinaId: string | null
  tempo: string
  observacao: string
}

function EditorRoteiro({
  produto,
  maquinas,
  onEnviar,
  onErro,
}: {
  produto: Produto
  maquinas: Maquina[]
  onEnviar: Enviar
  onErro: (e: string | null) => void
}) {
  const [linhas, setLinhas] = useState<LinhaOp[]>(() =>
    produto.operacoes.map((o) => ({
      descricao: o.descricao,
      maquinaId: o.maquinaId,
      tempo: o.tempoSegundos == null ? '' : String(o.tempoSegundos),
      observacao: o.observacao ?? '',
    })),
  )
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const mudar = (i: number, campo: keyof LinhaOp, valor: string | null) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))

  // Move uma operação de posição. A ordem é o roteiro — uma barra entrando
  // antes do fechamento lateral muda a fila da galoneira.
  const mover = (i: number, delta: number) =>
    setLinhas((ls) => {
      const j = i + delta
      if (j < 0 || j >= ls.length) return ls
      const copia = [...ls]
      ;[copia[i], copia[j]] = [copia[j], copia[i]]
      return copia
    })

  const totalConhecido = linhas.reduce((s, l) => s + (parseInt(l.tempo, 10) || 0), 0)
  const semTempo = linhas.filter((l) => l.descricao.trim() && !parseInt(l.tempo, 10)).length

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Roteiro de operações
      </h4>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="pb-1 w-8">#</th>
              <th className="pb-1">Operação</th>
              <th className="pb-1 w-40">Máquina</th>
              <th className="pb-1 w-28">Tempo (seg)</th>
              <th className="pb-1">Observação</th>
              <th className="pb-1 w-20" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>
                <td className="py-1 text-xs text-gray-400 tabular-nums">{i + 1}</td>
                <td className="py-1 pr-2">
                  <input
                    value={l.descricao}
                    onChange={(e) => mudar(i, 'descricao', e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    value={l.maquinaId ?? ''}
                    onChange={(e) => mudar(i, 'maquinaId', e.target.value || null)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                  >
                    <option value="">— sem máquina —</option>
                    {maquinas.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={l.tempo}
                    onChange={(e) => mudar(i, 'tempo', e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric"
                    placeholder="a medir"
                    className="w-full text-sm border rounded-lg px-2 py-1.5"
                    style={{ borderColor: l.tempo ? '#d1d5db' : '#fcd34d' }}
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={l.observacao}
                    onChange={(e) => mudar(i, 'observacao', e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                  />
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  <button
                    onClick={() => mover(i, -1)}
                    disabled={i === 0}
                    className="text-xs px-1.5 text-gray-500 hover:text-gray-900 disabled:opacity-25"
                    aria-label="Subir"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => mover(i, 1)}
                    disabled={i === linhas.length - 1}
                    className="text-xs px-1.5 text-gray-500 hover:text-gray-900 disabled:opacity-25"
                    aria-label="Descer"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))}
                    className="text-xs px-1.5 text-gray-400 hover:text-red-700"
                    aria-label="Remover"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() =>
            setLinhas((ls) => [...ls, { descricao: '', maquinaId: null, tempo: '', observacao: '' }])
          }
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          + Operação
        </button>
        <button
          disabled={salvando}
          onClick={async () => {
            setSalvando(true)
            try {
              await onEnviar({
                acao: 'salvar_roteiro',
                produtoId: produto.id,
                operacoes: linhas.map((l) => ({
                  descricao: l.descricao,
                  maquinaId: l.maquinaId,
                  tempoSegundos: parseInt(l.tempo, 10) || null,
                  observacao: l.observacao || null,
                })),
              })
              setAviso('Roteiro salvo.')
              onErro(null)
            } catch (e) {
              onErro(e instanceof Error ? e.message : 'Não foi possível salvar')
            } finally {
              setSalvando(false)
            }
          }}
          className="text-sm px-4 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ backgroundColor: VERDE }}
        >
          {salvando ? 'Salvando…' : 'Salvar roteiro'}
        </button>
        <span className="text-xs text-gray-500">
          {semTempo > 0
            ? `${tempoLegivel(totalConhecido)} nas operações já medidas · faltam ${semTempo}`
            : `${tempoLegivel(totalConhecido)} por peça`}
        </span>
        {aviso && <span className="text-xs text-gray-600">{aviso}</span>}
      </div>
    </div>
  )
}

type LinhaComp = {
  nome: string
  largura: string
  observacao: string
  medidas: { tamanho: string; comprimento: string }[]
}

function EditorComponentes({
  produto,
  onEnviar,
  onErro,
}: {
  produto: Produto
  onEnviar: Enviar
  onErro: (e: string | null) => void
}) {
  const [comps, setComps] = useState<LinhaComp[]>(() =>
    produto.componentes.map((c) => ({
      nome: c.nome,
      largura: c.larguraCm == null ? '' : String(c.larguraCm),
      observacao: c.observacao ?? '',
      medidas: c.medidas.map((m) => ({
        tamanho: m.tamanho,
        comprimento: m.comprimentoCm == null ? '' : String(m.comprimentoCm),
      })),
    })),
  )
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const mudarComp = (i: number, campo: 'nome' | 'largura' | 'observacao', v: string) =>
    setComps((cs) => cs.map((c, j) => (j === i ? { ...c, [campo]: v } : c)))

  const mudarMedida = (i: number, k: number, campo: 'tamanho' | 'comprimento', v: string) =>
    setComps((cs) =>
      cs.map((c, j) =>
        j === i
          ? { ...c, medidas: c.medidas.map((m, l) => (l === k ? { ...m, [campo]: v } : m)) }
          : c,
      ),
    )

  return (
    <div className="mt-6 pt-5 border-t border-gray-100">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        Ficha de corte
      </h4>
      <p className="text-xs text-gray-500 mb-3 max-w-2xl leading-relaxed">
        A largura é do modelo — a ribana da básica sai sempre com a mesma. O comprimento muda por
        tamanho. Essas medidas mudam o consumo de tecido e a instrução de corte, não o tempo de
        costura, por isso vivem aqui e não no roteiro.
      </p>

      <div className="flex flex-col gap-3">
        {comps.map((c, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="text-xs text-gray-600">
                Componente
                <input
                  value={c.nome}
                  onChange={(e) => mudarComp(i, 'nome', e.target.value)}
                  placeholder="Ribana da gola"
                  className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-600">
                Largura (cm)
                <input
                  value={c.largura}
                  onChange={(e) => mudarComp(i, 'largura', e.target.value)}
                  inputMode="decimal"
                  placeholder="5,3"
                  className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-600">
                Observação
                <input
                  value={c.observacao}
                  onChange={(e) => mudarComp(i, 'observacao', e.target.value)}
                  className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-2 mt-2">
              {c.medidas.map((m, k) => (
                <div key={k} className="flex items-end gap-1">
                  <label className="text-[11px] text-gray-500">
                    Tam.
                    <input
                      value={m.tamanho}
                      onChange={(e) => mudarMedida(i, k, 'tamanho', e.target.value.toUpperCase())}
                      className="mt-0.5 w-14 text-sm border border-gray-300 rounded-lg px-2 py-1 text-center"
                    />
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Compr. (cm)
                    <input
                      value={m.comprimento}
                      onChange={(e) => mudarMedida(i, k, 'comprimento', e.target.value)}
                      inputMode="decimal"
                      className="mt-0.5 w-20 text-sm border border-gray-300 rounded-lg px-2 py-1"
                    />
                  </label>
                  <button
                    onClick={() =>
                      setComps((cs) =>
                        cs.map((cc, j) =>
                          j === i ? { ...cc, medidas: cc.medidas.filter((_, l) => l !== k) } : cc,
                        ),
                      )
                    }
                    className="text-xs text-gray-400 hover:text-red-700 pb-1.5"
                    aria-label="Remover tamanho"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setComps((cs) =>
                    cs.map((cc, j) =>
                      j === i
                        ? { ...cc, medidas: [...cc.medidas, { tamanho: '', comprimento: '' }] }
                        : cc,
                    ),
                  )
                }
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                + Tamanho
              </button>
              <button
                onClick={() => setComps((cs) => cs.filter((_, j) => j !== i))}
                className="text-xs px-2 py-1.5 text-gray-400 hover:text-red-700 ml-auto"
              >
                Remover componente
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={() =>
            setComps((cs) => [...cs, { nome: '', largura: '', observacao: '', medidas: [] }])
          }
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          + Componente
        </button>
        <button
          disabled={salvando}
          onClick={async () => {
            setSalvando(true)
            try {
              await onEnviar({
                acao: 'salvar_componentes',
                produtoId: produto.id,
                componentes: comps.map((c) => ({
                  nome: c.nome,
                  larguraCm: nInput(c.largura),
                  observacao: c.observacao || null,
                  medidas: c.medidas.map((m) => ({
                    tamanho: m.tamanho,
                    comprimentoCm: nInput(m.comprimento),
                  })),
                })),
              })
              setAviso('Ficha de corte salva.')
              onErro(null)
            } catch (e) {
              onErro(e instanceof Error ? e.message : 'Não foi possível salvar')
            } finally {
              setSalvando(false)
            }
          }}
          className="text-sm px-4 py-1.5 rounded-lg text-white disabled:opacity-50"
          style={{ backgroundColor: VERDE }}
        >
          {salvando ? 'Salvando…' : 'Salvar ficha de corte'}
        </button>
        {aviso && <span className="text-xs text-gray-600">{aviso}</span>}
      </div>
    </div>
  )
}
