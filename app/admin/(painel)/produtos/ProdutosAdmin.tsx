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

type TipoRecurso = 'maquina' | 'posto'

type Servico = {
  id: string
  codigo: string
  nome: string
  recursoId: string | null
  recursoNome: string | null
  horasPadrao: number | null
  precoCentavos: number | null
  descricao: string | null
  ativo: boolean
}

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
  tipo: TipoRecurso
  capacidadeHorasDia: number
}

type TipoOperacao = 'por_peca' | 'por_lote'

type Operacao = {
  id: string
  ordem: number
  descricao: string
  maquinaId: string | null
  maquinaNome: string | null
  tempoSegundos: number | null
  tipo: TipoOperacao
  rendePecas: number | null
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
  tempoPorPecaSegundos: number | null
  temOperacaoPorLote: boolean
  operacoesSemTempo: number
  prontoParaCalculo: boolean
}

/**
 * Quanto esta operação custa para `qtd` peças.
 *
 * Espelha `custoOperacaoSegundos` do servidor — a conta roda aqui só para o
 * simulador responder na hora, sem ida ao banco. A verdade continua no
 * servidor; se as duas divergirem, é a de lá que vale.
 */
function custoOperacao(
  o: { tempoSegundos: number | null; tipo: TipoOperacao; rendePecas: number | null },
  qtd: number,
): number {
  if (o.tempoSegundos == null || qtd <= 0) return 0
  if (o.tipo === 'por_peca') return o.tempoSegundos * qtd
  if (!o.rendePecas) return o.tempoSegundos
  return o.tempoSegundos * Math.ceil(qtd / o.rendePecas)
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
  const [aba, setAba] = useState<'produtos' | 'maquinas' | 'servicos'>('produtos')
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
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
      setServicos(d.servicos ?? [])
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
    if (d?.servicos) setServicos(d.servicos)
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
        {(['produtos', 'maquinas', 'servicos'] as const).map((a) => (
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
            {a === 'produtos' ? 'Produtos' : a === 'maquinas' ? 'Máquinas e postos' : 'Serviços'}
          </button>
        ))}
      </div>

      {erro && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          {erro}
        </div>
      )}

      <div className="mt-5">
        {aba === 'servicos' ? (
          <AbaServicos servicos={servicos} maquinas={maquinas} onEnviar={enviar} onErro={setErro} />
        ) : aba === 'maquinas' ? (
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
                    {m.tipo === 'posto' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 ml-1.5">
                        posto
                      </span>
                    )}
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
                    {m.tipo === 'posto' ? (
                      <span className="text-gray-400">—</span>
                    ) : m.setupTrocaMin > 0 ? (
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
  const [tipo, setTipo] = useState<TipoRecurso>(maquina?.tipo ?? 'maquina')
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
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          Código
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="overloque"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          Quantas você tem
          <input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          Horas por dia (cada uma)
          <input
            value={horasDia}
            onChange={(e) => setHorasDia(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          O que é
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoRecurso)}
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900"
          >
            <option value="maquina">Máquina</option>
            <option value="posto">Posto de trabalho (design, modelagem)</option>
          </select>
        </label>
        {/* Posto não troca linha de cor — o campo só confundiria. */}
        {tipo === 'maquina' && (
          <label className="text-xs text-gray-600">
            Troca de linha (minutos)
            <input
              value={setup}
              onChange={(e) => setSetup(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
          </label>
        )}
        <label className="text-xs text-gray-600">
          Observação
          <input
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
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
              setupTrocaMin: tipo === 'posto' ? 0 : nInput(setup) ?? 0,
              tipo,
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
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 hover:text-gray-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Serviços — design, modelagem, ajuste de grade
//
// POR QUE NÃO SÃO OPERAÇÃO DO PRODUTO
// Modelagem varia por pedido (decisão do Fernando, 22/08/2026): alguns pedidos
// exigem modelo novo, outros reaproveitam. No roteiro do produto ela seria
// cobrada sempre. Aqui é só o CATÁLOGO — tempo e preço padrão; o uso real você
// pendura no card, em Produção, e pode ajustar os dois.
// ---------------------------------------------------------------------------
function AbaServicos({
  servicos,
  maquinas,
  onEnviar,
  onErro,
}: {
  servicos: Servico[]
  maquinas: Maquina[]
  onEnviar: Enviar
  onErro: (e: string | null) => void
}) {
  const [editando, setEditando] = useState<Servico | null>(null)
  const [novo, setNovo] = useState(false)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-gray-600 max-w-2xl">
          Trabalho que não é operação de peça. Cada serviço aponta pro posto que o executa — é assim
          que ele disputa hora e pode virar gargalo junto com a costura.
        </p>
        <button
          onClick={() => {
            setNovo(true)
            setEditando(null)
          }}
          className="text-sm px-4 py-2 rounded-lg text-white shrink-0"
          style={{ backgroundColor: VERDE }}
        >
          Novo serviço
        </button>
      </div>

      {(novo || editando) && (
        <FormServico
          servico={editando}
          maquinas={maquinas}
          onCancelar={() => {
            setNovo(false)
            setEditando(null)
          }}
          onSalvar={async (dados) => {
            try {
              await onEnviar({ acao: 'salvar_servico', ...dados })
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
                <th className="px-4 py-2.5 font-semibold">Serviço</th>
                <th className="px-4 py-2.5 font-semibold">Executado em</th>
                <th className="px-4 py-2.5 font-semibold text-right">Horas padrão</th>
                <th className="px-4 py-2.5 font-semibold text-right">Preço padrão</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {servicos.map((sv) => (
                <tr key={sv.id}>
                  <td className="px-4 py-2.5">
                    <span className="text-gray-900">{sv.nome}</span>
                    {sv.descricao && <p className="text-xs text-gray-500 mt-0.5">{sv.descricao}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">
                    {sv.recursoNome ?? (
                      <span className="text-gray-500">terceirizado — não ocupa capacidade</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {sv.horasPadrao == null ? (
                      <span className="text-amber-700">a definir</span>
                    ) : (
                      `${sv.horasPadrao}h`
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {sv.precoCentavos == null ? '—' : brlPcp(sv.precoCentavos)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => {
                        setEditando(sv)
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
        <strong>Horas e preço aqui são padrão</strong> — sugestão para não redigitar. No card você
        ajusta os dois: uma modelagem difícil leva o dobro, e mudar o catálogo depois não reescreve o
        que já foi planejado e cobrado.
      </p>
    </div>
  )
}

function brlPcp(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function FormServico({
  servico,
  maquinas,
  onSalvar,
  onCancelar,
}: {
  servico: Servico | null
  maquinas: Maquina[]
  onSalvar: (dados: Record<string, unknown>) => Promise<void>
  onCancelar: () => void
}) {
  const [nome, setNome] = useState(servico?.nome ?? '')
  const [codigo, setCodigo] = useState(servico?.codigo ?? '')
  const [recursoId, setRecursoId] = useState(servico?.recursoId ?? '')
  const [horas, setHoras] = useState(servico?.horasPadrao == null ? '' : String(servico.horasPadrao))
  const [preco, setPreco] = useState(
    servico?.precoCentavos == null ? '' : String(servico.precoCentavos / 100),
  )
  const [descricao, setDescricao] = useState(servico?.descricao ?? '')
  const [salvando, setSalvando] = useState(false)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        {servico ? `Editar ${servico.nome}` : 'Novo serviço'}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="text-xs text-gray-600">
          Nome
          <input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value)
              if (!servico && !codigo) setCodigo(e.target.value)
            }}
            placeholder="Modelagem nova"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          Executado em
          <select
            value={recursoId}
            onChange={(e) => setRecursoId(e.target.value)}
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900"
          >
            <option value="">Terceirizado — não ocupa capacidade</option>
            {maquinas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Horas padrão
          <input
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
            inputMode="decimal"
            placeholder="4"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600">
          Preço padrão (R$)
          <input
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            inputMode="decimal"
            placeholder="250"
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
        <label className="text-xs text-gray-600 sm:col-span-2">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
          />
        </label>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          disabled={salvando}
          onClick={async () => {
            setSalvando(true)
            const p = nInput(preco)
            await onSalvar({
              id: servico?.id ?? null,
              nome,
              codigo: codigo || nome,
              recursoId: recursoId || null,
              horasPadrao: nInput(horas),
              // Preço vazio não é zero: zero diria "de graça", vazio diz
              // "ainda não decidi".
              precoCentavos: p == null ? null : Math.round(p * 100),
              descricao: descricao || null,
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
          className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
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
              className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
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
              className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 hover:text-gray-900"
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
              {tempoLegivel(produto.tempoPorPecaSegundos)} por peça
              {produto.temOperacaoPorLote ? ' + lote' : ''}
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
  tipo: TipoOperacao
  rende: string
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
      tipo: o.tipo,
      rende: o.rendePecas == null ? '' : String(o.rendePecas),
      observacao: o.observacao ?? '',
    })),
  )
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  // Lote de referência do simulador. 50 é só um ponto de partida legível —
  // o número real vem do pedido, e a graça é justamente mexer aqui e ver o
  // custo por peça mudar quando existe operação por lote.
  const [lote, setLote] = useState('50')

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

  const semTempo = linhas.filter((l) => l.descricao.trim() && !parseInt(l.tempo, 10)).length
  const qtdLote = parseInt(lote, 10) || 0

  const { custoLote, porMaquina } = useMemo(() => {
    const porMaq = new Map<string, number>()
    let total = 0
    for (const l of linhas) {
      const seg = custoOperacao(
        {
          tempoSegundos: parseInt(l.tempo, 10) || null,
          tipo: l.tipo,
          rendePecas: parseInt(l.rende, 10) || null,
        },
        qtdLote,
      )
      if (!seg) continue
      total += seg
      const nome = maquinas.find((m) => m.id === l.maquinaId)?.nome ?? 'Sem máquina'
      porMaq.set(nome, (porMaq.get(nome) ?? 0) + seg)
    }
    return {
      custoLote: total,
      porMaquina: [...porMaq.entries()]
        .map(([nome, segundos]) => ({ nome, segundos }))
        .sort((a, b) => b.segundos - a.segundos),
    }
  }, [linhas, qtdLote, maquinas])

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
              <th className="pb-1 w-44">Como conta</th>
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
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                  />
                </td>
                <td className="py-1 pr-2">
                  <select
                    value={l.maquinaId ?? ''}
                    onChange={(e) => mudar(i, 'maquinaId', e.target.value || null)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900"
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
                    className="w-full text-sm border rounded-lg px-2 py-1.5 text-gray-900"
                    style={{ borderColor: l.tempo ? '#d1d5db' : '#fcd34d' }}
                  />
                </td>
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1">
                    <select
                      value={l.tipo}
                      onChange={(e) => mudar(i, 'tipo', e.target.value)}
                      className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-gray-900"
                      aria-label="Como o tempo conta"
                    >
                      <option value="por_peca">por peça</option>
                      <option value="por_lote">por lote</option>
                    </select>
                    {l.tipo === 'por_lote' && (
                      <>
                        <span className="text-[11px] text-gray-500 whitespace-nowrap">rende</span>
                        <input
                          value={l.rende}
                          onChange={(e) => mudar(i, 'rende', e.target.value.replace(/\D/g, ''))}
                          inputMode="numeric"
                          placeholder="∞"
                          title="Quantas peças esse tempo rende. Vazio = uma vez por lote, qualquer tamanho."
                          className="w-14 text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                        />
                      </>
                    )}
                  </div>
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={l.observacao}
                    onChange={(e) => mudar(i, 'observacao', e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
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
            setLinhas((ls) => [
              ...ls,
              { descricao: '', maquinaId: null, tempo: '', tipo: 'por_peca' as TipoOperacao, rende: '', observacao: '' },
            ])
          }
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 hover:text-gray-900"
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
                  tipo: l.tipo,
                  rendePecas: l.tipo === 'por_lote' ? parseInt(l.rende, 10) || null : null,
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
        {aviso && <span className="text-xs text-gray-600">{aviso}</span>}
      </div>

      {/* Simulador — é ele que mostra por que média fracionada não serve:
          mude o lote e veja o custo por peça andar. */}
      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          <span>Um lote de</span>
          <input
            value={lote}
            onChange={(e) => setLote(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            className="w-20 text-sm border border-gray-300 rounded-lg px-2 py-1 text-gray-900 bg-white"
          />
          <span>peças custa</span>
          <strong className="text-gray-900">{tempoLegivel(custoLote)}</strong>
          <span>
            — {tempoLegivel(qtdLote > 0 ? Math.round(custoLote / qtdLote) : null)} por peça
          </span>
          {semTempo > 0 && (
            <span className="text-amber-800">
              (parcial — faltam {semTempo} {semTempo === 1 ? 'tempo' : 'tempos'})
            </span>
          )}
        </div>
        {porMaquina.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-gray-600">
            {porMaquina.map((m) => (
              <span key={m.nome}>
                {m.nome}: <strong className="text-gray-900">{tempoLegivel(m.segundos)}</strong>
              </span>
            ))}
          </div>
        )}
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
                  className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
              </label>
              <label className="text-xs text-gray-600">
                Largura (cm)
                <input
                  value={c.largura}
                  onChange={(e) => mudarComp(i, 'largura', e.target.value)}
                  inputMode="decimal"
                  placeholder="5,3"
                  className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
                />
              </label>
              <label className="text-xs text-gray-600">
                Observação
                <input
                  value={c.observacao}
                  onChange={(e) => mudarComp(i, 'observacao', e.target.value)}
                  className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 text-gray-900"
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
                      className="mt-0.5 w-14 text-sm border border-gray-300 rounded-lg px-2 py-1 text-center text-gray-900"
                    />
                  </label>
                  <label className="text-[11px] text-gray-500">
                    Compr. (cm)
                    <input
                      value={m.comprimento}
                      onChange={(e) => mudarMedida(i, k, 'comprimento', e.target.value)}
                      inputMode="decimal"
                      className="mt-0.5 w-20 text-sm border border-gray-300 rounded-lg px-2 py-1 text-gray-900"
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
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 hover:text-gray-900"
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
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 hover:text-gray-900"
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
