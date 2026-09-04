"use client";

// app/fornecedor/painel/portfolio/FichaProdutoModal.tsx
// ============================================================================
// Ficha do produto. Só o NOME é obrigatório: sem nome a foto não vira produto,
// não ganha página própria e continua sendo só imagem no carrossel.
//
// Preço não está aqui de propósito — o valor sai na resposta ao pedido, como no
// resto do marketplace.
// ============================================================================

import { useState } from "react";
import type { PortfolioItem } from "@/app/lib/portfolio-fornecedor";
import { tipoLabel } from "@/app/lib/ofertas-labels";

export default function FichaProdutoModal({
  foto,
  aoFechar,
  aoSalvar,
}: {
  foto: PortfolioItem;
  aoFechar: () => void;
  aoSalvar: (item: PortfolioItem) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const fd = new FormData(e.currentTarget);
    const corpo = {
      nome: String(fd.get("nome") ?? ""),
      tipo: String(fd.get("tipo") ?? ""),
      pedidoMinimo: fd.get("pedidoMinimo") ? Number(fd.get("pedidoMinimo")) : null,
      prazoDias: fd.get("prazoDias") ? Number(fd.get("prazoDias")) : null,
      tamanhos: String(fd.get("tamanhos") ?? ""),
      tecido: String(fd.get("tecido") ?? ""),
      cores: String(fd.get("cores") ?? ""),
      tecnicas: String(fd.get("tecnicas") ?? ""),
      observacoes: String(fd.get("observacoes") ?? ""),
    };

    setSalvando(true);
    try {
      const r = await fetch(`/api/fornecedor/painel/portfolio/${foto.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = await r.json();
      if (!r.ok) {
        setErro(json?.error ?? "não consegui salvar");
        return;
      }
      aoSalvar(json as PortfolioItem);
    } catch {
      setErro("falha de conexão ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  const campo =
    "w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]";
  const rotulo = "text-gray-700 text-xs font-medium block mb-1.5";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={aoFechar}
      role="presentation"
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-gray-900 font-medium">Ficha do produto</h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        <form onSubmit={enviar} className="p-5 grid sm:grid-cols-2 gap-3">
          <label className="block sm:col-span-2">
            <span className={rotulo}>Nome do produto *</span>
            <input
              name="nome"
              defaultValue={foto.nome ?? ""}
              required
              maxLength={80}
              placeholder="Ex.: Baby look gola careca"
              className={campo}
            />
            <span className="text-gray-400 text-[11px] mt-1 block">
              É esse nome que aparece na home e vira a página do produto.
            </span>
          </label>

          <label className="block">
            <span className={rotulo}>Segmento</span>
            <select name="tipo" defaultValue={foto.tipo ?? ""} className={campo}>
              <option value="">Não informar</option>
              {Object.entries(tipoLabel).map(([valor, label]) => (
                <option key={valor} value={valor}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={rotulo}>Pedido mínimo (peças)</span>
            <input
              name="pedidoMinimo"
              type="number"
              min={1}
              defaultValue={foto.pedidoMinimo ?? ""}
              placeholder="Ex.: 50"
              className={campo}
            />
          </label>

          <label className="block">
            <span className={rotulo}>Tecido / composição</span>
            <input
              name="tecido"
              defaultValue={foto.tecido ?? ""}
              maxLength={160}
              placeholder="Ex.: Malha 100% algodão 30.1 penteada"
              className={campo}
            />
          </label>

          <label className="block">
            <span className={rotulo}>Cores disponíveis</span>
            <input
              name="cores"
              defaultValue={foto.cores ?? ""}
              maxLength={160}
              placeholder="Ex.: preto, branco, off-white, sob consulta"
              className={campo}
            />
          </label>

          <label className="block">
            <span className={rotulo}>Tamanhos</span>
            <input
              name="tamanhos"
              defaultValue={foto.tamanhos ?? ""}
              maxLength={120}
              placeholder="Ex.: P ao GG (plus size sob consulta)"
              className={campo}
            />
          </label>

          <label className="block">
            <span className={rotulo}>Prazo de produção (dias úteis)</span>
            <input
              name="prazoDias"
              type="number"
              min={1}
              max={365}
              defaultValue={foto.prazoDias ?? ""}
              placeholder="Ex.: 15"
              className={campo}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className={rotulo}>Personalização que você faz</span>
            <input
              name="tecnicas"
              defaultValue={foto.tecnicas ?? ""}
              maxLength={160}
              placeholder="Ex.: silk, DTF, bordado, sublimação"
              className={campo}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className={rotulo}>Observações</span>
            <textarea
              name="observacoes"
              rows={3}
              defaultValue={foto.observacoes ?? ""}
              maxLength={400}
              placeholder="Qualquer detalhe que ajude o cliente a decidir."
              className={campo}
            />
          </label>

          {erro && (
            <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {erro}
            </p>
          )}

          <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={aoFechar}
              className="text-gray-600 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:bg-gray-300 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
            >
              {salvando ? "Salvando…" : "Salvar ficha"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
