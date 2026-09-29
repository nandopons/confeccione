// app/lib/cobranca-orcamento.ts
// ============================================================================
// ACEITOU E NÃO ORÇOU: 20 H DEPOIS, A PERGUNTA VAI PRO CLIENTE — 29/09/2026
// (decisão do Fernando)
//
// Em 29/09 havia 42 pedidos em "orçamento atrasado" — confecção aceitou, o
// contato do cliente foi pra ela, e o orçamento nunca entrou na plataforma.
// 30 deles da mesma confecção. A etapa existia como etiqueta no painel e nada
// acontecia: o cliente ficava esperando um orçamento que talvez estivesse
// sendo combinado por fora, ou que nunca viria.
//
// O Fernando: "se bater 20 horas, a gente manda mensagem pro cliente pra
// saber se a confecção entrou em contato e se ele pretende seguir com a
// negociação ou se gostaria de buscar outro fornecedor."
//
// Duas mensagens na mesma rodada, uma por lado:
//   • ao CLIENTE: a confecção já falou com você? segue com ela ou procuro outra?
//     (a resposta volta pro Luigi, que tem o roteiro — ver proximo_passo em
//     luigi.ts e a ferramenta reabrir_busca)
//   • à CONFECÇÃO: o pedido ainda está sem orçamento na plataforma, com o link
//     pra definir. Sem cobrança, sem prazo: só o lembrete de onde se orça.
//
// Regras:
//   • uma vez por aceite (`orcamento_cobrado_em`); reabertura zera a marca
//   • só aceites dos últimos DIAS_MAX dias: o estoque antigo (jun–ago) é
//     limpeza, não régua — cobrar cliente de julho hoje é ruído
//   • horário 8h–21h todo dia (a janela do fechador): 20 h de um aceite às
//     14h cai nas 10h do dia seguinte; de um aceite às 23h cai às 19h
//   • pago, encerrado, com orçamento definido ou lembretes pausados → não
// ============================================================================

import { supabaseAdmin } from './supabase-server'
import { avisoOficial } from './whatsapp-notify'
import { estaNaJanelaDoFechador } from './horario'

const HORAS_SEM_ORCAMENTO = 20
const DIAS_MAX = 10
const MAX_POR_RODADA = 10

export type ResultadoCobrancaOrcamento = { clientes: number; confeccoes: number; puladas: number; observacao?: string }

type Linha = {
  id: string
  pedido_id: string
  respondido_em: string | null
  leads_fornecedores: { nome: string | null; whatsapp: string | null } | Array<{ nome: string | null; whatsapp: string | null }> | null
  pedidos_assistente:
    | {
        id: string
        codigo: string | null
        nome: string | null
        telefone: string | null
        pagamento_status: string | null
        orcamento_definido_em: string | null
        orcamento_cobrado_em: string | null
        encerrado_em: string | null
        finalizado_em: string | null
        lembretes_pausados_ate: string | null
      }
    | Array<Record<string, unknown>>
    | null
}

function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0]
}

export function textoDaCobrancaAoCliente(nome: string | null, codigo: string | null): { texto: string; resumo: string } {
  const p = primeiroNome(nome)
  const ref = codigo ? `pedido ${codigo}` : 'pedido'
  return {
    texto:
      `${p ? `Oi, ${p}! ` : 'Oi! '}A confecção que assumiu o seu ${ref} já entrou em contato com você?\n\n` +
      'Me conta se vocês estão conversando e se pretende seguir com ela — ou, se preferir, eu procuro outra confecção pro pedido.',
    resumo: `a confecção que assumiu o seu ${ref} já entrou em contato com você? Me conta se pretende seguir com ela ou se prefere que eu procure outra`,
  }
}

export function textoDoLembreteAConfeccao(nome: string | null, codigo: string | null, link: string): { texto: string; resumo: string } {
  const p = primeiroNome(nome)
  const ref = codigo ? `pedido ${codigo}` : 'pedido'
  return {
    texto:
      `${p ? `Oi, ${p}! ` : 'Oi! '}O ${ref} que você assumiu ainda está sem orçamento na plataforma. ` +
      `Quando alinhar com o cliente, define o valor aqui (é o que libera o pagamento seguro): ${link}`,
    resumo: `o ${ref} que você assumiu ainda está sem orçamento na plataforma — quando alinhar com o cliente, define o valor por aqui`,
  }
}

export async function rodarCobrancaOrcamento(): Promise<ResultadoCobrancaOrcamento> {
  if (!estaNaJanelaDoFechador()) return { clientes: 0, confeccoes: 0, puladas: 0, observacao: 'fora das 8h–21h' }

  const agora = Date.now()
  const { data, error } = await supabaseAdmin
    .from('ofertas_pedido_assistente')
    .select(
      'id, pedido_id, respondido_em, leads_fornecedores(nome, whatsapp), pedidos_assistente(id, codigo, nome, telefone, pagamento_status, orcamento_definido_em, orcamento_cobrado_em, encerrado_em, finalizado_em, lembretes_pausados_ate)'
    )
    .eq('status', 'aceita')
    .lte('respondido_em', new Date(agora - HORAS_SEM_ORCAMENTO * 3600_000).toISOString())
    .gte('respondido_em', new Date(agora - DIAS_MAX * 24 * 3600_000).toISOString())
    .limit(100)
  if (error) throw new Error(`cobrança orçamento: ofertas — ${error.message}`)

  let clientes = 0
  let confeccoes = 0
  let puladas = 0
  for (const o of (data ?? []) as unknown as Linha[]) {
    if (clientes >= MAX_POR_RODADA) break
    const p = (Array.isArray(o.pedidos_assistente) ? o.pedidos_assistente[0] : o.pedidos_assistente) as Exclude<Linha['pedidos_assistente'], null | unknown[]> | null
    const f = Array.isArray(o.leads_fornecedores) ? o.leads_fornecedores[0] : o.leads_fornecedores
    if (!p || !p.telefone) continue
    if (p.orcamento_definido_em || p.orcamento_cobrado_em || p.encerrado_em || p.finalizado_em || p.pagamento_status === 'pago') continue
    if (p.lembretes_pausados_ate && new Date(p.lembretes_pausados_ate).getTime() > agora) {
      puladas++
      continue
    }
    try {
      const c = textoDaCobrancaAoCliente(p.nome, p.codigo)
      const okCliente = await avisoOficial({ telefone: p.telefone, nome: p.nome, texto: c.texto, resumo: c.resumo, caminhoBotao: `visualizador/${p.id}` })
      if (!okCliente) {
        puladas++
        continue
      }
      // A marca sai junto com a mensagem ao cliente: a confecção é cortesia.
      await supabaseAdmin.from('pedidos_assistente').update({ orcamento_cobrado_em: new Date().toISOString() }).eq('id', p.id)
      clientes++
      if (f?.whatsapp) {
        const caminho = `fornecedor/oferta/${o.id}/orcamento`
        const l = textoDoLembreteAConfeccao(f.nome, p.codigo, `https://www.confeccione.com.br/${caminho}`)
        const okForn = await avisoOficial({ telefone: f.whatsapp, nome: f.nome, texto: l.texto, resumo: l.resumo, caminhoBotao: caminho }).catch(() => false)
        if (okForn) confeccoes++
      }
    } catch (err) {
      console.error('[cobranca-orcamento] erro no pedido', { pedido: p.codigo ?? p.id, err })
      puladas++
    }
  }
  return { clientes, confeccoes, puladas }
}
