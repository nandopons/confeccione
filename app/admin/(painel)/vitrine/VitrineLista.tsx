'use client'

// app/admin/(painel)/vitrine/VitrineLista.tsx
// ============================================================================
// Curadoria da vitrine. Cada foto que um fornecedor sobe cai aqui; o que estiver
// marcado como destaque aparece no carrossel da home.
//
// Decisão do Fernando (03/09/2026): a home é curada, não é feed automático. O
// custo é este clique; o ganho é que a primeira dobra do site nunca fica refém
// da foto que um fornecedor resolveu mandar.
//
// 05/09/2026 — o admin também EDITA a ficha daqui ("às vezes preciso dar algum
// suporte ao fornecedor"). Sem ficha, a foto não vira página de produto e não
// recebe pedido direto: o gargalo era a confecção não preencher, e o suporte
// não ter como destravar. Mesmo formulário do painel do fornecedor, rota
// auditada — ver /api/admin/vitrine/ficha.
//
// E ajusta a IMAGEM: enquadramento e recorte de fundo. São as mesmas funções do
// painel do fornecedor (`Dono = { admin: true }`), porque quem decide o que
// abre a home é a curadoria — esperar a confecção entrar no painel dela pra
// arrumar um enquadramento ruim é esperar por algo que não acontece. A foto
// original nunca é apagada, então nada aqui é irreversível.
// ============================================================================

import Image from 'next/image'
import { useState } from 'react'
import FichaProdutoModal from '@/app/fornecedor/painel/portfolio/FichaProdutoModal'
import AjusteFotoModal from '@/app/components/AjusteFotoModal'
import type { PortfolioItem } from '@/app/lib/portfolio-fornecedor'

export type ItemVitrine = PortfolioItem & {
  fornecedorId: string
  fornecedorNome: string | null
  fornecedorCidade: string | null
  fornecedorUf: string | null
  criadoEm: string
}

type Filtro = 'todas' | 'sem-destaque' | 'destaque'

const ROTULO: Record<Filtro, string> = {
  todas: 'Todas',
  'sem-destaque': 'Aguardando',
  destaque: 'Na home',
}

