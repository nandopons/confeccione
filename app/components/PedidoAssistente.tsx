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
  estampado?: boolean | null;
  descricao: string | null;
};
type Contato = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  complemento: string | null;
  logradouro?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  prazoDias?: number | null;
};
type Pedido = { linhas: Linha[]; contato: Contato };
type Fase = "produto" | "contato" | "completo";

type Turno = { role: "user" | "assistant"; display: string; raw: string };

const CONTATO_VAZIO: Contato = { nome: null, telefone: null, email: null, cep: null, complemento: null, logradouro: null, bairro: null, cidade: null, uf: null, prazoDias: null };
const PEDIDO_VAZIO: Pedido = { linhas: [], contato: { ...CONTATO_VAZIO } };

const SAUDACAO =
  "Oi! 👋 Vou te ajudar a montar seu pedido aqui mesmo. Me conta: o que você quer produzir? (ex.: “camisetas oversized pretas”, “bonés bordados”, “uniforme da minha equipe”)";

function corHex(s: string | null | undefined): string | null {
  const m = /#([0-9a-fA-F]{6})\b/.exec(s || "");
  return m ? "#" + m[1] : null;
}
function corLabel(s: string | null | undefined): string {
  return (s || "").replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, " ").replace(/#[0-9a-fA-F]{6}/g, "").replace(/\s{2,}/g, " ").trim();
}

