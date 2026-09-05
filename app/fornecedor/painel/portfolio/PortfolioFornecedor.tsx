"use client";

// app/fornecedor/painel/portfolio/PortfolioFornecedor.tsx
// ============================================================================
// Vitrine do fornecedor: sobe foto, vê a grade, apaga.
//
// Regra de UX (03/09/2026): NÃO pedimos tamanho, proporção nem formato. O
// fornecedor manda a foto do celular e o servidor recorta pra 1080x1350. Pedir
// "envie 1080x1350" seria empurrar trabalho de designer pra costureira — e o
// resultado seria portfólio vazio.
// ============================================================================

import Image from "next/image";
import { useRef, useState } from "react";
import type { PortfolioItem } from "@/app/lib/portfolio-fornecedor";
import type { Enquadramento } from "@/app/lib/portfolio-normalizar";
import FichaProdutoModal from "./FichaProdutoModal";

const MAX_FOTOS = 24;

// Rótulo do que o corte PRESERVA, não da âncora técnica. "Topo" não diz nada
// pra quem só quer que a peça apareça inteira.
const ENQUADRAMENTO_ROTULO: { valor: Enquadramento; label: string; titulo: string }[] = [
  { valor: "topo", label: "Cima", titulo: "Mantém o topo da foto (padrão)" },
  { valor: "centro", label: "Meio", titulo: "Mantém o meio da foto" },
  { valor: "base", label: "Baixo", titulo: "Mantém a parte de baixo da foto" },
];

