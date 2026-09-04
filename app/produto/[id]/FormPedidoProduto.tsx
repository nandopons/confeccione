"use client";

// app/produto/[id]/FormPedidoProduto.tsx
// ============================================================================
// Pedido direto pra UMA confecção, a partir de um produto da vitrine.
//
// Formulário curto de propósito: quantidade, tamanhos, personalização e
// contato. Tudo que der pra combinar depois fica pro alinhamento — cada campo
// a mais aqui é um pedido a menos.
// ============================================================================

import { useRef, useState } from "react";

const MAX_ARQUIVOS = 3;

/** Lê o arquivo e, se for grande, reduz pra ≤1600px em JPEG antes de subir.
 *  Mesma ideia do visualizador: a arte vai no corpo do POST, então imagem de
 *  celular crua (8MB) estouraria o limite da rota. */
async function arquivoParaDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error("não consegui ler o arquivo"));
    fr.readAsDataURL(file);
  });
  if (file.size <= 900_000) return dataUrl;

  const img = document.createElement("img");
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("imagem inválida"));
    img.src = dataUrl;
  });
  const max = 1600;
  const esc = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * esc));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * esc));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d");
  if (!cx) return dataUrl;
  cx.fillStyle = "#ffffff";
  cx.fillRect(0, 0, w, h);
  cx.drawImage(img, 0, 0, w, h);
  return cv.toDataURL("image/jpeg", 0.82);
}

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
  const [artes, setArtes] = useState<string[]>([]);
  const [lendoArte, setLendoArte] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function anexar(lista: FileList | null) {
    if (!lista?.length) return;
    setErro(null);
    setLendoArte(true);
    try {
      const espaco = MAX_ARQUIVOS - artes.length;
      const novas: string[] = [];
      for (const file of Array.from(lista).slice(0, Math.max(espaco, 0))) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 12 * 1024 * 1024) {
          setErro(`"${file.name}" passa de 12 MB e foi ignorado.`);
          continue;
        }
        novas.push(await arquivoParaDataUrl(file));
      }
      if (novas.length) setArtes((a) => [...a, ...novas].slice(0, MAX_ARQUIVOS));
    } catch {
      setErro("não consegui ler esse arquivo — tente outro");
    } finally {
      setLendoArte(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

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
        body: JSON.stringify({ ...corpo, artes }),
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

      {/* ARTE — aqui não existe chat, então este é o único lugar onde o cliente
          consegue mandar o logo/estampa antes do orçamento. Sem isso a
          confecção orça no escuro e a conversa volta pro WhatsApp. */}
      <div className="sm:col-span-2">
        <span className="text-gray-700 text-xs font-medium block mb-1.5">
          Arte, logo ou referência <span className="text-gray-400 font-normal">(opcional)</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {artes.map((src, i) => (
            <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Arte ${i + 1}`} className="w-full h-full object-contain" />
              <button
                type="button"
                onClick={() => setArtes((a) => a.filter((_, k) => k !== i))}
                aria-label="Remover arquivo"
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white text-xs leading-none"
              >
                ×
              </button>
            </div>
          ))}
          {artes.length < MAX_ARQUIVOS && (
            <button
              type="button"
              onClick={() => arquivoRef.current?.click()}
              disabled={lendoArte}
              className="w-16 h-16 rounded-lg border border-dashed border-gray-300 hover:border-[#1D9E75] text-gray-400 hover:text-[#1D9E75] text-xl transition-colors"
              aria-label="Anexar arquivo"
            >
              {lendoArte ? "…" : "+"}
            </button>
          )}
          <span className="text-gray-400 text-xs">JPG ou PNG, até {MAX_ARQUIVOS} arquivos.</span>
        </div>
        <input
          ref={arquivoRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void anexar(e.target.files)}
        />
      </div>

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
