"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MOCKUPS, CATEGORIAS, getMockup, type Vista, type ZonaNome } from "@/app/lib/mockups";

type CorLogo = "original" | "preto" | "branco";
type Turno = { role: "user" | "assistant"; display: string; raw: string; seed?: boolean };

const SAUDACAO =
  "Oi! Escolhe a peça ali em cima, anexa sua logo e me diz como quer — ex.: “logo no peito esquerdo, de preto, menor”. Você também pode arrastar a logo na prévia pra qualquer lugar (manga, nuca, barra…). 😊";

export default function MockupStudio() {
  const [categoriaId, setCategoriaId] = useState(CATEGORIAS[0]?.id ?? "tshirt");
  const [pecaId, setPecaId] = useState(MOCKUPS[0]?.id ?? "");
  const [vista, setVista] = useState<Vista>("frente");
  const [corLogo, setCorLogo] = useState<CorLogo>("original");
  const [removerFundo, setRemoverFundo] = useState(true);

  // posição = centro da arte, normalizado (0..1) sobre a imagem. Livre.
  const [pos, setPos] = useState({ x: 0.5, y: 0.3 });
  // tamanho = fração da LARGURA da imagem (livre)
  const [tamanho, setTamanho] = useState(0.16);

  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoNome, setLogoNome] = useState<string | null>(null);
  const [logoVersao, setLogoVersao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const [turnos, setTurnos] = useState<Turno[]>([{ role: "assistant", display: SAUDACAO, raw: "", seed: true }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mockupImgRef = useRef<HTMLImageElement | null>(null);
  const logoProcRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef({ ativo: false, px: 0, py: 0 });
  const fimRef = useRef<HTMLDivElement>(null);

  const peca = getMockup(pecaId);
  const view = peca?.vistas[vista];

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turnos, enviando]);

  // centro/tamanho default de uma zona
  function ancoraDaZona(z?: { x: number; y: number; w: number; h: number } | null) {
    if (!z) return { x: 0.5, y: 0.3, w: 0.3 };
    return { x: z.x + z.w / 2, y: z.y + z.h / 2, w: z.w };
  }
  function aplicarZonaPadrao(p = peca, v = vista, zonaNome?: ZonaNome) {
    const vw = p?.vistas[v];
    if (!vw) return;
    const nome = zonaNome ?? vw.zonaPadrao;
    const z = vw.zonas[nome] ?? Object.values(vw.zonas)[0];
    const a = ancoraDaZona(z);
    setPos({ x: a.x, y: a.y });
    setTamanho(a.w);
  }

  function selecionarPeca(id: string) {
    const m = getMockup(id); if (!m) return;
    setPecaId(id); setVista(m.vistaPadrao);
    setCorLogo(m.corLogoSugerida === "branco" ? "branco" : "original");
    aplicarZonaPadrao(m, m.vistaPadrao);
  }
  function trocarVista(v: Vista) {
    if (!peca?.vistas[v]) return;
    setVista(v); aplicarZonaPadrao(peca, v);
  }

  // carrega imagem do mockup
  useEffect(() => {
    if (!view) return;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { mockupImgRef.current = img; render(); };
    img.src = view.arquivo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pecaId, vista]);

  // processa a logo
  useEffect(() => {
    if (!logoSrc) { logoProcRef.current = null; render(); return; }
    const img = new Image();
    img.onload = () => { logoProcRef.current = processarLogo(img, removerFundo, corLogo); setLogoVersao((v) => v + 1); };
    img.src = logoSrc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoSrc, removerFundo, corLogo]);

  useEffect(() => { render(); /* eslint-disable-next-line */ }, [pos, tamanho, logoVersao, vista, pecaId]);

  function processarLogo(img: HTMLImageElement, knockout: boolean, cor: CorLogo): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
    if (knockout) {
      const d = ctx.getImageData(0, 0, c.width, c.height); const a = d.data, w = c.width, h = c.height;
      const pts = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]];
      let r = 0, g = 0, b = 0; for (const [x, y] of pts) { const i = (y * w + x) * 4; r += a[i]; g += a[i + 1]; b += a[i + 2]; }
      r /= 4; g /= 4; b /= 4; const tol = 52;
      for (let i = 0; i < a.length; i += 4) { const dr = a[i] - r, dg = a[i + 1] - g, db = a[i + 2] - b; if (Math.sqrt(dr * dr + dg * dg + db * db) < tol) a[i + 3] = 0; }
      ctx.putImageData(d, 0, 0);
    }
    if (cor !== "original") {
      const out = document.createElement("canvas"); out.width = c.width; out.height = c.height;
      const o = out.getContext("2d")!; o.drawImage(c, 0, 0); o.globalCompositeOperation = "source-in";
      o.fillStyle = cor === "preto" ? "#111111" : "#ffffff"; o.fillRect(0, 0, out.width, out.height); return out;
    }
    return c;
  }

  function logoRect() {
    const img = mockupImgRef.current, logo = logoProcRef.current;
    if (!img || !logo) return null;
    const W = img.naturalWidth, H = img.naturalHeight;
    const lw = Math.max(8, tamanho * W); const lh = lw * (logo.height / logo.width);
    return { x: pos.x * W - lw / 2, y: pos.y * H - lh / 2, w: lw, h: lh };
  }

  function render() {
    const canvas = canvasRef.current, img = mockupImgRef.current; if (!canvas || !img) return;
    if (canvas.width !== img.naturalWidth) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
    const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0);
    const lr = logoRect(); if (lr) { ctx.save(); ctx.globalAlpha = 0.97; ctx.drawImage(logoProcRef.current!, lr.x, lr.y, lr.w, lr.h); ctx.restore(); }
  }

  function evNorm(e: React.PointerEvent) {
    const c = canvasRef.current!; const rect = c.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }
  function onDown(e: React.PointerEvent) {
    if (!logoProcRef.current) return;
    const p = evNorm(e); dragRef.current = { ativo: true, px: p.x, py: p.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!dragRef.current.ativo) return;
    const p = evNorm(e);
    setPos((o) => ({ x: Math.min(1, Math.max(0, o.x + (p.x - dragRef.current.px))), y: Math.min(1, Math.max(0, o.y + (p.y - dragRef.current.py))) }));
    dragRef.current.px = p.x; dragRef.current.py = p.y;
  }
  function onUp() { dragRef.current.ativo = false; }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null); const file = e.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith("image/")) { setErro("Envie uma imagem (PNG, JPG ou SVG)."); return; }
    if (file.size > 5 * 1024 * 1024) { setErro("Arquivo grande demais (máx. 5 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => { setLogoSrc(typeof reader.result === "string" ? reader.result : null); setLogoNome(file.name); aplicarZonaPadrao(); };
    reader.readAsDataURL(file);
  }

  async function enviar() {
    const texto = input.trim(); if (!texto || enviando) return; setErro(null);
    const base = [...turnos, { role: "user", display: texto, raw: texto } as Turno];
    setTurnos(base); setInput(""); setEnviando(true);
    const messages = base.filter((t) => !t.seed).map((t) => ({ role: t.role, content: t.raw || t.display }));
    const estado = { pecaId, vista, corLogo, removerFundo, tamanho, temLogo: !!logoSrc };
    try {
      const res = await fetch("/api/mockup/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, estado }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.mensagem) { setErro(data?.error || "Não consegui responder agora."); setEnviando(false); return; }
      setTurnos([...base, { role: "assistant", display: data.mensagem, raw: JSON.stringify(data) }]);
      aplicarOps(data.ops || {});
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  function aplicarOps(ops: Record<string, unknown>) {
    let p = peca, v = vista;
    if (typeof ops.pecaId === "string" && getMockup(ops.pecaId)) { p = getMockup(ops.pecaId)!; setCategoriaId(p.categoria); selecionarPeca(ops.pecaId); v = p.vistaPadrao; }
    if (typeof ops.vista === "string" && p?.vistas[ops.vista as Vista]) { v = ops.vista as Vista; trocarVista(v); }
    if (typeof ops.posicao === "string") {
      const zonas = p?.vistas[v]?.zonas as Record<string, { x: number; y: number; w: number; h: number }> | undefined;
      if (zonas && zonas[ops.posicao]) { const a = ancoraDaZona(zonas[ops.posicao]); setPos({ x: a.x, y: a.y }); }
    }
    if (ops.corLogo === "original" || ops.corLogo === "preto" || ops.corLogo === "branco") setCorLogo(ops.corLogo);
    if (typeof ops.removerFundo === "boolean") setRemoverFundo(ops.removerFundo);
    if (typeof ops.tamanho === "number") setTamanho(Math.min(0.6, Math.max(0.05, ops.tamanho)));
  }

  function baixar() { const c = canvasRef.current; if (!c) return; const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = "mockup-confeccione.png"; a.click(); }
  function usarNoPedido() { try { const c = canvasRef.current; sessionStorage.setItem("mockup_pedido", JSON.stringify({ peca: peca?.nome, pecaId, vista, imagem: c ? c.toDataURL("image/jpeg", 0.8) : null })); } catch { /* */ } }

  const pecasDaCategoria = MOCKUPS.filter((m) => m.categoria === categoriaId);

  return (
    <section className="bg-[#F7F8F9]">
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-6">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
          <p className="text-gray-900 font-medium text-sm mb-3">Escolha a peça</p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            {CATEGORIAS.map((c) => (
              <button key={c.id} type="button" onClick={() => setCategoriaId(c.id)}
                className={"whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors " + (c.id === categoriaId ? "bg-[#111] text-white border-[#111]" : "border-gray-200 text-gray-600 hover:bg-gray-50")}>{c.nome}</button>
            ))}
          </div>
          <div className="flex gap-3 overflow-x-auto pt-3 -mx-1 px-1">
            {pecasDaCategoria.length === 0 && <p className="text-gray-400 text-sm py-6">Novos mockups dessa categoria em breve.</p>}
            {pecasDaCategoria.map((m) => {
              const capa = m.vistas[m.vistaPadrao]?.arquivo ?? "";
              return (
                <button key={m.id} type="button" onClick={() => selecionarPeca(m.id)}
                  className={"flex-shrink-0 w-28 border-2 rounded-xl overflow-hidden text-left transition-all " + (m.id === pecaId ? "border-[#1D9E75]" : "border-gray-200 hover:border-gray-300")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={capa} alt={m.nome} className="w-full h-32 object-cover object-top bg-gray-50" />
                  <span className="block text-[11px] text-gray-600 px-2 py-1 leading-tight truncate">{m.nome}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-gray-900 font-medium text-sm">Assistente</p>
              <button type="button" onClick={() => fileRef.current?.click()} className="text-xs font-medium text-[#0F6E56] hover:underline">{logoNome ? "Trocar arte" : "Anexar logo"}</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUpload} />
            </div>
            {logoNome && <div className="px-5 py-1.5 bg-[#E1F5EE] text-[11px] text-[#0F6E56] truncate">Arte: {logoNome}</div>}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 max-h-[360px] min-h-[240px]">
              {turnos.map((t, i) => (
                <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={(t.role === "user" ? "bg-[#1D9E75] text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm") + " rounded-2xl px-3 py-2 text-sm max-w-[85%]"}>{t.display}</div>
                </div>
              ))}
              {enviando && <div className="flex justify-start"><div className="bg-gray-100 text-gray-400 rounded-2xl px-3 py-2 text-sm">ajustando…</div></div>}
              <div ref={fimRef} />
            </div>
            {erro && <div className="px-5 pb-2 text-red-600 text-xs">{erro}</div>}
            <div className="border-t border-gray-100 p-3 flex items-end gap-2">
              <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Ex.: logo no peito esquerdo, de preto…"
                className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
              <button type="button" onClick={enviar} disabled={enviando || !input.trim()} className="bg-[#111] text-white px-4 py-2 rounded-xl text-sm font-medium hover:opacity-85 disabled:opacity-40">Enviar</button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-900 font-medium text-sm">Prévia</p>
              <div className="flex gap-1">
                {(["frente", "costas", "lateral"] as Vista[]).filter((v) => peca?.vistas[v]).map((v) => (
                  <button key={v} type="button" onClick={() => trocarVista(v)}
                    className={"px-2.5 py-1 rounded-lg text-xs border capitalize transition-colors " + (v === vista ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 text-gray-500 hover:bg-gray-50")}>{v}</button>
                ))}
              </div>
            </div>
            <div className="flex-1 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
              <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
                style={{ touchAction: "none" }} className="max-w-full max-h-[460px] cursor-move select-none" />
            </div>

            {logoSrc && (
              <div className="mt-3">
                <p className="text-xs text-gray-500 mb-1">Tamanho da arte</p>
                <input type="range" min={0.05} max={0.6} step={0.01} value={tamanho} onChange={(e) => setTamanho(parseFloat(e.target.value))} className="w-full accent-[#1D9E75]" />
                <p className="text-[11px] text-gray-400 mt-1">Arraste a arte na prévia pra posicionar onde quiser (peito, manga, nuca…). O resto, peça no chat.</p>
              </div>
            )}

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={baixar} disabled={!logoSrc} className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-40">Baixar mockup</button>
              <Link href="/#pedido" onClick={usarNoPedido} className={"flex-1 text-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors " + (logoSrc ? "bg-[#1D9E75] hover:bg-[#0F6E56] text-white" : "bg-gray-100 text-gray-400 pointer-events-none")}>Usar no meu pedido →</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