export default function PedidoAssistente() {
  const [turnos, setTurnos] = useState<Turno[]>([
    { role: "assistant", display: SAUDACAO, raw: JSON.stringify({ mensagem: SAUDACAO, pedido: PEDIDO_VAZIO }) },
  ]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [pedido, setPedido] = useState<Pedido>(PEDIDO_VAZIO);
  const [fase, setFase] = useState<Fase>("produto");
  const [coresSugeridas, setCoresSugeridas] = useState<{ termo: string; opcoes: { nome: string; hex: string }[] } | null>(null);
  const [gravando, setGravando] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarEmBreve, setMostrarEmBreve] = useState(false);
  const salvoRef = useRef(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Altura do card quando o teclado virtual está aberto (mobile). null = padrão.
  const [alturaTeclado, setAlturaTeclado] = useState<number | null>(null);

  // Rola apenas o container de mensagens (nunca a janela) — evita o "pulo" da
  // página ao enviar. scrollIntoView mexeria no scroll do documento inteiro.
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turnos, enviando]);

  // Teclado virtual (mobile): encolhe o card pra caber exatamente no espaço
  // visível acima do teclado, mantendo o input sempre à vista — sensação de app.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const ajustar = () => {
      const tecladoAberto = vv.height < window.innerHeight - 120;
      if (tecladoAberto && document.activeElement === inputRef.current && cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        const disponivel = vv.height + vv.offsetTop - rect.top - 10;
        setAlturaTeclado(Math.max(240, Math.min(Math.round(disponivel), 560)));
        requestAnimationFrame(() => {
          const el = listaRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } else {
        setAlturaTeclado(null);
      }
    };
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
    };
  }, []);

  // Ao focar o input no mobile, alinha o chat com o topo da tela (deixa o
  // máximo de espaço útil acima do teclado que vai abrir).
  function aoFocarInput() {
    if (typeof window === "undefined" || window.innerWidth >= 1024) return;
    setTimeout(() => {
      cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 350);
  }

  // Textarea cresce com o conteúdo (até ~4 linhas) e volta ao normal ao limpar.
  function autoSize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 112) + "px";
  }

  async function salvarPedido(p: Pedido): Promise<string | null> {
    if (salvoRef.current) return protocolo;
    if (salvando) return null;
    setSalvando(true);
    try {
      const res = await fetch("/api/pedido/assistente/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas: p.linhas, contato: p.contato, conversa: turnos.map((t) => ({ role: t.role, texto: t.display })) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        const novoId = String(data.protocolo ?? data.id ?? "");
        salvoRef.current = true;
        setProtocolo(novoId);
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
        return novoId;
      }
      return null;
    } catch {
      // silencioso: o cliente ainda pode prosseguir; tentamos salvar de novo no botão
      return null;
    } finally {
      setSalvando(false);
    }
  }

  function escolherMime(): string {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    if (typeof MediaRecorder === "undefined") return "";
    for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* */ } }
    return "";
  }

  async function transcrever(blob: Blob, mime: string) {
    setTranscrevendo(true);
    setErro(null);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      const base64 = dataUrl.split(",")[1] || "";
      const r = await fetch("/api/pedido/assistente/transcrever", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: base64, mime }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.texto) { setErro(d?.erro || "Não consegui transcrever o áudio."); return; }
      setInput((prev) => (prev.trim() ? prev.trim() + " " + d.texto : d.texto));
      inputRef.current?.focus();
    } catch {
      setErro("Falha ao transcrever o áudio.");
    } finally {
      setTranscrevendo(false);
    }
  }

  async function iniciarGravacao() {
    if (gravando || transcrevendo) return;
    const mime = escolherMime();
    if (!navigator.mediaDevices?.getUserMedia || !mime) { setErro("Seu navegador não suporta gravação de áudio."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (blob.size > 0) void transcrever(blob, mime);
      };
      mediaRecRef.current = rec;
      rec.start();
      setGravando(true);
      setErro(null);
    } catch {
      setErro("Não consegui acessar o microfone. Verifique a permissão.");
    }
  }

  function pararGravacao() {
    if (!gravando) return;
    setGravando(false);
    try { mediaRecRef.current?.stop(); } catch { /* */ }
  }

  async function enviar(textoForcado?: string) {
    const texto = (textoForcado ?? input).trim();
    if (!texto || enviando) return;
    setErro(null);
    setCoresSugeridas(null);

    const novos: Turno[] = [...turnos, { role: "user", display: texto, raw: texto }];
    setTurnos(novos);
    if (textoForcado === undefined) {
      setInput("");
      const el = inputRef.current;
      if (el) {
        el.style.height = "auto";
        el.focus(); // mantém o teclado aberto no mobile — sem retoque a cada mensagem
      }
    }
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
      setCoresSugeridas(data.cores ?? null);
      setEnviando(false);
      if (novaFase === "completo") void salvarPedido(novoPedido);
    } catch {
      setErro("Erro de conexão. Verifique sua internet e tente de novo.");
      setEnviando(false);
    }
  }

  async function prosseguir() {
    const id = salvoRef.current ? protocolo : await salvarPedido(pedido);
    if (id) {
      window.location.href = `/visualizador/${id}`;
      return;
    }
    setMostrarEmBreve(true);
  }

  const totalPecas = pedido.linhas.reduce((acc, l) => acc + (l.total ?? 0), 0);
  const temResumo = pedido.linhas.length > 0 || Object.values(pedido.contato).some(Boolean);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_minmax(300px,380px)] items-start">
      {/* ----------------------------- CHAT ----------------------------- */}
      <div ref={cardRef} style={alturaTeclado ? { height: alturaTeclado } : undefined} className="bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col h-[440px] sm:h-[560px] overflow-hidden scroll-mt-2">
        <div className={"px-5 border-b border-gray-100 flex items-center gap-2 " + (alturaTeclado ? "py-2" : "py-3.5")}>
          <span className="w-8 h-8 rounded-full bg-[#E1F5EE] flex items-center justify-center text-[#0F6E56] text-sm font-semibold">C</span>
          <div>
            <p className="text-sm font-medium text-gray-900 leading-tight">Assistente Confeccione</p>
            <p className="text-[11px] text-gray-400 leading-tight">Monta seu pedido com você, passo a passo</p>
            <p className="text-[10px] text-gray-400 leading-tight mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1D9E75] inline-block" />
              Conversa acompanhada por Luigi, da Confeccione
            </p>
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
          {coresSugeridas && !enviando && (
            <div className="flex justify-start">
              <div className="max-w-[85%] w-full">
                <p className="text-xs text-gray-400 mb-1.5">Toque na tonalidade de {coresSugeridas.termo || "cor"}:</p>
                <div className="flex flex-wrap gap-2">
                  {coresSugeridas.opcoes.map((o, k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => void enviar(`Quero o tom ${o.nome} (${o.hex})`)}
                      className="flex items-center gap-1.5 border border-gray-200 rounded-xl pl-1.5 pr-2.5 py-1 hover:border-[#1D9E75] hover:bg-gray-50 transition-colors"
                      title={o.hex}
                    >
                      <span className="w-6 h-6 rounded-md border border-black/10" style={{ backgroundColor: o.hex }} />
                      <span className="text-xs text-gray-700">{o.nome}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {fase === "completo" && !enviando && (
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => void prosseguir()}
                disabled={salvando}
                className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm"
              >
                {salvando ? "Salvando…" : "Prosseguir para visualizadores →"}
              </button>
            </div>
          )}
        </div>

        {erro && <div className="px-5 pb-1 text-red-600 text-xs">{erro}</div>}

        <div className="border-t border-gray-100 p-2.5 sm:p-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoSize(); }}
            onFocus={aoFocarInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder="Escreva aqui…"
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            aria-label="Mensagem para o assistente"
            className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2.5 text-base sm:text-sm text-gray-800 max-h-28 focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15"
          />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => (gravando ? pararGravacao() : void iniciarGravacao())}
            disabled={transcrevendo || enviando}
            title={gravando ? "Parar e transcrever" : "Gravar áudio"}
            aria-label={gravando ? "Parar gravação" : "Gravar áudio"}
            className={"w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-sm font-medium disabled:opacity-40 border transition-colors " + (gravando ? "bg-red-500 text-white border-red-500 animate-pulse" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}
          >
            {transcrevendo ? "…" : gravando ? "⏹" : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            )}
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void enviar()}
            disabled={enviando || !input.trim()}
            aria-label="Enviar mensagem"
            className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white w-11 h-11 shrink-0 rounded-xl flex items-center justify-center disabled:opacity-40 transition-colors"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 20.85 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z" /></svg>
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
                  <p className="text-sm font-medium text-gray-900 capitalize flex items-center gap-1.5">
                    {corHex(l.cor) && <span className="w-3 h-3 rounded-full border border-black/10 inline-block shrink-0" style={{ backgroundColor: corHex(l.cor) as string }} />}
                    {[l.modelo, corLabel(l.cor)].filter(Boolean).join(" · ") || "Produto"}
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
              {(pedido.contato.logradouro || pedido.contato.cidade) && (
                <div className="text-gray-500">{[pedido.contato.logradouro, pedido.contato.bairro, [pedido.contato.cidade, pedido.contato.uf].filter(Boolean).join("/")].filter(Boolean).join(", ")}</div>
              )}
              {pedido.contato.prazoDias ? (
                <div className="text-gray-500">Prazo: {pedido.contato.prazoDias} dias</div>
              ) : null}
            </div>
          </div>
        )}

        {/* CTA: só aparece quando o pedido está completo (Etapa 2 = placeholder) */}
        {fase === "completo" && (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => void prosseguir()}
              disabled={salvando}
              className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-4 py-3 rounded-xl transition-colors"
            >
              {salvando ? "Salvando…" : "Prosseguir para visualizadores →"}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-2">Veja uma pré-visualização dos seus produtos.</p>

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
