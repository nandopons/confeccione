"use client";

// app/components/PedidoAssistente.tsx
// ============================================================================
// Etapa 1 do novo fluxo de pedido: chat assistido (à esquerda) + quadro de
// resumo do pedido ao vivo (à direita). O Claude (via /api/pedido/assistente)
// é a baliza: guia o cliente, uma pergunta por vez, monta as linhas do pedido
// (modelo, cor, material, tamanhos) e depois coleta o contato. Quando completo,
// salva em /api/pedido/assistente/criar e libera o botão "Prosseguir para
// visualizadores" (placeholder até a Etapa 2 com geração de mockups).
// ============================================================================

import { useEffect, useRef, useState } from "react";

type Tamanho = { tamanho: string; qtd: number | null };
type Linha = {
  modelo: string | null;
  cor: string | null;
  material: string | null;
  total: number | null;
  tamanhos: Tamanho[];
  descricao: string | null;
};
type Contato = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  complemento: string | null;
};
type Pedido = { linhas: Linha[]; contato: Contato };
type Fase = "produto" | "contato" | "completo";

type Turno = { role: "user" | "assistant"; display: string; raw: string };

const CONTATO_VAZIO: Contato = { nome: null, telefone: null, email: null, cep: null, complemento: null };
const PEDIDO_VAZIO: Pedido = { linhas: [], contato: { ...CONTATO_VAZIO } };

const SAUDACAO =
  "Oi! 👋 Vou te ajudar a montar seu pedido aqui mesmo. Me conta: o que você quer produzir? (ex.: “camisetas oversized pretas”, “bonés bordados”, “uniforme da minha equipe”)";

