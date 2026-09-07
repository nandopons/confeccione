'use client'

// ============================================================================
// CAMPANHAS (aba "Campanhas") — o disparo manual/agendado pra um segmento da
// base. Fluxo: escolhe canal → escreve → filtra o público → vê a prévia →
// cria → dispara. O envio sai em lotes; enquanto sobrar gente aparece o botão
// "Continuar envio" (e o cron toca sozinho a cada 30 min).
// ============================================================================

import { useState } from 'react'
import type { Campanha, CanalCampanha } from '@/app/lib/campanhas-marketing'
import type { FiltroLeads } from '@/app/lib/leads-marketing'

type Segmento = { id: string; nome: string; filtro: FiltroLeads }

type Previa = {
  total: number
  semCanal: number
  amostra: Array<{ nome: string | null; empresa: string | null; cidade: string | null; uf: string | null; destino: string | null }>
  exemplo: string | null
  lote: number
}

const CANAL_LABEL: Record<CanalCampanha, string> = {
  whatsapp_template: 'WhatsApp oficial (template Meta)',
  whatsapp_zapi: 'WhatsApp Z-API (não oficial)',
  email: 'E-mail',
}

const STATUS_BADGE: Record<string, string> = {
  rascunho: 'bg-gray-100 text-gray-600',
  agendada: 'bg-blue-50 text-blue-700',
  enviando: 'bg-amber-50 text-amber-700',
  concluida: 'bg-[#E1F5EE] text-[#0F6E56]',
  cancelada: 'bg-red-50 text-red-600',
}

const CAMPO = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]'

