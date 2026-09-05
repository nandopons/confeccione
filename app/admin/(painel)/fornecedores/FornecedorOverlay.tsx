// app/admin/(painel)/fornecedores/FornecedorOverlay.tsx
// ============================================================================
// Overlay fullscreen (~90%) com detalhes de 1 fornecedor — Fase 3b.
// Read-only. Edição fica pra Fase 3c.
//
// Esquerda: cabeçalho (nome/plano/local) + cards de métricas.
// Direita: filtro por status de oferta + tabela paginada de ofertas
//          com status do pedido (Fechou com ele / outro / órfão / aberto).
//
// Atalhos:
//   - ESC fecha
//   - clique no backdrop fecha
//   - botão X fecha
//
// Pedido NÃO vira link (rota /admin/pedidos/[id] ainda não existe — Fase 3c+).
// ============================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'
import { tipoLabel } from '@/app/lib/ofertas-labels'
import { PECAS_PRINCIPAIS, PECAS_EXTRAS, pecaLabel } from '@/app/lib/pecas'
import { BadgePlano, BadgeStatusFornecedor } from './_helpers'
import { formatarDataRelativa, formatarDuracao } from './_format'

interface FornecedorFull {
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
  plano: string
  status: 'ativo' | 'pausado'
  motivo_pausa: string | null
  pausado_em: string | null
  ultimo_lead_em: string | null
}

interface Metricas {
  ofertas_aceitas: number
  ofertas_recusadas: number
  ofertas_enviadas: number
  ofertas_expiradas: number
  taxa_resposta: number | null
  ultima_oferta_em: string | null
  perdeu_para_outro: number
  tempo_medio_resposta_ms: number | null
  ultima_aceitacao_em: string | null
}

interface DetalhesResp {
  fornecedor: FornecedorFull
  metricas: Metricas
}

type FiltroOferta = 'todas' | 'aceita' | 'recusada' | 'expirada' | 'pendente'

interface PedidoOferta {
  id: string
  tipo: string
  quantidade: number | null
  estado: string | null
  prazo: string | null
  status: string
  criado_em: string
  fornecedor_aceito_id: string | null
}

interface OfertaLinha {
  id: string
  status: string
  enviada_em: string | null
  respondida_em: string | null
  tentativa_numero: number | null
  tempo_resposta_ms: number | null
  pedido: PedidoOferta | null
}

interface OfertasResp {
  dados: OfertaLinha[]
  total: number
  pagina: number
  por_pagina: number
}

const POR_PAGINA = 20

const RAIO_LABEL: Record<string, string> = {
  nacional: 'Nacional',
  estado: 'Estado',
  regiao: 'Região',
}

