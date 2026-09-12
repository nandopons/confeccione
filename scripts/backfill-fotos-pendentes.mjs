#!/usr/bin/env node
// scripts/backfill-fotos-pendentes.mjs
// ============================================================================
// Backfill pontual: a foto que o cliente mandou e que nunca chegou no pedido.
//
// Em 30 dias, 68 imagens entraram pelo WhatsApp e 11 de 19 pedidos ficaram com
// ZERO foto anexada. Anexar dependia de o modelo lembrar de chamar a ferramenta,
// e quando ele lembrava, `definirPecasPedido` apagava depois (corrigido em
// a8808e0). Os bytes nunca se perderam: estão no bucket `wa-midia` desde que a
// mensagem chegou.
//
// O QUE ELE NÃO FAZ, E É O PONTO: não diz de qual PEÇA é a foto.
//
// `mockups` é indexado por posição, e nos 5 pedidos medidos o placeholder de uma
// linha virou 2, 2, 1, 11 e 2 peças — atribuir aqui seria apostar que a foto é da
// primeira das onze. Foto na peça errada faz a confecção produzir errado, e é
// pior que foto faltando porque ninguém percebe. Então tudo cai em
// `mockups.pendentes`, chave NÃO-NUMÉRICA: `imagensDoProduto` lê
// `mockups[String(i)]` por posição, então nada aqui aparece como foto de peça
// nenhuma, nem no PDF nem na ficha da confecção. Quem atribui é quem sabe.
//
// PROVENIÊNCIA: cada foto guarda de qual `wa_mensagens.id` veio e por qual
// caminho. Sem isso, daqui a um mês "veio do backfill" e "o cliente mandou agora"
// ficam indistinguíveis — o mesmo argumento do `entrada_peca_unica`.
//
// SÓ PEDIDO ABERTO: `confirmado_em` e `encerrado_em` nulos, `status <>
// cancelado`. Mesma definição da trava do criar_pedido e do anexo na entrada; se
// as três discordarem, uma delas está escrevendo no pedido errado.
//
// REVERSÍVEL: apagar a chave `pendentes` de `mockups` desfaz tudo. Nenhuma linha
// de peça é tocada.
//
// USO
//   node --env-file=.env.local scripts/backfill-fotos-pendentes.mjs
//   node --env-file=.env.local scripts/backfill-fotos-pendentes.mjs --aplicar
//
// Idempotente: o nome do arquivo é o sha do conteúdo, e mensagem já marcada
// (`anexada_em`) é ignorada na próxima passada.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
const APLICAR = process.argv.includes('--aplicar')
const db = createClient(URL, KEY, { auth: { persistSession: false } })

const BUCKET_ORIGEM = 'wa-midia'
const BUCKET_DESTINO = 'artes-clientes'
const PREFIXO = 'storage:'
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
const MAX_BYTES = 12 * 1024 * 1024

const tel8 = (t) => (t ?? '').replace(/\D/g, '').slice(-8)

// Número de gestão não é cliente: aquela conversa é o canal de aviso do Fernando,
// e ele tem 3 pedidos de teste abertos desde junho. Foto de lá não é referência
// de peça de ninguém.
const GESTAO = new Set((process.env.WHATSAPP_GESTAO_NUMEROS ?? '').split(',').map((x) => tel8(x)).filter((x) => x.length === 8))

