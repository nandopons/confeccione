// PATCH /api/fornecedor/painel/dados
// ============================================================================
// O FORNECEDOR edita o próprio cadastro (05/09/2026). Até aqui só o admin
// editava, e qualquer mudança de cidade ou de pedido mínimo virava mensagem no
// WhatsApp do suporte.
//
// O que ele NÃO edita sozinho, e por quê:
//   whatsapp / email — são a chave de entrada (o OTP do login vai pra eles).
//     Trocar sem revalidar é perder o acesso no melhor caso, e entregar a conta
//     no pior. Para liberar isso, o caminho é confirmar o novo número por
//     código antes de gravar.
//   cpf_cnpj — documento; muda com conferência.
//   status — pausar/reativar tem fluxo próprio, com motivo.
//
// tipos_produto DEIXOU de ser editável à mão: agora é derivado das peças
// (legadoDasPecas). Quem manda é `pecas` — o fornecedor marca o que costura e o
// matching lê disso. Manter os dois editáveis separadamente era garantir que um
// dia divergissem.
// ============================================================================

import { getFornecedorAtual } from '@/app/lib/auth-server'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { registrarAudit, diffMudancas } from '@/app/lib/audit'
import { legadoDasPecas, pecaValida } from '@/app/lib/pecas'

const RAIOS_VALIDOS = new Set(['cidade', 'estado', 'regiao', 'nacional'])

const UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
])

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t || null
}

export async function PATCH(req: Request) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return Response.json({ error: 'não autenticado' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'dados inválidos' }, { status: 400 })
  }
  const b = body as Record<string, unknown>

  const nome = texto(b.nome, 120)
  if (!nome || nome.length < 2) {
    return Response.json({ error: 'informe o nome da confecção' }, { status: 400 })
  }

  const cidade = texto(b.cidade, 80)

  const estado = texto(b.estado, 2)?.toUpperCase() ?? null
  if (estado && !UFS.has(estado)) {
    return Response.json({ error: 'UF inválida' }, { status: 400 })
  }

  const raio = texto(b.raio_atendimento, 20) ?? 'nacional'
  if (!RAIOS_VALIDOS.has(raio)) {
    return Response.json({ error: 'raio de atendimento inválido' }, { status: 400 })
  }
  // Atender "só a minha cidade/estado" sem dizer qual é deixa o fornecedor fora
  // de todo matching regional — o filtro compara justamente contra esse campo.
  if ((raio === 'cidade' || raio === 'estado' || raio === 'regiao') && !estado) {
    return Response.json(
      { error: 'para atender por região, informe o seu estado' },
      { status: 400 },
    )
  }

  // Peças: campo opcional no corpo. Ausente = não mexe (evita que um cliente
  // antigo do formulário zere o que o fornecedor já tinha marcado).
  let pecas: string[] | null = null
  if (b.pecas !== undefined) {
    if (!Array.isArray(b.pecas)) {
      return Response.json({ error: 'peças inválidas' }, { status: 400 })
    }
    const limpas = [...new Set(b.pecas.filter(pecaValida))]
    if (limpas.length === 0) {
      return Response.json(
        { error: 'marque pelo menos uma peça que você produz' },
        { status: 400 },
      )
    }
    pecas = limpas
  }

  let pedidoMinimo: number | null = null
  if (b.pedido_minimo !== null && b.pedido_minimo !== undefined && b.pedido_minimo !== '') {
    const n = Math.round(Number(b.pedido_minimo))
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      return Response.json({ error: 'pedido mínimo inválido' }, { status: 400 })
    }
    pedidoMinimo = n
  }

  const { data: antes } = await supabaseAdmin
    .from('leads_fornecedores')
    .select('nome, cidade, estado, raio_atendimento, pedido_minimo, pecas, tipos_produto')
    .eq('id', fornecedor.id)
    .maybeSingle()

  const novos: Record<string, unknown> = {
    nome,
    cidade,
    estado,
    raio_atendimento: raio,
    pedido_minimo: pedidoMinimo,
  }
  if (pecas) {
    novos.pecas = pecas
    // Ponte: o matching ainda cai em tipos_produto quando o pedido é antigo
    // (sem peça). Derivar aqui mantém os dois lados dizendo a mesma coisa.
    novos.tipos_produto = legadoDasPecas(pecas)
  }

  const { data, error } = await supabaseAdmin
    .from('leads_fornecedores')
    .update(novos)
    .eq('id', fornecedor.id)
    .select('nome, cidade, estado, raio_atendimento, pedido_minimo, pecas, tipos_produto')
    .single()

  if (error || !data) {
    console.error('[fornecedor/dados] falha ao salvar:', error)
    return Response.json({ error: 'não consegui salvar' }, { status: 500 })
  }

  // Auditoria com ator = o próprio fornecedor: quando um cadastro "mudar
  // sozinho", dá pra saber que foi ele e não o admin.
  if (antes) {
    const mudancas = diffMudancas(antes as Record<string, unknown>, novos)
    if (Object.keys(mudancas).length > 0) {
      await registrarAudit({
        ator: `fornecedor:${fornecedor.id}`,
        acao: 'fornecedor.editar_proprio',
        entidade_tipo: 'leads_fornecedores',
        entidade_id: fornecedor.id,
        mudancas,
      })
    }
  }

  return Response.json(data)
}
