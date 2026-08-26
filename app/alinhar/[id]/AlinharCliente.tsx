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

/* Cards de resposta rápida. Quem monta a lista é o backend (app/api/pedido/
 * assistente), a partir do campo que o modelo disse estar perguntando — aqui
 * é só desenho. Clicar num card manda o título como se o cliente tivesse
 * escrito, então nada muda no resto do fluxo. */
type Cards = { campo: string; opcoes: Array<{ titulo: string; nota?: string }> } | null;

const PEDIDO_VAZIO: Pedido = { linhas: [], contato: {} };
const MAX_FOTOS = 6;
const MAX_COLETA = 12; // total de fotos de referência que o chat pode juntar (distribuídas entre os modelos)
// Teto da espera pela resposta do assistente. 60s é folgado pro caminho normal
// e curto o bastante pra o cliente não ficar olhando "digitando…" sem fim.
const TIMEOUT_CHAT_MS = 60_000;
// O iOS dispara uma RAJADA de resizes do visualViewport durante a animação do
// teclado (~6 eventos em 250ms). 140ms espera a rajada assentar sem parecer
// lento — abaixo disso volta o sobe-e-desce; acima, o card demora a acomodar.
const DEBOUNCE_TECLADO_MS = 140;

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

/* ---------------------------------------------------------------------------
 * DOIS SHELLS, UM CHAT — 24/08/2026
 * ---------------------------------------------------------------------------
 * `embutido` liga a variante que roda DENTRO do cartão do pedido, como passo 4
 * (app/components/PedidoSteps.tsx). O que muda é só a moldura:
 *
 *   página inteira  →  grid de 2 colunas, chat em 70vh, resumo numa aside fixa
 *                      no desktop e num bottom-sheet no celular
 *   embutido        →  só a coluna do chat, altura menor, e o resumo SEMPRE no
 *                      bottom-sheet — dentro de um cartão de ~640px não sobra
 *                      largura pra uma aside de 320px
 *
 * A conversa, os anexos, o `concluir` e o mapa de fotos são os mesmos nos dois.
 * Duplicar esse componente pra fazer o passo 4 significaria manter dois chats.
 * ------------------------------------------------------------------------- */