export default function PortfolioFornecedor({
  inicial,
  recorteDisponivel,
}: {
  inicial: PortfolioItem[];
  recorteDisponivel: boolean;
}) {
  const [fotos, setFotos] = useState<PortfolioItem[]>(inicial);
  const [enviando, setEnviando] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  // id da foto em recorte: trava só aquele card, não a página inteira.
  const [recortando, setRecortando] = useState<string | null>(null);
  const [reenquadrando, setReenquadrando] = useState<string | null>(null);
  const [editando, setEditando] = useState<PortfolioItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function mudarEnquadramento(foto: PortfolioItem, posicao: Enquadramento) {
    if (foto.enquadramento === posicao) return;
    setErro(null);
    setReenquadrando(foto.id);
    try {
      const r = await fetch(`/api/fornecedor/painel/portfolio/${foto.id}/enquadramento`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enquadramento: posicao }),
      });
      const json = await r.json();
      if (!r.ok) {
        setErro(json?.error ?? "não consegui mudar o enquadramento");
        return;
      }
      setFotos((atual) => atual.map((f) => (f.id === foto.id ? (json as PortfolioItem) : f)));
    } catch {
      setErro("falha de conexão ao mudar o enquadramento");
    } finally {
      setReenquadrando(null);
    }
  }

  async function alternarFundo(foto: PortfolioItem) {
    setErro(null);
    setRecortando(foto.id);
    try {
      const r = await fetch(`/api/fornecedor/painel/portfolio/${foto.id}/fundo`, {
        method: foto.fundoRemovido ? "DELETE" : "POST",
      });
      const json = await r.json();
      if (!r.ok) {
        setErro(json?.error ?? "não consegui aplicar o fundo padrão");
        return;
      }
      setFotos((atual) => atual.map((f) => (f.id === foto.id ? (json as PortfolioItem) : f)));
    } catch {
      setErro("falha de conexão ao aplicar o fundo");
    } finally {
      setRecortando(null);
    }
  }

  const cheio = fotos.length >= MAX_FOTOS;

  async function enviar(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    setErro(null);

    const restante = MAX_FOTOS - fotos.length;
    const arquivos = Array.from(lista).slice(0, Math.max(restante, 0));
    if (arquivos.length < lista.length) {
      setErro(`Você pode ter até ${MAX_FOTOS} fotos. Enviei só as primeiras.`);
    }

    setEnviando(arquivos.length);
    for (const file of arquivos) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/fornecedor/painel/portfolio", { method: "POST", body: fd });
        const json = await r.json();
        if (!r.ok) {
          setErro(json?.error ?? "não consegui enviar essa foto");
        } else {
          setFotos((atual) => [...atual, json as PortfolioItem]);
        }
      } catch {
        setErro("falha de conexão ao enviar a foto");
      } finally {
        setEnviando((n) => n - 1);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function apagar(id: string) {
    const antes = fotos;
    setFotos((atual) => atual.filter((f) => f.id !== id));
    try {
      const r = await fetch(`/api/fornecedor/painel/portfolio/${id}`, { method: "DELETE" });
      if (!r.ok) setFotos(antes);
    } catch {
      setFotos(antes);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={cheio || enviando > 0}
          className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          {enviando > 0 ? `Enviando ${enviando}…` : "Adicionar fotos"}
        </button>
        <span className="text-gray-400 text-xs">
          {fotos.length} de {MAX_FOTOS} · JPG ou PNG, até 10MB cada
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => enviar(e.target.files)}
        />
      </div>

      {erro && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {erro}
        </p>
      )}

      {fotos.length === 0 && enviando === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-2xl px-6 py-12 text-center">
          <p className="text-gray-900 font-medium mb-1">Sua vitrine está vazia</p>
          <p className="text-gray-500 text-sm max-w-sm mx-auto leading-relaxed">
            Suba fotos de peças que você já produziu. Elas aparecem para o cliente quando ele
            recebe a sua oferta — e as melhores podem entrar na página inicial da Confeccione.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {fotos.map((f) => (
            <li key={f.id} className="relative group rounded-xl overflow-hidden bg-gray-100">
              <Image
                src={f.url}
                alt={f.legenda ?? "Peça produzida por este fornecedor"}
                width={f.largura ?? 1080}
                height={f.altura ?? 1350}
                sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
                className="w-full h-full object-cover aspect-[4/5]"
              />
              {f.destaque && (
                <span className="absolute top-2 left-2 bg-[#1D9E75] text-white text-[10px] font-medium px-2 py-1 rounded-full">
                  Na página inicial
                </span>
              )}
              {!f.nome && !f.destaque && (
                <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-medium px-2 py-1 rounded-full">
                  Sem ficha
                </span>
              )}
              <button
                type="button"
                onClick={() => apagar(f.id)}
                aria-label="Apagar foto"
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-600 text-white text-sm leading-none transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                ×
              </button>

              <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => setEditando(f)}
                  className="bg-gray-900 hover:bg-black text-white text-[11px] font-medium py-1.5 rounded-lg shadow-sm transition-colors"
                >
                  {f.nome ? "Editar ficha" : "Preencher ficha"}
                </button>

                {f.podeReenquadrar && (
                  <div
                    className="flex bg-white/95 rounded-lg shadow-sm overflow-hidden"
                    role="group"
                    aria-label="Enquadramento da foto"
                  >
                    {ENQUADRAMENTO_ROTULO.map((op) => (
                      <button
                        key={op.valor}
                        type="button"
                        title={op.titulo}
                        onClick={() => mudarEnquadramento(f, op.valor)}
                        disabled={reenquadrando === f.id}
                        aria-pressed={f.enquadramento === op.valor}
                        className={`flex-1 text-[11px] font-medium py-1.5 transition-colors disabled:opacity-60 ${
                          f.enquadramento === op.valor
                            ? "bg-gray-900 text-white"
                            : "text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {reenquadrando === f.id && f.enquadramento !== op.valor ? "…" : op.label}
                      </button>
                    ))}
                  </div>
                )}

                {recorteDisponivel && (
                  <button
                    type="button"
                    onClick={() => alternarFundo(f)}
                    disabled={recortando === f.id}
                    className="bg-white/95 hover:bg-white disabled:opacity-70 text-gray-900 text-[11px] font-medium py-1.5 rounded-lg shadow-sm transition-colors"
                  >
                    {recortando === f.id
                      ? "Processando…"
                      : f.fundoRemovido
                        ? "Voltar foto original"
                        : "Isolar em fundo claro"}
                  </button>
                )}
              </div>
            </li>
          ))}
          {Array.from({ length: enviando }).map((_, i) => (
            <li
              key={`skeleton-${i}`}
              className="rounded-xl bg-gray-100 animate-pulse aspect-[4/5]"
              aria-hidden="true"
            />
          ))}
        </ul>
      )}

      {editando && (
        <FichaProdutoModal
          foto={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={(item) => {
            setFotos((atual) => atual.map((f) => (f.id === item.id ? item : f)));
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}
