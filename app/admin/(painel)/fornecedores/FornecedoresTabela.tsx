// app/admin/(painel)/fornecedores/FornecedoresTabela.tsx
// ============================================================================
// Tabela interativa de fornecedores — Fase 3a.
// Client Component que consome as APIs da Fase 2 (/api/admin/fornecedores*).
//
// Filtros reativos (status, busca debounced, vertical), ordenação clicável,
// pausar/reativar inline com prompt/confirm, exportar CSV via location.href.
//
// Drawer de edição fica pra Fase 3b — esta sprint NÃO inclui PATCH.
// ============================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'
import { ColunaContato } from '../ColunaContato'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { PECAS_PRINCIPAIS, PECAS_EXTRAS, pecaLabel } from '@/app/lib/pecas'
import { BadgePlano, BadgeStatusFornecedor } from './_helpers'
import { calcularDiasInatividade, formatarUltimaOferta } from './_format'
import FornecedorOverlay from './FornecedorOverlay'

// A coluna que era "Verticais" virou PEÇAS (05/09/2026).
//
// A vertical é ocasião de compra e o cadastro médio marcava sete delas: a
// célula abria um paredão de dez chips que empurrava a linha pra três alturas e
// não respondia a pergunta que o admin faz olhando a tabela ("essa confecção
// faz polo?"). Agora mostra no máximo três peças e conta o resto; o detalhe
// completo está no overlay, a um clique.
const CHIPS_VISIVEIS = 3

type Status = 'ativo' | 'pausado' | 'todos'
type Ordem = 'nome' | 'pedido_minimo' | 'ultimo_lead_em' | 'cidade' | 'plano'
type Dir = 'asc' | 'desc'

interface Fornecedor {
  id: string
  nome: string | null
  whatsapp: string
  email: string | null
  cidade: string | null
  estado: string | null
  tipos_produto: string[] | null
  pecas: string[] | null
  pecas_outro: string | null
  raio_atendimento: string | null
  pedido_minimo: number | null
  plano: 'free' | 'starter' | 'pro'
  status: 'ativo' | 'pausado'
  pausado_em: string | null
  motivo_pausa: string | null
  ultimo_lead_em: string | null
  criado_em: string
  atualizado_em: string
}

interface Resposta {
  dados: Fornecedor[]
  total: number
  pagina: number
  por_pagina: number
}

const RAIO_LABEL: Record<string, string> = {
  nacional: 'Nacional',
  estado: 'Estado',
  regiao: 'Região',
}

