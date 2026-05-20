// app/cliente/(painel)/pedido/[id]/page.tsx
// ============================================================================
// Detalhes de 1 pedido do cliente logado.
// Validação dupla: WHERE id=$1 AND conta_id=$contaAtual.
// Se não existir/não pertencer → redirect pro painel.
// ============================================================================

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getContaAtual, perfilCompleto } from '@/app/lib/cliente-auth'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import { corStatus, labelStatus } from '@/app/lib/cliente-status'
import { formatarWhatsappBR } from '@/app/lib/format'
import { linkWhatsApp } from '@/app/lib/phone'
import SolicitarOutroFornecedorButton from './SolicitarOutroFornecedorButton'
import CompartilharArtesButton from './CompartilharArtesButton'

export const dynamic = 'force-dynamic'

const STATUS_TERMINAL = ['concluido', 'expirado_sem_resposta', 'manual_pausado']
const LIMITE_TROCAS_FREE = 2

type Solicitacao = {
  id: string
  motivo: string | null
  criado_em: string
}

type PedidoDetalhe = {
  id: string
  tipo: string
  quantidade: number | null
  estado: string | null
  prazo: string | null
  status: string
  criado_em: string
  descricao: string | null
  fornecedor_aceito_id: string | null
  fornecedor_aceito?: {
    nome: string | null
    whatsapp: string
  } | null
}

type OfertaTimeline = {
  id: string
  status: string
  enviada_em: string
  respondida_em: string | null
}

type Compartilhamento = {
  id: string
  arquivos_count: number
  acessos_count: number
  expira_em: string
  criado_em: string
}

