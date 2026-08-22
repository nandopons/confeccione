// app/lib/pcp.ts
// ============================================================================
// PCP — cadastro técnico: parque de máquinas, produtos e roteiro de operações.
//
// PARA QUE SERVE
// O quadro de produção sabe QUE um pedido existe e em que etapa está. Não sabe
// QUANTO trabalho ele é. "10 camisas básicas" não diz nada sobre horas de
// overloque — e sem isso não dá para dizer quanto de mão de obra a semana pede
// nem qual máquina estoura primeiro. Este cadastro é a régua que falta.
//
// TEMPO NULO NÃO É ZERO
// Operação sem tempo cronometrado fica `null`, e um produto com qualquer
// operação nula NÃO entra em cálculo de capacidade — `prontoParaCalculo` é
// falso. Tratar null como zero produziria um gráfico bonito e mentiroso, e o
// erro só apareceria no chão de fábrica, tarde.
//
// SETUP MORA NA MÁQUINA
// Trocar linha no overloque de 4 cones custa mais que na reta. O tempo é da
// máquina, não da operação — assim ele não precisa ser repetido (e divergir)
// em cada uma das operações que rodam ali.
// ============================================================================

import { supabaseAdmin } from './supabase-server'

export type Maquina = {
  id: string
  codigo: string
  nome: string
  quantidade: number
  horasDia: number
  setupTrocaMin: number
  observacao: string | null
  ordem: number
  ativo: boolean
  /** quantidade × horasDia — o teto diário deste tipo de máquina. */
  capacidadeHorasDia: number
}

export type Operacao = {
  id: string
  ordem: number
  descricao: string
  maquinaId: string | null
  maquinaNome: string | null
  tempoSegundos: number | null
  observacao: string | null
}

export type Medida = { tamanho: string; comprimentoCm: number | null }

export type Componente = {
  id: string
  nome: string
  larguraCm: number | null
  observacao: string | null
  ordem: number
  medidas: Medida[]
}

export type Produto = {
  id: string
  codigo: string
  nome: string
  descricao: string | null
  ativo: boolean
  operacoes: Operacao[]
  componentes: Componente[]
  /** Soma dos tempos. Null se QUALQUER operação ainda não foi cronometrada. */
  tempoTotalSegundos: number | null
  /** Quantas operações ainda faltam cronometrar. */
  operacoesSemTempo: number
  /** Só com tempo em todas as operações este produto pode virar capacidade. */
  prontoParaCalculo: boolean
}

// ---------------------------------------------------------------------------
// Máquinas
// ---------------------------------------------------------------------------
type LinhaMaquina = {
  id: string
  codigo: string
  nome: string
  quantidade: number
  horas_dia: string | number
  setup_troca_min: string | number
  observacao: string | null
  ordem: number
  ativo: boolean
}

/** Postgres devolve numeric como string — Number() aqui, uma vez, e não espalhado. */
function num(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n as number) ? (n as number) : 0
}

function mapearMaquina(l: LinhaMaquina): Maquina {
  const quantidade = l.quantidade ?? 0
  const horasDia = num(l.horas_dia)
  return {
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    quantidade,
    horasDia,
    setupTrocaMin: num(l.setup_troca_min),
    observacao: l.observacao,
    ordem: l.ordem,
    ativo: l.ativo,
    capacidadeHorasDia: quantidade * horasDia,
  }
}

const COLUNAS_MAQUINA =
  'id, codigo, nome, quantidade, horas_dia, setup_troca_min, observacao, ordem, ativo'

export async function listarMaquinas(incluirInativas = false): Promise<Maquina[]> {
  let q = supabaseAdmin.from('pcp_maquinas').select(COLUNAS_MAQUINA).order('ordem').order('nome')
  if (!incluirInativas) q = q.eq('ativo', true)
  const { data } = await q
  return ((data ?? []) as unknown as LinhaMaquina[]).map(mapearMaquina)
}

export type ResultadoPcp = { ok: true; id?: string } | { ok: false; erro: string }

/**
 * Cria ou atualiza um tipo de máquina.
 *
 * `codigo` é a identidade estável (as operações apontam para o id, mas o
 * código é o que uma importação futura casaria). Slug simples, sem acento.
 */
export async function salvarMaquina(params: {
  id?: string | null
  codigo: string
  nome: string
  quantidade: number
  horasDia: number
  setupTrocaMin: number
  observacao?: string | null
  ordem?: number
  ativo?: boolean
}): Promise<ResultadoPcp> {
  const codigo = params.codigo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!codigo) return { ok: false, erro: 'Código inválido' }
  if (!params.nome.trim()) return { ok: false, erro: 'Informe o nome da máquina' }

  const linha = {
    codigo,
    nome: params.nome.trim(),
    quantidade: Math.max(0, Math.round(params.quantidade)),
    horas_dia: params.horasDia,
    setup_troca_min: params.setupTrocaMin,
    observacao: params.observacao?.trim() || null,
    ordem: params.ordem ?? 0,
    ativo: params.ativo ?? true,
    atualizado_em: new Date().toISOString(),
  }

  if (params.id) {
    const { error } = await supabaseAdmin.from('pcp_maquinas').update(linha).eq('id', params.id)
    if (error) return { ok: false, erro: error.message }
    return { ok: true, id: params.id }
  }

  const { data, error } = await supabaseAdmin
    .from('pcp_maquinas')
    .insert(linha)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error) return { ok: false, erro: error.message }
  return { ok: true, id: data?.id }
}

