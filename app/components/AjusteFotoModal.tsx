"use client";

// app/components/AjusteFotoModal.tsx
// ============================================================================
// Ajuste do enquadramento da foto da vitrine (05/09/2026).
//
// Substitui os três botões (Cima / Meio / Baixo). Eles resolviam só o "cortou a
// cabeça": peça fora do eixo, foto tirada de lado e peça pequena num quadro
// grande continuavam sem solução, e não havia como aproximar. E, pior, cada
// clique era uma ida ao servidor pra descobrir se ficou bom — o fornecedor
// ajustava no escuro.
//
// Aqui ele vê o corte ANTES de salvar: a foto crua aparece dentro da moldura
// 4:5 e ele posiciona arrastando ou pelas setas, e aproxima com + / −. Só o
// "Salvar" processa de verdade.
//
// A conta do preview é a MESMA de normalizarFotoPortfolio: escala = quanto a
// foto precisa crescer pra cobrir o quadro, vezes o zoom; a posição é uma
// fração de quanto sobra. Se as duas divergirem, a pessoa posiciona uma coisa e
// recebe outra — por isso a fórmula está escrita nos dois lugares com os mesmos
// nomes. Mudou aqui, muda lá.
//
// Serve o fornecedor e o admin: só muda o `endpoint`.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioItem } from "@/app/lib/portfolio-fornecedor";
// De portfolio-corte, NÃO de portfolio-normalizar: aquele importa sharp, que é
// nativo e de servidor — puxá-lo daqui quebraria o bundle do navegador.
import { ZOOM_MAX, type Corte } from "@/app/lib/portfolio-corte";

/** Passo das setas, em % do que sobra. 4% move o suficiente pra ver, e pouco
 *  o bastante pra dar pra parar no ponto certo sem brigar com o botão. */
const PASSO = 4;
const PASSO_ZOOM = 0.1;

