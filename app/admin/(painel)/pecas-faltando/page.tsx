// app/admin/(painel)/pecas-faltando/page.tsx
// ============================================================================
// O QUE O CATÁLOGO ESTÁ DEIXANDO PASSAR (05/09/2026).
//
// O catálogo de peças (app/lib/pecas.ts) é uma aposta nossa sobre o que o
// mercado pede. Antes do campo "Outros", errar essa aposta era invisível: o
// cliente marcava a peça mais ou menos parecida — e aí o match errava e a
// culpa parecia ser do matching — ou fechava a aba. Nos dois casos a gente não
// ficava sabendo.
//
// Esta tela é o retorno desse campo. Cada linha é alguém dizendo, com as
// palavras dele, o que a Confeccione não sabe atender ou não sabe oferecer.
// Quando um mesmo assunto repete, vira peça nova em app/lib/pecas.ts.
// ============================================================================

import Link from 'next/link'
import { supabaseAdmin } from '@/app/lib/supabase-server'
import { pecaLabel } from '@/app/lib/pecas'

export const dynamic = 'force-dynamic'

type PedidoOutro = {
  id: string
  codigo: number | null
  peca: string | null
  peca_outro: string
  nome: string | null
  uf: string | null
  criado_em: string
}

type FornecedorOutro = {
  id: string
  nome: string | null
  pecas: string[] | null
  pecas_outro: string
  estado: string | null
  criado_em: string | null
}

function data(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

/** Palavras que se repetem no texto livre — o sinal de "isso virou peça".
 *  Heurística grosseira de propósito: quem decide é você lendo, não a contagem. */
function termosRecorrentes(textos: string[]): Array<{ termo: string; n: number }> {
  const PARAR = new Set([
    'de','da','do','das','dos','e','ou','a','o','as','os','um','uma','uns','umas',
    'para','pra','por','com','sem','em','no','na','nos','nas','que','tipo','tudo',
    'mais','também','tambem','sob','medida','faço','faco','fazemos','produzo',
    'produzimos','peça','peca','peças','pecas','roupa','roupas','etc',
  ])
  const conta = new Map<string, number>()
  for (const t of textos) {
    const vistas = new Set(
      t
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length >= 4 && !PARAR.has(p)),
    )
    for (const p of vistas) conta.set(p, (conta.get(p) ?? 0) + 1)
  }
  return [...conta.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([termo, n]) => ({ termo, n }))
}

export default async function PecasFaltando() {
  const [pedidosRes, fornecedoresRes] = await Promise.all([
    supabaseAdmin
      .from('pedidos_assistente')
      .select('id, codigo, peca, peca_outro, nome, uf, criado_em')
      .not('peca_outro', 'is', null)
      .order('criado_em', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('leads_fornecedores')
      .select('id, nome, pecas, pecas_outro, estado, criado_em')
      .not('pecas_outro', 'is', null)
      .order('criado_em', { ascending: false })
      .limit(200),
  ])

  const pedidos = (pedidosRes.data ?? []) as PedidoOutro[]
  const fornecedores = (fornecedoresRes.data ?? []) as FornecedorOutro[]

  const termos = termosRecorrentes([
    ...pedidos.map((p) => p.peca_outro),
    ...fornecedores.map((f) => f.pecas_outro),
  ])

  return (
    <section className="px-5 md:px-8 pt-8 pb-14 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-2xl font-medium mb-1">Peças faltando</h1>
        <p className="text-gray-500 text-sm max-w-2xl leading-relaxed">
          O que clientes e fornecedores escreveram quando o catálogo não tinha a
          peça deles. Assunto que repete vira peça nova em{' '}
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">app/lib/pecas.ts</code>.
        </p>
      </div>

      {termos.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
          <h2 className="text-gray-900 text-sm font-medium mb-3">
            Palavras que repetem
          </h2>
          <div className="flex flex-wrap gap-2">
            {termos.map((t) => (
              <span
                key={t.termo}
                className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2.5 py-1 rounded-full"
              >
                {t.termo} <span className="opacity-60">×{t.n}</span>
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            Contagem simples de palavra, não de significado — serve pra chamar a
            sua atenção, não pra decidir por você.
          </p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ───────── Lado do cliente ───────── */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-gray-900 text-base font-medium">
              Clientes <span className="text-gray-400 font-normal">({pedidos.length})</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Demanda que a gente não soube nomear.
            </p>
          </div>
          {pedidos.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">
              Ninguém usou o campo ainda.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {pedidos.map((p) => (
                <li key={p.id} className="px-5 py-3.5">
                  <p className="text-sm text-gray-900 leading-snug">{p.peca_outro}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                    <span>{data(p.criado_em)}</span>
                    {p.nome && <span>{p.nome}</span>}
                    {p.uf && <span>{p.uf}</span>}
                    {p.peca && (
                      // Marcou uma peça E escreveu: o catálogo tem algo perto,
                      // mas não exato. É a pista mais barata de refinamento.
                      <span className="text-gray-500">
                        marcou “{pecaLabel(p.peca)}”
                      </span>
                    )}
                    <Link
                      href={`/admin/pedidos?busca=${p.codigo ?? p.id}`}
                      className="text-[#0F6E56] hover:underline"
                    >
                      ver pedido
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ───────── Lado do fornecedor ───────── */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-gray-900 text-base font-medium">
              Fornecedores{' '}
              <span className="text-gray-400 font-normal">({fornecedores.length})</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Capacidade instalada que a gente não está vendendo.
            </p>
          </div>
          {fornecedores.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">
              Ninguém usou o campo ainda.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {fornecedores.map((f) => (
                <li key={f.id} className="px-5 py-3.5">
                  <p className="text-sm text-gray-900 leading-snug">{f.pecas_outro}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-400">
                    <span>{data(f.criado_em)}</span>
                    {f.nome && <span>{f.nome}</span>}
                    {f.estado && <span>{f.estado}</span>}
                    {(f.pecas?.length ?? 0) > 0 && (
                      <span className="text-gray-500">
                        + {f.pecas!.length} do catálogo
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
