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
  /** 'maquina' = equipamento; 'posto' = trabalho humano (design, modelagem). */
  tipo: TipoRecurso
  /** quantidade × horasDia — o teto diário deste recurso. */
  capacidadeHorasDia: number
}

export type TipoRecurso = 'maquina' | 'posto'

export type TipoOperacao = 'por_peca' | 'por_lote'

export type Operacao = {
  id: string
  ordem: number
  descricao: string
  maquinaId: string | null
  maquinaNome: string | null
  tempoSegundos: number | null
  /** por_peca = tempo por peça; por_lote = o tempo cobre um lote inteiro. */
  tipo: TipoOperacao
  /** Só no por_lote: quantas peças aquele tempo rende. Null = uma vez por lote. */
  rendePecas: number | null
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
  /**
   * Soma só das operações POR PEÇA. Null se alguma delas ainda não tem tempo.
   * Não é o custo da peça: as operações por lote entram diluídas, e o quanto
   * elas pesam depende do tamanho do lote — por isso `custoDoLote`.
   */
  tempoPorPecaSegundos: number | null
  /** Existe operação por lote? Se sim, "tempo por peça" sozinho engana. */
  temOperacaoPorLote: boolean
  /** Quantas operações ainda faltam cronometrar. */
  operacoesSemTempo: number
  /** Só com tempo em todas as operações este produto pode virar capacidade. */
  prontoParaCalculo: boolean
}

/**
 * Quanto tempo esta operação custa para produzir `quantidade` peças.
 *
 * POR QUE NÃO MÉDIA FRACIONADA
 * Diluir "30 min que rendem 50 peças" em 36 s/peça só acerta o total quando o
 * lote tem exatamente 50. Num lote de 10 você gasta os 30 minutos do mesmo
 * jeito (a mesa é montada uma vez, não um quinto de vez); num lote de 120 são
 * três cortes, 90 minutos. E a média apaga o DEGRAU — gargalo é ocupação numa
 * janela de tempo, e 30 minutos contínuos travando a máquina é um fato de
 * planejamento que 36 segundos por peça escondem.
 */
export function custoOperacaoSegundos(op: Operacao, quantidade: number): number {
  if (op.tempoSegundos == null || quantidade <= 0) return 0
  if (op.tipo === 'por_peca') return op.tempoSegundos * quantidade
  // por_lote sem rendimento = uma vez só, independente do tamanho do lote
  // (montar enfesto, regular máquina).
  if (!op.rendePecas) return op.tempoSegundos
  return op.tempoSegundos * Math.ceil(quantidade / op.rendePecas)
}

export type CustoLote = {
  quantidade: number
  totalSegundos: number
  /** O que o lote custa dividido por peça — número derivado, nunca cadastrado. */
  porPecaSegundos: number
  porMaquina: { maquinaId: string | null; maquinaNome: string; segundos: number }[]
}

/** Custo de um lote inteiro, com a quebra por máquina (a base do gargalo). */
export function custoDoLote(produto: Produto, quantidade: number): CustoLote {
  const porMaquina = new Map<string, { maquinaId: string | null; maquinaNome: string; segundos: number }>()
  let total = 0

  for (const op of produto.operacoes) {
    const seg = custoOperacaoSegundos(op, quantidade)
    if (!seg) continue
    total += seg
    const chave = op.maquinaId ?? 'sem_maquina'
    const atual = porMaquina.get(chave)
    if (atual) atual.segundos += seg
    else {
      porMaquina.set(chave, {
        maquinaId: op.maquinaId,
        maquinaNome: op.maquinaNome ?? 'Sem máquina',
        segundos: seg,
      })
    }
  }

  return {
    quantidade,
    totalSegundos: total,
    porPecaSegundos: quantidade > 0 ? total / quantidade : 0,
    porMaquina: [...porMaquina.values()].sort((a, b) => b.segundos - a.segundos),
  }
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
  tipo: TipoRecurso
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
    tipo: l.tipo ?? 'maquina',
    capacidadeHorasDia: quantidade * horasDia,
  }
}

