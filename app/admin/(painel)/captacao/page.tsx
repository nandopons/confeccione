'use client'

// app/admin/(painel)/captacao/page.tsx
//
// Aba "Captação" do painel admin (Tailwind, casando com o resto do painel).
// Auth coberta pelo layout (painel) via eAdminLogado() + a route /api/admin/captacao.
// - Modo individual: nome / email / whatsapp / segmento / canais
// - Modo lote: cola linhas "nome, email, whatsapp" + segmento aplicado a todos
// - Tabela: status de cada contato na cadência

import { useEffect, useState } from 'react'

const SEGMENTOS = [
  { id: 'moda_praia', nome: 'Moda Praia' },
  { id: 'private_label', nome: 'Private Label' },
  { id: 'fitness', nome: 'Fitness' },
  { id: 'interclasse', nome: 'Interclasse / Eventos' },
  { id: 'moda_intima', nome: 'Moda Íntima' },
  { id: 'fardamento', nome: 'Fardamento' },
  { id: 'padrao_esportivo', nome: 'Padrão Esportivo' },
  { id: 'roupas_uv', nome: 'Roupas UV' },
  { id: 'bolsas', nome: 'Bolsas' },
  { id: 'bones', nome: 'Bonés' },
]

const STATUS_LABEL: Record<string, string> = {
  ativo: 'Em cadência',
  convertido: 'Cadastrado ✓',
  esgotado: 'Cadência encerrada',
  pausado: 'Pausado',
  erro: 'Erro',
}

type Entrada = { nome?: string; email?: string; whatsapp?: string }

type ResultadoLinha = {
  ok: boolean
  motivo?: string
  contato?: Entrada
  email?: boolean | null
  whatsapp?: boolean | null
}

type ContatoRow = {
  id: string
  nome: string | null
  email: string | null
  whatsapp: string | null
  segmento: string
  etapa: number
  status: string
  proximo_envio_em: string | null
}

export default function CaptacaoPage() {
  const [modo, setModo] = useState<'individual' | 'lote'>('individual')
  const [segmento, setSegmento] = useState('moda_praia')
  const [canalEmail, setCanalEmail] = useState(true)
  const [canalWhatsapp, setCanalWhatsapp] = useState(false)

  // individual
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')

  // lote
  const [textoLote, setTextoLote] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoLinha[] | null>(null)
  const [lista, setLista] = useState<ContatoRow[]>([])

  async function carregar() {
    const r = await fetch('/api/admin/captacao')
    if (r.ok) {
      const j = await r.json()
      setLista(j.dados ?? [])
    }
  }
  useEffect(() => {
    carregar()
  }, [])

  function parseLote(): Entrada[] {
    return textoLote
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((linha) => {
        const partes = linha.split(/[,;\t]/).map((p) => p.trim())
        // heurística: o que tem @ é email; o que tem muitos dígitos é whatsapp; resto é nome
        const email = partes.find((p) => p.includes('@'))
        const whatsapp = partes.find((p) => /\d{8,}/.test(p.replace(/\D/g, '')))
        const nome = partes.find((p) => p !== email && p !== whatsapp)
        return { nome, email, whatsapp }
      })
  }

  async function enviar() {
    setEnviando(true)
    setResultado(null)
    const contatos = modo === 'individual' ? [{ nome, email, whatsapp }] : parseLote()

    const r = await fetch('/api/admin/captacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segmento,
        canal_email: canalEmail,
        canal_whatsapp: canalWhatsapp,
        contatos,
      }),
    })
    const j = await r.json()
    setResultado(j.resultados ?? [{ ok: false, motivo: j.erro }])
    setEnviando(false)
    setNome('')
    setEmail('')
    setWhatsapp('')
    setTextoLote('')
    await carregar()
  }

  const btnModo = (ativo: boolean) =>
    'px-4 py-2 rounded-md border text-sm font-medium transition-colors ' +
    (ativo
      ? 'bg-gray-900 text-white border-gray-900'
      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100')

  const inputCls =
    'w-full px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-900/10'

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Captação de fornecedores
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Convide fornecedores garimpados a se cadastrar. Convite na hora, follow-ups
        automáticos (dias 5, 12 e 21).
      </p>

      {/* seletor de modo */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setModo('individual')} className={btnModo(modo === 'individual')}>
          Um contato
        </button>
        <button onClick={() => setModo('lote')} className={btnModo(modo === 'lote')}>
          Lote (colar lista)
        </button>
      </div>

      {/* segmento + canais */}
      <div className="flex gap-4 flex-wrap items-center mb-4">
        <label className="text-sm text-gray-700">
          Segmento:{' '}
          <select
            value={segmento}
            onChange={(e) => setSegmento(e.target.value)}
            className="ml-1 px-2 py-1.5 rounded-md border border-gray-300 text-sm text-gray-900"
          >
            {SEGMENTOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={canalEmail} onChange={(e) => setCanalEmail(e.target.checked)} />
          E-mail
        </label>
        <label
          className="flex items-center gap-1.5 text-sm text-gray-700"
          title="Cuidado: disparo frio por WhatsApp aumenta risco de bloqueio do número"
        >
          <input type="checkbox" checked={canalWhatsapp} onChange={(e) => setCanalWhatsapp(e.target.checked)} />
          WhatsApp
        </label>
      </div>

      {/* entrada */}
      {modo === 'individual' ? (
        <div className="grid gap-2 mb-4">
          <input
            placeholder="Nome (opcional)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputCls}
          />
          <input
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
          />
          <input
            placeholder="WhatsApp (ex: 5581999999999)"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            className={inputCls}
          />
        </div>
      ) : (
        <div className="mb-4">
          <textarea
            value={textoLote}
            onChange={(e) => setTextoLote(e.target.value)}
            placeholder={
              'Uma linha por contato:\nNome, email@x.com, 5581999999999\nOutro, outro@y.com, 5581988888888'
            }
            rows={8}
            className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-900 placeholder:text-gray-500 font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            Separadores aceitos: vírgula, ponto-e-vírgula ou tab.
          </p>
        </div>
      )}

      <button
        onClick={enviar}
        disabled={enviando}
        className="px-6 py-2.5 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Enviar convite'}
      </button>

      {/* resultado do disparo */}
      {resultado && (
        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-md">
          {resultado.map((r, i) => (
            <div key={i} className="text-sm text-gray-700">
              {r.ok ? '✓' : '✗'} {r.contato?.email || r.contato?.whatsapp || '—'}
              {r.motivo ? ` — ${r.motivo}` : ''}
            </div>
          ))}
        </div>
      )}

      {/* tabela de status */}
      <h2 className="text-lg font-semibold text-gray-900 mt-8 mb-3">
        Contatos em captação
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b-2 border-gray-200 text-gray-600">
              <th className="p-2 font-medium">Contato</th>
              <th className="p-2 font-medium">Segmento</th>
              <th className="p-2 font-medium">Etapa</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium">Próximo toque</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="p-2 text-gray-900">{c.nome || c.email || c.whatsapp}</td>
                <td className="p-2 text-gray-700">
                  {SEGMENTOS.find((s) => s.id === c.segmento)?.nome ?? c.segmento}
                </td>
                <td className="p-2 text-gray-700">{c.etapa}/3</td>
                <td className="p-2 text-gray-700">{STATUS_LABEL[c.status] ?? c.status}</td>
                <td className="p-2 text-gray-700">
                  {c.proximo_envio_em
                    ? new Date(c.proximo_envio_em).toLocaleDateString('pt-BR')
                    : '—'}
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-400">
                  Nenhum contato em captação ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
