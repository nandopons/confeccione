// app/lib/whatsapp-templates.ts
// ============================================================================
// CATÁLOGO DE TEMPLATES DO WHATSAPP — criar e consultar na WABA pela Graph API.
//
// Template é a única forma de abrir conversa fora da janela de 24 h. Até aqui
// cada lote nascia numa rota one-shot (criar-templates-retomada); a partir de
// set/2026 a criação passa por esta lib, chamada pelo admin e pelo MCP, pra
// que o catálogo cresça sem deploy: o Luigi (agente) só abre conversa com
// template que já está aqui, aprovado.
//
// Regras da Meta que valem lembrar (motivos de rejeição já vistos):
//   - variáveis numeradas em sequência ({{1}}, {{2}}…) e com exemplo;
//   - nome só com minúsculas, números e _ ;
//   - UTILITY precisa referir uma transação do cliente (pedido, orçamento);
//     a Meta pode RECLASSIFICAR pra MARKETING (allow_category_change) e aí a
//     tarifa é a de marketing (R$ 0,3217 vs R$ 0,035).
// ============================================================================

import { horaEmRecife } from './horario'

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'
// Só pra mock local (mesmo knob de whatsapp-cloud.ts). Em produção fica sem definir.
const GRAPH_BASE = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com'

export type CategoriaTemplate = 'UTILITY' | 'MARKETING'

export type NovoTemplate = {
  /** snake_case, ex.: duvida_pedido_manha */
  nome: string
  categoria: CategoriaTemplate
  /** Corpo com {{1}}, {{2}}… Sem emoji é escolha nossa, não da Meta. */
  corpo: string
  /** Um exemplo por variável, na ordem. */
  exemplos?: string[]
  rodape?: string | null
  idioma?: string
  /** Deixa a Meta reclassificar em vez de rejeitar. Padrão true. */
  permitirTrocaCategoria?: boolean
}

export type ResultadoCriacao = {
  nome: string
  ok: boolean
  id?: string
  status?: string
  categoria?: string
  erro?: string
}

function credenciais(): { token: string; wabaId: string } | null {
  const token = process.env.WHATSAPP_TOKEN
  const wabaId = process.env.WHATSAPP_WABA_ID
  if (!token || !wabaId) return null
  return { token, wabaId }
}

export function validarNomeTemplate(nome: string): string | null {
  if (!/^[a-z0-9_]{3,512}$/.test(nome)) return 'Nome só com minúsculas, números e _ (ex.: duvida_pedido_manha).'
  return null
}

/** Conta {{n}} no corpo e confere se os exemplos batem. */
export function validarCorpo(corpo: string, exemplos: string[] = []): string | null {
  const vars = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))
  const esperado = vars.length ? Math.max(...vars) : 0
  for (let i = 1; i <= esperado; i++) {
    if (!vars.includes(i)) return `Variáveis fora de sequência: falta {{${i}}}.`
  }
  if (exemplos.length !== esperado) {
    return `O corpo tem ${esperado} variável(is); informe exatamente ${esperado} exemplo(s).`
  }
  if (corpo.trim().length < 10) return 'Corpo curto demais.'
  if (corpo.length > 1024) return 'Corpo acima de 1024 caracteres.'
  return null
}

