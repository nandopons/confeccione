"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Papel = "user" | "assistant";
type Turno = { role: Papel; display: string; raw: string; seed?: boolean };
type Brief = {
  peca: string | null;
  cor: string | null;
  posicao_arte: string | null;
  tamanho_arte: string | null;
  estilo_foto: string | null;
  observacoes: string | null;
};

const SAUDACAO =
  "Oi! Eu te ajudo a montar o mockup da sua arte numa peça. Pra começar: qual peça você quer ver (camiseta, moletom, boné, bolsa…) e de que cor? E pode já anexar sua logo/arte no botão ali do lado.";

const BRIEF_VAZIO: Brief = {
  peca: null,
  cor: null,
  posicao_arte: null,
  tamanho_arte: null,
  estilo_foto: null,
  observacoes: null,
};

export default function MockupStudio() {
  const [turnos, setTurnos] = useState<Turno[]>([
    { role: "assistant", display: SAUDACAO, raw: "", seed: true },
  ]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);

  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoNome, setLogoNome] = useState<string | null>(null);

  const [brief, setBrief] = useState<Brief>({ ...BRIEF_VAZIO });
  const [promptImagem, setPromptImagem] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  const [gerando, setGerando] = useState(false);
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [avisoProvedor, setAvisoProvedor] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const fimRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnos, gerando]);

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
      setLogoDataUrl(typeof reader.result === "string" ? reader.result : null);
      setLogoNome(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function enviar() {
    const texto = input.trim();
    if (!texto || enviando) return;
    setErro(null);
    const novoUser: Turno = { role: "user", display: texto, raw: texto };
    const base = [...turnos, novoUser];
    setTurnos(base);
    setInput("");
    setEnviando(true);

    // histórico p/ API: ignora a saudação semente; assistant manda o JSON cru.
    const messages = base
      .filter((t) => !t.seed)
      .map((t) => ({ role: t.role, content: t.raw || t.display }));

    try {
      const res = await fetch("/api/mockup/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, temLogo: !!logoDataUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.mensagem) {
        setErro(data?.error || "Não consegui responder agora. Tente de novo.");
        setEnviando(false);
        return;
      }
      const raw = JSON.stringify({
        mensagem: data.mensagem,
        brief: data.brief ?? BRIEF_VAZIO,
        prompt_imagem: data.prompt_imagem ?? null,
        pronto: !!data.pronto,
      });
      setTurnos([...base, { role: "assistant", display: data.mensagem, raw }]);
      if (data.brief) setBrief(data.brief);
      setPromptImagem(data.prompt_imagem ?? null);
      setPronto(!!data.pronto);
    } catch {
      setErro("Erro de conexão. Verifique sua internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  async function gerar() {
    if (!pronto || !promptImagem || !logoDataUrl || gerando) return;
    setErro(null);
    setAvisoProvedor(null);
    setGerando(true);
    try {
      const res = await fetch("/api/mockup/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptImagem, logoDataUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(data?.error || "Falha ao gerar o mockup.");
      } else if (data?.disponivel) {
        setMockupUrl(data.imagemDataUrl);
      } else {
        setAvisoProvedor(
          data?.motivo ||
            "A geração de imagem ainda não está ativa. Em breve!"
        );
      }
    } catch {
      setErro("Erro de conexão ao gerar o mockup.");
    } finally {
      setGerando(false);
    }
  }

  function usarNoPedido() {
    try {
      sessionStorage.setItem(
        "mockup_brief",
        JSON.stringify({ brief, prompt: promptImagem, mockup: mockupUrl })
      );
    } catch {
      /* ignora */
    }
  }

  const resumoBrief = [
    brief.peca && `Peça: ${brief.peca}`,
    brief.cor && `Cor: ${brief.cor}`,
    brief.posicao_arte && `Arte: ${brief.posicao_arte}`,
    brief.tamanho_arte && `Tamanho: ${brief.tamanho_arte}`,
    brief.estilo_foto && `Foto: ${brief.estilo_foto}`,
  ].filter(Boolean) as string[];

  return (
    <section className="bg-[#F7F8F9]">
      <div className="max-w-5xl mx-auto px-6 py-12 grid gap-6 md:grid-cols-2">
        {/* Coluna do chat */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <p className="text-gray-900 font-medium text-sm">Assistente de mockup</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs font-medium text-[#0F6E56] hover:underline"
            >
              {logoNome ? "Trocar arte" : "Anexar logo/arte"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onUpload}
            />
          </div>

          {logoNome && (
            <div className="px-5 py-2 bg-[#E1F5EE] flex items-center gap-2 text-xs text-[#0F6E56]">
              {logoDataUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoDataUrl} alt="" className="w-6 h-6 object-contain rounded bg-white" />
              )}
              <span className="truncate">Arte anexada: {logoNome}</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 max-h-[420px] min-h-[280px]">
            {turnos.map((t, i) => (
              <div
                key={i}
                className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    t.role === "user"
                      ? "bg-[#1D9E75] text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%]"
                      : "bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[85%]"
                  }
                >
                  {t.display}
                </div>
              </div>
            ))}
            {enviando && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
                  digitando…
                </div>
              </div>
            )}
            <div ref={fimRef} />
          </div>

          {erro && <div className="px-5 pb-2 text-red-600 text-xs">{erro}</div>}

          <div className="border-t border-gray-100 p-3 flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escreva aqui…"
              className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]"
            />
            <button
              type="button"
              onClick={enviar}
              disabled={enviando || !input.trim()}
              className="bg-[#111] text-white px-4 py-2 rounded-xl text-sm font-medium hover:opacity-85 disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>

        {/* Coluna do preview */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col">
          <p className="text-gray-900 font-medium text-sm mb-3">Prévia do mockup</p>

          <div className="flex-1 rounded-xl border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden min-h-[280px]">
            {mockupUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={mockupUrl} alt="Mockup gerado" className="w-full h-full object-contain" />
            ) : gerando ? (
              <p className="text-gray-400 text-sm">Gerando seu mockup…</p>
            ) : (
              <div className="text-center px-6 py-8">
                <p className="text-gray-400 text-sm">
                  Seu mockup aparece aqui depois que você conversar com o assistente,
                  anexar a arte e clicar em “Gerar mockup”.
                </p>
              </div>
            )}
          </div>

          {resumoBrief.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {resumoBrief.map((r) => (
                <span
                  key={r}
                  className="bg-[#E1F5EE] text-[#0F6E56] text-[11px] px-2 py-1 rounded-full"
                >
                  {r}
                </span>
              ))}
            </div>
          )}

          {avisoProvedor && (
            <div className="mt-3 bg-blue-50 border-l-2 border-blue-400 text-blue-800 text-xs px-3 py-2 rounded-md leading-relaxed">
              {avisoProvedor}
              {promptImagem && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-blue-700">Ver o prompt montado</summary>
                  <p className="mt-1 text-blue-900/80 whitespace-pre-wrap">{promptImagem}</p>
                </details>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={gerar}
              disabled={!pronto || !logoDataUrl || gerando}
              className="flex-1 bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              {gerando ? "Gerando…" : mockupUrl ? "Gerar de novo" : "Gerar mockup"}
            </button>
            {mockupUrl && (
              /* eslint-disable-next-line @next/next/no-html-link-for-pages */
              <a
                href={mockupUrl}
                download="mockup-confeccione.png"
                className="flex-1 text-center border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50"
              >
                Baixar
              </a>
            )}
          </div>

          <Link
            href="/#pedido"
            onClick={usarNoPedido}
            className={
              "mt-2 text-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors " +
              (mockupUrl || resumoBrief.length > 0
                ? "bg-[#111] text-white hover:opacity-85"
                : "bg-gray-100 text-gray-400 pointer-events-none")
            }
          >
            Usar no meu pedido →
          </Link>
          {!pronto && (
            <p className="mt-2 text-[11px] text-gray-400 text-center">
              Dica: anexe a arte e responda peça, cor e posição pra liberar a geração.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