export default function AlinharCliente({ pedidoId, categoria, totalPecas, linhasIniciais = [], embutido = false }: { pedidoId: string; categoria: string | null; totalPecas: number; linhasIniciais?: LinhaInicial[]; embutido?: boolean }) {
  const linhasBase: Linha[] = (linhasIniciais ?? []).map((l) => ({
    modelo: l?.modelo ?? null, cor: l?.cor ?? null, material: l?.material ?? null,
    publico: l?.publico ?? null, total: l?.total ?? null,
    tamanhos: Array.isArray(l?.tamanhos) ? l!.tamanhos!.map((t) => ({ tamanho: t?.tamanho ?? "", qtd: t?.qtd ?? null })) : [],
    estampado: l?.estampado ?? null, descricao: l?.descricao ?? null,
  }));
  const resumoProdutos = linhasBase.filter(linhaCompleta).map((l) => `${l.modelo}${corLabel(l.cor) ? ` ${corLabel(l.cor)}` : ""}${l.total ? ` (${l.total})` : ""}`);
  const jaTem = resumoProdutos.length > 0;
  /* Aberturas curtas de propósito (25/08/2026). As anteriores tinham ~200
   * caracteres e ocupavam OITO linhas no celular — a primeira coisa que o
   * cliente via era um paredão de texto, e os cards de resposta nasciam abaixo
   * da dobra do chat. Menos texto aqui é layout, não só tom. */
  const abertura = jaTem
    ? `Seu pedido já tem: ${resumoProdutos.join(", ")}. O que você quer ajustar? Mexo só no que você pedir — o resto fica como está. 😊`
    // Desde 24/08/2026 a home não pergunta mais quantidade, então `totalPecas`
    // costuma vir 0. Nesse caso a abertura ainda repete a CATEGORIA escolhida —
    // sem isso o cliente cai num "e aí?" que ignora o que ele acabou de marcar.
    : `${
        totalPecas > 0
          ? `Boa, ${totalPecas} ${totalPecas === 1 ? "peça" : "peças"}${categoria ? ` de ${categoria}` : ""}! `
          : categoria
          ? `Boa, ${categoria}! `
          : "Boa! "
      }` +
      `Quantos modelos diferentes você quer produzir? Se já tiver foto do que quer, manda pelo 📎.`;
  const pedidoInicial: Pedido = jaTem ? { linhas: linhasBase, contato: {} } : PEDIDO_VAZIO;
  const aberturaRaw = jaTem ? JSON.stringify({ mensagem: abertura, cores: null, pedido: pedidoInicial }) : undefined;
  const [turnos, setTurnos] = useState<Turno[]>([{ role: "assistant", display: abertura, raw: aberturaRaw }]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido>(pedidoInicial);
  const [cores, setCores] = useState<Cores>(null);
  const [cards, setCards] = useState<Cards>(null);
  const [concluindo, setConcluindo] = useState(false);
  const [anexos, setAnexos] = useState<string[]>([]);
  const [fotosColetadas, setFotosColetadas] = useState<{ id: number; url: string }[]>([]);
  const [mapaFotos, setMapaFotos] = useState<Record<string, number[]> | null>(null);
  const proxIdRef = useRef(1);
  const [subindo, setSubindo] = useState(false);
  const [sheetAberto, setSheetAberto] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Altura do card quando o teclado virtual está aberto (mobile). null = padrão (lg:h-[70vh]).
  const [alturaTeclado, setAlturaTeclado] = useState<number | null>(null);

  // Rola apenas o container de mensagens (nunca a janela) — evita o "pulo" da
  // página ao enviar.
  useEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else fimRef.current?.scrollIntoView({ behavior: "smooth" });
    // `cards` entra nas dependências porque a fila de cards nasce DEPOIS da
    // última mensagem: sem isso, num celular ela podia aparecer abaixo da
    // dobra do chat e o cliente nem via que tinha o que clicar.
  }, [turnos, enviando, anexos, cards]);

  // Teclado virtual (mobile): encolhe o card pra caber exatamente no espaço
  // visível acima do teclado, mantendo o input sempre à vista — sensação de app.
  // Desktop (lg) nunca entra aqui (guard innerWidth) e mantém lg:h-[70vh].
  //
  // 26/08/2026 — O CARD SUBIA E DESCIA ao focar a caixa de texto. Eram TRÊS
  // animações brigando enquanto o teclado abria:
  //   (a) o iOS rola a página pro campo focado, por conta própria;
  //   (b) um scrollIntoView SUAVE disparava no onFocus 350ms depois;
  //   (c) o visualViewport emite VÁRIOS resizes durante a animação do teclado,
  //       e cada um recalculava a altura com o rect.top ainda em movimento —
  //       cada aplicação com transição de 200ms por cima da anterior.
  //
  // O conserto: (b) foi removido; (c) passa por um DEBOUNCE — espera os
  // eventos assentarem e só então mede uma vez; e a medição começa com um
  // scroll INSTANTÂNEO do card pro topo, pra medir um rect parado.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const aplicar = () => {
      if (window.innerWidth >= 1024) { setAlturaTeclado(null); return; }
      const card = cardRef.current;
      const tecladoAberto = vv.height < window.innerHeight - 120;
      if (!tecladoAberto || document.activeElement !== inputRef.current || !card) {
        setAlturaTeclado(null);
        return;
      }
      // Instantâneo (behavior: "auto"): rolar suave aqui seria medir um alvo
      // em movimento — foi exatamente o que produzia o sobe-e-desce.
      card.scrollIntoView({ block: "start", behavior: "auto" });
      const rect = card.getBoundingClientRect();
      const disponivel = vv.height + vv.offsetTop - rect.top - 10;
      setAlturaTeclado(Math.max(240, Math.min(Math.round(disponivel), 620)));
      requestAnimationFrame(() => {
        const el = listaRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    };

    const agendar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(aplicar, DEBOUNCE_TECLADO_MS);
    };

    vv.addEventListener("resize", agendar);
    vv.addEventListener("scroll", agendar);
    return () => {
      if (timer) clearTimeout(timer);
      vv.removeEventListener("resize", agendar);
      vv.removeEventListener("scroll", agendar);
    };
  }, []);

  // Textarea cresce com o conteúdo (até ~4 linhas) e volta ao normal ao limpar.
  function autoSize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 112) + "px";
  }

  const temLinha = pedido.linhas.some(linhaCompleta);
  // Botão apagado engole o toque sem resposta nenhuma — mais um clique morto.
  // Sem mensagem, o toque no enviar FOCA o input (o visual continua apagado);
  // durante o envio ele fica desabilitado de verdade.
  const semMensagem = !input.trim() && anexos.length === 0;
  const totalFotos = fotosColetadas.length + anexos.length;
  const qtdProdutos = pedido.linhas.length;

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
    setErro(null); setCores(null); setCards(null);
    // Snapshot pro ROLLBACK do envio otimista (26/08/2026). Antes, uma falha
    // deixava o turno do cliente no histórico: reenviar duplicava a fala dele
    // na conversa (e o operador recebia a mesma frase duas vezes).
    const anteriores = turnos;
    const novos: Turno[] = [...turnos, { role: "user", display: texto, fotos: fotos.length ? fotos : undefined }];
    setTurnos(novos); setInput(""); setAnexos([]);
    // limpa a altura do textarea após enviar e mantém o teclado aberto no mobile.
    if (textoForcado === undefined) {
      const el = inputRef.current;
      if (el) { el.style.height = "auto"; el.focus(); }
    }
    const novasColetadas = fotos.map((u) => ({ id: proxIdRef.current++, url: u }));
    if (novasColetadas.length) setFotosColetadas((p) => [...p, ...novasColetadas].slice(0, MAX_COLETA));
    const idsNovos = new Set(novasColetadas.map((c) => c.id));

    /** Devolve tudo pro estado de antes do envio e explica o que fazer. */
    const desfazerEnvio = (aviso: string) => {
      setTurnos(anteriores);
      setInput(texto);
      setAnexos(fotos);
      if (idsNovos.size) setFotosColetadas((p) => p.filter((c) => !idsNovos.has(c.id)));
      setErro(aviso);
      requestAnimationFrame(autoSize);
    };

    setEnviando(true);
    // Sem timeout, uma resposta pendurada virava "digitando…" pra sempre — o
    // padrão exato da sessão de 25/08 que some no minuto 1 e nunca volta.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_CHAT_MS);
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
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok || !data?.mensagem) {
        desfazerEnvio((data?.error || "Não consegui responder agora.") + " Sua mensagem voltou pra caixa — é só enviar de novo.");
        return;
      }
      const novoPedido: Pedido = data.pedido ?? PEDIDO_VAZIO;
      setPedido(novoPedido);
      setCores(data.cores ?? null);
      setCards(data.cards ?? null);
      if (data.fotosPorLinha && typeof data.fotosPorLinha === "object") setMapaFotos(data.fotosPorLinha);
      const raw = JSON.stringify({ mensagem: data.mensagem, cores: data.cores ?? null, pedido: novoPedido });
      setTurnos([...novos, { role: "assistant", display: data.mensagem, raw }]);
    } catch (e) {
      const abortou = e instanceof DOMException && e.name === "AbortError";
      desfazerEnvio(
        abortou
          ? "A resposta demorou demais. Sua mensagem voltou pra caixa — é só enviar de novo."
          : "Falha de conexão. Sua mensagem voltou pra caixa — é só enviar de novo.",
      );
    } finally { clearTimeout(timer); setEnviando(false); }
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

  // Lista de produtos do resumo (parte que ROLA no bottom-sheet mobile).
  const resumoLista = () => (
    <div className="space-y-3">
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
                {l.publico && <p className="text-[11px] text-gray-500 mt-0.5">Público: {({ feminino: "Feminino", masculino: "Masculino", infantil: "Infantil", unissex: "Unissex" } as Record<string, string>)[l.publico] ?? l.publico}</p>}
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
    </div>
  );

  // Ações do resumo (botão Concluir + link organizar). No mobile ficam FIXAS no rodapé do sheet.
  const resumoAcoes = () => (
    <>
      <button type="button" onClick={() => void concluir()} disabled={concluindo}
        className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-4 py-3 rounded-xl">
        {concluindo ? "Salvando…" : temLinha ? "Concluir e ver os produtos →" : "Ir para os produtos →"}
      </button>
      <button type="button" onClick={pular} className="w-full text-xs text-gray-400 hover:text-[#0F6E56]">organizar eu mesmo na página de produtos</button>
    </>
  );

  return (
    <div className={embutido ? "w-full" : "flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6"}>
      {/* CHAT */}
      <div
        ref={cardRef}
        style={alturaTeclado ? { height: alturaTeclado } : undefined}
        className={
          "flex flex-col bg-white overflow-hidden scroll-mt-2 transition-[height] duration-200 ease-out " +
          (embutido
            // Dentro do cartão do pedido a borda e a sombra já vêm de fora —
            // repetir as duas desenharia um cartão dentro do outro.
            // svh (e não vh): no celular o vh conta a barra de endereço, então
            // 62vh estourava a tela quando a barra estava visível. svh usa o
            // viewport pequeno — altura estável, sem pular quando a barra some.
            ? "h-[64svh] max-h-[520px] min-h-[360px] rounded-xl border border-gray-200"
            : "h-[72svh] lg:h-[70vh] rounded-2xl border border-gray-200 shadow-sm")
        }
      >
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 shrink-0">
          <p className="text-gray-900 font-medium text-sm truncate">{embutido ? "Sua produção" : "💬 Vamos alinhar seu pedido"}</p>
          {/* Embutido, o mesmo atalho já aparece embaixo do chat ("organizar eu
              mesmo na página de produtos") — repetir aqui só roubava largura
              do título no celular. */}
          {!embutido && (
            <button type="button" onClick={pular} className="text-xs text-gray-400 hover:text-[#0F6E56] whitespace-nowrap shrink-0">prefiro organizar eu mesmo →</button>
          )}
        </div>
        <div ref={listaRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3.5 sm:px-4 sm:py-4 space-y-3">
          {turnos.map((t, i) => (
            <div key={i} className={"flex " + (t.role === "user" ? "justify-end" : "justify-start")}>
              <div className={"max-w-[88%] sm:max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] " + (t.role === "user" ? "bg-[#1D9E75] text-white" : "bg-gray-100 text-gray-800")}>
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
                // preventDefault no pointerdown: sem isso o toque rouba o foco
                // do textarea, o teclado cai e o card redimensiona no meio.
                <button key={o.hex} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => void enviar(`${o.nome} (${o.hex})`)}
                  className="flex items-center gap-1.5 border border-gray-200 rounded-full pl-1 pr-2.5 py-1 text-xs text-gray-700 hover:border-[#1D9E75]">
                  <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: o.hex }} />
                  {o.nome}
                </button>
              ))}
            </div>
          )}
          {/* Cards de resposta rápida da pergunta da vez.
           *
           * 25/08/2026 — a versão anterior forçava UMA fila em qualquer tela
           * (`repeat(N, 1fr)` inline). No celular, dentro do cartão do passo 4,
           * sobram ~230px pra lista: 4 opções viravam colunas de ~58px e
           * "Masculino"/"Feminino" vazavam por cima da borda do card ao lado.
           *
           * Agora: 2 colunas no celular (com a última ocupando a linha inteira
           * quando o total é ímpar, pra não deixar buraco) e uma fila só a
           * partir de md, onde a largura comporta. A contagem de opções é 2, 3
           * ou 4 — ver CARDS em app/api/pedido/assistente. */}
          {cards && cards.opcoes.length > 0 && !enviando && (
            <div
              className="grid grid-cols-2 gap-2 pt-1 md:[grid-template-columns:var(--fila)] [&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child]:col-span-1"
              style={{ "--fila": `repeat(${cards.opcoes.length}, minmax(0, 1fr))` } as React.CSSProperties}
            >
              {cards.opcoes.map((o) => (
                <button
                  key={o.titulo}
                  type="button"
                  // Mantém o teclado aberto (o botão de enviar e o 📎 já
                  // faziam isso). Dá pra encadear card → digitar sem reabrir.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => void enviar(o.titulo)}
                  className="text-left border border-gray-300 hover:border-[#1D9E75] hover:bg-[#F6FCFA] active:bg-[#E1F5EE] rounded-xl px-3 py-2.5 min-w-0 [overflow-wrap:anywhere] transition-colors"
                >
                  <span className="block text-[13px] font-medium text-gray-900 leading-tight">{o.titulo}</span>
                  {o.nota && <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">{o.nota}</span>}
                </button>
              ))}
            </div>
          )}
          {enviando && <div className="flex justify-start"><div className="bg-gray-100 text-gray-400 rounded-2xl px-3.5 py-2.5 text-sm">digitando…</div></div>}
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          <div ref={fimRef} />
        </div>
        {/* Porta de entrada do resumo — e, desde que exista produto no pedido,
            a AÇÃO PRINCIPAL da tela. Enquanto o pedido está vazio ela é discreta
            (fundo claro), pra não gritar "conclua" antes de ter o que concluir;
            com produto vira botão cheio e chama pra conferir e concluir. */}
        <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => { inputRef.current?.blur(); setAlturaTeclado(null); setSheetAberto(true); }}
          className={
            (embutido ? "" : "lg:hidden ") +
            // whitespace-nowrap: em 360px sobram ~208px de texto dentro da
            // pílula. Rótulo comprido virava duas linhas e a barra ficava um
            // bloco desproporcional em cima do input — por isso o texto é curto.
            "mx-3 mt-3 shrink-0 flex items-center justify-center gap-1.5 rounded-full text-sm font-medium px-4 py-2.5 whitespace-nowrap shadow-sm hover:shadow active:scale-[0.99] transition " +
            (temLinha
              ? "bg-[#1D9E75] hover:bg-[#0F6E56] text-white"
              : "bg-[#E1F5EE] text-[#0F6E56]")
          }>
          {temLinha
            ? `📋 Resumo · ${qtdProdutos} ${qtdProdutos === 1 ? "produto" : "produtos"} →`
            : "📋 Resumo do pedido"}
        </button>
        <div className="border-t border-gray-100 p-2.5 sm:p-3 shrink-0">
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
            <label onPointerDown={(e) => e.preventDefault()} className={"shrink-0 h-11 w-11 rounded-full border border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-50 " + (totalFotos >= MAX_FOTOS ? "opacity-40 pointer-events-none" : "")} aria-label="Anexar fotos" title="Anexar fotos do que você quer produzir">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onAnexar(e)} />
            </label>
            <textarea
              ref={inputRef}
              value={input} onChange={(e) => { setInput(e.target.value); autoSize(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
              onPaste={(e) => void onColar(e)}
              // O placeholder antigo ("Escreva ou cole uma foto aqui…") não
              // cabia numa linha no celular: sobram ~195px entre o 📎 e o
              // enviar, o texto quebrava em duas linhas e a segunda ficava
              // cortada, porque o textarea nasce com altura de UMA linha.
              // Curto aqui, e a dica da foto fica no 📎 e na abertura do chat.
              rows={1} placeholder="Escreva aqui…" enterKeyHint="send"
              autoCapitalize="sentences" autoCorrect="on" spellCheck
              style={{ scrollbarWidth: "none" }}
              className="flex-1 min-w-0 resize-none border border-gray-300 rounded-xl px-3 py-2.5 text-base leading-6 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75] min-h-11 max-h-28 overflow-y-auto [&::-webkit-scrollbar]:hidden"
            />
            <button type="button" onPointerDown={(e) => e.preventDefault()}
              onClick={() => { if (semMensagem) { inputRef.current?.focus(); return; } void enviar(); }}
              disabled={enviando} aria-disabled={semMensagem || undefined}
              className={"shrink-0 h-11 w-11 rounded-full bg-[#1D9E75] text-white flex items-center justify-center disabled:opacity-40 " + (semMensagem ? "opacity-40" : "hover:bg-[#0F6E56]")} aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* 25/08/2026 — o "Concluir/Ir para os produtos" NÃO fica mais solto
          embaixo do chat. Ele mora dentro do Resumo do pedido (o bottom-sheet),
          junto da lista do que foi montado: quem conclui deve conferir antes.
          Embaixo do chat o botão competia com a conversa e convidava a sair no
          meio. O caminho agora é a barra "Resumo do pedido" logo acima do
          input — que vira botão cheio assim que existe produto no pedido. */}

      {/* RESUMO + AÇÕES (desktop, só na página inteira) */}
      <aside className={embutido ? "hidden" : "hidden lg:block lg:sticky lg:top-6 self-start"}>
        <div className="space-y-3">
          {resumoLista()}
          {resumoAcoes()}
        </div>
      </aside>

      {/* RESUMO — bottom-sheet (mobile) */}
      {sheetAberto && (
        <div className={"fixed inset-0 z-50 " + (embutido ? "" : "lg:hidden")} role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheetAberto(false)} />
          <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-xl max-h-[72vh] flex flex-col">
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-gray-200 shrink-0" />
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <p className="text-sm font-medium text-gray-900">Resumo do pedido</p>
              <button type="button" onClick={() => setSheetAberto(false)} aria-label="Fechar" className="h-8 w-8 rounded-full hover:bg-gray-100 text-gray-500 text-xl leading-none flex items-center justify-center">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {resumoLista()}
            </div>
            <div className="shrink-0 border-t border-gray-100 p-4 bg-white space-y-2">
              {resumoAcoes()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
