'use client'

import { useState } from 'react'

type Item = {
  ofertaId: string
  pedidoId: string
  valorCentavos: number | null
  repasseStatus: 'a_receber' | 'pago'
  criadoEm: string
  totalPecas: number
  resumo: string
}
type Carteira = { saldoAReceberCentavos: number; totalRecebidoCentavos: number; itens: Item[] }
type Dados = {
  pix_chave: string | null
  pix_tipo: string | null
  banco_nome: string | null
  banco_agencia: string | null
  banco_conta: string | null
  banco_titular: string | null
}

function brl(c: number | null | undefined) {
  if (c == null) return '—'
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function data(s: string) { try { return new Date(s).toLocaleDateString('pt-BR') } catch { return s } }

export default function CarteiraCliente({ carteira, dados }: { carteira: Carteira; dados: Dados }) {
  const [form, setForm] = useState<Dados>(dados)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function set<K extends keyof Dados>(k: K, v: string) {
    setForm((p) => ({ ...p, [k]: v }))
  }

  async function salvar() {
    setSalvando(true); setMsg(null)
    try {
      const r = await fetch('/api/fornecedor/carteira/dados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pix_chave: form.pix_chave ?? '',
          pix_tipo: (form.pix_tipo ?? '') as string,
          banco_nome: form.banco_nome ?? '',
          banco_agencia: form.banco_agencia ?? '',
          banco_conta: form.banco_conta ?? '',
          banco_titular: form.banco_titular ?? '',
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha')
      setMsg('Dados salvos!')
    } catch (e: any) {
      setMsg(e.message || 'Erro')
    } finally {
      setSalvando(false)
    }
  }

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="space-y-6">
      {/* Saldo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-5">
          <div className="text-xs text-emerald-700 font-medium uppercase tracking-wide">A receber</div>
          <div className="text-2xl font-bold text-emerald-800 mt-1">{brl(carteira.saldoAReceberCentavos)}</div>
        </div>
        <div className="rounded-2xl bg-gray-50 border border-gray-100 p-5">
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Já recebido</div>
          <div className="text-2xl font-bold text-gray-800 mt-1">{brl(carteira.totalRecebidoCentavos)}</div>
        </div>
      </div>

      {/* Extrato */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Extrato</h2>
        {carteira.itens.length === 0 && <div className="text-sm text-gray-400 py-6 text-center">Sem lançamentos ainda.</div>}
        <div className="space-y-2">
          {carteira.itens.map((it) => (
            <div key={it.ofertaId} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3">
              <div>
                <div className="text-sm text-gray-900 font-medium">{it.totalPecas} peças</div>
                <div className="text-xs text-gray-400">{data(it.criadoEm)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-900">{brl(it.valorCentavos)}</div>
                <div className={'text-xs ' + (it.repasseStatus === 'pago' ? 'text-green-600' : 'text-amber-600')}>
                  {it.repasseStatus === 'pago' ? 'pago' : 'a receber'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dados de repasse */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Dados pra repasse</h2>
        <p className="text-xs text-gray-400 mb-4">É pra cá que a Confeccione envia o valor dos pedidos que você produz. O frete é cobrado à parte.</p>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1">
              <label className="text-xs text-gray-500">Tipo de chave PIX</label>
              <select className={input} value={form.pix_tipo ?? ''} onChange={(e) => set('pix_tipo', e.target.value)}>
                <option value="">—</option>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="telefone">Telefone</option>
                <option value="aleatoria">Aleatória</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Chave PIX</label>
              <input className={input} value={form.pix_chave ?? ''} onChange={(e) => set('pix_chave', e.target.value)} />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <div className="text-xs text-gray-400 mb-2">Ou conta bancária (opcional)</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Banco</label>
                <input className={input} value={form.banco_nome ?? ''} onChange={(e) => set('banco_nome', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Titular</label>
                <input className={input} value={form.banco_titular ?? ''} onChange={(e) => set('banco_titular', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Agência</label>
                <input className={input} value={form.banco_agencia ?? ''} onChange={(e) => set('banco_agencia', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500">Conta</label>
                <input className={input} value={form.banco_conta ?? ''} onChange={(e) => set('banco_conta', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={salvar} disabled={salvando} className="text-sm px-4 py-2 rounded-lg bg-gray-900 text-white disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar dados'}
            </button>
            {msg && <span className="text-sm text-gray-500">{msg}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
