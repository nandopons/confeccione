#!/usr/bin/env node
// scripts/migrar-imagens-para-storage.mjs
// ============================================================================
// Migração pontual: tira os data URIs de `pedidos_assistente` e põe no bucket.
//
// O código novo (app/lib/imagens-pedido-storage.ts) já grava no Storage, então
// pedido NOVO nasce leve. Este script é só pros 178 pedidos antigos, que ainda
// carregam ~107 MB de base64 no TOAST.
//
// SEGURANÇA — a ordem importa
//   1. sobe a imagem pro bucket
//   2. BAIXA DE VOLTA e compara o sha256 byte a byte
//   3. só então reescreve a linha trocando o base64 pela referência
// Se a verificação falhar em qualquer imagem do pedido, a linha inteira fica
// como está. Nada é apagado: os bytes existem no bucket antes do banco mudar.
//
// USO
//   node scripts/migrar-imagens-para-storage.mjs            # simulação (padrão)
//   node scripts/migrar-imagens-para-storage.mjs --aplicar  # grava de verdade
//   node scripts/migrar-imagens-para-storage.mjs --aplicar --limite 5
//
// Precisa de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente
// (é só rodar com o .env.local carregado, ex.: `node --env-file=.env.local ...`).
//
// É idempotente: rodar de novo não duplica nada — o nome do arquivo é o hash
// do conteúdo e o que já virou referência é ignorado.
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
const LIMITE = (() => {
  const i = process.argv.indexOf('--limite')
  return i > -1 ? parseInt(process.argv[i + 1], 10) || 0 : 0
})()

const BUCKET = 'artes-clientes'
const PREFIXO = 'storage:'
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
}

const db = createClient(URL, KEY)
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

/** Sobe e CONFIRMA. Devolve a referência, ou null se não deu pra confiar. */
async function subirEConferir(dataUrl, pedidoId) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const mime = m[1]
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length === 0) return null

  const digest = sha(bytes)
  const caminho = `pedidos/${pedidoId}/${digest.slice(0, 32)}.${EXT[mime.toLowerCase()] ?? 'bin'}`

  const up = await db.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: true })
  if (up.error) { console.error('   upload falhou:', caminho, up.error.message); return null }

  // A conferência é o que autoriza mexer no banco.
  const down = await db.storage.from(BUCKET).download(caminho)
  if (down.error || !down.data) { console.error('   releitura falhou:', caminho); return null }
  const volta = Buffer.from(await down.data.arrayBuffer())
  if (sha(volta) !== digest) { console.error('   CONTEÚDO DIFERENTE na volta:', caminho); return null }

  return `${PREFIXO}${caminho}`
}

/** Percorre o mapa de mockups trocando data URIs por referências. */
async function migrarMockups(mockups, pedidoId, contador) {
  if (!mockups || typeof mockups !== 'object') return { valor: mockups, ok: true }
  const saida = {}
  let ok = true
  for (const [k, v] of Object.entries(mockups)) {
    const novo = { ...v }
    for (const campo of ['liso', 'arte']) {
      if (typeof v?.[campo] === 'string' && v[campo].startsWith('data:')) {
        const ref = await subirEConferir(v[campo], pedidoId)
        if (!ref) { ok = false; continue }
        novo[campo] = ref; contador.migradas++
      }
    }
    if (Array.isArray(v?.fotos)) {
      novo.fotos = []
      for (const f of v.fotos) {
        if (typeof f === 'string' && f.startsWith('data:')) {
          const ref = await subirEConferir(f, pedidoId)
          if (!ref) { ok = false; novo.fotos.push(f); continue }
          novo.fotos.push(ref); contador.migradas++
        } else novo.fotos.push(f)
      }
    }
    if (Array.isArray(v?.ia)) {
      novo.ia = []
      for (const it of v.ia) {
        if (typeof it?.url === 'string' && it.url.startsWith('data:')) {
          const ref = await subirEConferir(it.url, pedidoId)
          if (!ref) { ok = false; novo.ia.push(it); continue }
          novo.ia.push({ ...it, url: ref }); contador.migradas++
        } else novo.ia.push(it)
      }
    }
    saida[k] = novo
  }
  return { valor: saida, ok }
}

async function main() {
  console.log(APLICAR ? '>> MODO GRAVAÇÃO\n' : '>> SIMULAÇÃO (use --aplicar para gravar)\n')

  const { data: ids, error } = await db
    .from('pedidos_assistente')
    .select('id, codigo')
    .order('criado_em', { ascending: true })
  if (error) { console.error(error.message); process.exit(1) }

  const alvos = LIMITE > 0 ? ids.slice(0, LIMITE) : ids
  const contador = { migradas: 0 }
  let linhasMexidas = 0, linhasPuladas = 0

  for (const { id, codigo } of alvos) {
    const { data: row } = await db
      .from('pedidos_assistente')
      .select('mockups, imagens')
      .eq('id', id)
      .maybeSingle()
    if (!row) continue

    const antes = contador.migradas
    const mk = await migrarMockups(row.mockups, id, contador)

    let imagens = row.imagens, okImgs = true
    if (Array.isArray(row.imagens)) {
      imagens = []
      for (const v of row.imagens) {
        if (typeof v === 'string' && v.startsWith('data:')) {
          const ref = await subirEConferir(v, id)
          if (!ref) { okImgs = false; imagens.push(v); continue }
          imagens.push(ref); contador.migradas++
        } else imagens.push(v)
      }
    }

    const mexeu = contador.migradas > antes
    if (!mexeu) continue

    if (!mk.ok || !okImgs) {
      console.log(`!! ${codigo ?? id}: alguma imagem não passou na conferência — linha INTOCADA`)
      linhasPuladas++
      continue
    }

    if (APLICAR) {
      const { error: errUpd } = await db
        .from('pedidos_assistente')
        .update({ mockups: mk.valor, imagens })
        .eq('id', id)
      if (errUpd) { console.log(`!! ${codigo ?? id}: update falhou — ${errUpd.message}`); linhasPuladas++; continue }
    }
    linhasMexidas++
    console.log(`ok ${codigo ?? id} (${contador.migradas - antes} imagens)`)
  }

  console.log(`\n${APLICAR ? 'Migrados' : 'Migrariam'}: ${linhasMexidas} pedidos, ${contador.migradas} imagens`)
  if (linhasPuladas) console.log(`Pulados por falha de conferência: ${linhasPuladas}`)
  if (APLICAR) {
    console.log('\nO espaço no disco só volta a ser reaproveitado depois do autovacuum.')
    console.log('Para devolver os MB ao sistema de arquivos seria preciso VACUUM FULL,')
    console.log('que trava a tabela — decida isso separadamente, fora do horário de pico.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