export default function VitrineLista({
  inicial,
  recorteDisponivel,
}: {
  inicial: ItemVitrine[]
  recorteDisponivel: boolean
}) {
  const [itens, setItens] = useState(inicial)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [salvando, setSalvando] = useState<string | null>(null)
  const [editando, setEditando] = useState<ItemVitrine | null>(null)
  const [ajustando, setAjustando] = useState<ItemVitrine | null>(null)
  // id da foto em processamento: trava só aquele card, não a página inteira —
  // o recorte leva segundos e a curadoria é feita em lote.
  const [imagemOcupada, setImagemOcupada] = useState<string | null>(null)
  const [erroImagem, setErroImagem] = useState<string | null>(null)

  const visiveis = itens.filter((i) =>
    filtro === 'todas' ? true : filtro === 'destaque' ? i.destaque : !i.destaque,
  )
  const nDestaque = itens.filter((i) => i.destaque).length

  async function alternar(item: ItemVitrine) {
    setSalvando(item.id)
    const novo = !item.destaque
    // Otimista: a lista responde na hora e volta atrás se a API recusar.
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, destaque: novo } : i)))
    try {
      const r = await fetch('/api/admin/vitrine', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id, destaque: novo }),
      })
      if (!r.ok) throw new Error('falhou')
    } catch {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, destaque: !novo } : i)))
    } finally {
      setSalvando(null)
    }
  }

  // Aplica no item o que a rota devolveu. O `url` muda a cada operação (path
  // novo no storage, de propósito, pra furar o cache do CDN e do next/image),
  // então trocar o objeto inteiro é o que faz a miniatura atualizar na hora.
  function aplicarNoItem(id: string, salvo: PortfolioItem) {
    setItens((atual) => atual.map((i) => (i.id === id ? { ...i, ...salvo } : i)))
  }

  async function alternarFundo(item: ItemVitrine) {
    setErroImagem(null)
    setImagemOcupada(item.id)
    try {
      const r = await fetch(`/api/admin/vitrine/${item.id}/fundo`, {
        method: item.fundoRemovido ? 'DELETE' : 'POST',
      })
      const json = await r.json()
      if (!r.ok) {
        setErroImagem(json?.error ?? 'não consegui remover o fundo')
        return
      }
      aplicarNoItem(item.id, json as PortfolioItem)
    } catch {
      setErroImagem('falha de conexão ao remover o fundo')
    } finally {
      setImagemOcupada(null)
    }
  }

  return (
    <>
      {erroImagem && (
        <p className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {erroImagem}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(Object.keys(ROTULO) as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
              filtro === f
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {ROTULO[f]}
            {f === 'destaque' && nDestaque > 0 ? ` (${nDestaque})` : ''}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-auto">
          {nDestaque} foto{nDestaque === 1 ? '' : 's'} no carrossel da home
        </span>
      </div>

      {visiveis.length === 0 ? (
        <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-2xl px-6 py-10 text-center">
          {itens.length === 0
            ? 'Nenhum fornecedor subiu foto ainda. Elas aparecem aqui assim que chegarem.'
            : 'Nada neste filtro.'}
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {visiveis.map((item) => (
            <li key={item.id} className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
              <div className="relative bg-gray-100">
                <Image
                  src={item.url}
                  alt={item.legenda ?? `Peça de ${item.fornecedorNome ?? 'fornecedor'}`}
                  width={item.largura ?? 1080}
                  height={item.altura ?? 1350}
                  sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
                  className="w-full object-cover aspect-[4/5]"
                />
                {item.destaque && (
                  <span className="absolute top-2 left-2 bg-[#1D9E75] text-white text-[10px] font-medium px-2 py-1 rounded-full">
                    Na home
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm text-gray-900 font-medium truncate" title={item.nome ?? ''}>
                  {item.nome ?? <span className="text-amber-600">Sem ficha de produto</span>}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {item.fornecedorNome ?? 'Fornecedor sem nome'}
                  {' · '}
                  {[item.fornecedorCidade, item.fornecedorUf].filter(Boolean).join('/') || '—'}
                </p>
                <button
                  type="button"
                  onClick={() => alternar(item)}
                  disabled={salvando === item.id}
                  className={`mt-3 w-full text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                    item.destaque
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-[#1D9E75] text-white hover:bg-[#0F6E56]'
                  }`}
                >
                  {item.destaque ? 'Tirar da home' : 'Destacar na home'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditando(item)}
                  className="mt-1.5 w-full text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors"
                >
                  {item.nome ? 'Editar ficha' : 'Preencher ficha'}
                </button>

                {item.podeReenquadrar && (
                  <button
                    type="button"
                    onClick={() => setAjustando(item)}
                    className="mt-1.5 w-full text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors"
                  >
                    Ajustar enquadramento
                  </button>
                )}

                {recorteDisponivel && (
                  <button
                    type="button"
                    onClick={() => alternarFundo(item)}
                    disabled={imagemOcupada === item.id}
                    className="mt-1.5 w-full text-xs font-medium px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors disabled:opacity-60"
                  >
                    {imagemOcupada === item.id
                      ? 'Processando…'
                      : item.fundoRemovido
                        ? 'Voltar ao original'
                        : 'Remover fundo'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {ajustando && (
        <AjusteFotoModal
          foto={ajustando}
          endpoint={`/api/admin/vitrine/${ajustando.id}/enquadramento`}
          aoFechar={() => setAjustando(null)}
          aoSalvar={(salvo) => {
            aplicarNoItem(ajustando.id, salvo)
            setAjustando(null)
          }}
        />
      )}

      {editando && (
        <FichaProdutoModal
          foto={editando}
          titulo="Ficha do produto (suporte)"
          aviso={`Você está editando a ficha de ${
            editando.fornecedorNome ?? 'um fornecedor'
          }. A alteração fica registrada no log com o seu nome, e ela aparece no painel dele.`}
          endpoint="/api/admin/vitrine/ficha"
          aoFechar={() => setEditando(null)}
          aoSalvar={(salvo) => {
            setItens((atual) =>
              atual.map((i) => (i.id === salvo.id ? { ...i, ...salvo } : i)),
            )
            setEditando(null)
          }}
        />
      )}
    </>
  )
}