function dataHoraBR(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default function Campanhas({
  campanhasIniciais,
  segmentosIniciais,
}: {
  campanhasIniciais: Campanha[]
  segmentosIniciais: Segmento[]
}) {
  const [campanhas, setCampanhas] = useState(campanhasIniciais)
  const [segmentos, setSegmentos] = useState(segmentosIniciais)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupada, setOcupada] = useState<string | null>(null)

  // ── formulário ──
  const [nome, setNome] = useState('')
  const [canal, setCanal] = useState<CanalCampanha>('email')
  const [assunto, setAssunto] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [template, setTemplate] = useState('')
  const [paramCorpo, setParamCorpo] = useState('#nome')
  const [botaoUrl, setBotaoUrl] = useState('')
  const [filtro, setFiltro] = useState<FiltroLeads>({})
  const [agendar, setAgendar] = useState('')
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function mudaFiltro(patch: Partial<FiltroLeads>) {
    setFiltro((f) => ({ ...f, ...patch }))
    setPrevia(null)
  }

  async function recarregar() {
    const r = await fetch('/api/admin/marketing/campanhas')
    const j = await r.json()
    if (r.ok) setCampanhas(j.campanhas as Campanha[])
  }

  async function verPrevia() {
    setErro(null)
    setCriando(true)
    try {
      const r = await fetch('/api/admin/marketing/campanhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'previa', canal, mensagem, filtro }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha na prévia')
      setPrevia(j.previa as Previa)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na prévia.')
    } finally {
      setCriando(false)
    }
  }

  async function criar() {
    setErro(null)
    setCriando(true)
    try {
      const r = await fetch('/api/admin/marketing/campanhas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'criar',
          nome,
          canal,
          mensagem,
          assunto: canal === 'email' ? assunto : undefined,
          template: canal === 'whatsapp_template' ? template.trim() : undefined,
          templateParams:
            canal === 'whatsapp_template'
              ? {
                  corpo: paramCorpo.split('|').map((p) => p.trim()).filter(Boolean),
                  botaoUrl: botaoUrl.trim() || undefined,
                }
              : undefined,
          filtro,
          agendadaPara: agendar ? new Date(agendar).toISOString() : undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não deu pra criar')
      setMsg(
        agendar
          ? 'Campanha agendada. O robô dispara na hora marcada.'
          : 'Campanha criada como rascunho. Clique em "Disparar" quando quiser mandar.'
      )
      setNome('')
      setMensagem('')
      setAssunto('')
      setPrevia(null)
      setAgendar('')
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar.')
    } finally {
      setCriando(false)
    }
  }

  async function acao(id: string, tipo: 'disparar' | 'continuar' | 'cancelar') {
    if (tipo === 'disparar' && !confirm('Confirmar o disparo? As mensagens começam a sair agora.')) return
    setOcupada(id)
    setMsg(null)
    try {
      const r = await fetch(`/api/admin/marketing/campanhas/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: tipo }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Falha na ação')
      if (j.lote) {
        const l = j.lote as { enviados: number; erros: number; pulados: number; restantes: number }
        setMsg(
          `Lote enviado: ${l.enviados} ok, ${l.erros} com erro, ${l.pulados} pulados. ` +
            (l.restantes > 0 ? `Faltam ${l.restantes} — clique em "Continuar envio".` : 'Campanha concluída.')
        )
      } else if (j.agendada) {
        setMsg(`Público congelado: ${j.total} leads. Sai na hora agendada.`)
      }
      await recarregar()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro na ação.')
    } finally {
      setOcupada(null)
    }
  }

  async function salvarSegmento() {
    const n = prompt('Nome do segmento (ex.: "Clientes de PE"):')
    if (!n) return
    await fetch('/api/admin/marketing/segmentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: n, filtro }),
    })
    const r = await fetch('/api/admin/marketing/segmentos')
    const j = await r.json()
    if (r.ok) setSegmentos(j.segmentos as Segmento[])
  }

  const podeCriar =
    nome.trim().length >= 3 &&
    (canal === 'whatsapp_template' ? template.trim().length > 0 : mensagem.trim().length >= 10) &&
    (canal !== 'email' || assunto.trim().length > 0)

  return (
    <div className="space-y-4">
      {/* ── Nova campanha ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Nova campanha</p>
          <p className="text-xs text-gray-500">
            Fala com um pedaço da base pra trazer gente de volta. Use{' '}
            <code className="bg-gray-100 px-1 rounded">#nome</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">#empresa</code> e{' '}
            <code className="bg-gray-100 px-1 rounded">#cidade</code> no texto.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            Nome da campanha (só você vê)
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} placeholder="Volta às aulas — uniformes" />
          </label>
          <label className="text-xs text-gray-500">
            Canal
            <select
              value={canal}
              onChange={(e) => { setCanal(e.target.value as CanalCampanha); setPrevia(null) }}
              className={CAMPO + ' bg-white'}
            >
              <option value="email">{CANAL_LABEL.email}</option>
              <option value="whatsapp_template">{CANAL_LABEL.whatsapp_template}</option>
              <option value="whatsapp_zapi">{CANAL_LABEL.whatsapp_zapi}</option>
            </select>
          </label>
        </div>

        {canal === 'email' && (
          <label className="text-xs text-gray-500 block">
            Assunto do e-mail
            <input value={assunto} onChange={(e) => setAssunto(e.target.value)} className={CAMPO} placeholder="#nome, sua próxima produção sai em 15 dias" />
          </label>
        )}

        {canal === 'whatsapp_template' && (
          <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3 space-y-3">
            <p className="text-[11px] text-amber-800">
              O WhatsApp oficial só deixa iniciar conversa com template aprovado na Meta. Crie o template no Gerenciador
              do WhatsApp, espere aprovar, e coloque o nome exato aqui. Template de marketing é pago (~R$0,31 por
              mensagem).
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs text-gray-500">
                Nome do template aprovado
                <input value={template} onChange={(e) => setTemplate(e.target.value)} className={CAMPO} placeholder="novidade_colecao_v1" />
              </label>
              <label className="text-xs text-gray-500">
                Variáveis do corpo (separadas por |)
                <input value={paramCorpo} onChange={(e) => setParamCorpo(e.target.value)} className={CAMPO} placeholder="#nome | #cidade" />
              </label>
              <label className="text-xs text-gray-500 sm:col-span-2">
                Sufixo do botão de URL (opcional)
                <input value={botaoUrl} onChange={(e) => setBotaoUrl(e.target.value)} className={CAMPO} placeholder="?utm_source=whatsapp&utm_campaign=novidade" />
              </label>
            </div>
          </div>
        )}

        <label className="text-xs text-gray-500 block">
          {canal === 'whatsapp_template' ? 'Cópia do texto do template (só pro histórico)' : 'Mensagem'}
          <textarea
            value={mensagem}
            onChange={(e) => { setMensagem(e.target.value); setPrevia(null) }}
            rows={4}
            className={CAMPO + ' resize-y'}
            placeholder="Oi, #nome! Chegou a grade nova de malha pra produção nacional. Se quiser fechar um lote esse mês, é só responder aqui que eu te mando o orçamento."
          />
        </label>

        {/* Público */}
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Quem recebe</p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filtro.origem ?? 'todas'}
              onChange={(e) => mudaFiltro({ origem: e.target.value as FiltroLeads['origem'] })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
            >
              <option value="todas">Todas as origens</option>
              <option value="chat">Veio do chat</option>
              <option value="conta">Criou conta</option>
              <option value="manual">Cadastro manual</option>
              <option value="importacao">Importado</option>
            </select>
            <select
              value={filtro.status ?? 'todos'}
              onChange={(e) => mudaFiltro({ status: e.target.value as FiltroLeads['status'] })}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white"
            >
              <option value="todos">Clientes e leads</option>
              <option value="cliente">Só quem já comprou (recompra)</option>
              <option value="lead">Só quem ainda não comprou</option>
            </select>
            <input
              value={filtro.uf ?? ''}
              onChange={(e) => mudaFiltro({ uf: e.target.value.toUpperCase().slice(0, 2) })}
              placeholder="UF"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-16 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
            />
            <input
              value={filtro.tag ?? ''}
              onChange={(e) => mudaFiltro({ tag: e.target.value })}
              placeholder="tag"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm w-28 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
            />
            <input
              value={filtro.busca ?? ''}
              onChange={(e) => mudaFiltro({ busca: e.target.value })}
              placeholder="Buscar…"
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-[120px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
            />
            <button type="button" onClick={() => void salvarSegmento()} className="text-xs text-gray-500 hover:text-gray-700 underline">
              salvar segmento
            </button>
          </div>

          {segmentos.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-[11px] text-gray-400">salvos:</span>
              {segmentos.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setFiltro(s.filtro); setPrevia(null) }}
                  className="text-[11px] border border-gray-200 rounded-full px-2.5 py-1 text-gray-600 hover:bg-gray-50"
                >
                  {s.nome}
                </button>
              ))}
            </div>
          )}
        </div>

        {previa && (
          <div className="border border-[#1D9E75]/30 bg-[#E1F5EE]/40 rounded-lg p-3">
            <p className="text-xs text-gray-700">
              Alcança <strong>{previa.total}</strong> {previa.total === 1 ? 'lead' : 'leads'}
              {previa.semCanal > 0 && <> · {previa.semCanal} ficam de fora por não ter {canal === 'email' ? 'e-mail' : 'WhatsApp'}</>}
              {previa.total > previa.lote && <> · sai em lotes de {previa.lote}</>}
            </p>
            {previa.amostra.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                Ex.: {previa.amostra.map((a) => a.nome ?? a.destino ?? 'sem nome').join(', ')}
                {previa.total > previa.amostra.length ? '…' : ''}
              </p>
            )}
            {previa.exemplo && (
              <p className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-2.5 py-2 mt-2 whitespace-pre-wrap">
                {previa.exemplo}
              </p>
            )}
          </div>
        )}

        {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void verPrevia()}
            disabled={criando}
            className="border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            Ver quem recebe
          </button>
          <label className="text-xs text-gray-500 flex items-center gap-2">
            Agendar para
            <input
              type="datetime-local"
              value={agendar}
              onChange={(e) => setAgendar(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void criar()}
            disabled={criando || !podeCriar}
            className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 ml-auto"
          >
            {criando ? 'Salvando…' : agendar ? 'Agendar campanha' : 'Criar campanha'}
          </button>
        </div>
      </div>

      {/* ── Histórico ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-900 mb-3">Campanhas</p>
        {msg && <p className="text-xs text-[#0F6E56] bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg px-3 py-2 mb-3">{msg}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-3 font-semibold">Campanha</th>
                <th className="py-2 pr-3 font-semibold">Canal</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Envios</th>
                <th className="py-2 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-gray-900">{c.nome}</p>
                    <p className="text-[11px] text-gray-400">
                      criada {dataHoraBR(c.criadoEm)}
                      {c.agendadaPara ? ` · agendada ${dataHoraBR(c.agendadaPara)}` : ''}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-500">{CANAL_LABEL[c.canal]}</td>
                  <td className="py-2.5 pr-3">
                    <span className={'text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap ' + (STATUS_BADGE[c.status] ?? '')}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">
                    {c.enviados}/{c.totalAlvo || '—'}
                    {c.erros > 0 && <span className="text-red-500"> · {c.erros} erro(s)</span>}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {(c.status === 'rascunho' || c.status === 'agendada') && (
                      <button
                        type="button"
                        onClick={() => void acao(c.id, 'disparar')}
                        disabled={ocupada === c.id}
                        className="text-xs bg-[#1D9E75] hover:bg-[#178A65] text-white px-3 py-1.5 rounded-lg disabled:opacity-50 mr-2"
                      >
                        {ocupada === c.id ? 'Enviando…' : 'Disparar'}
                      </button>
                    )}
                    {c.status === 'enviando' && (
                      <button
                        type="button"
                        onClick={() => void acao(c.id, 'continuar')}
                        disabled={ocupada === c.id}
                        className="text-xs border border-[#1D9E75]/40 text-[#0F6E56] hover:bg-[#E1F5EE]/50 px-3 py-1.5 rounded-lg disabled:opacity-50 mr-2"
                      >
                        {ocupada === c.id ? 'Enviando…' : 'Continuar envio'}
                      </button>
                    )}
                    {c.status !== 'concluida' && c.status !== 'cancelada' && (
                      <button
                        type="button"
                        onClick={() => void acao(c.id, 'cancelar')}
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                      >
                        cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {campanhas.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">Nenhuma campanha ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
