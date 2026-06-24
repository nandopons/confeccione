"use client";
// Modal de chat por PRODUTO. Diferente do /alinhar (que trata o pedido inteiro),
// este foca em UM ÚNICO produto: pergunta só o que falta daquela peça e, ao
// concluir, devolve a linha completa pro visualizador (que grava e gera o mockup).
// Reusa o operador /api/pedido/assistente no modo "produto".
import { useEffect, useRef, useState } from "react";

export type LinhaProduto = {
  modelo: string | null; cor: string | null; material: string | null;
  publico: string | null; total: number | null;
  tamanhos: { tamanho: string; qtd: number | null }[];
  estampas?: { posicao: string; tamanho: string }[];
  estampado?: boolean | null; acabamentos?: string[] | null;
  categoria?: string | null; objetivo_material?: string | null; descricao: string | null;
};
type Turno = { role: "user" | "assistant"; display: string; raw?: string };
type CorOpcao = { nome: string; hex: string };
type Cores = { termo: string; opcoes: CorOpcao[] } | null;

function corLabel(s: string | null | undefined): string {
  return (s || "").replace(/\s*\(#([0-9a-fA-F]{6})\)\s*/, "").trim();
}

export default function ProdutoChat({
  pedidoId, categoria, linha, faltam, onConcluir, onFechar,
}: {
  pedidoId: string; categoria: string | null; linha: LinhaProduto;
  faltam: string[]; onConcluir: (l: LinhaProduto) => void; onFechar: () => void;
}) {
  void pedidoId;
  const nomeProduto = corLabel(linha.modelo) || "este produto";
  const resumo = [linha.modelo, corLabel(linha.cor)].filter(Boolean).join(" · ") || "produto sem detalhes";
  const seedLinha = {
    modelo: linha.modelo, cor: linha.cor, material: linha.material, publico: linha.publico,
    total: linha.total, tamanhos: linha.tamanhos || [], estampado: linha.estampado ?? null, descricao: linha.descricao,
  };
  const abertura =
    `Vamos completar o ${nomeProduto} pra eu gerar o visualizador. ` +
    (faltam.length ? `Faltou: ${faltam.join(", ")}. Me conta o primeiro: ${faltam[0]}?` : `O que você quer ajustar nesse produto?`);
  const aberturaRaw = JSON.stringify({ mensagem: abertura, cores: null, pedido: { linhas: [seedLinha], contato: {} } });

  const [turnos, setTurnos] = useState<Turno[]>([{ role: "assistant", display: abertura, raw: aberturaRaw }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [linhaAtual, setLinhaAtual] = useState<LinhaProduto>(linha);
  const [cores, setCores] = useState<Cores>(null);
  const [concluindo, setConcluindo] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turnos, enviando]);

  const totalPecas = (linha.total ?? 0) > 0 ? (linha.total as number) : (linha.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0);

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? input).trim();
    if (!texto || enviando) return;
    setErro(null); setCores(null);
    const novos: Turno[] = [...turnos, { role: "user", display: texto }];
    setTurnos(novos); setInput("");
    setEnviando(true);
    try {
      const payloadMsgs = novos.map((t) => ({ role: t.role, content: t.raw ?? t.display }));
      const res = await fetch("/api/pedido/assistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadMsgs, modo: "produto",
          contexto: { categoria, totalPecas, produtoResumo: resumo, faltam },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.mensagem) { setErro(data?.error || "Não consegui responder agora. Tenta de novo."); return; }
      const novaLinha = (data.pedido?.linhas?.[0] ?? null) as LinhaProduto | null;
      if (novaLinha) setLinhaAtual((prev) => ({ ...prev, ...novaLinha }));
      setCores(data.cores ?? null);
      const raw = JSON.stringify({ mensagem: data.mensagem, cores: data.cores ?? null, pedido: data.pedido });
      setTurnos([...novos, { role: "assistant", display: data.mensagem, raw }]);
    } catch {
      setErro("Falha de conexão. Tenta de novo.");
    } finally { setEnviando(false); }
  }

  function concluir() {
    if (concluindo) return;
    setConcluindo(true);
    const merged: LinhaProduto = {
      ...linha,
      modelo: linhaAtual.modelo, cor: linhaAtual.cor, material: linhaAtual.material,
      publico: linhaAtual.publico ?? linha.publico, total: linhaAtual.total ?? linha.total,
      tamanhos: (linhaAtual.tamanhos && linhaAtual.tamanhos.length ? linhaAtual.tamanhos : linha.tamanhos) || [],
      descricao: linhaAtual.descricao ?? linha.descricao,
    };
    onConcluir(merged);
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
              <div className={"max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap " + (t.role === "user" ? "bg-[#1D9E75] text-white" : "bg-gray-100 text-gray-800")}>{t.display}</div>
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
        <div className="border-t border-gray-100 p-3 shrink-0 space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
              rows={1} placeholder="Escreva aqui…" enterKeyHint="send"
              className="flex-1 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-[16px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75] max-h-28"
            />
            <button type="button" onClick={() => void enviar()} disabled={enviando || !input.trim()} className="shrink-0 h-11 w-11 rounded-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-40 text-white flex items-center justify-center" aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
            </button>
          </div>
          <button type="button" onClick={concluir} disabled={concluindo} className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-xl">
            {concluindo ? "Gerando…" : "Concluir e gerar visualizador →"}
          </button>
        </div>
      </div>
    </div>
  );
}