const limitar = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export default function AjusteFotoModal({
  foto,
  endpoint,
  aoFechar,
  aoSalvar,
}: {
  foto: PortfolioItem;
  /** Rota que reprocessa. Fornecedor e admin passam a sua. */
  endpoint: string;
  aoFechar: () => void;
  aoSalvar: (item: PortfolioItem) => void;
}) {
  const [corte, setCorte] = useState<Corte>(foto.corte);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const molduraRef = useRef<HTMLDivElement>(null);
  // Dimensões da FOTO (naturais) e da MOLDURA (em tela). As duas em estado, não
  // lidas do ref na hora de renderizar: ref não dispara render, então o preview
  // ficaria em branco na primeira pintura e desalinhado ao girar o celular.
  const [dimensoes, setDimensoes] = useState<{ L: number; A: number } | null>(null);
  const [moldura, setMoldura] = useState<{ L: number; A: number } | null>(null);

  useEffect(() => {
    const el = molduraRef.current;
    if (!el) return;
    const medir = () => setMoldura({ L: el.clientWidth, A: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── A conta (espelho de normalizarFotoPortfolio) ───
  // escala: quanto a foto crua precisa crescer pra COBRIR a moldura, vezes zoom.
  // deslocamento: a fração `x`/`y` do que sobra pra fora da moldura.
  const estilo = (() => {
    if (!moldura || !dimensoes) return { visibility: "hidden" as const };
    const escala =
      Math.max(moldura.L / dimensoes.L, moldura.A / dimensoes.A) * corte.zoom;
    const l = dimensoes.L * escala;
    const a = dimensoes.A * escala;
    return {
      width: `${l}px`,
      height: `${a}px`,
      left: `${-(l - moldura.L) * (corte.x / 100)}px`,
      top: `${-(a - moldura.A) * (corte.y / 100)}px`,
    };
  })();

  const mover = useCallback((dx: number, dy: number) => {
    setCorte((c) => ({
      ...c,
      x: limitar(c.x + dx, 0, 100),
      y: limitar(c.y + dy, 0, 100),
    }));
  }, []);

  const aproximar = useCallback((d: number) => {
    setCorte((c) => ({
      ...c,
      zoom: Math.round(limitar(c.zoom + d, 1, ZOOM_MAX) * 100) / 100,
    }));
  }, []);

  // Teclado: as setas são o controle preciso, e quem chegou aqui pelo teclado
  // não deveria precisar caçar os botões.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const mapa: Record<string, () => void> = {
        ArrowLeft: () => mover(-PASSO, 0),
        ArrowRight: () => mover(PASSO, 0),
        ArrowUp: () => mover(0, -PASSO),
        ArrowDown: () => mover(0, PASSO),
        "+": () => aproximar(PASSO_ZOOM),
        "=": () => aproximar(PASSO_ZOOM),
        "-": () => aproximar(-PASSO_ZOOM),
        Escape: aoFechar,
      };
      const acao = mapa[e.key];
      if (!acao) return;
      e.preventDefault();
      acao();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [mover, aproximar, aoFechar]);

  // Arrastar: converte o deslocamento do ponteiro em % do que sobra, que é a
  // mesma unidade das setas — os dois controles mexem na mesma variável.
  const arrasto = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  function aoPressionar(e: React.PointerEvent) {
    if (!moldura || !dimensoes) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    arrasto.current = { px: e.clientX, py: e.clientY, cx: corte.x, cy: corte.y };
  }

  function aoArrastar(e: React.PointerEvent) {
    const a = arrasto.current;
    if (!a || !moldura || !dimensoes) return;
    const escala =
      Math.max(moldura.L / dimensoes.L, moldura.A / dimensoes.A) * corte.zoom;
    const sobraL = dimensoes.L * escala - moldura.L;
    const sobraA = dimensoes.A * escala - moldura.A;
    // Arrastar pra direita mostra o que está à ESQUERDA, então o sinal inverte.
    const dx = sobraL > 0 ? (-(e.clientX - a.px) / sobraL) * 100 : 0;
    const dy = sobraA > 0 ? (-(e.clientY - a.py) / sobraA) * 100 : 0;
    setCorte((c) => ({
      ...c,
      x: limitar(a.cx + dx, 0, 100),
      y: limitar(a.cy + dy, 0, 100),
    }));
  }

  function aoSoltar() {
    arrasto.current = null;
  }

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corte),
      });
      const json = await r.json();
      if (!r.ok) {
        setErro(json?.error ?? "não consegui salvar o enquadramento");
        return;
      }
      aoSalvar(json as PortfolioItem);
    } catch {
      setErro("falha de conexão ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  const seta =
    "w-10 h-10 rounded-lg border border-gray-200 text-gray-700 hover:border-gray-400 hover:bg-gray-50 active:bg-gray-100 text-base leading-none transition-colors disabled:opacity-40";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={aoFechar}
      role="presentation"
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-gray-900 font-medium">Ajustar a foto</h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="w-8 h-8 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        <div className="p-5">
          <p className="text-gray-500 text-xs mb-3 leading-relaxed">
            Arraste a foto ou use as setas. O que aparecer dentro da moldura é
            exatamente o que vai pra vitrine.
          </p>

          {/* Moldura 4:5 — a mesma proporção do resultado. */}
          <div
            ref={molduraRef}
            onPointerDown={aoPressionar}
            onPointerMove={aoArrastar}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            className="relative w-full aspect-[4/5] overflow-hidden rounded-xl bg-gray-100 touch-none cursor-grab active:cursor-grabbing select-none"
          >
            {foto.urlOriginal ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={foto.urlOriginal}
                alt="Foto original, para posicionar o corte"
                draggable={false}
                onLoad={(e) =>
                  setDimensoes({
                    L: e.currentTarget.naturalWidth,
                    A: e.currentTarget.naturalHeight,
                  })
                }
                style={estilo}
                className="absolute max-w-none pointer-events-none"
              />
            ) : (
              <p className="absolute inset-0 flex items-center justify-center text-center text-xs text-gray-500 px-6">
                Esta foto subiu antes de a gente guardar o arquivo original.
                Envie ela de novo pra poder reenquadrar.
              </p>
            )}
          </div>

          {/* Setas em cruz: é o controle preciso, pra quando arrastar passa do
              ponto. Zoom ao lado, na mesma altura. */}
          <div className="flex items-center justify-between gap-4 mt-4">
            <div className="grid grid-cols-3 gap-1 w-[136px]">
              <span />
              <button type="button" className={seta} onClick={() => mover(0, -PASSO)} aria-label="Mover para cima">↑</button>
              <span />
              <button type="button" className={seta} onClick={() => mover(-PASSO, 0)} aria-label="Mover para a esquerda">←</button>
              <button
                type="button"
                onClick={() => setCorte({ x: 50, y: 50, zoom: 1 })}
                aria-label="Centralizar"
                title="Centralizar"
                className="w-10 h-10 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 hover:bg-gray-50 text-xs transition-colors"
              >
                ⊙
              </button>
              <button type="button" className={seta} onClick={() => mover(PASSO, 0)} aria-label="Mover para a direita">→</button>
              <span />
              <button type="button" className={seta} onClick={() => mover(0, PASSO)} aria-label="Mover para baixo">↓</button>
              <span />
            </div>

            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-500">Aproximar</span>
                <span className="text-xs text-gray-400 tabular-nums">
                  {corte.zoom.toFixed(1)}×
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={seta}
                  onClick={() => aproximar(-PASSO_ZOOM)}
                  disabled={corte.zoom <= 1}
                  aria-label="Afastar"
                >
                  −
                </button>
                <input
                  type="range"
                  min={1}
                  max={ZOOM_MAX}
                  step={0.1}
                  value={corte.zoom}
                  onChange={(e) => setCorte((c) => ({ ...c, zoom: Number(e.target.value) }))}
                  aria-label="Aproximação"
                  className="flex-1 accent-[#1D9E75]"
                />
                <button
                  type="button"
                  className={seta}
                  onClick={() => aproximar(PASSO_ZOOM)}
                  disabled={corte.zoom >= ZOOM_MAX}
                  aria-label="Aproximar"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {erro && (
            <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              {erro}
            </p>
          )}

          <div className="flex gap-2 justify-end mt-5">
            <button
              type="button"
              onClick={aoFechar}
              className="text-gray-600 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || !foto.urlOriginal}
              className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:bg-gray-300 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
            >
              {salvando ? "Salvando…" : "Salvar enquadramento"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
