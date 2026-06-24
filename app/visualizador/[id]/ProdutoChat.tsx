"use client";
// Modal de chat por PRODUTO. Foca em UM único produto: pergunta o que falta,
// SALVA as infos no produto AO VIVO (a cada resposta) e aceita anexar/colar
// foto (vai pro operador multimodal e vira referência do produto). Sem botão
// de "concluir" — o cliente fecha no × quando quiser; o produto já está salvo.
import { useEffect, useRef, useState } from "react";

export type LinhaProduto = {
  modelo: string | null; cor: string | null; material: string | null;
  publico: string | null; total: number | null;
  tamanhos: { tamanho: string; qtd: number | null }[];
  estampas?: { posicao: string; tamanho: string }[];
  estampado?: boolean | null; acabamentos?: string[] | null;
  categoria?: string | null; objetivo_material?: string | null; descricao: string | null;
};
type Turno = { role: "user" | "assistant"; display: string; raw?: string; fotos?: string[] };
type CorOpcao = { nome: string; hex: string };
type Cores = { termo: string; opcoes: CorOpcao[] } | null;
const MAX_FOTOS = 6;

function corLabel(s: string | null | undefined): string {
  return (s || "").replace(/\s*\(#([0-9a-fA-F]{6})\)\s*/, "").trim();
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("falhou")); r.readAsDataURL(file); });
}
async function arquivoParaRef(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const img = document.createElement("img");
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img inválida")); img.src = dataUrl; });
  const maxDim = 2000;
  const esc = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * esc));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * esc));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const cx = cv.getContext("2d"); if (!cx) return dataUrl;
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
  return cv.toDataURL("image/jpeg", 0.85);
}

