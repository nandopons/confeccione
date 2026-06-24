"use client";
// Chat de ALINHAMENTO do pedido. Reusa o operador /api/pedido/assistente em
// modo "alinhar" (sem contato — já coletado): decompõe em linhas (modelo, cor,
// tamanhos, tecido) e aceita FOTOS de referência ("quero produzir isso"). Ao
// concluir, grava as linhas (PATCH) + as fotos (mockup) e segue pro
// visualizador. Tem "pular" pra quem prefere organizar lá mesmo.
import { useEffect, useRef, useState } from "react";

type Tamanho = { tamanho: string; qtd: number | null };
type Linha = {
  modelo: string | null; cor: string | null; material: string | null;
  publico: string | null; total: number | null; tamanhos: Tamanho[];
  estampado: boolean | null; descricao: string | null;
};
type Pedido = { linhas: Linha[]; contato: unknown };
export type LinhaInicial = Partial<Omit<Linha, "tamanhos">> & { tamanhos?: Array<{ tamanho?: string | null; qtd?: number | null }> | null };
type Turno = { role: "user" | "assistant"; display: string; raw?: string; fotos?: string[] };
type CorOpcao = { nome: string; hex: string };
type Cores = { termo: string; opcoes: CorOpcao[] } | null;

const PEDIDO_VAZIO: Pedido = { linhas: [], contato: {} };
const MAX_FOTOS = 6;
const MAX_COLETA = 12; // total de fotos de referência que o chat pode juntar (distribuídas entre os modelos)

function corHex(s: string | null | undefined): string | null {
  const m = (s || "").match(/#([0-9a-fA-F]{6})/);
  return m ? `#${m[1]}` : null;
}
function corLabel(s: string | null | undefined): string {
  return (s || "").replace(/\s*\(#([0-9a-fA-F]{6})\)\s*/, "").trim();
}
function linhaCompleta(l: Linha): boolean {
  return Boolean(l.modelo && l.total);
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("leitura falhou"));
    r.readAsDataURL(file);
  });
}
async function arquivoParaRef(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const img = document.createElement("img");
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("imagem inválida")); img.src = dataUrl; });
  const maxDim = 2000;
  const esc = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * esc));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * esc));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const cx = cv.getContext("2d");
  if (!cx) return dataUrl;
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h);
  cx.drawImage(img, 0, 0, w, h);
  return cv.toDataURL("image/jpeg", 0.85);
}

