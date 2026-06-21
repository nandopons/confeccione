'use client'
// Lista (admin) das coletas + inscritos, agrupadas por pedido. Export CSV.
import { useMemo, useState } from 'react'

export type InscritoAdmin = {
  id: string
  nome: string
  tamanho: string
  numero: string | null
  observacao: string | null
  whatsapp: string | null
  email: string | null
}
export type ListaAdmin = {
  id: string
  pedido_id: string
  pedido_codigo: string | null
  organizador: string | null
  modelo: string
  token: string
  ativa: boolean
  criado_em: string
  inscritos: InscritoAdmin[]
}

function csvEscape(v: string): string {
  if (/[",\n;]/.test(v)) return '"' + v.replace(/"/g, '""') + '"'
  return v
}
function baixarCsv(lista: ListaAdmin) {
  const head = ['Nome', 'Tamanho', 'Numero', 'Observacao', 'WhatsApp', 'Email']
  const linhas = lista.inscritos.map((p) => [p.nome, p.tamanho, p.numero ?? '', p.observacao ?? '', p.whatsapp ?? '', p.email ?? ''])
  const csv = [head, ...linhas].map((r) => r.map((c) => csvEscape(String(c))).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `coleta-${lista.pedido_codigo || lista.pedido_id.slice(0, 8)}-${lista.modelo.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ListasExternasAdmin({ listas }: { listas: ListaAdmin[] }) {
  const [aberto, setAberto] = useState<Record<string, boolean>>({})
  const totalInscritos = useMemo(() => listas.reduce((a, l) => a + l.inscritos.length, 0), [listas])

  if (listas.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
        <p className="text-gray-500 text-sm">Nenhuma lista de coleta criada ainda.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">{listas.length} lista{listas.length === 1 ? '' : 's'} · {totalInscritos} inscrito{totalInscritos === 1 ? '' : 's'} no total</p>
      <div className="space-y-3">
        {listas.map((l) => {
          const expandido = aberto[l.id]
          return (
            <div key={l.id} className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 capitalize">{l.modelo}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {l.pedido_codigo ? `Pedido nº ${l.pedido_codigo}` : 'Pedido'}{l.organizador ? ` · ${l.organizador}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={'text-[11px] px-2 py-0.5 rounded-full ' + (l.ativa ? 'bg-[#E1F5EE] text-[#0F6E56]' : 'bg-gray-100 text-gray-500')}>{l.ativa ? 'aberta' : 'fechada'}</span>
                  <span className="text-xs font-medium text-gray-700 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">{l.inscritos.length} inscrito{l.inscritos.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={`/inscricao/${l.token}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0F6E56] border border-[#1D9E75]/40 hover:bg-[#E1F5EE] px-2.5 py-1.5 rounded-lg">Abrir link público ↗</a>
                <a href={`/visualizador/${l.pedido_id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg">Ver pedido ↗</a>
                {l.inscritos.length > 0 && (
                  <>
                    <button type="button" onClick={() => setAberto((p) => ({ ...p, [l.id]: !p[l.id] }))} className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg">{expandido ? 'Ocultar' : 'Ver'} inscritos</button>
                    <button type="button" onClick={() => baixarCsv(l)} className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 px-2.5 py-1.5 rounded-lg">⬇️ CSV</button>
                  </>
                )}
              </div>

              {expandido && l.inscritos.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                        <th className="py-1.5 pr-3 font-medium">Nome</th>
                        <th className="py-1.5 pr-3 font-medium">Tam.</th>
                        <th className="py-1.5 pr-3 font-medium">Nº</th>
                        <th className="py-1.5 pr-3 font-medium">Obs.</th>
                        <th className="py-1.5 pr-3 font-medium">WhatsApp</th>
                        <th className="py-1.5 font-medium">E-mail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {l.inscritos.map((p) => (
                        <tr key={p.id} className="text-gray-700">
                          <td className="py-1.5 pr-3">{p.nome}</td>
                          <td className="py-1.5 pr-3 font-medium text-[#0F6E56]">{p.tamanho}</td>
                          <td className="py-1.5 pr-3">{p.numero ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{p.observacao ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{p.whatsapp ?? '—'}</td>
                          <td className="py-1.5 text-gray-500">{p.email ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
