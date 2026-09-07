'use client'

// ============================================================================
// TEMPLATES (aba "Templates") — a biblioteca de conteúdo, em três sub-abas:
//   E-mails      assunto + corpo, enviados pelo Resend
//   WhatsApp     template aprovado na Meta (ou texto puro via Z-API)
//   Mala Direta  peça física (panfleto, catálogo, carta): arte, formato, peso
//                e custo. Ainda sem integração com os Correios — por ora é
//                cadastro + a lista de endereços que sai da Base de leads.
//
// É daqui que a aba Automação puxa o conteúdo de cada passo do fluxo.
// ============================================================================

import { useState } from 'react'
import type { CanalEnvio } from '@/app/lib/envio-marketing'
import type { FormatoPeca, StatusTemplate, TemplateMarketing } from '@/app/lib/templates-marketing'
import type { Bloco } from '@/app/lib/email-blocos'
import { Modal } from './BaseLeads'
import EditorBlocos from './EditorBlocos'

const SUBABAS: Array<{ canal: CanalEnvio; label: string; explica: string }> = [
  {
    canal: 'email',
    label: 'E-mails',
    explica:
      'Sai pelo Resend, do contato@confeccione.com.br. Todo e-mail leva link de descadastro no rodapé — quem clica sai automaticamente das campanhas e dos fluxos.',
  },
  {
    canal: 'whatsapp',
    label: 'WhatsApp',
    explica:
      'Pra iniciar conversa fora da janela de 24h o WhatsApp exige template aprovado na Meta. Crie no Gerenciador, espere aprovar e cadastre o nome exato aqui. Template de marketing é pago (~R$0,31 por mensagem).',
  },
  {
    canal: 'mala_direta',
    label: 'Mala Direta',
    explica:
      'Peça física: panfleto, catálogo, carta. Aqui você cadastra a arte, o formato, o peso e o custo unitário — a base de leads já guarda CEP e endereço completo. O envio ainda é manual: exporte a lista pela aba Base de leads e leve aos Correios.',
  },
]

const FORMATOS: Array<[FormatoPeca, string]> = [
  ['panfleto', 'Panfleto / flyer'],
  ['catalogo', 'Catálogo'],
  ['carta', 'Carta'],
  ['cartao_postal', 'Cartão postal'],
  ['brinde', 'Brinde / amostra'],
]

const STATUS_BADGE: Record<StatusTemplate, string> = {
  rascunho: 'bg-gray-100 text-gray-600',
  ativo: 'bg-[#E1F5EE] text-[#0F6E56]',
  arquivado: 'bg-red-50 text-red-500',
}

const CAMPO =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]'