export default function FornecedoresTabela() {
  const [status, setStatus] = useState<Status>('todos')
  const [busca, setBusca] = useState('')
  const [buscaDebounced, setBuscaDebounced] = useState('')
  const [peca, setPeca] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('ultimo_lead_em')
  const [dir, setDir] = useState<Dir>('desc')

  const [dados, setDados] = useState<Fornecedor[]>([])
  const [total, setTotal] = useState(0)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [acaoLoading, setAcaoLoading] = useState<string | null>(null)
  const [fornecedorAberto, setFornecedorAberto] = useState<string | null>(null)

  // Debounce da busca (300ms)
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 300)
    return () => clearTimeout(t)
  }, [busca])

  const queryString = useCallback(() => {
    const p = new URLSearchParams()
    if (status !== 'todos') p.set('status', status)
    if (buscaDebounced) p.set('busca', buscaDebounced)
    if (peca) p.set('peca', peca)
    p.set('ordem', ordem)
    p.set('dir', dir)
    p.set('por_pagina', '200') // sem paginação visual nesta sprint
    return p.toString()
  }, [status, buscaDebounced, peca, ordem, dir])

  const carregar = useCallback(async () => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chamada de event/effect que dispara loading state
    setCarregando(true)
    setErro(null)
    try {
      const r = await fetch(`/api/admin/fornecedores?${queryString()}`, {
        credentials: 'same-origin',
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.erro || `HTTP ${r.status}`)
      }
      const j: Resposta = await r.json()
      setDados(j.dados)
      setTotal(j.total)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setCarregando(false)
    }
  }, [queryString])

  useEffect(() => {
    carregar()
  }, [carregar])

  const toggleOrdem = (campo: Ordem) => {
    if (ordem === campo) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setOrdem(campo)
      setDir('asc')
    }
  }

  const pausar = async (f: Fornecedor) => {
    const motivo = prompt(`Motivo pra pausar ${f.nome ?? 'fornecedor'}? (opcional)`)
    if (motivo === null) return // cancelou
    if (!confirm(`Confirma pausar ${f.nome ?? 'fornecedor'}?`)) return
    setAcaoLoading(f.id)
    try {
      const r = await fetch(`/api/admin/fornecedores/${f.id}/pausar`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo || undefined }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await carregar()
    } catch (e) {
      alert('Erro ao pausar: ' + (e instanceof Error ? e.message : 'desconhecido'))
    } finally {
      setAcaoLoading(null)
    }
  }

  const reativar = async (f: Fornecedor) => {
    if (!confirm(`Confirma reativar ${f.nome ?? 'fornecedor'}?`)) return
    setAcaoLoading(f.id)
    try {
      const r = await fetch(`/api/admin/fornecedores/${f.id}/reativar`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await carregar()
    } catch (e) {
      alert('Erro ao reativar: ' + (e instanceof Error ? e.message : 'desconhecido'))
    } finally {
      setAcaoLoading(null)
    }
  }

  const exportar = () => {
    const qs = queryString()
    window.location.href = `/api/admin/fornecedores/exportar?${qs}`
  }

  const temFiltro = status !== 'todos' || busca !== '' || peca !== ''
  const limparFiltros = () => {
    setStatus('todos')
    setBusca('')
    setPeca('')
  }

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Tabs de status */}
        <div className="inline-flex rounded-md border border-gray-200">
          {(['ativo', 'pausado', 'todos'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                'px-3 py-1.5 text-sm capitalize ' +
                (status === s
                  ? 'bg-gray-900 text-white'
                  : 'hover:bg-gray-100')
              }
            >
              {s}
            </button>
          ))}
        </div>

        {/* Busca */}
        <input
          type="text"
          placeholder="Buscar por nome ou cidade..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm min-w-[240px]"
        />

        {/* Peça. O filtro usa a MESMA ponte do matching (condicaoPecaSupabase):
            quem já migrou casa por `pecas`, quem não migrou pelas categorias
            equivalentes. Filtro de admin que discorda do matching faz a tela
            mostrar um conjunto e o sistema ofertar pra outro. */}
        <select
          value={peca}
          onChange={(e) => setPeca(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm bg-white"
        >
          <option value="">Todas as peças</option>
          <optgroup label="Mais pedidas">
            {PECAS_PRINCIPAIS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Outras">
            {PECAS_EXTRAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </select>

        {temFiltro && (
          <button
            onClick={limparFiltros}
            className="text-sm text-gray-600 underline"
          >
            Limpar filtros
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-gray-500">
            {carregando
              ? '...'
              : `${total} ${total === 1 ? 'fornecedor' : 'fornecedores'}`}
          </span>
          <button
            onClick={exportar}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-100"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Tabela */}
      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Erro: {erro}
        </div>
      )}

      {!erro && carregando && dados.length === 0 && (
        <div className="p-8 text-center text-sm text-gray-500">Carregando...</div>
      )}

      {!erro && !carregando && dados.length === 0 && (
        <div className="p-8 text-center text-sm text-gray-500">
          {temFiltro
            ? 'Nenhum fornecedor com esses filtros.'
            : 'Nenhum fornecedor cadastrado.'}
        </div>
      )}

      {fornecedorAberto && (
        <FornecedorOverlay
          fornecedorId={fornecedorAberto}
          onClose={() => setFornecedorAberto(null)}
        />
      )}

      {dados.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th
                  onClick={() => toggleOrdem('nome')}
                  ativo={ordem === 'nome'}
                  dir={dir}
                >
                  Contato
                </Th>
                <Th
                  onClick={() => toggleOrdem('plano')}
                  ativo={ordem === 'plano'}
                  dir={dir}
                >
                  Plano
                </Th>
                <Th
                  onClick={() => toggleOrdem('cidade')}
                  ativo={ordem === 'cidade'}
                  dir={dir}
                >
                  Local
                </Th>
                <Th>Peças</Th>
                <Th
                  onClick={() => toggleOrdem('pedido_minimo')}
                  ativo={ordem === 'pedido_minimo'}
                  dir={dir}
                >
                  Pedido mín
                </Th>
                <Th>Raio</Th>
                <Th
                  onClick={() => toggleOrdem('ultimo_lead_em')}
                  ativo={ordem === 'ultimo_lead_em'}
                  dir={dir}
                >
                  Última oferta
                </Th>
                <Th>Status</Th>
                <Th>Ações</Th>
              </tr>
            </thead>
            <tbody>
              {dados.map((f) => (
                <Linha
                  key={f.id}
                  fornecedor={f}
                  carregandoAcao={acaoLoading === f.id}
                  onPausar={() => pausar(f)}
                  onReativar={() => reativar(f)}
                  onAbrir={() => setFornecedorAberto(f.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Subcomponentes
// ============================================================================

function Th({
  children,
  onClick,
  ativo,
  dir,
}: {
  children: React.ReactNode
  onClick?: () => void
  ativo?: boolean
  dir?: 'asc' | 'desc'
}) {
  const base =
    'px-3 py-2 text-left text-xs uppercase tracking-wider font-semibold text-gray-600 whitespace-nowrap'
  if (!onClick) return <th className={base}>{children}</th>
  return (
    <th className={base}>
      <button
        type="button"
        onClick={onClick}
        className={
          'inline-flex items-center gap-1 ' +
          (ativo ? 'text-gray-900' : '')
        }
      >
        {children}
        {ativo && <span className="text-xs">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

function Linha({
  fornecedor,
  carregandoAcao,
  onPausar,
  onReativar,
  onAbrir,
}: {
  fornecedor: Fornecedor
  carregandoAcao: boolean
  onPausar: () => void
  onReativar: () => void
  onAbrir: () => void
}) {
  const pausado = fornecedor.status === 'pausado'
  const diasInatividade = calcularDiasInatividade(fornecedor.ultimo_lead_em)
  const opacidade = pausado ? 'opacity-60' : ''

  const local = fornecedor.cidade
    ? `${fornecedor.cidade}${fornecedor.estado ? ` / ${fornecedor.estado}` : ''}`
    : (fornecedor.estado ?? '—')

  return (
    <tr
      onClick={onAbrir}
      className={`cursor-pointer border-t border-gray-100 hover:bg-gray-50 ${opacidade}`}
    >
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {/* stopPropagation: botão WhatsApp 💬 não deve abrir o overlay */}
        <ColunaContato
          nome={fornecedor.nome ?? '(sem nome)'}
          whatsapp={fornecedor.whatsapp}
        />
      </td>
      <td className="px-3 py-2.5">
        <BadgePlano plano={fornecedor.plano} />
      </td>
      <td className="px-3 py-2.5 text-gray-700">{local}</td>
      <td className="px-3 py-2.5 align-top">
        <ColunaPecas fornecedor={fornecedor} />
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
        {fornecedor.pedido_minimo ?? '—'}
        {fornecedor.pedido_minimo !== null && (
          <span className="text-xs text-gray-500"> peças</span>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
        {RAIO_LABEL[fornecedor.raio_atendimento ?? ''] ??
          fornecedor.raio_atendimento ??
          '—'}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">
        <span className="inline-flex items-center gap-1.5">
          <span>{formatarUltimaOferta(fornecedor.ultimo_lead_em)}</span>
          {diasInatividade !== null && diasInatividade >= 30 && (
            <span
              title={`${diasInatividade} dias sem oferta`}
              aria-label={`${diasInatividade} dias sem oferta — atenção`}
              className="text-red-500"
            >
              ●
            </span>
          )}
          {diasInatividade !== null &&
            diasInatividade >= 10 &&
            diasInatividade < 30 && (
              <span
                title={`${diasInatividade} dias sem oferta`}
                aria-label={`${diasInatividade} dias sem oferta`}
                className="text-yellow-500"
              >
                ●
              </span>
            )}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span
          title={
            pausado && fornecedor.motivo_pausa
              ? `Motivo: ${fornecedor.motivo_pausa}`
              : undefined
          }
        >
          <BadgeStatusFornecedor status={fornecedor.status} />
        </span>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {/* stopPropagation: botão de ação não deve abrir o overlay */}
        {pausado ? (
          <button
            type="button"
            onClick={onReativar}
            disabled={carregandoAcao}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
          >
            {carregandoAcao ? '...' : 'Reativar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onPausar}
            disabled={carregandoAcao}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
          >
            {carregandoAcao ? '...' : 'Pausar'}
          </button>
        )}
      </td>
    </tr>
  )
}

/**
 * Peças da confecção, resumidas.
 *
 * Três estados, e a diferença entre eles é informação de operação:
 *   - já migrou  → chips verdes com o nome da peça. É o que o matching lê.
 *   - não migrou → chips cinza com a categoria antiga, e a palavra "legado".
 *     O admin precisa VER quem ainda não confirmou, senão a migração some.
 *   - nada       → o cadastro não casa com pedido nenhum. Vermelho, porque é
 *     um fornecedor invisível pro sistema.
 */
function ColunaPecas({ fornecedor }: { fornecedor: Fornecedor }) {
  const pecas = fornecedor.pecas ?? []
  const legado = fornecedor.tipos_produto ?? []
  const migrado = pecas.length > 0

  const lista = migrado ? pecas : legado
  const rotulo = (id: string) => (migrado ? pecaLabel(id) : (tipoLabel[id] ?? id))
  const visiveis = lista.slice(0, CHIPS_VISIVEIS)
  const resto = lista.length - visiveis.length

  if (lista.length === 0 && !fornecedor.pecas_outro) {
    return (
      <span className="text-xs text-red-600" title="Não casa com nenhum pedido">
        sem peça
      </span>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 max-w-[280px]"
      title={lista.map(rotulo).join(', ')}
    >
      {visiveis.map((id) => (
        <span
          key={id}
          className={
            'text-xs px-1.5 py-0.5 rounded whitespace-nowrap ' +
            (migrado ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-gray-100 text-gray-600')
          }
        >
          {rotulo(id)}
        </span>
      ))}
      {resto > 0 && (
        <span className="text-xs text-gray-400 whitespace-nowrap">+{resto}</span>
      )}
      {!migrado && lista.length > 0 && (
        <span
          className="text-[10px] uppercase tracking-wide text-amber-600"
          title="Cadastro ainda no vocabulário antigo — entra no matching pela ponte de categoria"
        >
          legado
        </span>
      )}
      {fornecedor.pecas_outro && (
        <span
          className="text-xs text-gray-400 italic truncate max-w-[140px]"
          title={fornecedor.pecas_outro}
        >
          “{fornecedor.pecas_outro}”
        </span>
      )}
    </div>
  )
}

// (helpers de formatação foram movidos pra ./_format na Fase 3b)
