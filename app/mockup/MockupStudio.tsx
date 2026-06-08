"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MOCKUPS, getMockup } from "@/app/lib/mockups";

type CorLogo = "original" | "preto" | "branco";

export default function MockupStudio() {
  const [mockupId, setMockupId] = useState(MOCKUPS[0]?.id ?? "");
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoNome, setLogoNome] = useState<string | null>(null);
  const [removerFundo, setRemoverFundo] = useState(true);
  const [corLogo, setCorLogo] = useState<CorLogo>("original");
  const [escala, setEscala] = useState(0.7); // fração da largura da área de estampa
  const [off, setOff] = useState({ x: 0, y: 0 }); // deslocamento em px naturais
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mockupImgRef = useRef<HTMLImageElement | null>(null);
  const logoProcRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ ativo: boolean; px: number; py: number }>({ ativo: false, px: 0, py: 0 });

  const mockup = getMockup(mockupId);

  // sugere a cor da logo ao trocar de peça
  useEffect(() => {
    if (mockup) setCorLogo(mockup.corLogoSugerida === "branco" ? "branco" : "original");
  }, [mockupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // carrega a imagem do mockup
  useEffect(() => {
    if (!mockup) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      mockupImgRef.current = img;
      setOff({ x: 0, y: 0 });
      render();
    };
    img.src = mockup.arquivo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mockupId]);

  // (re)processa a logo (remover fundo + recolorir) quando os inputs mudam
  useEffect(() => {
    if (!logoSrc) {
      logoProcRef.current = null;
      render();
      return;
    }
    const img = new Image();
    img.onload = () => {
      logoProcRef.current = processarLogo(img, removerFundo, corLogo);
      setPronto(true);
      render();
    };
    img.src = logoSrc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoSrc, removerFundo, corLogo]);

  // re-render em mudanças de layout
  useEffect(() => {
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escala, off, mockupId]);

  function processarLogo(img: HTMLImageElement, tirarFundo: boolean, cor: CorLogo): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    if (tirarFundo) {
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        // pixel quase branco e pouco saturado -> transparente
        if (min > 238 && max - min < 14) d[i + 3] = 0;
      }
      ctx.putImageData(data, 0, 0);
    }

    if (cor !== "original") {
      const out = document.createElement("canvas");
      out.width = c.width;
      out.height = c.height;
      const o = out.getContext("2d")!;
      o.drawImage(c, 0, 0);
      o.globalCompositeOperation = "source-in";
      o.fillStyle = cor === "preto" ? "#111111" : "#ffffff";
      o.fillRect(0, 0, out.width, out.height);
      return out;
    }
    return c;
  }

  function logoRect() {
    const img = mockupImgRef.current;
    const logo = logoProcRef.current;
    if (!img || !logo || !mockup) return null;
    const W = img.naturalWidth, H = img.naturalHeight;
    const area = {
      x: mockup.printArea.x * W,
      y: mockup.printArea.y * H,
      w: mockup.printArea.w * W,
      h: mockup.printArea.h * H,
    };
    const alvoLarg = area.w * escala;
    const ratio = logo.height / logo.width;
    let lw = alvoLarg;
    let lh = lw * ratio;
    if (lh > area.h * 1.6) {
      lh = area.h * 1.6;
      lw = lh / ratio;
    }
    const cx = area.x + area.w / 2 + off.x;
    const cy = area.y + area.h / 2 + off.y;
    return { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh, area };
  }

  function render() {
    const canvas = canvasRef.current;
    const img = mockupImgRef.current;
    if (!canvas || !img) return;
    if (canvas.width !== img.naturalWidth) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const lr = logoRect();
    if (lr) {
      ctx.save();
      // leve fusão com o tecido
      ctx.globalAlpha = 0.96;
      ctx.drawImage(logoProcRef.current!, lr.x, lr.y, lr.w, lr.h);
      ctx.restore();
    }
  }

  // ---- arrastar a logo ----
  function eventoParaNatural(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function onPointerDown(e: React.PointerEvent) {
    const lr = logoRect();
    if (!lr) return;
    const p = eventoParaNatural(e);
    if (p.x >= lr.x && p.x <= lr.x + lr.w && p.y >= lr.y && p.y <= lr.y + lr.h) {
      dragRef.current = { ativo: true, px: p.x, py: p.y };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current.ativo) return;
    const p = eventoParaNatural(e);
    setOff((o) => ({ x: o.x + (p.x - dragRef.current.px), y: o.y + (p.y - dragRef.current.py) }));
    dragRef.current.px = p.x;
    dragRef.current.py = p.y;
  }
  function onPointerUp() {
    dragRef.current.ativo = false;
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErro("Envie um arquivo de imagem (PNG, JPG ou SVG).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErro("Arquivo grande demais (máx. 5 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoSrc(typeof reader.result === "string" ? reader.result : null);
      setLogoNome(file.name);
      setOff({ x: 0, y: 0 });
      setEscala(0.7);
    };
    reader.readAsDataURL(file);
  }

  function baixar() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "mockup-confeccione.png";
    a.click();
  }

  function usarNoPedido() {
    try {
      const canvas = canvasRef.current;
      sessionStorage.setItem(
        "mockup_pedido",
        JSON.stringify({
          mockup: mockup?.nome,
          mockupId,
          imagem: canvas ? canvas.toDataURL("image/jpeg", 0.8) : null,
        })
      );
    } catch {
      /* ignora */
    }
  }

  return (
    <section className="bg-[#F7F8F9]">
      <div className="max-w-5xl mx-auto px-6 py-12 grid gap-6 md:grid-cols-[1fr_1.1fr]">
        {/* Controles */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col">
          <p className="text-gray-900 font-medium text-sm mb-3">1. Escolha a peça</p>
          <div className="grid grid-cols-3 gap-2 mb-5">
            {MOCKUPS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMockupId(m.id)}
                className={
                  "border-2 rounded-xl overflow-hidden text-left transition-all " +
                  (m.id === mockupId ? "border-[#1D9E75]" : "border-gray-200 hover:border-gray-300")
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.arquivo} alt={m.nome} className="w-full h-24 object-cover object-top bg-gray-50" />
                <span className="block text-[11px] text-gray-600 px-2 py-1 leading-tight">{m.nome}</span>
              </button>
            ))}
          </div>

          <p className="text-gray-900 font-medium text-sm mb-2">2. Sua arte / logo</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 text-left"
          >
            {logoNome ? `Trocar arte (${logoNome})` : "Anexar logo/arte (PNG, JPG, SVG)"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUpload} />
          {erro && <p className="text-red-600 text-xs mt-2">{erro}</p>}

          {logoSrc && (
            <div className="mt-5 space-y-4">
              <p className="text-gray-900 font-medium text-sm">3. Ajustes</p>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={removerFundo}
                  onChange={(e) => setRemoverFundo(e.target.checked)}
                  className="accent-[#1D9E75]"
                />
                Remover fundo branco da arte
              </label>

              <div>
                <p className="text-xs text-gray-500 mb-1">Cor da logo</p>
                <div className="flex gap-2">
                  {([
                    ["original", "Original"],
                    ["preto", "Preto"],
                    ["branco", "Branco"],
                  ] as [CorLogo, string][]).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setCorLogo(v)}
                      className={
                        "px-3 py-1.5 rounded-lg text-xs border transition-colors " +
                        (corLogo === v
                          ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Tamanho</span>
                </div>
                <input
                  type="range"
                  min={0.3}
                  max={1.3}
                  step={0.02}
                  value={escala}
                  onChange={(e) => setEscala(parseFloat(e.target.value))}
                  className="w-full accent-[#1D9E75]"
                />
                <p className="text-[11px] text-gray-400 mt-1">Arraste a arte na prévia pra posicionar.</p>
              </div>
            </div>
          )}
        </div>

        {/* Prévia (canvas) */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col">
          <p className="text-gray-900 font-medium text-sm mb-3">Prévia</p>
          <div className="flex-1 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              className="max-w-full max-h-[520px] object-contain touch-none cursor-move"
            />
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={baixar}
              disabled={!pronto}
              className="flex-1 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Baixar mockup
            </button>
            <Link
              href="/#pedido"
              onClick={usarNoPedido}
              className={
                "flex-1 text-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors " +
                (pronto ? "bg-[#1D9E75] hover:bg-[#0F6E56] text-white" : "bg-gray-100 text-gray-400 pointer-events-none")
              }
            >
              Usar no meu pedido →
            </Link>
          </div>
          {!pronto && (
            <p className="mt-2 text-[11px] text-gray-400 text-center">
              Anexe sua arte pra ver o mockup e habilitar o download.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