export default function AlinharCliente({ pedidoId, categoria, totalPecas, linhasIniciais = [] }: { pedidoId: string; categoria: string | null; totalPecas: number; linhasIniciais?: LinhaInicial[] }) {
  const linhasBase: Linha[] = (linhasIniciais ?? []).map((l) => ({
    modelo: l?.modelo ?? null, cor: l?.cor ?? null, material: l?.material ?? null,
    publico: l?.publico ?? null, total: l?.total ?? null,
    tamanhos: Array.isArray(l?.tamanhos) ? l!.tamanhos!.map((t) => ({ tamanho: t?.tamanho ?? "", qtd: t?.qtd ?? null })) : [],
    estampado: l?.estampado ?? null, descricao: l?.descricao ?? null,
  }));
  const resumoProdutos = linhasBase.filter(linhaCompleta).map((l) => `${l.modelo}${corLabel(l.cor) ? ` ${corLabel(l.cor)}` : ""}${l.total ? ` (${l.total})` : ""}`);
  const jaTem = resumoProdutos.length > 0;
  const abertura = jaTem
    ? `Seu pedido já tem: ${resumoProdutos.join(", ")}. O que você quer ajustar? Pode pedir pra mudar cor, tecido, tamanhos, quantidade, estampa, ou adicionar/remover um produto — eu mexo SÓ no que você pedir, o resto fica como está. 😊`
    : `Boa! ${totalPecas > 0 ? `Você sinalizou ${totalPecas} ${totalPecas === 1 ? "peça" : "peças"}${categoria ? ` de ${categoria}` : ""}. ` : ""}` +
      `Pra deixar tudo organizado: quantos modelos diferentes você quer produzir? (ex.: só 1 modelo, ou camiseta + moletom…) — se já tiver fotos do que quer, pode me enviar pelo 📎.`;
  const pedidoInicial: Pedido = jaTem ? { linhas: linhasBase, contato: {} } : PEDIDO_VAZIO;
  const aberturaRaw = jaTem ? JSON.stringify({ mensagem: abertura, cores: null, pedido: pedidoInicial }) : undefined;
  const [turnos, setTurnos] = useState<Turno[]>([{ role: "assistant", display: abertura, raw: aberturaRaw }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido>(pedidoInicial);
  const [cores, setCores] = useState<Cores>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [anexos, setAnexos] = useState<string[]>([]);
  const [fotosColetadas, setFotosColetadas] = useState<{ id: number; url: string }[]>([]);
  const [mapaFotos, setMapaFotos] = useState<Record<string, number[]> | null>(null);
  const proxIdRef = useRef(1);
  const [subindo, setSubindo] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turnos, enviando, anexos]);

  const temLinha = pedido.linhas.some(linhaCompleta);
  const totalFotos = fotosColetadas.length + anexos.length;

  async function onAnexar(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const espaco = Math.max(0, MAX_COLETA - totalFotos);
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

  async function onColar(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const itens = Array.from(e.clipboardData?.items ?? []);
    const imgs = itens.filter((it) => it.type.startsWith("image/"));
    if (imgs.length === 0) return; // sem imagem: deixa colar texto normalmente
    e.preventDefault();
    const espaco = Math.max(0, MAX_COLETA - totalFotos);
    if (espaco === 0) { setErro(`Máximo de ${MAX_FOTOS} fotos.`); return; }
    setSubindo(true); setErro(null);
    try {
      const novas: string[] = [];
      for (const it of imgs.slice(0, espaco)) {
        const f = it.getAsFile();
        if (!f) continue;
        if (f.size > 10 * 1024 * 1024) { setErro("A imagem colada passa de 10 MB e foi ignorada."); continue; }
        novas.push(await arquivoParaRef(f));
      }
      if (novas.length) setAnexos((p) => [...p, ...novas]);
    } catch { setErro("Não consegui ler a imagem colada. Tenta de novo."); }
    finally { setSubindo(false); }
  }

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? input).trim();
    const fotos = anexos;
    if ((!texto && fotos.length === 0) || enviando) return;
    setErro(null); setCores(null);
    const novos: Turno[] = [...turnos, { role: "user", display: texto, fotos: fotos.length ? fotos : undefined }];
    setTurnos(novos); setInput(""); setAnexos([]);
    const novasColetadas = fotos.map((u) => ({ id: proxIdRef.current++, url: u }));
    if (novasColetadas.length) setFotosColetadas((p) => [...p, ...novasColetadas].slice(0, MAX_COLETA));
    setEnviando(true);
    try {
      const nums = novasColetadas.map((c) => `#${c.id}`).join(", ");
      const notaFoto = fotos.length ? `${texto ? " " : ""}(enviei a(s) foto(s) ${nums} de referência do que quero produzir)` : "";
      const textoOperador = (texto + notaFoto).trim() || "Enviei fotos de referência do que quero produzir.";
      const payloadMsgs = novos.map((t, i) => {
        if (t.role === "assistant") return { role: "assistant" as const, content: t.raw ?? t.display };
        if (i === novos.length - 1 && fotos.length) {
          const blocos: Array<{ type: "image_url"; url: string } | { type: "text"; text: string }> = fotos.map((u) => ({ type: "image_url" as const, url: u }));
          blocos.push({ type: "text", text: textoOperador });
          return { role: "user" as const, content: blocos };
        }
        return { role: "user" as const, content: i === novos.length - 1 ? textoOperador : (t.display || "(fotos enviadas)") };
      });
      const res = await fetch("/api/pedido/assistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMsgs, modo: "alinhar", contexto: { categoria, totalPecas, edicao: jaTem, produtos: resumoProdutos } }),
      });
      const data = await res.json();
      if (!res.ok || !data?.mensagem) { setErro(data?.error || "Não consegui responder agora. Tenta de novo."); return; }
      const novoPedido: Pedido = data.pedido ?? PEDIDO_VAZIO;
      setPedido(novoPedido);
      setCores(data.cores ?? null);
      if (data.fotosPorLinha && typeof data.fotosPorLinha === "object") setMapaFotos(data.fotosPorLinha);
      const raw = JSON.stringify({ mensagem: data.mensagem, cores: data.cores ?? null, pedido: novoPedido });
      setTurnos([...novos, { role: "assistant", display: data.mensagem, raw }]);
    } catch {
      setErro("Falha de conexão. Tenta de novo.");
    } finally { setEnviando(false); }
  }

  async function concluir() {
    if (concluindo) return;
    setConcluindo(true);
    try {
      // Mantém o índice ORIGINAL de cada linha (o operador mapeou fotosPorLinha por esse índice).
      const completas = pedido.linhas.map((l, oldIdx) => ({ l, oldIdx })).filter((x) => linhaCompleta(x.l));
      if (completas.length) {
        const linhas = completas.map(({ l }) => ({
          modelo: l.modelo, cor: l.cor, material: l.material, publico: l.publico ?? null,
          total: l.total, tamanhos: (l.tamanhos || []).filter((t) => t.tamanho),
          estampado: l.estampado ?? null, descricao: l.descricao ?? null,
          categoria: categoria ?? null,
        }));
        await fetch(`/api/pedido/assistente/${pedidoId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linhas, status: "em_visualizacao" }),
        });
      }
      // Distribui CADA foto pro modelo certo (mapa fotosPorLinha do operador, por id de foto).
      if (fotosColetadas.length && completas.length) {
        const urlPorId = new Map(fotosColetadas.map((c) => [c.id, c.url]));
        const porNovoIdx: Record<number, string[]> = {};
        const usados = new Set<number>();
        completas.forEach(({ oldIdx }, novoIdx) => {
          const ids = (mapaFotos?.[String(oldIdx)] ?? []).filter((id) => urlPorId.has(id));
          if (ids.length) {
            porNovoIdx[novoIdx] = ids.map((id) => urlPorId.get(id) as string);
            ids.forEach((id) => usados.add(id));
          }
        });
        // Fotos que o operador não mapeou caem no 1º modelo (fallback — nunca some).
        const sobra = fotosColetadas.filter((c) => !usados.has(c.id)).map((c) => c.url);
        if (sobra.length) porNovoIdx[0] = [...(porNovoIdx[0] ?? []), ...sobra];
        for (const [idx, urls] of Object.entries(porNovoIdx)) {
          await fetch(`/api/pedido/assistente/${pedidoId}/mockup`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: Number(idx), fotos: urls.slice(0, MAX_FOTOS) }),
          });
        }
      }
    } catch { /* segue pro visualizador de qualquer forma */ }
    window.location.href = `/visualizador/${pedidoId}`;
  }

  function pular() { window.location.href = `/visualizador/${pedidoId}`; }

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* CHAT */}
      <div className="flex flex-col bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden min-h-[60vh]">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-gray-900 font-medium text-sm">💬 Vamos alinhar seu pedido</p>
          <button type="button" onClick={pular} className="text-xs text-gray-400 hover:text-[#0F6E56]">prefiro organizar eu mesmo →</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {turnos.map((t, i) => (
            <div key={i} className={"flex " + (t.role === "user" ? "justify-end" : "justify-start")}>
              <div className={"max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap " + (t.role === "user" ? "bg-[#1D9E75] text-white" : "bg-gray-100 text-gray-800")}>
                {t.fotos && t.fotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                    {t.fotos.map((u, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={u} alt={`foto ${j + 1}`} className="h-16 w-16 object-cover rounded-lg border border-white/30" />
                    ))}
                  </div>
                )}
                {t.display}
              </div>
            </div>
          ))}
          {cores && cores.opcoes.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {cores.opcoes.map((o) => (
                <button key={o.hex} type="button" onClick={() => void enviar(`${o.nome} (${o.hex})`)}
                  className="flex items-center gap-1.5 border border-gray-200 rounded-full pl-1 pr-2.5 py-1 text-xs text-gray-700 hover:border-[#1D9E75]">
                  <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: o.hex }} />
                  {o.nome}
                </button>
              ))}
            </div>
          )}
          {enviando && <div className="flex justify-start"><div className="bg-gray-100 text-gray-400 rounded-2xl px-3.5 py-2.5 text-sm">digitando…</div></div>}
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          <div ref={fimRef} />
        </div>
        <div className="border-t border-gray-100 p-3">
          {/* tray de anexos */}
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
            <label className={"shrink-0 h-11 w-11 rounded-full border border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-50 " + (totalFotos >= MAX_FOTOS ? "opacity-40 pointer-events-none" : "")} aria-label="Anexar fotos" title="Anexar fotos do que você quer produzir">
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
            <button type="button" onClick={() => void enviar()} disabled={enviando || (!input.trim() && anexos.length === 0)}
              className="shrink-0 h-11 w-11 rounded-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-40 text-white flex items-center justify-center" aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* RESUMO + AÇÕES */}
      <aside className="lg:sticky lg:top-6 self-start space-y-3">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <p className="text-sm font-medium text-gray-900 mb-2">Seu pedido</p>
          {pedido.linhas.length === 0 ? (
            <p className="text-xs text-gray-400">Os produtos vão aparecendo aqui conforme a gente conversa.</p>
          ) : (
            <ul className="space-y-2">
              {pedido.linhas.map((l, i) => (
                <li key={i} className="border border-gray-100 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5">
                    {corHex(l.cor) && <span className="h-3.5 w-3.5 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: corHex(l.cor) as string }} />}
                    <span className="text-sm text-gray-800 capitalize">{[l.modelo, corLabel(l.cor)].filter(Boolean).join(" · ") || "produto"}</span>
                    {l.total ? <span className="ml-auto text-xs text-gray-500">{l.total} un.</span> : null}
                  </div>
                  {l.material && <p className="text-[11px] text-gray-500 mt-0.5">Tecido: {l.material}</p>}
                  {l.tamanhos.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {l.tamanhos.map((t, j) => (
                        <span key={j} className="bg-gray-50 border border-gray-200 text-gray-600 text-[10px] px-1.5 py-0.5 rounded">{t.tamanho.toUpperCase()}{t.qtd ? ` · ${t.qtd}` : ""}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {fotosColetadas.length > 0 && (
            <p className="text-[11px] text-[#0F6E56] mt-2">📎 {fotosColetadas.length} foto{fotosColetadas.length > 1 ? "s" : ""} de referência anexada{fotosColetadas.length > 1 ? "s" : ""}.</p>
          )}
        </div>
        <button type="button" onClick={() => void concluir()} disabled={concluindo}
          className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-4 py-3 rounded-xl">
          {concluindo ? "Salvando…" : temLinha ? "Concluir e ver os produtos →" : "Ir para os produtos →"}
        </button>
        <button type="button" onClick={pular} className="w-full text-xs text-gray-400 hover:text-[#0F6E56]">organizar eu mesmo na página de produtos</button>
      </aside>
    </div>
  );
}