export default function ProdutoChat({
  pedidoId, categoria, linha, faltam, onAtualizarLinha, onAnexarFotos, onFechar,
}: {
  pedidoId: string; categoria: string | null; linha: LinhaProduto; faltam: string[];
  onAtualizarLinha: (l: LinhaProduto) => void; onAnexarFotos: (fotos: string[]) => void; onFechar: () => void;
}) {
  void pedidoId;
  const nomeProduto = corLabel(linha.modelo) || "este produto";
  const resumo = [linha.modelo, corLabel(linha.cor)].filter(Boolean).join(" · ") || "produto sem detalhes";
  const seedLinha = {
    modelo: linha.modelo, cor: linha.cor, material: linha.material, publico: linha.publico,
    total: linha.total, tamanhos: linha.tamanhos || [], estampado: linha.estampado ?? null, descricao: linha.descricao,
  };
  const abertura =
    `Vamos completar o ${nomeProduto}. ` +
    (faltam.length ? `Faltou: ${faltam.join(", ")}. Me conta o primeiro: ${faltam[0]}? (pode mandar foto também 📎)` : `O que você quer ajustar nesse produto? Pode mandar texto ou foto 📎.`);
  const aberturaRaw = JSON.stringify({ mensagem: abertura, cores: null, pedido: { linhas: [seedLinha], contato: {} } });

  const [turnos, setTurnos] = useState<Turno[]>([{ role: "assistant", display: abertura, raw: aberturaRaw }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cores, setCores] = useState<Cores>(null);
  const [anexos, setAnexos] = useState<string[]>([]);
  const [subindo, setSubindo] = useState(false);
  const baseRef = useRef<LinhaProduto>(linha);
  const fimRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turnos, enviando, anexos]);

  const totalPecas = (linha.total ?? 0) > 0 ? (linha.total as number) : (linha.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0);

  async function processarArquivos(files: File[]) {
    const espaco = Math.max(0, MAX_FOTOS - anexos.length);
    if (espaco === 0) { setErro(`Máximo de ${MAX_FOTOS} fotos.`); return; }
    setSubindo(true); setErro(null);
    try {
      const novas: string[] = [];
      for (const f of files.slice(0, espaco)) {
        if (!f.type.startsWith("image/")) continue;
        if (f.size > 10 * 1024 * 1024) { setErro(`"${f.name}" passa de 10 MB e foi ignorada.`); continue; }
        novas.push(await arquivoParaRef(f));
      }
      if (novas.length) setAnexos((p) => [...p, ...novas]);
    } catch { setErro("Não consegui ler a imagem. Tenta outra."); }
    finally { setSubindo(false); }
  }
  async function onAnexar(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []); e.target.value = "";
    if (files.length) await processarArquivos(files);
  }
  async function onColar(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imgs = Array.from(e.clipboardData?.items ?? []).filter((it) => it.type.startsWith("image/"));
    if (imgs.length === 0) return;
    e.preventDefault();
    const files = imgs.map((it) => it.getAsFile()).filter((f): f is File => !!f);
    if (files.length) await processarArquivos(files);
  }

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? input).trim();
    const fotos = anexos;
    if ((!texto && fotos.length === 0) || enviando) return;
    setErro(null); setCores(null);
    const novos: Turno[] = [...turnos, { role: "user", display: texto, fotos: fotos.length ? fotos : undefined }];
    setTurnos(novos); setInput(""); setAnexos([]);
    // Salva as fotos como referência do produto na hora.
    if (fotos.length) onAnexarFotos(fotos);
    setEnviando(true);
    try {
      const notaFoto = fotos.length ? `${texto ? " " : ""}(enviei ${fotos.length} foto${fotos.length > 1 ? "s" : ""} de referência desse produto)` : "";
      const textoOperador = (texto + notaFoto).trim() || "Enviei foto(s) de referência desse produto.";
      const payloadMsgs = novos.map((t, i) => {
        if (t.role === "assistant") return { role: "assistant" as const, content: t.raw ?? t.display };
        if (i === novos.length - 1 && fotos.length) {
          const blocos: Array<{ type: "image_url"; url: string } | { type: "text"; text: string }> = fotos.map((u) => ({ type: "image_url" as const, url: u }));
          blocos.push({ type: "text", text: textoOperador });
          return { role: "user" as const, content: blocos };
        }
        return { role: "user" as const, content: i === novos.length - 1 ? textoOperador : (t.display || "(foto enviada)") };
      });
      const res = await fetch("/api/pedido/assistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMsgs, modo: "produto", contexto: { categoria, totalPecas, produtoResumo: resumo, faltam } }),
      });
      const data = await res.json();
      if (!res.ok || !data?.mensagem) { setErro(data?.error || "Não consegui responder agora. Tenta de novo."); return; }
      const nova = (data.pedido?.linhas?.[0] ?? null) as LinhaProduto | null;
      if (nova) {
        // Mescla preservando acabamentos/estampas/categoria; salva no produto AO VIVO.
        const merged: LinhaProduto = {
          ...baseRef.current,
          modelo: nova.modelo ?? baseRef.current.modelo,
          cor: nova.cor ?? baseRef.current.cor,
          material: nova.material ?? baseRef.current.material,
          publico: nova.publico ?? baseRef.current.publico,
          total: nova.total ?? baseRef.current.total,
          tamanhos: (nova.tamanhos && nova.tamanhos.length ? nova.tamanhos : baseRef.current.tamanhos) || [],
          descricao: nova.descricao ?? baseRef.current.descricao,
        };
        baseRef.current = merged;
        onAtualizarLinha(merged);
      }
      setCores(data.cores ?? null);
      const raw = JSON.stringify({ mensagem: data.mensagem, cores: data.cores ?? null, pedido: data.pedido });
      setTurnos([...novos, { role: "assistant", display: data.mensagem, raw }]);
    } catch {
      setErro("Falha de conexão. Tenta de novo.");
    } finally { setEnviando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[88vh] sm:max-h-[80vh] overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <p className="text-gray-900 font-medium text-sm">💬 Completar {nomeProduto}</p>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="h-8 w-8 rounded-full hover:bg-gray-100 text-gray-500 flex items-center justify-center text-lg leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {turnos.map((t, i) => (
            <div key={i} className={"flex " + (t.role === "user" ? "justify-end" : "justify-start")}>
              <div className={"max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap " + (t.role === "user" ? "bg-[#1D9E75] text-white" : "bg-gray-100 text-gray-800")}>
                {t.fotos && t.fotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.fotos.map((u, j) => (<img key={j} src={u} alt={`foto ${j + 1}`} className="h-16 w-16 object-cover rounded-lg border border-white/30" />))}
                  </div>
                )}
                {t.display}
              </div>
            </div>
          ))}
          {cores && cores.opcoes.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {cores.opcoes.map((o) => (
                <button key={o.hex} type="button" onClick={() => void enviar(`${o.nome} (${o.hex})`)} className="flex items-center gap-1.5 border border-gray-200 rounded-full pl-1 pr-2.5 py-1 text-xs text-gray-700 hover:border-[#1D9E75]">
                  <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: o.hex }} />{o.nome}
                </button>
              ))}
            </div>
          )}
          {enviando && <div className="flex justify-start"><div className="bg-gray-100 text-gray-400 rounded-2xl px-3.5 py-2.5 text-sm">digitando…</div></div>}
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          <div ref={fimRef} />
        </div>
        <div className="border-t border-gray-100 p-3 shrink-0">
          {(anexos.length > 0 || subindo) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {anexos.map((u, j) => (
                <div key={j} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`anexo ${j + 1}`} className="h-14 w-14 object-cover rounded-lg border border-gray-200" />
                  <button type="button" onClick={() => setAnexos((p) => p.filter((_, k) => k !== j))} aria-label="Remover" className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 text-white text-xs leading-none flex items-center justify-center">×</button>
                </div>
              ))}
              {subindo && <span className="text-xs text-gray-400 self-center">processando…</span>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className={"shrink-0 h-11 w-11 rounded-full border border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-50 " + (anexos.length >= MAX_FOTOS ? "opacity-40 pointer-events-none" : "")} aria-label="Anexar foto" title="Anexar foto desse produto">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onAnexar(e)} />
            </label>
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
              onPaste={(e) => void onColar(e)}
              rows={1} placeholder="Escreva ou cole uma foto aqui…" enterKeyHint="send"
              className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75] max-h-28"
            />
            <button type="button" onClick={() => void enviar()} disabled={enviando || (!input.trim() && anexos.length === 0)} className="shrink-0 h-11 w-11 rounded-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-40 text-white flex items-center justify-center" aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 text-center">As infos vão sendo salvas no produto automaticamente. Pode fechar quando terminar.</p>
        </div>
      </div>
    </div>
  );
}
