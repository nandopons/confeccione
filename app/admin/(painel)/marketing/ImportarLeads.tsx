'use client'

// ============================================================================
// IMPORTAÇÃO DE CSV em 3 passos:
//   1. escolher o arquivo  → o servidor lê o cabeçalho e sugere o mapeamento
//   2. conferir o mapeamento coluna → campo, e ver a prévia (novos/repetidos)
//   3. importar de fato (dedupe por WhatsApp/e-mail)
// O arquivo é lido no navegador e mandado como texto; nada fica salvo em disco.
// ============================================================================

import { useState } from 'react'
import type { CampoLead } from '@/app/lib/leads-marketing'
import { Modal } from './BaseLeads'

// Lista local (não importa do lib server-side: isso puxaria o cliente Supabase
// pro bundle do navegador). Precisa espelhar CAMPOS_LEAD de leads-marketing.ts.
const CAMPOS_LEAD: Array<{ campo: CampoLead; label: string }> = [
  { campo: 'nome', label: 'Nome' },
  { campo: 'empresa', label: 'Empresa' },
  { campo: 'telefone', label: 'WhatsApp / telefone' },
  { campo: 'email', label: 'E-mail' },
  { campo: 'cidade', label: 'Cidade' },
  { campo: 'uf', label: 'UF' },
  { campo: 'observacao', label: 'Observação' },
  { campo: 'ignorar', label: '— não importar —' },
]

type Previa = {
  totalLinhas: number
  validos: number
  invalidos: number
  novos: number
  jaExistem: number
  amostra: Array<{ nome?: string; telefone?: string; email?: string; situacao: string; motivo?: string }>
}

export default function ImportarLeads({
  onFechar,
  onImportado,
}: {
  onFechar: () => void
  onImportado: (resumo: string) => void
}) {
  const [csv, setCsv] = useState<string | null>(null)
  const [arquivo, setArquivo] = useState<string>('')
  const [cabecalho, setCabecalho] = useState<string[]>([])
  const [mapa, setMapa] = useState<CampoLead[]>([])
  const [exemplo, setExemplo] = useState<string[][]>([])
  const [totalLinhas, setTotalLinhas] = useState(0)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [etiqueta, setEtiqueta] = useState('')
  const [tags, setTags] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function escolherArquivo(file: File) {
    setErro(null)
    setOcupado(true)
    try {
      const texto = await file.text()
      setCsv(texto)
      setArquivo(file.name)
      const r = await fetch('/api/admin/marketing/leads/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'ler', csv: texto }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não deu pra ler o arquivo')
      setCabecalho(j.cabecalho as string[])
      setMapa(j.mapa as CampoLead[])
      setExemplo(j.exemplo as string[][])
      setTotalLinhas(j.totalLinhas as number)
      setPrevia(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao ler o arquivo.')
    } finally {
      setOcupado(false)
    }
  }

  async function verPrevia() {
    if (!csv) return
    setOcupado(true)
    setErro(null)
    try {
      const r = await fetch('/api/admin/marketing/leads/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'previa', csv, mapa }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha na prévia')
      setPrevia(j.previa as Previa)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na prévia.')
    } finally {
      setOcupado(false)
    }
  }

  async function importar() {
    if (!csv) return
    setOcupado(true)
    setErro(null)
    try {
      const r = await fetch('/api/admin/marketing/leads/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'importar',
          csv,
          mapa,
          etiqueta: etiqueta.trim() || undefined,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha ao importar')
      const res = j.resultado as { criados: number; atualizados: number; invalidos: number }
      onImportado(
        `Importação concluída: ${res.criados} novos, ${res.atualizados} já existiam e foram completados, ${res.invalidos} descartados (sem contato válido).`
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao importar.')
      setOcupado(false)
    }
  }

  const temContato = mapa.includes('telefone') || mapa.includes('email')

  return (
    <Modal titulo="Importar leads de um CSV" onFechar={onFechar}>
      {/* Passo 1 */}
      {!csv && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            Exporte sua base como CSV (o Excel e o Google Planilhas fazem isso em Arquivo → Baixar). Aceita separador
            ponto e vírgula, vírgula ou tabulação — e não importa a ordem das colunas, você escolhe o que é o quê no
            passo seguinte.
          </p>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void escolherArquivo(f)
            }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#E1F5EE] file:text-[#0F6E56] hover:file:bg-[#d3efe5]"
          />
        </div>
      )}

      {/* Passo 2 */}
      {csv && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            <strong className="text-gray-700">{arquivo}</strong> · {totalLinhas} linhas · {cabecalho.length} colunas
          </p>

          <div>
            <p className="text-sm font-semibold text-gray-900 mb-2">O que é cada coluna?</p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {cabecalho.map((col, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{col || `(coluna ${i + 1})`}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      ex.: {exemplo.map((l) => l[i]).filter(Boolean).slice(0, 2).join(' · ') || '—'}
                    </p>
                  </div>
                  <select
                    value={mapa[i] ?? 'ignorar'}
                    onChange={(e) => {
                      const novo = [...mapa]
                      novo[i] = e.target.value as CampoLead
                      setMapa(novo)
                      setPrevia(null)
                    }}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white w-52 shrink-0"
                  >
                    {CAMPOS_LEAD.map((c) => (
                      <option key={c.campo} value={c.campo}>{c.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {!temContato && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Marque pelo menos uma coluna como WhatsApp ou E-mail — sem contato o lead não entra.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">
              Etiqueta da importação
              <input
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
                placeholder="base-antiga-2025"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
              />
            </label>
            <label className="text-xs text-gray-500">
              Tags pra todos (vírgula)
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="uniformes, atacado"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
              />
            </label>
          </div>

          {/* Passo 3 */}
          {previa && (
            <div className="border border-[#1D9E75]/30 bg-[#E1F5EE]/40 rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-700">
                <strong>{previa.novos}</strong> entram como novos · <strong>{previa.jaExistem}</strong> já estão na base
                (serão completados) · <strong>{previa.invalidos}</strong> descartados por não ter contato válido.
              </p>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <tbody>
                    {previa.amostra.map((a, i) => (
                      <tr key={i} className="border-b border-white/60">
                        <td className="py-1 pr-2 text-gray-700">{a.nome || '—'}</td>
                        <td className="py-1 pr-2 text-gray-500">{a.telefone || a.email || '—'}</td>
                        <td className="py-1 text-gray-400">{a.motivo ?? 'novo'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}

          <div className="flex gap-2 flex-wrap">
            {!previa ? (
              <button
                type="button"
                onClick={() => void verPrevia()}
                disabled={ocupado || !temContato}
                className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {ocupado ? 'Conferindo…' : 'Conferir antes de importar'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void importar()}
                disabled={ocupado || previa.novos + previa.jaExistem === 0}
                className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {ocupado ? 'Importando…' : `Importar ${previa.novos + previa.jaExistem} contatos`}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCsv(null)
                setPrevia(null)
                setCabecalho([])
              }}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Trocar arquivo
            </button>
          </div>
        </div>
      )}

      {erro && !csv && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">{erro}</p>}
    </Modal>
  )
}