const COLUNAS_MAQUINA =
  'id, codigo, nome, quantidade, horas_dia, setup_troca_min, observacao, ordem, ativo, tipo'

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
  tipo?: TipoRecurso
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
    tipo: params.tipo ?? 'maquina',
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
  tipo: TipoOperacao
  rende_pecas: number | null
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
      .select('id, produto_id, ordem, descricao, maquina_id, tempo_segundos, tipo, rende_pecas, observacao')
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
      tipo: o.tipo ?? 'por_peca',
      rendePecas: o.rende_pecas,
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
    const porPeca = operacoes.filter((o) => o.tipo === 'por_peca')
    const porPecaIncompleto = porPeca.some((o) => o.tempoSegundos == null)
    return {
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      descricao: p.descricao,
      ativo: p.ativo,
      operacoes,
      componentes: compsPorProduto.get(p.id) ?? [],
      // Só existe quando todas as por-peça têm tempo. Somar as conhecidas e
      // ignorar as vazias daria um número menor que a realidade, sem aviso.
      tempoPorPecaSegundos: porPeca.length && !porPecaIncompleto
        ? porPeca.reduce((s, o) => s + (o.tempoSegundos ?? 0), 0)
        : null,
      temOperacaoPorLote: operacoes.some((o) => o.tipo === 'por_lote'),
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
    tipo?: TipoOperacao
    rendePecas?: number | null
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
        tipo: o.tipo ?? 'por_peca',
        // Rendimento só sobrevive no por_lote — o CHECK do banco recusa o resto,
        // e mandar mesmo assim quebraria o salvamento inteiro por uma linha.
        rende_pecas:
          o.tipo === 'por_lote' && o.rendePecas && o.rendePecas > 0
            ? Math.round(o.rendePecas)
            : null,
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

// ---------------------------------------------------------------------------
// O ELO: card do quadro de produção → produto, cor e grade
//
// Sem isto o roteiro não vale nada operacionalmente: "10 camisas" em texto
// livre não diz ao sistema que são camisas básicas na grade M/G em preto, e
// portanto não vira hora de overloque.
// ---------------------------------------------------------------------------

export type ItemProducao = {
  id: string
  produtoId: string
  produtoNome: string
  cor: string
  tamanho: string
  quantidade: number
  observacao: string | null
}

export async function listarItensCard(cardId: string): Promise<ItemProducao[]> {
  const { data } = await supabaseAdmin
    .from('pcp_producao_itens')
    .select('id, produto_id, cor, tamanho, quantidade, observacao, pcp_produtos(nome)')
    .eq('card_id', cardId)
    .order('cor')
    .order('tamanho')

  return ((data ?? []) as unknown as {
    id: string
    produto_id: string
    cor: string
    tamanho: string
    quantidade: number
    observacao: string | null
    pcp_produtos: { nome: string } | null
  }[]).map((l) => ({
    id: l.id,
    produtoId: l.produto_id,
    produtoNome: l.pcp_produtos?.nome ?? '—',
    cor: l.cor,
    tamanho: l.tamanho,
    quantidade: l.quantidade,
    observacao: l.observacao,
  }))
}

/** Grava a lista inteira do card — mesma estratégia do roteiro e da ficha. */
export async function salvarItensCard(
  cardId: string,
  itens: {
    produtoId: string
    cor: string
    tamanho: string
    quantidade: number
    observacao?: string | null
  }[],
): Promise<ResultadoPcp> {
  const limpos = itens
    .map((i) => ({
      ...i,
      cor: (i.cor || '').trim() || 'Único',
      tamanho: (i.tamanho || '').trim().toUpperCase(),
    }))
    .filter((i) => i.produtoId && i.tamanho && i.quantidade > 0)

  // A unique (card, produto, cor, tamanho) protege o banco, mas um duplicado
  // vindo da tela derrubaria o insert inteiro. Somar é o que a pessoa quis
  // dizer ao digitar "M 5" duas vezes.
  const somados = new Map<string, (typeof limpos)[number]>()
  for (const i of limpos) {
    const chave = `${i.produtoId}|${i.cor}|${i.tamanho}`
    const atual = somados.get(chave)
    if (atual) atual.quantidade += i.quantidade
    else somados.set(chave, { ...i })
  }

  const { error: delErr } = await supabaseAdmin
    .from('pcp_producao_itens')
    .delete()
    .eq('card_id', cardId)
  if (delErr) return { ok: false, erro: delErr.message }

  if (somados.size) {
    const { error } = await supabaseAdmin.from('pcp_producao_itens').insert(
      [...somados.values()].map((i) => ({
        card_id: cardId,
        produto_id: i.produtoId,
        cor: i.cor,
        tamanho: i.tamanho,
        quantidade: Math.round(i.quantidade),
        observacao: i.observacao?.trim() || null,
      })),
    )
    if (error) return { ok: false, erro: error.message }
  }

  return { ok: true, id: cardId }
}

export type CargaMaquina = {
  maquinaId: string | null
  maquinaNome: string
  /** Tempo das operações em si. */
  producaoSegundos: number
  /** Tempo perdido trocando linha de cor nesta máquina. */
  setupSegundos: number
  totalSegundos: number
  /** null quando a operação não tem máquina (corte manual, conferência). */
  capacidadeHorasDia: number | null
  /** Quantos dias de máquina esta carga ocupa. Null sem capacidade cadastrada. */
  diasDeMaquina: number | null
}

export type CargaCard = {
  cardId: string
  totalPecas: number
  totalSegundos: number
  setupSegundos: number
  /** Horas de design, modelagem etc. já incluídas em `porMaquina`. */
  servicosSegundos: number
  /** O que os serviços deste card somam de cobrança ao cliente. */
  servicosCentavos: number
  porMaquina: CargaMaquina[]
  /** Produtos citados no card que ainda têm operação sem tempo. */
  produtosIncompletos: string[]
  /** Cores distintas — é o que multiplica o setup. */
  cores: string[]
}

/**
 * Quanto trabalho este card é, por máquina.
 *
 * AGRUPA POR (PRODUTO, COR), NÃO POR CARD INTEIRO
 * Operação por lote — cortar viés, montar enfesto — é feita por layout, e o
 * layout é de um produto numa cor. Somar as peças de cores diferentes antes de
 * aplicar o teto do rendimento faria o sistema achar que um corte só atende
 * preto e branco juntos, o que não acontece na mesa.
 *
 * O SETUP É POR MÁQUINA × COR
 * Cada máquina paga uma troca de linha por cor que passa por ela. Duas cores no
 * mesmo card = dois setups na overloque. É exatamente o custo que some quando
 * alguém dilui tudo em "tempo médio por peça".
 *
 * PRODUTO INCOMPLETO NÃO ENTRA
 * Se falta cronometrar qualquer operação do produto, ele fica de fora da conta
 * e o nome dele volta em `produtosIncompletos`. Somar o que se conhece daria um
 * número menor que a realidade, e ninguém notaria.
 */
export async function cargaDoCard(cardId: string): Promise<CargaCard> {
  const [itens, produtos, maquinas, servicos] = await Promise.all([
    listarItensCard(cardId),
    listarProdutos(true),
    listarMaquinas(true),
    listarServicosCard(cardId),
  ])

  const porId = new Map(produtos.map((p) => [p.id, p]))
  const maquinaPorId = new Map(maquinas.map((m) => [m.id, m]))

  const grupos = new Map<string, { produtoId: string; cor: string; quantidade: number }>()
  let totalPecas = 0
  for (const i of itens) {
    totalPecas += i.quantidade
    const chave = `${i.produtoId}|${i.cor}`
    const atual = grupos.get(chave)
    if (atual) atual.quantidade += i.quantidade
    else grupos.set(chave, { produtoId: i.produtoId, cor: i.cor, quantidade: i.quantidade })
  }

  const producaoPorMaquina = new Map<string, { maquinaId: string | null; nome: string; segundos: number }>()
  // Chave "maquinaId|cor" — o setup é pago uma vez por combinação.
  const setupsCobrados = new Set<string>()
  const incompletos = new Set<string>()
  let setupTotal = 0

  for (const g of grupos.values()) {
    const produto = porId.get(g.produtoId)
    if (!produto) continue
    if (!produto.prontoParaCalculo) {
      incompletos.add(produto.nome)
      continue
    }

    const custo = custoDoLote(produto, g.quantidade)
    for (const linha of custo.porMaquina) {
      const chave = linha.maquinaId ?? 'sem_maquina'
      const atual = producaoPorMaquina.get(chave)
      if (atual) atual.segundos += linha.segundos
      else {
        producaoPorMaquina.set(chave, {
          maquinaId: linha.maquinaId,
          nome: linha.maquinaNome,
          segundos: linha.segundos,
        })
      }

      if (linha.maquinaId) {
        const chaveSetup = `${linha.maquinaId}|${g.cor}`
        if (!setupsCobrados.has(chaveSetup)) {
          setupsCobrados.add(chaveSetup)
          setupTotal += (maquinaPorId.get(linha.maquinaId)?.setupTrocaMin ?? 0) * 60
        }
      }
    }
  }

  // Serviços entram como produção no posto que os executa. Serviço sem recurso
  // é terceirizado: conta como prazo e custo, mas não ocupa capacidade nossa —
  // por isso fica fora de `porMaquina`, e não numa linha "sem máquina" que
  // apareceria disputando gargalo com a costura.
  let servicosSegundos = 0
  let servicosCentavos = 0
  for (const sv of servicos) {
    const seg = Math.round(sv.horas * 3600)
    servicosSegundos += seg
    servicosCentavos += sv.precoCentavos ?? 0
    if (!sv.recursoId) continue
    const atual = producaoPorMaquina.get(sv.recursoId)
    if (atual) atual.segundos += seg
    else {
      producaoPorMaquina.set(sv.recursoId, {
        maquinaId: sv.recursoId,
        nome: sv.recursoNome ?? 'Posto',
        segundos: seg,
      })
    }
  }

  const porMaquina: CargaMaquina[] = [...producaoPorMaquina.values()].map((m) => {
    const maquina = m.maquinaId ? maquinaPorId.get(m.maquinaId) : null
    const setup = m.maquinaId
      ? [...setupsCobrados].filter((c) => c.startsWith(`${m.maquinaId}|`)).length *
        (maquina?.setupTrocaMin ?? 0) * 60
      : 0
    const total = m.segundos + setup
    const capacidade = maquina?.capacidadeHorasDia ?? null
    return {
      maquinaId: m.maquinaId,
      maquinaNome: m.nome,
      producaoSegundos: m.segundos,
      setupSegundos: setup,
      totalSegundos: total,
      capacidadeHorasDia: capacidade,
      diasDeMaquina: capacidade && capacidade > 0 ? total / 3600 / capacidade : null,
    }
  })

  // Máquina mais carregada primeiro: o gargalo é a primeira linha da lista.
  porMaquina.sort((a, b) => (b.diasDeMaquina ?? 0) - (a.diasDeMaquina ?? 0) || b.totalSegundos - a.totalSegundos)

  return {
    cardId,
    totalPecas,
    totalSegundos: porMaquina.reduce((s, m) => s + m.totalSegundos, 0),
    setupSegundos: setupTotal,
    servicosSegundos,
    servicosCentavos,
    porMaquina,
    produtosIncompletos: [...incompletos],
    cores: [...new Set(itens.map((i) => i.cor))],
  }
}

// ---------------------------------------------------------------------------
// SERVIÇOS — design, modelagem, ajuste de grade
//
// POR QUE NÃO SÃO OPERAÇÃO DO PRODUTO
// Decisão do Fernando (22/08/2026): modelagem "varia por pedido — só às vezes".
// Se morasse no roteiro do produto, seria cobrada em todo pedido daquele
// modelo, inclusive nos que reaproveitam a modelagem antiga. Por isso o
// serviço é pendurado no CARD.
//
// POR QUE O POSTO É UM "RECURSO" E NÃO UMA TABELA NOVA
// Ele também respondeu que design e modelagem "são horas minhas/da equipe" —
// disputam tempo e podem virar gargalo. A conta é idêntica à da máquina
// (quantidade × horas/dia), então reaproveito `pcp_maquinas` com `tipo`. Duas
// tabelas para o mesmo conceito divergiriam na primeira mudança de regra.
// ---------------------------------------------------------------------------

export type Servico = {
  id: string
  codigo: string
  nome: string
  recursoId: string | null
  recursoNome: string | null
  horasPadrao: number | null
  precoCentavos: number | null
  descricao: string | null
  ativo: boolean
}

export async function listarServicos(incluirInativos = false): Promise<Servico[]> {
  let q = supabaseAdmin
    .from('pcp_servicos')
    .select('id, codigo, nome, recurso_id, horas_padrao, preco_centavos, descricao, ativo, pcp_maquinas(nome)')
    .order('nome')
  if (!incluirInativos) q = q.eq('ativo', true)

  const { data } = await q
  return ((data ?? []) as unknown as {
    id: string
    codigo: string
    nome: string
    recurso_id: string | null
    horas_padrao: string | number | null
    preco_centavos: number | null
    descricao: string | null
    ativo: boolean
    pcp_maquinas: { nome: string } | null
  }[]).map((l) => ({
    id: l.id,
    codigo: l.codigo,
    nome: l.nome,
    recursoId: l.recurso_id,
    recursoNome: l.pcp_maquinas?.nome ?? null,
    horasPadrao: l.horas_padrao == null ? null : num(l.horas_padrao),
    precoCentavos: l.preco_centavos,
    descricao: l.descricao,
    ativo: l.ativo,
  }))
}

export async function salvarServico(params: {
  id?: string | null
  codigo: string
  nome: string
  recursoId: string | null
  horasPadrao: number | null
  precoCentavos: number | null
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
  if (!params.nome.trim()) return { ok: false, erro: 'Informe o nome do serviço' }

  const linha = {
    codigo,
    nome: params.nome.trim(),
    recurso_id: params.recursoId || null,
    horas_padrao: params.horasPadrao && params.horasPadrao > 0 ? params.horasPadrao : null,
    preco_centavos:
      params.precoCentavos != null && params.precoCentavos >= 0 ? Math.round(params.precoCentavos) : null,
    descricao: params.descricao?.trim() || null,
    ativo: params.ativo ?? true,
    atualizado_em: new Date().toISOString(),
  }

  if (params.id) {
    const { error } = await supabaseAdmin.from('pcp_servicos').update(linha).eq('id', params.id)
    if (error) return { ok: false, erro: error.message }
    return { ok: true, id: params.id }
  }

  const { data, error } = await supabaseAdmin
    .from('pcp_servicos')
    .insert(linha)
    .select('id')
    .maybeSingle<{ id: string }>()
  if (error) return { ok: false, erro: error.message }
  return { ok: true, id: data?.id }
}

export type ServicoDoCard = {
  id: string
  servicoId: string
  servicoNome: string
  recursoId: string | null
  recursoNome: string | null
  horas: number
  precoCentavos: number | null
  descricao: string | null
}

export async function listarServicosCard(cardId: string): Promise<ServicoDoCard[]> {
  const { data } = await supabaseAdmin
    .from('pcp_producao_servicos')
    .select('id, servico_id, horas, preco_centavos, descricao, pcp_servicos(nome, recurso_id, pcp_maquinas(nome))')
    .eq('card_id', cardId)
    .order('criado_em')

  return ((data ?? []) as unknown as {
    id: string
    servico_id: string
    horas: string | number
    preco_centavos: number | null
    descricao: string | null
    pcp_servicos: { nome: string; recurso_id: string | null; pcp_maquinas: { nome: string } | null } | null
  }[]).map((l) => ({
    id: l.id,
    servicoId: l.servico_id,
    servicoNome: l.pcp_servicos?.nome ?? '—',
    recursoId: l.pcp_servicos?.recurso_id ?? null,
    recursoNome: l.pcp_servicos?.pcp_maquinas?.nome ?? null,
    horas: num(l.horas),
    precoCentavos: l.preco_centavos,
    descricao: l.descricao,
  }))
}

/** Grava a lista inteira de serviços do card — mesma estratégia dos itens. */
export async function salvarServicosCard(
  cardId: string,
  servicos: {
    servicoId: string
    horas: number
    precoCentavos?: number | null
    descricao?: string | null
  }[],
): Promise<ResultadoPcp> {
  // Serviço sem horas não é serviço: seria uma linha que ocupa a tela e não
  // entra em conta nenhuma. Some no salvamento em vez de virar zero silencioso.
  const limpos = servicos.filter((s) => s.servicoId && s.horas > 0)

  const { error: delErr } = await supabaseAdmin
    .from('pcp_producao_servicos')
    .delete()
    .eq('card_id', cardId)
  if (delErr) return { ok: false, erro: delErr.message }

  if (limpos.length) {
    const { error } = await supabaseAdmin.from('pcp_producao_servicos').insert(
      limpos.map((s) => ({
        card_id: cardId,
        servico_id: s.servicoId,
        horas: s.horas,
        preco_centavos:
          s.precoCentavos != null && s.precoCentavos >= 0 ? Math.round(s.precoCentavos) : null,
        descricao: s.descricao?.trim() || null,
      })),
    )
    if (error) return { ok: false, erro: error.message }
  }

  return { ok: true, id: cardId }
}