async function main() {
  const { data: pedidos, error: e1 } = await db
    .from('pedidos_assistente')
    .select('id, codigo, telefone, mockups, linhas, criado_em')
    .is('confirmado_em', null)
    .is('encerrado_em', null)
    .neq('status', 'cancelado')
  if (e1) throw new Error(`pedidos: ${e1.message}`)

  const { data: msgs, error: e2 } = await db
    .from('wa_mensagens')
    .select('id, conversa_id, midia_path, midia_mime, criado_em, wa_conversas!inner(contato_id, wa_contatos!inner(wa_id))')
    .eq('tipo', 'image')
    .eq('direcao', 'entrada')
    .is('anexada_em', null)
    .not('midia_path', 'is', null)
  if (e2) throw new Error(`mensagens: ${e2.message}`)

  // UMA FOTO VAI PRA UM PEDIDO SÓ.
  //
  // Três contatos aqui têm mais de um pedido aberto (um deles tem três). Iterar
  // pedido a pedido parquearia a mesma foto em todos — e aí o mesmo arquivo
  // apareceria como referência de três pedidos diferentes. O alvo é o pedido
  // aberto MAIS RECENTE do contato, que é a mesma regra do anexo na entrada e da
  // trava do criar_pedido. Se as três discordarem, uma está escrevendo no
  // pedido errado.
  const abertoDo = new Map()
  for (const p of [...pedidos].sort((a, b) => (a.criado_em ?? '').localeCompare(b.criado_em ?? ''))) {
    abertoDo.set(tel8(p.telefone), p)
  }

  const porPedido = new Map()
  for (const m of msgs) {
    const wa = m.wa_conversas?.wa_contatos?.wa_id
    if (!wa) continue
    const k = tel8(wa)
    if (GESTAO.has(k)) continue
    const alvo = abertoDo.get(k)
    if (!alvo) continue
    if (!porPedido.has(alvo.id)) porPedido.set(alvo.id, [])
    porPedido.get(alvo.id).push(m)
  }

  let totalPedidos = 0
  let totalFotos = 0
  for (const p of pedidos) {
    const lista = (porPedido.get(p.id) ?? []).sort((a, b) => a.criado_em.localeCompare(b.criado_em))
    if (lista.length === 0) continue

    const mockups = p.mockups && typeof p.mockups === 'object' ? { ...p.mockups } : {}
    const jaTem = new Set()
    for (const v of Object.values(mockups)) for (const f of v?.fotos ?? []) jaTem.add(f)

    const pend = mockups.pendentes ?? {}
    const fotos = Array.isArray(pend.fotos) ? [...pend.fotos] : []
    const de = { ...(pend.de ?? {}) }
    const marcar = []

    for (const m of lista) {
      const baixado = await db.storage.from(BUCKET_ORIGEM).download(m.midia_path)
      if (baixado.error || !baixado.data) {
        console.log(`  ! ${p.codigo} ${m.midia_path}: não baixou (${baixado.error?.message ?? 'vazio'})`)
        continue
      }
      const bytes = Buffer.from(await baixado.data.arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
        console.log(`  ! ${p.codigo}: ${bytes.byteLength} bytes, fora do limite`)
        continue
      }
      const mime = baixado.data.type || m.midia_mime || 'image/jpeg'
      if (!mime.startsWith('image/')) {
        console.log(`  ! ${p.codigo}: ${mime} não é imagem`)
        continue
      }
      const sha = createHash('sha256').update(bytes).digest('hex')
      const caminho = `pedidos/${p.id}/${sha.slice(0, 32)}.${EXT[mime.toLowerCase()] ?? 'jpg'}`
      const ref = `${PREFIXO}${caminho}`
      if (jaTem.has(ref) || fotos.includes(ref)) {
        marcar.push({ id: m.id, ref })
        continue
      }

      if (APLICAR) {
        const up = await db.storage.from(BUCKET_DESTINO).upload(caminho, bytes, { contentType: mime, upsert: true })
        if (up.error) {
          console.log(`  ! ${p.codigo}: upload falhou (${up.error.message})`)
          continue
        }
        // Mesma ordem do migrar-imagens: baixa de volta e compara byte a byte
        // ANTES de o banco apontar pra lá. Referência pra arquivo que não é o
        // que a gente acha que é seria pior que não ter referência.
        const volta = await db.storage.from(BUCKET_DESTINO).download(caminho)
        if (volta.error || !volta.data) {
          console.log(`  ! ${p.codigo}: verificação não baixou`)
          continue
        }
        const shaVolta = createHash('sha256').update(Buffer.from(await volta.data.arrayBuffer())).digest('hex')
        if (shaVolta !== sha) {
          console.log(`  ! ${p.codigo}: sha divergiu, pulando`)
          continue
        }
      }

      fotos.push(ref)
      de[ref] = { mensagem: m.id, em: m.criado_em, via: 'backfill' }
      marcar.push({ id: m.id, ref })
      totalFotos++
    }

    if (marcar.length === 0) continue
    totalPedidos++
    console.log(`${APLICAR ? '✓' : '·'} ${p.codigo}: ${fotos.length} foto(s) em pendentes (${marcar.length} mensagens)`)

    if (!APLICAR) continue
    mockups.pendentes = { fotos, de }
    const { error: e3 } = await db.from('pedidos_assistente').update({ mockups }).eq('id', p.id)
    if (e3) {
      console.log(`  ! ${p.codigo}: update falhou (${e3.message})`)
      continue
    }
    // Marca DEPOIS de gravar. Marcar antes transformaria uma falha em foto que a
    // fila considera resolvida — o sumiço silencioso de novo.
    const { error: e4 } = await db
      .from('wa_mensagens')
      .update({ anexada_em: new Date().toISOString(), anexo_motivo: 'backfill_pendentes' })
      .in('id', marcar.map((x) => x.id))
    if (e4) console.log(`  ! ${p.codigo}: marcação falhou (${e4.message})`)
  }

  console.log(`\n${APLICAR ? 'GRAVADO' : 'SIMULAÇÃO'}: ${totalFotos} foto(s) em ${totalPedidos} pedido(s).`)
  if (!APLICAR) console.log('Rode de novo com --aplicar pra gravar.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