function brl(c: number | null): string {
  return c == null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Espelha pendenciaDoTemplate do lib — a tela avisa antes de você usar o template num fluxo. */
function pendencia(t: TemplateMarketing): string | null {
  if (t.canal === 'email') {
    if (!t.assunto?.trim()) return 'Falta o assunto'
    if (t.formatoEmail === 'blocos') {
      if (t.blocos.length === 0) return 'E-mail sem blocos'
      const temTexto = t.blocos.some((b) => (b.tipo === 'texto' || b.tipo === 'titulo') && b.texto.trim())
      if (!temTexto) return 'Falta texto — e-mail só com imagem cai em spam'
      return null
    }
    if (t.corpo.trim().length < 20) return 'Corpo muito curto'
    return null
  }
  if (t.canal === 'whatsapp') {
    if (t.usaTemplateOficial && !t.templateMeta?.trim()) return 'Falta o template aprovado na Meta'
    if (!t.usaTemplateOficial && t.corpo.trim().length < 10) return 'Falta o texto'
    return null
  }
  if (!t.formato) return 'Falta o formato da peça'
  if (!t.arteUrl?.trim()) return 'Falta o link da arte'
  return null
}

export default function Templates({ iniciais }: { iniciais: TemplateMarketing[] }) {
  const [canal, setCanal] = useState<CanalEnvio>('email')
  const [templates, setTemplates] = useState(iniciais)
  const [editando, setEditando] = useState<TemplateMarketing | 'novo' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const daAba = templates.filter((t) => t.canal === canal)
  const aba = SUBABAS.find((s) => s.canal === canal)!

  async function recarregar() {
    const r = await fetch('/api/admin/marketing/templates')
    const j = await r.json()
    if (r.ok) setTemplates(j.templates as TemplateMarketing[])
  }

  async function excluir(t: TemplateMarketing) {
    if (!confirm(`Excluir o template "${t.nome}"?`)) return
    const r = await fetch(`/api/admin/marketing/templates/${t.id}`, { method: 'DELETE' })
    const j = await r.json()
    if (!r.ok) {
      setMsg(j.erro as string)
      return
    }
    setMsg(null)
    await recarregar()
  }

  async function alternarStatus(t: TemplateMarketing) {
    await fetch(`/api/admin/marketing/templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: t.status === 'ativo' ? 'rascunho' : 'ativo' }),
    })
    await recarregar()
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        {/* Sub-abas */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {SUBABAS.map((s) => (
              <button
                key={s.canal}
                type="button"
                onClick={() => setCanal(s.canal)}
                className={
                  'text-sm font-medium px-3.5 py-1.5 rounded-md transition-colors ' +
                  (canal === s.canal ? 'bg-white text-[#0F6E56] shadow-sm' : 'text-gray-500 hover:text-gray-800')
                }
              >
                {s.label}
                <span className="ml-1.5 text-[11px] text-gray-400">
                  {templates.filter((t) => t.canal === s.canal).length}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEditando('novo')}
            className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg ml-auto"
          >
            + Novo template
          </button>
        </div>

        <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 leading-relaxed">
          {aba.explica}
        </p>

        {msg && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{msg}</p>}

        {/* Lista */}
        <div className="space-y-2">
          {daAba.map((t) => {
            const falta = pendencia(t)
            return (
              <div key={t.id} className="border border-gray-100 rounded-lg p-3.5 hover:border-gray-200 transition-colors">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 text-sm">{t.nome}</p>
                      <span className={'text-[11px] font-medium px-2 py-0.5 rounded-full ' + STATUS_BADGE[t.status]}>
                        {t.status}
                      </span>
                      {falta && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                          {falta}
                        </span>
                      )}
                    </div>
                    {t.descricao && <p className="text-xs text-gray-500 mt-0.5">{t.descricao}</p>}

                    {t.canal === 'email' && t.assunto && (
                      <p className="text-xs text-gray-600 mt-1.5">
                        <span className="text-gray-400">Assunto:</span> {t.assunto}
                      </p>
                    )}
                    {t.canal === 'whatsapp' && (
                      <p className="text-xs text-gray-600 mt-1.5">
                        {t.usaTemplateOficial ? (
                          <>
                            <span className="text-gray-400">Meta:</span>{' '}
                            <code className="bg-gray-100 px-1 rounded">{t.templateMeta ?? '—'}</code>
                          </>
                        ) : (
                          <span className="text-gray-400">Texto livre (Z-API)</span>
                        )}
                      </p>
                    )}
                    {t.canal === 'mala_direta' && (
                      <p className="text-xs text-gray-600 mt-1.5">
                        {FORMATOS.find(([f]) => f === t.formato)?.[1] ?? 'sem formato'}
                        {t.pesoGramas ? ` · ${t.pesoGramas}g` : ''}
                        {t.dimensoes ? ` · ${t.dimensoes}` : ''}
                        {' · '}
                        {brl(t.custoUnitarioCentavos)} por peça
                      </p>
                    )}

                    {t.corpo && (
                      <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 whitespace-pre-wrap">{t.corpo}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button type="button" onClick={() => setEditando(t)} className="text-xs text-[#0F6E56] underline">
                      editar
                    </button>
                    <button type="button" onClick={() => void alternarStatus(t)} className="text-xs text-gray-500 hover:text-gray-700 underline">
                      {t.status === 'ativo' ? 'despublicar' : 'ativar'}
                    </button>
                    <button type="button" onClick={() => void excluir(t)} className="text-xs text-red-400 hover:text-red-600 underline">
                      excluir
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {daAba.length === 0 && (
            <p className="py-10 text-center text-sm text-gray-400">
              Nenhum template de {aba.label.toLowerCase()} ainda.
            </p>
          )}
        </div>
      </div>

      {editando && (
        <ModalTemplate
          template={editando === 'novo' ? null : editando}
          canalPadrao={canal}
          onFechar={() => setEditando(null)}
          onSalvo={async () => {
            setEditando(null)
            setMsg(null)
            await recarregar()
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Editor
// ─────────────────────────────────────────────────────────────

function ModalTemplate({
  template,
  canalPadrao,
  onFechar,
  onSalvo,
}: {
  template: TemplateMarketing | null
  canalPadrao: CanalEnvio
  onFechar: () => void
  onSalvo: () => void
}) {
  const canal = template?.canal ?? canalPadrao
  const [nome, setNome] = useState(template?.nome ?? '')
  const [descricao, setDescricao] = useState(template?.descricao ?? '')
  const [assunto, setAssunto] = useState(template?.assunto ?? '')
  const [corpo, setCorpo] = useState(template?.corpo ?? '')
  const [formatoEmail, setFormatoEmail] = useState<'texto' | 'blocos'>(template?.formatoEmail ?? 'texto')
  const [blocos, setBlocos] = useState<Bloco[]>(template?.blocos ?? [])
  const [oficial, setOficial] = useState(template?.usaTemplateOficial ?? true)
  const [templateMeta, setTemplateMeta] = useState(template?.templateMeta ?? '')
  const [paramCorpo, setParamCorpo] = useState((template?.templateParams.corpo ?? ['#nome']).join(' | '))
  const [botaoUrl, setBotaoUrl] = useState(template?.templateParams.botaoUrl ?? '')
  const [formato, setFormato] = useState<FormatoPeca | ''>(template?.formato ?? '')
  const [arteUrl, setArteUrl] = useState(template?.arteUrl ?? '')
  const [peso, setPeso] = useState(template?.pesoGramas?.toString() ?? '')
  const [dimensoes, setDimensoes] = useState(template?.dimensoes ?? '')
  const [custo, setCusto] = useState(
    template?.custoUnitarioCentavos != null ? (template.custoUnitarioCentavos / 100).toFixed(2) : ''
  )
  const [tags, setTags] = useState((template?.tags ?? []).join(', '))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    const centavos = custo.trim() ? Math.round(Number(custo.replace(',', '.')) * 100) : null
    const corpoReq = {
      nome,
      canal,
      descricao: descricao || null,
      corpo,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
      ...(canal === 'email' ? { assunto: assunto || null, formatoEmail, blocos } : {}),
      ...(canal === 'whatsapp'
        ? {
            usaTemplateOficial: oficial,
            templateMeta: oficial ? templateMeta.trim() || null : null,
            templateParams: {
              corpo: paramCorpo.split('|').map((p) => p.trim()).filter(Boolean),
              botaoUrl: botaoUrl.trim() || undefined,
            },
          }
        : {}),
      ...(canal === 'mala_direta'
        ? {
            formato: formato || null,
            arteUrl: arteUrl || null,
            pesoGramas: peso.trim() ? Number(peso) : null,
            dimensoes: dimensoes || null,
            custoUnitarioCentavos: Number.isFinite(centavos) ? centavos : null,
          }
        : {}),
    }
    try {
      const r = await fetch(
        template ? `/api/admin/marketing/templates/${template.id}` : '/api/admin/marketing/templates',
        {
          method: template ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpoReq),
        }
      )
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || 'Não deu pra salvar')
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const titulo = template ? 'Editar template' : `Novo template de ${SUBABAS.find((s) => s.canal === canal)!.label}`
  const editorAberto = canal === 'email' && formatoEmail === 'blocos'

  return (
    <Modal titulo={titulo} onFechar={onFechar} largo={editorAberto}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">
            Nome (só você vê)
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} placeholder="Boas-vindas — quem é a Confeccione" />
          </label>
          <label className="text-xs text-gray-500">
            Tags (vírgula)
            <input value={tags} onChange={(e) => setTags(e.target.value)} className={CAMPO} placeholder="boas-vindas" />
          </label>
        </div>

        <label className="text-xs text-gray-500 block">
          Pra que serve
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={CAMPO} placeholder="Primeiro contato com quem acabou de entrar na base." />
        </label>

        {canal === 'email' && (
          <>
            <label className="text-xs text-gray-500 block">
              Assunto
              <input value={assunto} onChange={(e) => setAssunto(e.target.value)} className={CAMPO} placeholder="Prazer, #nome — a Confeccione produz sua roupa no Brasil" />
            </label>

            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
              {([['blocos', 'Montar visualmente'], ['texto', 'Só texto']] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFormatoEmail(v)}
                  className={
                    'text-xs font-medium px-3 py-1.5 rounded-md transition-colors ' +
                    (formatoEmail === v ? 'bg-white text-[#0F6E56] shadow-sm' : 'text-gray-500 hover:text-gray-800')
                  }
                >
                  {l}
                </button>
              ))}
            </div>
          </>
        )}

        {editorAberto && <EditorBlocos blocos={blocos} assunto={assunto} onChange={setBlocos} />}

        {canal === 'whatsapp' && (
          <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3 space-y-3">
            <label className="flex items-start gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={oficial} onChange={(e) => setOficial(e.target.checked)} className="mt-0.5" />
              <span>
                <strong>Usar template oficial da Meta</strong> — obrigatório pra iniciar conversa com quem não te
                respondeu nas últimas 24h. Desmarcado, a mensagem sai como texto puro pela Z-API: sem custo e sem
                aprovação, mas com risco de banir o número se a base for fria.
              </span>
            </label>
            {oficial && (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-xs text-gray-500">
                  Nome do template aprovado
                  <input value={templateMeta} onChange={(e) => setTemplateMeta(e.target.value)} className={CAMPO} placeholder="novidade_colecao_v1" />
                </label>
                <label className="text-xs text-gray-500">
                  Variáveis do corpo (separadas por |)
                  <input value={paramCorpo} onChange={(e) => setParamCorpo(e.target.value)} className={CAMPO} placeholder="#nome | #cidade" />
                </label>
                <label className="text-xs text-gray-500 sm:col-span-2">
                  Sufixo do botão de URL (opcional)
                  <input value={botaoUrl} onChange={(e) => setBotaoUrl(e.target.value)} className={CAMPO} placeholder="#pedido?utm_source=whatsapp&utm_campaign=retomada" />
                </label>
              </div>
            )}
          </div>
        )}

        {canal === 'mala_direta' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">
              Formato
              <select value={formato} onChange={(e) => setFormato(e.target.value as FormatoPeca | '')} className={CAMPO + ' bg-white'}>
                <option value="">Escolha…</option>
                {FORMATOS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500">
              Link da arte (PDF)
              <input value={arteUrl} onChange={(e) => setArteUrl(e.target.value)} className={CAMPO} placeholder="https://…/panfleto.pdf" />
            </label>
            <label className="text-xs text-gray-500">
              Peso unitário (g)
              <input value={peso} onChange={(e) => setPeso(e.target.value.replace(/\D/g, ''))} className={CAMPO} placeholder="20" />
            </label>
            <label className="text-xs text-gray-500">
              Dimensões
              <input value={dimensoes} onChange={(e) => setDimensoes(e.target.value)} className={CAMPO} placeholder="15 × 21 cm" />
            </label>
            <label className="text-xs text-gray-500">
              Custo por peça (R$)
              <input value={custo} onChange={(e) => setCusto(e.target.value)} className={CAMPO} placeholder="0,85" />
            </label>
          </div>
        )}

        {!editorAberto && (
        <label className="text-xs text-gray-500 block">
          {canal === 'mala_direta'
            ? 'Texto da peça / observações pra gráfica'
            : canal === 'whatsapp' && oficial
              ? 'Cópia do texto do template (guardada no histórico do lead)'
              : 'Mensagem'}
          <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={7} className={CAMPO + ' resize-y'} />
        </label>
        )}

        {!editorAberto && (
        <p className="text-[11px] text-gray-400">
          Marcadores: <code className="bg-gray-100 px-1 rounded">#nome</code> (primeiro nome),{' '}
          <code className="bg-gray-100 px-1 rounded">#empresa</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">#cidade</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">#link</code> (pedido do lead no visualizador) e{' '}
          <code className="bg-gray-100 px-1 rounded">#pedido</code> (só o id, pro botão de URL do template).
        </p>
        )}

        {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || nome.trim().length < 3}
            className="bg-[#1D9E75] hover:bg-[#178A65] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" onClick={onFechar} className="text-sm text-gray-500 hover:text-gray-700 px-2">
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  )
}
