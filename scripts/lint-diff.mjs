// scripts/lint-diff.mjs — eslint só nas LINHAS que a mudança tocou.
//
// POR QUE — 12/09/2026. O `ship` lintava o arquivo inteiro e travava por erro
// que já estava lá: mexer em 3 linhas do inbox reprovava por 4 erros de
// react-hooks de outra época. Regra que trava por coisa alheia é regra que a
// pessoa aprende a contornar, e aí ela vale menos que nenhuma.
//
// Agora o critério é o honesto: você é responsável pelo que ESCREVEU. Erro
// preexistente aparece como aviso no fim, sem travar.
import { execSync } from 'node:child_process'

const diff = execSync('git diff -U0 HEAD -- "*.ts" "*.tsx"', { encoding: 'utf8' })
const tocadas = new Map()
let arquivo = null
for (const linha of diff.split('\n')) {
  const m1 = /^\+\+\+ b\/(.+)$/.exec(linha)
  if (m1) { arquivo = m1[1]; tocadas.set(arquivo, new Set()); continue }
  const m2 = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(linha)
  if (m2 && arquivo) {
    const ini = Number(m2[1]); const n = m2[2] === undefined ? 1 : Number(m2[2])
    for (let i = ini; i < ini + n; i++) tocadas.get(arquivo).add(i)
  }
}
const alvos = [...tocadas.keys()].filter((f) => tocadas.get(f).size > 0)
if (alvos.length === 0) { console.log('  (nenhuma linha de ts/tsx alterada)'); process.exit(0) }

let json = '[]'
try {
  json = execSync(`npx eslint -f json ${alvos.map((f) => JSON.stringify(f)).join(' ')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
} catch (e) { json = e.stdout?.toString() || '[]' }

let meus = 0, alheios = 0
for (const r of JSON.parse(json)) {
  const rel = r.filePath.replace(process.cwd() + '/', '')
  const linhasDoArquivo = tocadas.get(rel) ?? new Set()
  for (const m of r.messages) {
    if (m.severity !== 2) continue
    if (linhasDoArquivo.has(m.line)) {
      meus++
      console.error(`  ✗ ${rel}:${m.line}  ${m.message}  (${m.ruleId ?? '-'})`)
    } else alheios++
  }
}
if (alheios > 0) console.log(`  ${alheios} erro(s) preexistente(s) nos arquivos tocados — não travam, mas continuam lá`)
if (meus > 0) { console.error(`✗ ${meus} erro(s) nas linhas que você escreveu`); process.exit(1) }
console.log('  ok')
