"use client";

// app/produto/[id]/FormPedidoProduto.tsx
// ============================================================================
// Pedido direto pra UMA confecção, a partir de um produto da vitrine.
//
// Formulário curto de propósito: quantidade, tamanhos, personalização e
// contato. Tudo que der pra combinar depois fica pro alinhamento — cada campo
// a mais aqui é um pedido a menos.
// ============================================================================

import { useState } from "react";

export default function FormPedidoProduto({
  produtoId,
  produtoNome,
  pedidoMinimo,
  fornecedorNome,
}: {
  produtoId: string;
  produtoNome: string;
  pedidoMinimo: number | null;
  fornecedorNome: string | null;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    const corpo = Object.fromEntries(fd.entries());

    setEnviando(true);
    try {
      const r = await fetch(`/api/produto/${produtoId}/pedido`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = await r.json();
      if (!r.ok) {
        setErro(json?.error ?? "não consegui enviar seu pedido");
        return;
      }
      setPronto(true);
    } catch {
      setErro("falha de conexão — tente de novo");
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <div className="bg-[#F7FBF9] border border-[#E1F5EE] rounded-2xl p-6">
        <p className="text-gray-900 font-medium mb-1">Pedido enviado</p>
        <p className="text-gray-600 text-sm leading-relaxed">
          {fornecedorNome ?? "A confecção"} recebeu seu pedido de {produtoNome} e vai responder
          pelo WhatsApp com o orçamento. Se ela não puder atender, a gente te avisa e busca
          outra confecção da rede.
        </p>
      </div>
    );
  }

  const campo =
    "w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]";

  return (
    <form onSubmit={enviar} className="grid sm:grid-cols-2 gap-3 max-w-2xl">
      <label className="block">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">
          Quantidade de peças{pedidoMinimo ? ` (mínimo ${pedidoMinimo})` : ""}
        </span>
        <input
          name="quantidade"
          type="number"
          inputMode="numeric"
          min={pedidoMinimo ?? 1}
          required
          placeholder={String(pedidoMinimo ?? 50)}
          className={campo}
        />
      </label>

      <label className="block">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">Tamanhos</span>
        <input name="tamanhos" type="text" placeholder="Ex.: 20 P, 40 M, 30 G" className={campo} />
      </label>

      <label className="block sm:col-span-2">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">
          Cor e personalização
        </span>
        <textarea
          name="detalhes"
          rows={3}
          placeholder="Ex.: preta, logo bordado no peito e silk nas costas"
          className={campo}
        />
      </label>

      <label className="block">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">Seu nome</span>
        <input name="nome" type="text" required maxLength={80} className={campo} />
      </label>

      <label className="block">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">WhatsApp</span>
        <input
          name="telefone"
          type="tel"
          required
          placeholder="(81) 99999-9999"
          className={campo}
        />
      </label>

      <label className="block">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">E-mail</span>
        <input name="email" type="email" required maxLength={120} className={campo} />
      </label>

      <label className="block">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">Cidade / UF</span>
        <input name="cidade" type="text" placeholder="Recife/PE" maxLength={80} className={campo} />
      </label>

      {erro && (
        <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {erro}
        </p>
      )}

      <div className="sm:col-span-2 flex items-center gap-3 mt-1">
        <button
          type="submit"
          disabled={enviando}
          className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:bg-gray-300 text-white text-sm font-medium px-6 py-3 rounded-full transition-colors"
        >
          {enviando ? "Enviando…" : "Enviar pedido →"}
        </button>
        <span className="text-gray-400 text-xs">Sem compromisso. Você recebe o orçamento antes.</span>
      </div>
    </form>
  );
}
