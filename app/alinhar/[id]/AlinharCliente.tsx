"use client";
// Chat de ALINHAMENTO do pedido. Reusa o operador /api/pedido/assistente em
// modo "alinhar" (sem contato — já coletado): decompõe em linhas (modelo, cor,
// tamanhos, tecido). Ao concluir, grava as linhas via PATCH e segue pro
// visualizador. Tem "pular" pra quem prefere organizar lá mesmo.
import { useEffect, useRef, useState } from "react";

type Tamanho = { tamanho: string; qtd: number | null };
type Linha = {
  modelo: string | null; cor: string | null; material: string | null;
  publico: string | null; total: number | null; tamanhos: Tamanho[];
  estampado: boolean | null; descricao: string | null;
};
type Pedido = { linhas: Linha[]; contato: unknown };
type Turno = { role: "user" | "assistant"; display: string; raw?: string };
type CorOpcao = { nome: string; hex: string };
type Cores = { termo: string; opcoes: CorOpcao[] } | null;

const PEDIDO_VAZIO: Pedido = { linhas: [], contato: {} };

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

export default function AlinharCliente({ pedidoId, categoria, totalPecas }: { pedidoId: string; categoria: string | null; totalPecas: number }) {
  const abertura =
    `Boa! ${totalPecas > 0 ? `Você sinalizou *${totalPecas} ${totalPecas === 1 ? "peça" : "peças"}*${categoria ? ` de ${categoria}` : ""}. ` : ""}` +
    `Pra deixar tudo organizado: quantos modelos diferentes você quer produzir? (ex.: só 1 modelo, ou camiseta + moletom…) — se já souber o modelo, pode me dizer direto.`;
  const [turnos, setTurnos] = useState<Turno[]>([{ role: "assistant", display: abertura }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido>(PEDIDO_VAZIO);
  const [cores, setCores] = useState<Cores>(null);
  const [concluindo, setConcluindo] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turnos, enviando]);

  const temLinha = pedido.linhas.some(linhaCompleta);

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? input).trim();
    if (!texto || enviando) return;
    setErro(null); setCores(null);
    const novos: Turno[] = [...turnos, { role: "user", display: texto }];
    setTurnos(novos); setInput(""); setEnviando(true);
    try {
      const payloadMsgs = novos.map((t) => ({ role: t.role, content: t.role === "assistant" ? (t.raw ?? t.display) : t.display }));
      const res = await fetch("/api/pedido/assistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMsgs, modo: "alinhar", contexto: { categoria, totalPecas } }),
      });
      const data = await res.json();
      if (!res.ok || !data?.mensagem) { setErro(data?.error || "Não consegui responder agora. Tenta de novo."); return; }
      const novoPedido: Pedido = data.pedido ?? PEDIDO_VAZIO;
      setPedido(novoPedido);
      setCores(data.cores ?? null);
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
      if (temLinha) {
        const linhas = pedido.linhas.filter(linhaCompleta).map((l) => ({
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
          <div className="flex items-end gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
              rows={1} placeholder="Escreva aqui…" enterKeyHint="send"
              className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75] max-h-28"
            />
            <button type="button" onClick={() => void enviar()} disabled={enviando || !input.trim()}
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