/**
 * Máquina não é apagada, é desativada.
 *
 * O roteiro de um produto aponta pra ela; apagar deixaria operações órfãs
 * (`on delete set null`) e o histórico do que já foi produzido perderia
 * sentido. Inativa some das listas de escolha e continua legível no passado.
 */
export async function desativarMaquina(id: string): Promise<ResultadoPcp> {
  const { error } = await supabaseAdmin
    .from('pcp_maquinas')
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, erro: error.message }
  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// Produtos + roteiro
// ---------------------------------------------------------------------------
type LinhaOperacao = {
  id: string
  ordem: number
  descricao: string
  maquina_id: string | null
  tempo_segundos: number | null
  observacao: string | null
}

export async function listarProdutos(incluirInativos = false): Promise<Produto[]> {
  let q = supabaseAdmin
    .from('pcp_produtos')
    .select('id, codigo, nome, descricao, ativo')
    .order('nome')
  if (!incluirInativos) q = q.eq('ativo', true)

  const { data: produtos } = await q
  const lista = (produtos ?? []) as unknown as {
    id: string
    codigo: string
    nome: string
    descricao: string | null
    ativo: boolean
  }[]
  if (!lista.length) return []

  const ids = lista.map((p) => p.id)
  const [maquinas, ops, comps] = await Promise.all([
    listarMaquinas(true),
    supabaseAdmin
      .from('pcp_operacoes')
      .select('id, produto_id, ordem, descricao, maquina_id, tempo_segundos, observacao')
      .in('produto_id', ids)
      .order('ordem'),
    supabaseAdmin
      .from('pcp_componentes')
      .select('id, produto_id, nome, largura_cm, observacao, ordem')
      .in('produto_id', ids)
      .order('ordem'),
  ])

  const nomeMaquina = new Map(maquinas.map((m) => [m.id, m.nome]))

  const componentes = (comps.data ?? []) as unknown as {
    id: string
    produto_id: string
    nome: string
    largura_cm: string | number | null
    observacao: string | null
    ordem: number
  }[]

  // Medidas em uma consulta só, depois agrupadas — uma por componente seria
  // N+1 num cadastro que a tela carrega inteiro.
  const medidasPorComponente = new Map<string, Medida[]>()
  if (componentes.length) {
    const { data: medidas } = await supabaseAdmin
      .from('pcp_componente_medidas')
      .select('componente_id, tamanho, comprimento_cm')
      .in('componente_id', componentes.map((c) => c.id))
      .order('tamanho')
    for (const m of (medidas ?? []) as unknown as {
      componente_id: string
      tamanho: string
      comprimento_cm: string | number | null
    }[]) {
      const arr = medidasPorComponente.get(m.componente_id) ?? []
      arr.push({
        tamanho: m.tamanho,
        comprimentoCm: m.comprimento_cm == null ? null : num(m.comprimento_cm),
      })
      medidasPorComponente.set(m.componente_id, arr)
    }
  }

  const opsPorProduto = new Map<string, Operacao[]>()
  for (const o of (ops.data ?? []) as unknown as (LinhaOperacao & { produto_id: string })[]) {
    const arr = opsPorProduto.get(o.produto_id) ?? []
    arr.push({
      id: o.id,
      ordem: o.ordem,
      descricao: o.descricao,
      maquinaId: o.maquina_id,
      maquinaNome: o.maquina_id ? nomeMaquina.get(o.maquina_id) ?? null : null,
      tempoSegundos: o.tempo_segundos,
      observacao: o.observacao,
    })
    opsPorProduto.set(o.produto_id, arr)
  }

  const compsPorProduto = new Map<string, Componente[]>()
  for (const c of componentes) {
    const arr = compsPorProduto.get(c.produto_id) ?? []
    arr.push({
      id: c.id,
      nome: c.nome,
      larguraCm: c.largura_cm == null ? null : num(c.largura_cm),
      observacao: c.observacao,
      ordem: c.ordem,
      medidas: medidasPorComponente.get(c.id) ?? [],
    })
    compsPorProduto.set(c.produto_id, arr)
  }

  return lista.map((p) => {
    const operacoes = opsPorProduto.get(p.id) ?? []
    const semTempo = operacoes.filter((o) => o.tempoSegundos == null).length
    return {
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      descricao: p.descricao,
      ativo: p.ativo,
      operacoes,
      componentes: compsPorProduto.get(p.id) ?? [],
      // Total só existe quando TODAS têm tempo. Somar as conhecidas e ignorar
      // as vazias daria um número menor que a realidade, e ninguém notaria.
      tempoTotalSegundos:
        operacoes.length && semTempo === 0
          ? operacoes.reduce((s, o) => s + (o.tempoSegundos ?? 0), 0)
          : null,
      operacoesSemTempo: semTempo,
      prontoParaCalculo: operacoes.length > 0 && semTempo === 0,
    }
  })
}