export default function FornecedorOverlay({
  fornecedorId,
  onClose,
}: {
  fornecedorId: string
  onClose: () => void
}) {
  const [detalhes, setDetalhes] = useState<DetalhesResp | null>(null)
  const [carregandoDet, setCarregandoDet] = useState(true)
  const [erroDet, setErroDet] = useState<string | null>(null)

  // ESC + bloqueia scroll do body
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const carregarDetalhes = useCallback(async () => {
    setCarregandoDet(true)
    setErroDet(null)
    try {
      const r = await fetch(`/api/admin/fornecedores/${fornecedorId}`, {
        credentials: 'same-origin',
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.erro || `HTTP ${r.status}`)
      }
      const j: DetalhesResp = await r.json()
      setDetalhes(j)
    } catch (e) {
      setErroDet(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setCarregandoDet(false)
    }
  }, [fornecedorId])

  useEffect(() => {
    carregarDetalhes()
  }, [carregarDetalhes])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="overlay-titulo"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <h2 id="overlay-titulo" className="text-lg font-semibold text-gray-900">
            Detalhes do fornecedor
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-gray-500 hover:text-gray-900 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Conteúdo */}
        {erroDet && (
          <div className="m-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Erro ao carregar: {erroDet}
            <button
              onClick={carregarDetalhes}
              className="ml-3 underline"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {!erroDet && carregandoDet && (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
            Carregando…
          </div>
        )}

        {!erroDet && detalhes && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-0 overflow-hidden">
            {/* ESQUERDA — Métricas */}
            <ColunaMetricas
              fornecedor={detalhes.fornecedor}
              metricas={detalhes.metricas}
              aoSalvar={carregarDetalhes}
            />

            {/* DIREITA — Ofertas */}
            <ColunaOfertas fornecedorId={fornecedorId} />
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// EDIÇÃO — o que o PATCH da API aceita (nome, whatsapp, email, cidade, estado,
// pecas, pecas_outro, raio_atendimento, pedido_minimo). Status fica de fora:
// pausar e reativar têm rota própria, com motivo e auditoria.
//
// As PEÇAS são o campo que mais importa: é por elas que o fornecedor entra no
// matching de um pedido. Vêm como caixas, não como texto livre — id digitado
// errado tirava o fornecedor da fila sem ninguém perceber. `tipos_produto`
// saiu da tela: virou derivado das peças na própria rota, porque dois campos
// editáveis dizendo a mesma coisa divergem.
// ============================================================================

const RAIOS = [
  { valor: 'cidade', label: 'Cidade' },
  { valor: 'estado', label: 'Estado' },
  { valor: 'regiao', label: 'Região' },
  { valor: 'nacional', label: 'Nacional' },
]

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

function FormEdicaoFornecedor({
  fornecedor,
  onCancelar,
  onSalvo,
}: {
  fornecedor: FornecedorFull
  onCancelar: () => void
  onSalvo: () => void
}) {
  const [nome, setNome] = useState(fornecedor.nome ?? '')
  const [whatsapp, setWhatsapp] = useState(fornecedor.whatsapp ?? '')
  const [email, setEmail] = useState(fornecedor.email ?? '')
  const [cidade, setCidade] = useState(fornecedor.cidade ?? '')
  const [estado, setEstado] = useState(fornecedor.estado ?? '')
  const [raio, setRaio] = useState(fornecedor.raio_atendimento ?? 'nacional')
  const [minimo, setMinimo] = useState(
    fornecedor.pedido_minimo !== null ? String(fornecedor.pedido_minimo) : '',
  )
  const [pecas, setPecas] = useState<string[]>(fornecedor.pecas ?? [])
  const [pecasOutro, setPecasOutro] = useState(fornecedor.pecas_outro ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function alternarPeca(valor: string) {
    setPecas((atual) =>
      atual.includes(valor) ? atual.filter((t) => t !== valor) : [...atual, valor],
    )
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    const digitos = whatsapp.replace(/\D/g, '')
    if (digitos.length < 10) {
      setErro('WhatsApp precisa ter DDD + número.')
      return
    }
    if (email.trim() && !email.includes('@')) {
      setErro('E-mail inválido.')
      return
    }

    setSalvando(true)
    try {
      const r = await fetch(`/api/admin/fornecedores/${fornecedor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          nome: nome.trim() || null,
          whatsapp: digitos,
          email: email.trim() || null,
          cidade: cidade.trim() || null,
          estado: estado.trim() || null,
          pecas,
          pecas_outro: pecasOutro.trim() || null,
          raio_atendimento: raio,
          pedido_minimo: minimo.trim() ? Number(minimo) : null,
        }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.erro || `HTTP ${r.status}`)
      }
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const campo =
    'w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-900'
  const rotulo = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <form onSubmit={salvar} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Editar fornecedor</h3>
        <button
          type="button"
          onClick={onCancelar}
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          Cancelar
        </button>
      </div>

      <div>
        <label className={rotulo}>Nome</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={rotulo}>WhatsApp</label>
          <input
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className={campo}
            placeholder="5581999999999"
          />
        </div>
        <div>
          <label className={rotulo}>E-mail</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={campo} maxLength={120} />
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <div>
          <label className={rotulo}>Cidade</label>
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} className={campo} maxLength={80} />
        </div>
        <div>
          <label className={rotulo}>UF</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className={campo}>
            <option value="">—</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={rotulo}>Raio de atendimento</label>
          <select value={raio} onChange={(e) => setRaio(e.target.value)} className={campo}>
            {RAIOS.map((r) => (
              <option key={r.valor} value={r.valor}>{r.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={rotulo}>Pedido mínimo (peças)</label>
          <input
            type="number"
            min={1}
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            className={campo}
            placeholder="sem mínimo"
          />
        </div>
      </div>

      <div>
        <label className={rotulo}>Peças que produz</label>
        <div className="border border-gray-200 rounded-md p-3 max-h-64 overflow-y-auto space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
              Mais pedidas
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {PECAS_PRINCIPAIS.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pecas.includes(p.id)}
                    onChange={() => alternarPeca(p.id)}
                    className="rounded border-gray-300"
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
              Outras
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {PECAS_EXTRAS.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pecas.includes(p.id)}
                    onChange={() => alternarPeca(p.id)}
                    className="rounded border-gray-300"
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {pecas.length === 0 && (fornecedor.tipos_produto?.length ?? 0) > 0 && (
          <p className="text-xs text-amber-600 mt-1.5">
            Cadastro ainda no vocabulário antigo (
            {fornecedor.tipos_produto!.map((v) => tipoLabel[v] ?? v).join(', ')}).
            Marcar as peças aqui migra ele.
          </p>
        )}
        {pecas.length === 0 && (fornecedor.tipos_produto?.length ?? 0) === 0 && (
          <p className="text-xs text-red-600 mt-1.5">
            Sem nenhuma peça marcada ele não entra em nenhum matching.
          </p>
        )}

        <label className="block mt-3">
          <span className={rotulo}>Produz algo fora do catálogo?</span>
          <input
            value={pecasOutro}
            onChange={(e) => setPecasOutro(e.target.value.slice(0, 300))}
            maxLength={300}
            placeholder="Ex.: capa de almofada, toalha de mesa sob medida"
            className={campo}
          />
          <span className="text-[11px] text-gray-400 mt-1 block">
            Aparece em Peças faltando — é de onde saem as peças novas do catálogo.
          </span>
        </label>
      </div>

      {erro && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{erro}</div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={salvando}
          className="bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

// ============================================================================
// ESQUERDA — Métricas
// ============================================================================

function ColunaMetricas({
  fornecedor,
  metricas,
  aoSalvar,
}: {
  fornecedor: FornecedorFull
  metricas: Metricas
  aoSalvar: () => void
}) {
  const [editando, setEditando] = useState(false)
  const taxaAceite =
    metricas.ofertas_aceitas + metricas.ofertas_recusadas > 0
      ? metricas.ofertas_aceitas /
        (metricas.ofertas_aceitas + metricas.ofertas_recusadas)
      : null
  const local = fornecedor.cidade
    ? `${fornecedor.cidade}${fornecedor.estado ? ` / ${fornecedor.estado}` : ''}`
    : (fornecedor.estado ?? '—')

  if (editando) {
    return (
      <div className="border-r border-gray-200 overflow-y-auto p-6">
        <FormEdicaoFornecedor
          fornecedor={fornecedor}
          onCancelar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false)
            aoSalvar()
          }}
        />
      </div>
    )
  }

  return (
    <div className="border-r border-gray-200 overflow-y-auto p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xl font-semibold text-gray-900">
            {fornecedor.nome ?? '(sem nome)'}
          </h3>
          <BadgePlano plano={fornecedor.plano} />
          <BadgeStatusFornecedor status={fornecedor.status} />
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="ml-auto text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-300 hover:border-gray-500 rounded-md px-2.5 py-1 transition-colors"
          >
            Editar dados
          </button>
        </div>
        <div className="mt-1 text-sm text-gray-600">
          {fornecedor.whatsapp}
          {fornecedor.email ? ` · ${fornecedor.email}` : ''}
        </div>
        <div className="text-sm text-gray-600">{local}</div>
        {fornecedor.status === 'pausado' && fornecedor.motivo_pausa && (
          <div className="mt-2 text-xs text-gray-500">
            Motivo da pausa: {fornecedor.motivo_pausa}
          </div>
        )}
      </div>

      {/* Peças. Verde = migrado (o matching lê daqui). Cinza = categoria antiga,
          ainda entrando pela ponte. */}
      {((fornecedor.pecas?.length ?? 0) > 0 ||
        (fornecedor.tipos_produto?.length ?? 0) > 0 ||
        fornecedor.pecas_outro) && (
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
            {(fornecedor.pecas?.length ?? 0) > 0 ? 'Peças' : 'Verticais (legado)'}
          </div>
          <div className="flex flex-wrap gap-1">
            {(fornecedor.pecas?.length ?? 0) > 0
              ? fornecedor.pecas!.map((v) => (
                  <span
                    key={v}
                    className="text-xs px-1.5 py-0.5 bg-[#E1F5EE] rounded text-[#0F6E56] whitespace-nowrap"
                  >
                    {pecaLabel(v)}
                  </span>
                ))
              : (fornecedor.tipos_produto ?? []).map((v) => (
                  <span
                    key={v}
                    className="text-xs px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 whitespace-nowrap"
                  >
                    {tipoLabel[v] ?? v}
                  </span>
                ))}
          </div>
          {fornecedor.pecas_outro && (
            <p className="text-xs text-gray-500 italic mt-1.5">
              Fora do catálogo: “{fornecedor.pecas_outro}”
            </p>
          )}
        </div>
      )}

      {/* Raio + pedido mínimo */}
      <div className="text-sm text-gray-700">
        <div>
          <span className="text-gray-500">Raio: </span>
          {RAIO_LABEL[fornecedor.raio_atendimento ?? ''] ??
            fornecedor.raio_atendimento ??
            '—'}
        </div>
        <div>
          <span className="text-gray-500">Pedido mínimo: </span>
          {fornecedor.pedido_minimo !== null
            ? `${fornecedor.pedido_minimo} peças`
            : '—'}
        </div>
      </div>

      {/* Cards de métricas — grid 2x */}
      <div className="grid grid-cols-2 gap-3">
        <Card titulo="Ofertas recebidas" valor={metricas.ofertas_enviadas} />
        <Card
          titulo="Taxa de aceite"
          valor={
            taxaAceite !== null
              ? `${Math.round(taxaAceite * 100)}%`
              : '—'
          }
          dica={
            taxaAceite === null
              ? 'Ainda não respondeu nenhuma oferta'
              : `${metricas.ofertas_aceitas} aceitas de ${metricas.ofertas_aceitas + metricas.ofertas_recusadas} respondidas`
          }
        />
        <Card
          titulo="Tempo médio resposta"
          valor={formatarDuracao(metricas.tempo_medio_resposta_ms)}
          dica="Média entre enviada e respondida (aceitas + recusadas)"
        />
        <Card
          titulo="Última oferta"
          valor={formatarDataRelativa(metricas.ultima_oferta_em)}
        />
        <Card
          titulo="Perdeu pra outro"
          valor={metricas.perdeu_para_outro}
          dica="Pedidos que ele recebeu e outro fornecedor fechou"
        />
        <Card
          titulo="Última aceitação"
          valor={formatarDataRelativa(metricas.ultima_aceitacao_em)}
        />
      </div>
    </div>
  )
}

function Card({
  titulo,
  valor,
  dica,
}: {
  titulo: string
  valor: string | number
  dica?: string
}) {
  return (
    <div
      className="rounded-md border border-gray-200 p-3"
      title={dica}
    >
      <div className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
        {titulo}
      </div>
      <div className="text-lg font-semibold text-gray-900 mt-0.5">{valor}</div>
    </div>
  )
}

// ============================================================================
// DIREITA — Ofertas
// ============================================================================

const FILTROS: Array<{ valor: FiltroOferta; label: string }> = [
  { valor: 'todas', label: 'Todas' },
  { valor: 'aceita', label: 'Aceitas' },
  { valor: 'recusada', label: 'Recusadas' },
  { valor: 'expirada', label: 'Expiradas' },
  { valor: 'pendente', label: 'Pendentes' },
]

function ColunaOfertas({ fornecedorId }: { fornecedorId: string }) {
  const [filtro, setFiltro] = useState<FiltroOferta>('todas')
  const [dados, setDados] = useState<OfertaLinha[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(
    async (paginaAlvo: number, append: boolean) => {
      setCarregando(true)
      setErro(null)
      try {
        const url = new URL(
          `/api/admin/fornecedores/${fornecedorId}/ofertas`,
          window.location.origin,
        )
        if (filtro !== 'todas') url.searchParams.set('status', filtro)
        url.searchParams.set('pagina', String(paginaAlvo))
        url.searchParams.set('por_pagina', String(POR_PAGINA))
        const r = await fetch(url.toString(), { credentials: 'same-origin' })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.erro || `HTTP ${r.status}`)
        }
        const j: OfertasResp = await r.json()
        setDados((prev) => (append ? [...prev, ...j.dados] : j.dados))
        setTotal(j.total)
        setPagina(paginaAlvo)
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro desconhecido')
      } finally {
        setCarregando(false)
      }
    },
    [fornecedorId, filtro],
  )

  // Refetch quando troca o filtro (volta pra página 1)
  useEffect(() => {
    carregar(1, false)
  }, [carregar])

  const carregarMais = () => carregar(pagina + 1, true)

  const temMais = dados.length < total

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Tabs filtro */}
      <div className="border-b border-gray-200 px-4 py-2 flex items-center gap-1 flex-wrap">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            className={
              'rounded-md px-3 py-1 text-sm ' +
              (filtro === f.valor
                ? 'bg-gray-900 text-white'
                : 'hover:bg-gray-100')
            }
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-gray-500">
          {carregando && dados.length === 0 ? '…' : `${total} ${total === 1 ? 'oferta' : 'ofertas'}`}
        </span>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-4">
        {erro && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Erro: {erro}
          </div>
        )}

        {!erro && carregando && dados.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            Carregando…
          </div>
        )}

        {!erro && !carregando && dados.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            Nenhuma oferta com esse filtro.
          </div>
        )}

        {dados.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Data</Th>
                  <Th>Pedido</Th>
                  <Th>Resposta</Th>
                  <Th>Tempo resposta</Th>
                  <Th>Status pedido</Th>
                </tr>
              </thead>
              <tbody>
                {dados.map((o) => (
                  <LinhaOferta
                    key={o.id}
                    oferta={o}
                    fornecedorId={fornecedorId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {temMais && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={carregarMais}
              disabled={carregando}
              className="rounded-md border border-gray-200 px-4 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
            >
              {carregando ? 'Carregando…' : `Carregar mais (${total - dados.length} restantes)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs uppercase tracking-wider font-semibold text-gray-600 whitespace-nowrap">
      {children}
    </th>
  )
}

function LinhaOferta({
  oferta,
  fornecedorId,
}: {
  oferta: OfertaLinha
  fornecedorId: string
}) {
  const pedido = oferta.pedido
  const statusPedido = classificarStatusPedido(pedido, fornecedorId)

  return (
    <tr className="border-t border-gray-100">
      <td className="px-3 py-2 whitespace-nowrap text-gray-700">
        {oferta.enviada_em
          ? formatarDataCurta(oferta.enviada_em)
          : '—'}
      </td>
      <td className="px-3 py-2">
        {pedido ? (
          <div>
            <div className="text-gray-900">
              {tipoLabel[pedido.tipo] ?? pedido.tipo}
              {pedido.quantidade !== null && (
                <span className="text-gray-500"> · {pedido.quantidade}pç</span>
              )}
              {pedido.estado && (
                <span className="text-gray-500"> · {pedido.estado}</span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {pedido.id.slice(0, 8)}…
            </div>
          </div>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <BadgeStatusOferta status={oferta.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-700">
        {formatarDuracao(oferta.tempo_resposta_ms)}
      </td>
      <td className="px-3 py-2">
        <BadgeStatusPedido tipo={statusPedido} />
      </td>
    </tr>
  )
}

function BadgeStatusOferta({ status }: { status: string }) {
  const config: Record<string, { cor: string; label: string }> = {
    enviada: { cor: 'bg-yellow-100 text-yellow-800', label: 'Pendente' },
    aceita: { cor: 'bg-green-100 text-green-800', label: 'Aceitou' },
    recusada: { cor: 'bg-red-100 text-red-800', label: 'Recusou' },
    expirada: { cor: 'bg-gray-200 text-gray-700', label: 'Expirou' },
  }
  const def = config[status] ?? {
    cor: 'bg-gray-100 text-gray-500',
    label: status,
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${def.cor}`}
    >
      {def.label}
    </span>
  )
}

type StatusPedidoTipo =
  | 'fechou_com_ele'
  | 'fechou_com_outro'
  | 'orfao'
  | 'buscando'
  | 'desconhecido'

function classificarStatusPedido(
  pedido: PedidoOferta | null,
  fornecedorId: string,
): StatusPedidoTipo {
  if (!pedido) return 'desconhecido'
  if (
    pedido.fornecedor_aceito_id &&
    pedido.fornecedor_aceito_id === fornecedorId
  ) {
    return 'fechou_com_ele'
  }
  if (
    pedido.fornecedor_aceito_id &&
    pedido.fornecedor_aceito_id !== fornecedorId
  ) {
    return 'fechou_com_outro'
  }
  if (pedido.status === 'orfao') return 'orfao'
  return 'buscando'
}

function BadgeStatusPedido({ tipo }: { tipo: StatusPedidoTipo }) {
  const config: Record<StatusPedidoTipo, { cor: string; label: string }> = {
    fechou_com_ele: {
      cor: 'bg-green-100 text-green-800',
      label: 'Fechou com ele',
    },
    fechou_com_outro: {
      cor: 'bg-gray-200 text-gray-700',
      label: 'Fechou com outro',
    },
    orfao: { cor: 'bg-red-100 text-red-800', label: 'Órfão' },
    buscando: { cor: 'bg-blue-100 text-blue-800', label: 'Buscando' },
    desconhecido: { cor: 'bg-gray-100 text-gray-500', label: '—' },
  }
  const def = config[tipo]
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${def.cor}`}
    >
      {def.label}
    </span>
  )
}

function formatarDataCurta(iso: string): string {
  const d = new Date(iso)
  const dia = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const ano = String(d.getFullYear()).slice(-2)
  return `${dia}/${mes}/${ano}`
}
