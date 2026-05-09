// app/fornecedor/painel/pedidos/CardOfertaPendente.tsx
'use client'

// ============================================================================
// Card de oferta PENDENTE — mostra dados do pedido (sem contato cliente),
// timer regressivo até expirar, e botões Aceitar / Recusar.
// Após aceitar, transforma o card em "aceito com contato direto" sem precisar
// recarregar a página (substitui o card por CardOfertaAceita inline).
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OfertaPainel } from '@/app/lib/ofertas-painel'
import { tipoLabel, prazoLabel } from '@/app/lib/ofertas-labels'
import ModalAceitar from './ModalAceitar'

type Props = {
  oferta: OfertaPainel
}

type EstadoCard =
  | { tipo: 'pendente' }
  | { tipo: 'aceito'; cliente: { nome: string; whatsapp: string; email: string | null } }
  | { tipo: 'recusado' }

export default function CardOfertaPendente({ oferta }: Props) {
  const router = useRouter()
  const [estado, setEstado] = useState<EstadoCard>({ tipo: 'pendente' })
  const [tempoRestante, setTempoRestante] = useState<string>('')
  const [expirado, setExpirado] = useState(false)
  const [modalAberto, setModalAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Timer regressivo (atualiza a cada 30s)
  useEffect(() => {
    function atualizar() {
      const restanteMs = new Date(oferta.expira_em).getTime() - Date.now()
      if (restanteMs <= 0) {
        setExpirado(true)
        setTempoRestante('Expirado')
        return
      }
      const horas = Math.floor(restanteMs / (60 * 60 * 1000))
      const minutos = Math.floor((restanteMs % (60 * 60 * 1000)) / (60 * 1000))
      setTempoRestante(`${horas}h ${minutos}min`)
    }
    atualizar()
    const id = setInterval(atualizar, 30 * 1000)
    return () => clearInterval(id)
  }, [oferta.expira_em])

  async function aceitar() {
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch(
        `/api/fornecedor/ofertas/${oferta.id}/aceitar`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        setErro(data.erro ?? 'Erro ao aceitar oferta')
        setEnviando(false)
        return
      }
      setEstado({ tipo: 'aceito', cliente: data.cliente })
      setModalAberto(false)
      router.refresh()
    } catch {
      setErro('Erro de conexão. Tenta de novo.')
      setEnviando(false)
    }
  }

  async function recusar() {
    if (!confirm('Tem certeza que quer recusar este pedido?')) return
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch(
        `/api/fornecedor/ofertas/${oferta.id}/recusar`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        setErro(data.erro ?? 'Erro ao recusar oferta')
        setEnviando(false)
        return
      }
      setEstado({ tipo: 'recusado' })
      router.refresh()
    } catch {
      setErro('Erro de conexão. Tenta de novo.')
      setEnviando(false)
    }
  }

  // ============================================================
  // Estado: ACEITO (após aceitar com sucesso) — mostra contato
  // ============================================================
  if (estado.tipo === 'aceito') {
    const tipo = tipoLabel[oferta.pedido_tipo] ?? oferta.pedido_tipo
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="text-2xl">✅</div>
          <div>
            <div className="text-emerald-900 font-medium">
              Pedido aceito! Aqui estão os dados do cliente:
            </div>
            <div className="text-emerald-700 text-xs mt-1">
              Pedido de {tipo}
              {oferta.pedido_quantidade
                ? ` · ${oferta.pedido_quantidade} peças`
                : ''}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 space-y-3">
          <Linha rotulo="Nome" valor={estado.cliente.nome} />
          <Linha
            rotulo="WhatsApp"
            valor={estado.cliente.whatsapp}
            link={`https://wa.me/${estado.cliente.whatsapp.replace(/\D/g, '')}`}
            linkLabel="Abrir conversa"
          />
          {estado.cliente.email && (
            <Linha
              rotulo="E-mail"
              valor={estado.cliente.email}
              link={`mailto:${estado.cliente.email}`}
              linkLabel="Enviar e-mail"
            />
          )}
        </div>

        <p className="text-emerald-700 text-xs mt-3">
          Entre em contato direto com o cliente pra combinar detalhes. Boa venda!
        </p>
      </div>
    )
  }

  // ============================================================
  // Estado: RECUSADO (após recusar com sucesso) — placeholder
  // ============================================================
  if (estado.tipo === 'recusado') {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 opacity-60">
        <div className="text-gray-500 text-sm">
          Pedido recusado. Já encaminhamos pra outro fornecedor.
        </div>
      </div>
    )
  }

  // ============================================================
  // Estado: PENDENTE (estado inicial)
  // ============================================================
  const tipo = tipoLabel[oferta.pedido_tipo] ?? oferta.pedido_tipo
  const prazo = prazoLabel[oferta.pedido_prazo] ?? oferta.pedido_prazo

  return (
    <>
      <div
        className={`bg-white border rounded-2xl p-5 ${
          expirado ? 'border-gray-200 opacity-60' : 'border-emerald-200'
        }`}
      >
        {/* Header com tempo restante */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-gray-900 font-medium text-base">{tipo}</h3>
            {oferta.pedido_quantidade && (
              <div className="text-gray-600 text-sm mt-0.5">
                {oferta.pedido_quantidade} peças
              </div>
            )}
          </div>
          <div
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
              expirado
                ? 'bg-gray-100 text-gray-500'
                : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {expirado ? '⏱ Expirado' : `⏱ ${tempoRestante}`}
          </div>
        </div>

        {/* Detalhes */}
        <div className="space-y-2 text-sm mb-5">
          <div>
            <span className="text-gray-500">Estado:</span>{' '}
            <span className="text-gray-900">{oferta.pedido_estado}</span>
          </div>
          <div>
            <span className="text-gray-500">Prazo:</span>{' '}
            <span className="text-gray-900">{prazo}</span>
          </div>
          {oferta.pedido_descricao && oferta.pedido_descricao.trim() && (
            <div>
              <span className="text-gray-500">Detalhes:</span>{' '}
              <span className="text-gray-900">{oferta.pedido_descricao}</span>
            </div>
          )}
        </div>

        {/* Erro */}
        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2 mb-3">
            {erro}
          </div>
        )}

        {/* Botões */}
        {!expirado && (
          <div className="flex gap-2">
            <button
              onClick={() => setModalAberto(true)}
              disabled={enviando}
              className="flex-1 bg-emerald-500 text-white px-4 py-2.5 rounded-xl font-medium text-sm hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {enviando ? 'Enviando...' : 'Aceitar'}
            </button>
            <button
              onClick={recusar}
              disabled={enviando}
              className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Recusar
            </button>
          </div>
        )}

        {expirado && (
          <p className="text-gray-500 text-xs">
            Esta oferta expirou. Foi automaticamente encaminhada pra outro fornecedor.
          </p>
        )}
      </div>

      {/* Modal de confirmação */}
      {modalAberto && (
        <ModalAceitar
          tipo={tipo}
          quantidade={oferta.pedido_quantidade}
          estado={oferta.pedido_estado}
          enviando={enviando}
          onConfirmar={aceitar}
          onCancelar={() => setModalAberto(false)}
        />
      )}
    </>
  )
}

// ============================================================
// Subcomponente: linha de dado do cliente
// ============================================================
function Linha({
  rotulo,
  valor,
  link,
  linkLabel,
}: {
  rotulo: string
  valor: string
  link?: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="text-gray-500 text-xs">{rotulo}</div>
        <div className="text-gray-900 text-sm font-medium">{valor}</div>
      </div>
      {link && linkLabel && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-700 text-xs font-medium hover:text-emerald-800 underline"
        >
          {linkLabel} →
        </a>
      )}
    </div>
  )
}
