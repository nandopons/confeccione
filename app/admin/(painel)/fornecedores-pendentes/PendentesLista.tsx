'use client'

import { useState } from 'react'

export type FornecedorPendente = {
  id: string
  nome: string | null
  whatsapp: string | null
  email: string | null
  tipos_produto: string[] | null
  descricao_livre: string | null
  pedido_minimo: number | null
  estado: string | null
  cidade: string | null
  raio_atendimento: string | null
  cpf_cnpj: string | null
  criado_em: string | null
}

function dataBR(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function PendentesLista({ inicial }: { inicial: FornecedorPendente[] }) {
  const [lista, setLista] = useState(inicial)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function agir(id: string, acao: 'aprovar' | 'reprovar') {
    setErro(null)
    let motivo: string | undefined
    if (acao === 'reprovar') {
      const m = window.prompt('Motivo da reprovação (opcional, só interno):') ?? ''
      motivo = m.trim() || undefined
    } else if (!window.confirm('Aprovar este fornecedor? Ele será avisado e passará a receber pedidos.')) {
      return
    }
    setOcupado(id)
    try {
      const r = await fetch(`/api/admin/fornecedores/${id}/${acao}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || 'Falha na ação')
      setLista((l) => l.filter((f) => f.id !== id))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setOcupado(null)
    }
  }

  if (lista.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Nenhum fornecedor aguardando aprovação. 🎉
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}
      {lista.map((f) => (
        <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-4 sm:flex sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{f.nome || 'Sem nome'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">pendente</span>
              <span className="text-xs text-gray-400">cadastrou {dataBR(f.criado_em)}</span>
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {[f.whatsapp, f.email].filter(Boolean).join(' · ') || 'sem contato'}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">
              {[f.cidade, f.estado].filter(Boolean).join('/') || 'local n/d'}
              {f.raio_atendimento ? ` · atende ${f.raio_atendimento}` : ''}
              {f.pedido_minimo != null ? ` · mín. ${f.pedido_minimo} pç` : ''}
              {f.cpf_cnpj ? ` · doc ${f.cpf_cnpj}` : ''}
            </div>
            {f.tipos_produto && f.tipos_produto.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {f.tipos_produto.map((t) => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{t}</span>
                ))}
              </div>
            )}
            {f.descricao_livre && <p className="text-sm text-gray-500 mt-2 whitespace-pre-wrap">{f.descricao_livre}</p>}
          </div>
          <div className="flex gap-2 mt-3 sm:mt-0 shrink-0">
            <button
              type="button"
              onClick={() => void agir(f.id, 'aprovar')}
              disabled={ocupado === f.id}
              className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {ocupado === f.id ? '…' : 'Aprovar'}
            </button>
            <button
              type="button"
              onClick={() => void agir(f.id, 'reprovar')}
              disabled={ocupado === f.id}
              className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              Reprovar
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