export async function salvarProduto(params: {
  id?: string | null
  codigo: string
  nome: string
  descricao?: string | null
  ativo?: boolean
}): Promise<ResultadoPcp> {
  const codigo = params.codigo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!codigo) return { ok: false, erro: 'Código inválido' }
  if (!params.nome.trim()) return { ok: false, erro: 'Informe o nome do produto' }

  const linha = {
    codigo,
    nome: params.nome.trim(),
    descricao: params.descricao?.trim() || null,
    ativo: params.ativo ?? true,
    atualizado_em: new Date().toISOString(),
  }

  if (params.id) {
    const { error } = await supabaseAdmin.from('pcp_produtos').update(linha).eq('id', params.id)
    if (error) return { ok: false, erro: error.message }
    return { ok: true, id: params.id }
  }

  const { data, error } = await supabaseAdmin
    .from('pcp_produtos')
    .insert(linha)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error) return { ok: false, erro: error.message }
  return { ok: true, id: data?.id }
}

/**
 * Grava o roteiro INTEIRO de um produto de uma vez.
 *
 * Substituir a lista toda em vez de editar operação por operação: reordenar é
 * a edição mais comum aqui (uma operação entra no meio e empurra as outras), e
 * fazer isso com PATCHes individuais tropeçaria na unique (produto, ordem) no
 * meio do caminho. A ordem é reatribuída 1..n a partir da posição no array —
 * a tela não precisa acertar número nenhum.
 */
export async function salvarRoteiro(
  produtoId: string,
  operacoes: {
    descricao: string
    maquinaId: string | null
    tempoSegundos: number | null
    observacao?: string | null
  }[],
): Promise<ResultadoPcp> {
  const limpas = operacoes
    .map((o) => ({ ...o, descricao: o.descricao.trim() }))
    .filter((o) => o.descricao.length > 0)

  // Apaga e reinsere. O histórico de produção não referencia pcp_operacoes.id
  // hoje, então não há nada a preservar — e no dia em que referenciar, isto
  // aqui vira versionamento de roteiro, não um UPDATE remendado.
  const { error: delErr } = await supabaseAdmin
    .from('pcp_operacoes')
    .delete()
    .eq('produto_id', produtoId)
  if (delErr) return { ok: false, erro: delErr.message }

  if (limpas.length) {
    const { error } = await supabaseAdmin.from('pcp_operacoes').insert(
      limpas.map((o, i) => ({
        produto_id: produtoId,
        ordem: i + 1,
        descricao: o.descricao,
        maquina_id: o.maquinaId || null,
        tempo_segundos: o.tempoSegundos && o.tempoSegundos > 0 ? Math.round(o.tempoSegundos) : null,
        observacao: o.observacao?.trim() || null,
      })),
    )
    if (error) return { ok: false, erro: error.message }
  }

  return { ok: true, id: produtoId }
}

/** Mesma estratégia do roteiro: a ficha de corte é gravada inteira. */
export async function salvarComponentes(
  produtoId: string,
  componentes: {
    nome: string
    larguraCm: number | null
    observacao?: string | null
    medidas: { tamanho: string; comprimentoCm: number | null }[]
  }[],
): Promise<ResultadoPcp> {
  const limpos = componentes
    .map((c) => ({ ...c, nome: c.nome.trim() }))
    .filter((c) => c.nome.length > 0)

  const { error: delErr } = await supabaseAdmin
    .from('pcp_componentes')
    .delete()
    .eq('produto_id', produtoId)
  if (delErr) return { ok: false, erro: delErr.message }

  for (const [i, c] of limpos.entries()) {
    const { data: novo, error } = await supabaseAdmin
      .from('pcp_componentes')
      .insert({
        produto_id: produtoId,
        nome: c.nome,
        largura_cm: c.larguraCm && c.larguraCm > 0 ? c.larguraCm : null,
        observacao: c.observacao?.trim() || null,
        ordem: i + 1,
      })
      .select('id')
      .maybeSingle<{ id: string }>()
    if (error) return { ok: false, erro: error.message }
    if (!novo?.id) continue

    const medidas = c.medidas
      .map((m) => ({ ...m, tamanho: m.tamanho.trim().toUpperCase() }))
      .filter((m) => m.tamanho.length > 0)
    if (!medidas.length) continue

    const { error: errMed } = await supabaseAdmin.from('pcp_componente_medidas').insert(
      medidas.map((m) => ({
        componente_id: novo.id,
        tamanho: m.tamanho,
        comprimento_cm: m.comprimentoCm && m.comprimentoCm > 0 ? m.comprimentoCm : null,
      })),
    )
    if (errMed) return { ok: false, erro: errMed.message }
  }

  return { ok: true, id: produtoId }
}