/** Submete um template pra aprovação. Devolve o id e o status inicial (PENDING). */
export async function criarTemplateWhatsApp(t: NovoTemplate): Promise<ResultadoCriacao> {
  const cred = credenciais()
  if (!cred) return { nome: t.nome, ok: false, erro: 'WHATSAPP_TOKEN/WHATSAPP_WABA_ID ausentes' }

  const erroNome = validarNomeTemplate(t.nome)
  if (erroNome) return { nome: t.nome, ok: false, erro: erroNome }
  const exemplos = t.exemplos ?? []
  const erroCorpo = validarCorpo(t.corpo, exemplos)
  if (erroCorpo) return { nome: t.nome, ok: false, erro: erroCorpo }

  const components: Array<Record<string, unknown>> = [
    {
      type: 'BODY',
      text: t.corpo,
      ...(exemplos.length ? { example: { body_text: [exemplos] } } : {}),
    },
  ]
  if (t.rodape) components.push({ type: 'FOOTER', text: t.rodape })

  const payload = {
    name: t.nome,
    language: t.idioma ?? 'pt_BR',
    category: t.categoria,
    allow_category_change: t.permitirTrocaCategoria ?? true,
    components,
  }

  try {
    const res = await fetch(`${GRAPH_BASE}/${GRAPH_VERSION}/${cred.wabaId}/message_templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.token}` },
      body: JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => null)) as
      | { id?: string; status?: string; category?: string; error?: { message?: string } }
      | null
    if (!res.ok) {
      return { nome: t.nome, ok: false, erro: data?.error?.message || `HTTP ${res.status}` }
    }
    return { nome: t.nome, ok: true, id: data?.id, status: data?.status, categoria: data?.category }
  } catch (err) {
    return { nome: t.nome, ok: false, erro: err instanceof Error ? err.message : String(err) }
  }
}

export type TemplateNaWaba = {
  id: string
  name: string
  status: string
  category: string
  language: string
  rejected_reason?: string | null
  corpo?: string | null
}

/** Todos os templates da WABA (qualquer status), opcionalmente filtrados por nome. */
export async function consultarTemplatesWhatsApp(nomes?: string[]): Promise<{ ok: boolean; templates: TemplateNaWaba[]; erro?: string }> {
  const cred = credenciais()
  if (!cred) return { ok: false, templates: [], erro: 'WHATSAPP_TOKEN/WHATSAPP_WABA_ID ausentes' }

  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${cred.wabaId}/message_templates`)
  url.searchParams.set('fields', 'name,status,category,language,rejected_reason,components')
  url.searchParams.set('limit', '200')

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cred.token}` } })
    const data = (await res.json().catch(() => null)) as
      | { data?: Array<Record<string, unknown>>; error?: { message?: string } }
      | null
    if (!res.ok) return { ok: false, templates: [], erro: data?.error?.message || `HTTP ${res.status}` }

    const filtro = nomes && nomes.length ? new Set(nomes) : null
    const templates = (data?.data ?? [])
      .filter((t) => !filtro || filtro.has(String(t.name)))
      .map((t) => {
        const comps = Array.isArray(t.components) ? (t.components as Array<Record<string, unknown>>) : []
        const body = comps.find((c) => c.type === 'BODY')
        return {
          id: String(t.id ?? ''),
          name: String(t.name ?? ''),
          status: String(t.status ?? ''),
          category: String(t.category ?? ''),
          language: String(t.language ?? ''),
          rejected_reason: (t.rejected_reason as string | undefined) ?? null,
          corpo: (body?.text as string | undefined) ?? null,
        }
      })
    return { ok: true, templates }
  } catch (err) {
    return { ok: false, templates: [], erro: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Saudação por hora (São Paulo) ──────────────────────────────────────────
// Três templates iguais, um por saudação, porque a Meta não deixa a saudação
// ser variável no começo do corpo com segurança. Quem envia escolhe pelo
// relógio de São Paulo no momento do disparo.

export const TEMPLATES_DUVIDA_PEDIDO = {
  manha: 'duvida_pedido_manha',
  tarde: 'duvida_pedido_tarde',
  noite: 'duvida_pedido_noite',
} as const

export function saudacaoPorHora(agora = new Date()): 'manha' | 'tarde' | 'noite' {
  const hora = horaEmRecife(agora)
  if (hora >= 5 && hora < 12) return 'manha'
  if (hora >= 12 && hora < 18) return 'tarde'
  return 'noite'
}

/** Nome do template "posso tirar uma dúvida?" certo pra hora atual. */
export function templateDuvidaPedidoAgora(agora = new Date()): string {
  return TEMPLATES_DUVIDA_PEDIDO[saudacaoPorHora(agora)]
}