export default function PedidoAssistente() {
  const [turnos, setTurnos] = useState<Turno[]>([
    { role: "assistant", display: SAUDACAO, raw: JSON.stringify({ mensagem: SAUDACAO, pedido: PEDIDO_VAZIO }) },
  ]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [pedido, setPedido] = useState<Pedido>(PEDIDO_VAZIO);
  const [fase, setFase] = useState<Fase>("produto");

  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarEmBreve, setMostrarEmBreve] = useState(false);
  const salvoRef = useRef(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Rola apenas o container de mensagens (nunca a janela) — evita o "pulo" da
  // página ao enviar. scrollIntoView mexeria no scroll do documento inteiro.
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnos, enviando]);

  async function salvarPedido(p: Pedido) {
    if (salvoRef.current || salvando) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/pedido/assistente/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas: p.linhas, contato: p.contato }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        salvoRef.current = true;
        setProtocolo(String(data.protocolo ?? data.id ?? ""));
        try {
          const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
          w.dataLayer = w.dataLayer || [];
          w.dataLayer.push({
            event: "generate_lead",
            pedido_id: String(data.protocolo ?? data.id ?? ""),
            pecas: p.linhas.reduce((acc, l) => acc + (l.total ?? 0), 0),
            linhas: p.linhas.length,
            value: 1,
            currency: "BRL",
          });
        } catch {
          // analytics nunca quebra o fluxo
        }
      }
    } catch {
      // silencioso: o cliente ainda pode prosseguir; tentamos salvar de novo no botão
    } finally {
      setSalvando(false);
    }
  }

  async function enviar() {
    const texto = input.trim();
    if (!texto || enviando) return;
    setErro(null);

    const novos: Turno[] = [...turnos, { role: "user", display: texto, raw: texto }];
    setTurnos(novos);
    setInput("");
    setEnviando(true);

    // histórico p/ API: começa no 1º turno de usuário (Anthropic exige role user primeiro)
    const msgs = novos.map((t) => ({ role: t.role, content: t.raw }));
    while (msgs.length && msgs[0].role === "assistant") msgs.shift();

    try {
      const res = await fetch("/api/pedido/assistente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.mensagem) {
        setErro(data?.error || "Não consegui responder agora. Tente de novo.");
        setEnviando(false);
        return;
      }
      const novoPedido: Pedido = data.pedido ?? PEDIDO_VAZIO;
      const novaFase: Fase = data.fase ?? "produto";
      const raw = JSON.stringify({ mensagem: data.mensagem, pedido: novoPedido });
      setTurnos((t) => [...t, { role: "assistant", display: data.mensagem, raw }]);
      setPedido(novoPedido);
      setFase(novaFase);
      setEnviando(false);
      if (novaFase === "completo") void salvarPedido(novoPedido);
    } catch {
      setErro("Erro de conexão. Verifique sua internet e tente de novo.");
      setEnviando(false);
    }
  }

  async function prosseguir() {
    if (!salvoRef.current) await salvarPedido(pedido);
    setMostrarEmBreve(true);
  }

  const totalPecas = pedido.linhas.reduce((acc, l) => acc + (l.total ?? 0), 0);
  const temResumo = pedido.linhas.length > 0 || Object.values(pedido.contato).some(Boolean);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(300px,380px)] items-start">
      {/* ----------------------------- CHAT ----------------------------- */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col h-[560px] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-[#E1F5EE] flex items-center justify-center text-[#0F6E56] text-sm font-semibold">C</span>
          <div>
            <p className="text-sm font-medium text-gray-900 leading-tight">Assistente Confeccione</p>
            <p className="text-[11px] text-gray-400 leading-tight">Monta seu pedido com você, passo a passo</p>
          </div>
        </div>

        <div ref={listaRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {turnos.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap " +
                  (t.role === "user"
                    ? "bg-[#1D9E75] text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm")
                }
              >
                {t.display}
              </div>
            </div>
          ))}
          {enviando && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-400 rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm">digitando…</div>
            </div>
          )}
        </div>

        {erro && <div className="px-5 pb-1 text-red-600 text-xs">{erro}</div>}

        <div className="border-t border-gray-100 p-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder="Escreva aqui…"
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 max-h-28 focus:outline-none focus:border-[#1D9E75]"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || !input.trim()}
            className="bg-[#111] text-white px-4 py-2 rounded-xl text-sm font-medium hover:opacity-85 disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </div>

      {/* --------------------------- RESUMO ---------------------------- */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 lg:sticky lg:top-28">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-900">Resumo do pedido</p>
          {totalPecas > 0 && (
            <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">
              {totalPecas} {totalPecas === 1 ? "peça" : "peças"}
            </span>
          )}
        </div>

        {!temResumo && (
          <p className="text-sm text-gray-400 leading-relaxed">
            Conforme você for descrevendo no chat, seu pedido vai aparecendo aqui — produto por produto.
          </p>
        )}

        {pedido.linhas.length > 0 && (
          <div className="space-y-3">
            {pedido.linhas.map((l, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50/60">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-900 capitalize">
                    {[l.modelo, l.cor].filter(Boolean).join(" · ") || "Produto"}
                  </p>
                  {l.total ? <span className="text-xs text-gray-500 shrink-0">{l.total} un.</span> : null}
                </div>
                {l.material && <p className="text-xs text-gray-500 mb-1">Material: {l.material}</p>}
                {l.tamanhos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {l.tamanhos.map((t, j) => (
                      <span key={j} className="bg-white border border-gray-200 text-gray-700 text-[11px] px-2 py-0.5 rounded-md">
                        {t.tamanho.toUpperCase()}{t.qtd ? ` · ${t.qtd}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {l.descricao && <p className="text-[11px] text-gray-400 mt-2 leading-snug">{l.descricao}</p>}
              </div>
            ))}
          </div>
        )}

        {Object.values(pedido.contato).some(Boolean) && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 font-medium mb-2">Contato</p>
            <div className="space-y-1 text-sm text-gray-700">
              {pedido.contato.nome && <div>{pedido.contato.nome}</div>}
              {pedido.contato.telefone && <div className="text-gray-500">{pedido.contato.telefone}</div>}
              {pedido.contato.email && <div className="text-gray-500">{pedido.contato.email}</div>}
              {(pedido.contato.cep || pedido.contato.complemento) && (
                <div className="text-gray-500">{[pedido.contato.cep, pedido.contato.complemento].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          </div>
        )}

        {/* CTA: aparece assim que há produtos, mas só habilita após o contato.
            Ao confirmar, salva e avança pra próxima etapa (Etapa 2 = placeholder). */}
        {pedido.linhas.length > 0 && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void prosseguir()}
              disabled={fase !== "completo" || salvando}
              className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-3 rounded-xl transition-colors"
            >
              {salvando ? "Salvando…" : "Confirmar pedido →"}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-2">
              {fase === "completo"
                ? "Avançar para a pré-visualização dos seus produtos."
                : "Disponível depois que você informar seus dados de contato no chat."}
            </p>

            {mostrarEmBreve && (
              <div className="mt-3 bg-[#E1F5EE] border border-[#1D9E75]/30 rounded-xl p-3 text-center">
                <p className="text-sm text-[#0F6E56] font-medium">Pré-visualização chega em breve 🚧</p>
                <p className="text-xs text-[#0F6E56]/80 mt-1 leading-relaxed">
                  Seu pedido foi salvo{protocolo ? <> — protocolo <strong>#{protocolo.slice(0, 8)}</strong></> : ""}. Em breve você vai poder ver cada produto em frente, costas e lateral, e aplicar suas artes.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