export default async function PedidoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const conta = await getContaAtual()
  if (!conta) return null
  if (!perfilCompleto(conta)) redirect('/cliente/perfil?completar=1')

  const { id } = await params

  const { data: pedidoRaw } = await supabaseAdmin
    .from('pedidos')
    .select(
      'id, tipo, quantidade, estado, prazo, status, criado_em, descricao, ' +
        'fornecedor_aceito_id, ' +
        'fornecedor_aceito:leads_fornecedores!fornecedor_aceito_id(nome, whatsapp)',
    )
    .eq('id', id)
    .eq('conta_id', conta.id)
    .maybeSingle()

  if (!pedidoRaw) {
    notFound()
  }

  const pedido = pedidoRaw as unknown as PedidoDetalhe

  // Registra acesso ao painel (sinal de "pedido vivo", usado no follow-up).
  // await pra garantir a escrita em serverless; erro não bloqueia o render.
  const { error: errAcesso } = await supabaseAdmin
    .from('pedidos')
    .update({ ultimo_acesso_painel: new Date().toISOString() })
    .eq('id', id)
    .eq('conta_id', conta.id)
  if (errAcesso) {
    console.warn('[pedido] update ultimo_acesso_painel falhou:', errAcesso.message)
  }

  // Timeline de ofertas (mínimo: data + status)
  const { data: ofertasRaw } = await supabaseAdmin
    .from('ofertas')
    .select('id, status, enviada_em, respondida_em')
    .eq('pedido_id', id)
    .order('enviada_em', { ascending: true })

  const ofertas = (ofertasRaw ?? []) as OfertaTimeline[]

  // Solicitações de troca registradas
  const { data: solicitacoesRaw } = await supabaseAdmin
    .from('solicitacoes_outro_fornecedor')
    .select('id, motivo, criado_em')
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true })

  const solicitacoes = (solicitacoesRaw ?? []) as Solicitacao[]

  // Compartilhamentos de artes registrados
  const { data: compartilhamentosRaw } = await supabaseAdmin
    .from('compartilhamentos_artes')
    .select('id, arquivos_count, acessos_count, expira_em, criado_em')
    .eq('pedido_id', id)
    .order('criado_em', { ascending: true })

  const compartilhamentos = (compartilhamentosRaw ?? []) as Compartilhamento[]

  const podeMostrarTrocar =
    !STATUS_TERMINAL.includes(pedido.status) &&
    (ofertas.length > 0 || pedido.fornecedor_aceito_id !== null)
  const podeTrocar = solicitacoes.length < LIMITE_TROCAS_FREE

  const tipo = tipoLabel[pedido.tipo] ?? pedido.tipo
  const prazo = pedido.prazo ? (prazoLabel[pedido.prazo] ?? pedido.prazo) : null
  const criado = formatarDataHora(pedido.criado_em)

  const aceito = pedido.fornecedor_aceito_id && pedido.fornecedor_aceito
  const ofertaAceita = ofertas.find((o) => o.status === 'aceita')
  const semFornecedor =
    pedido.status === 'expirado_sem_resposta' || pedido.status === 'orfao'

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Link
        href="/cliente/painel"
        className="text-sm text-gray-600 hover:text-gray-900 inline-block mb-4"
      >
        ← Voltar
      </Link>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{tipo}</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Criado em {criado}
            </p>
          </div>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${corStatus(pedido.status)}`}
          >
            {labelStatus(pedido.status)}
          </span>
        </div>

        <dl className="text-sm text-gray-700 space-y-1.5">
          {pedido.quantidade !== null && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Quantidade:</dt>
              <dd>{pedido.quantidade} peças</dd>
            </div>
          )}
          {pedido.estado && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Estado:</dt>
              <dd>{pedido.estado}</dd>
            </div>
          )}
          {prazo && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Prazo:</dt>
              <dd>{prazo}</dd>
            </div>
          )}
          {pedido.descricao && (
            <div className="flex gap-2">
              <dt className="text-gray-500 min-w-[110px]">Descrição:</dt>
              <dd className="whitespace-pre-wrap">{pedido.descricao}</dd>
            </div>
          )}
        </dl>

        {podeMostrarTrocar && (
          <SolicitarOutroFornecedorButton
            pedidoId={pedido.id}
            trocasRealizadas={solicitacoes.length}
            limiteTrocas={LIMITE_TROCAS_FREE}
            podeTrocar={podeTrocar}
          />
        )}
      </div>

      {/* Status / Fornecedor */}
      {aceito && pedido.fornecedor_aceito && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-6">
          <div className="text-xs uppercase tracking-wider text-green-800 font-semibold mb-2">
            Fornecedor encontrado
          </div>
          <div className="text-lg font-semibold text-gray-900">
            {pedido.fornecedor_aceito.nome ?? 'Fornecedor confirmado'}
          </div>
          <div className="text-sm text-gray-700 mt-0.5">
            📱 {formatarWhatsappBR(pedido.fornecedor_aceito.whatsapp)}
          </div>
          <a
            href={linkWhatsApp(pedido.fornecedor_aceito.whatsapp)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block px-5 py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761]"
          >
            Conversar no WhatsApp
          </a>
          <CompartilharArtesButton
            pedidoId={pedido.id}
            fornecedorNome={pedido.fornecedor_aceito.nome}
          />
        </div>
      )}

      {semFornecedor && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 mb-6">
          <div className="text-orange-900 font-medium text-sm mb-1">
            Estamos com dificuldade em encontrar fornecedor
          </div>
          <p className="text-orange-800 text-sm">
            Nossa equipe foi notificada e está procurando ativamente um
            fornecedor compatível pro seu pedido. Te avisaremos assim que
            tivermos novidade.
          </p>
        </div>
      )}

      {/* Acompanhamento — sempre visível, condicional os passos */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
          Acompanhamento
        </h3>
        <ol className="relative border-l border-gray-200 pl-4 space-y-4 text-sm">
          {/* Sempre: pedido criado */}
          <PassoTimeline icone="✅" texto="Pedido criado" detalhe={criado} />

          {/* Se tem ofertas enviadas */}
          {ofertas.length > 0 && (
            <PassoTimeline
              icone="📤"
              texto={`${ofertas.length} ${ofertas.length === 1 ? 'oferta enviada' : 'ofertas enviadas'} a fornecedores`}
            />
          )}

          {/* Se aceito */}
          {aceito && pedido.fornecedor_aceito && (
            <PassoTimeline
              icone="✅"
              texto={`Fornecedor ${pedido.fornecedor_aceito.nome ?? 'parceiro'} aceitou`}
              detalhe={
                ofertaAceita?.respondida_em
                  ? formatarDataHora(ofertaAceita.respondida_em)
                  : undefined
              }
            />
          )}

          {/* Solicitações de troca (ordem cronológica) */}
          {solicitacoes.map((s) => (
            <PassoTimeline
              key={s.id}
              icone="🔄"
              texto="Você pediu trocar de fornecedor"
              detalhe={
                s.motivo
                  ? `${formatarDataHora(s.criado_em)} · Motivo: ${s.motivo}`
                  : formatarDataHora(s.criado_em)
              }
            />
          ))}

          {/* Compartilhamentos de artes */}
          {compartilhamentos.map((c) => (
            <PassoTimeline
              key={c.id}
              icone="📎"
              texto={`Você compartilhou ${c.arquivos_count} ${c.arquivos_count === 1 ? 'arquivo' : 'arquivos'} com o fornecedor`}
              detalhe={
                c.acessos_count > 0
                  ? `${formatarDataHora(c.criado_em)} · Aberto ${c.acessos_count}x pelo fornecedor`
                  : `${formatarDataHora(c.criado_em)} · Ainda não aberto`
              }
            />
          ))}

          {/* Se órfão */}
          {semFornecedor && (
            <PassoTimeline
              icone="⚠️"
              texto="Não encontramos fornecedor disponível"
            />
          )}

          {/* Se buscando e ainda sem ofertas */}
          {pedido.status === 'buscando_fornecedor' && ofertas.length === 0 && (
            <PassoTimeline
              icone="⏳"
              texto="Procurando fornecedores compatíveis..."
            />
          )}
        </ol>
      </div>
    </section>
  )
}

function PassoTimeline({
  icone,
  texto,
  detalhe,
}: {
  icone: string
  texto: string
  detalhe?: string
}) {
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className="absolute -left-[26px] top-0 flex items-center justify-center w-5 h-5 bg-white rounded-full text-sm"
      >
        {icone}
      </span>
      <div className="text-gray-900">{texto}</div>
      {detalhe && (
        <div className="text-xs text-gray-500 mt-0.5">{detalhe}</div>
      )}
    </li>
  )
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  const dia = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const ano = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dia}/${mes}/${ano} às ${hh}:${mm}`
}
