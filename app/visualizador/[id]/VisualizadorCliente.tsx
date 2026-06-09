"use client";

// app/visualizador/[id]/VisualizadorCliente.tsx
// ============================================================================
// Etapa 2 — Visualizadores. Cada linha do pedido vira um card com UMA imagem
// panorâmica do produto liso (frente · lateral · costas lado a lado, gerada via
// Gemini — placeholder enquanto indisponível), os detalhes e as ações: editar,
// excluir, adicionar produto e "Aplicar minha arte" (pop-up estilo Nano Banana
// com upload de múltiplas artes + caixa de texto).
// ============================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type Tamanho = { tamanho: string; qtd: number | null };
export type Estampa = { posicao: string; tamanho: string };
export type Linha = {
  modelo: string | null;
  cor: string | null;
  material: string | null;
  publico?: string | null;
  total: number | null;
  tamanhos: Tamanho[];
  estampas: Estampa[];
  estampado: boolean | null;
  descricao: string | null;
};

type LinhaOrc = { unit_centavos: number | null; total_centavos: number; faltando: string[] };
type Orcamento = { linhas: LinhaOrc[]; total_centavos: number; completo: boolean } | null;

function brl(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export type PedidoVis = {
  id: string;
  linhas: Linha[];
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  complemento: string | null;
  status: string | null;
  mockups?: Record<string, { liso?: string; arte?: string }> | null;
  prazo_dias?: number | null;
};

type ImgEstado = { loading?: boolean; url?: string; motivo?: string; aplicado?: string };

const linhaVazia: Linha = { modelo: "", cor: "", material: "", publico: null, total: null, tamanhos: [], estampas: [], estampado: null, descricao: "" };

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function corHex(s: string | null | undefined): string | null {
  const m = /#([0-9a-fA-F]{6})\b/.exec(s || "");
  return m ? "#" + m[1] : null;
}
function corLabel(s: string | null | undefined): string {
  return (s || "").replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, " ").replace(/#[0-9a-fA-F]{6}/g, "").replace(/\s{2,}/g, " ").trim();
}

export default function VisualizadorCliente({ pedido }: { pedido: PedidoVis }) {
  const [linhas, setLinhas] = useState<Linha[]>(
    (pedido.linhas ?? []).map((l) => ({ ...l, tamanhos: l.tamanhos ?? [], estampas: l.estampas ?? [], estampado: l.estampado ?? null }))
  );
  const [imgs, setImgs] = useState<Record<number, ImgEstado>>(() => {
    const m = pedido.mockups || {};
    const init: Record<number, ImgEstado> = {};
    for (const k of Object.keys(m)) {
      const v = m[k] || {};
      if (v.liso || v.arte) init[Number(k)] = { url: v.liso, aplicado: v.arte };
    }
    return init;
  });
  const [verArte, setVerArte] = useState<Record<number, boolean>>(() => {
    // Pré-seleciona "Com arte" nas linhas que já têm arte salva.
    const m = pedido.mockups || {};
    const init: Record<number, boolean> = {};
    for (const k of Object.keys(m)) if (m[k]?.arte) init[Number(k)] = true;
    return init;
  });
  const [salvando, setSalvando] = useState(false);

  // confirmação / pagamento
  const [confirmStep, setConfirmStep] = useState<"idle" | "form" | "feito">("idle");
  const [cpf, setCpf] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [confirmErro, setConfirmErro] = useState<string | null>(null);
  const [pixResult, setPixResult] = useState<{ copiaCola: string | null; invoiceUrl: string; valorCentavos: number } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pago, setPago] = useState(false);
  const [numImagensSalvas, setNumImagensSalvas] = useState(0);
  const [checandoPago, setChecandoPago] = useState(false);

  // orçamento (estimativa) + opções de estampa cadastradas
  const [orcamento, setOrcamento] = useState<Orcamento>(null);
  const [semTabela, setSemTabela] = useState(false);
  const [estimandoPrecos, setEstimandoPrecos] = useState(false);
  const orcMountRef = useRef(false);

  // edição / adição
  const [editOpen, setEditOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Linha>({ ...linhaVazia });

  // aplicar arte
  const [arteOpen, setArteOpen] = useState(false);
  const [arteIndex, setArteIndex] = useState<number | null>(null);
  const [artes, setArtes] = useState<string[]>([]);
  const [instrucoes, setInstrucoes] = useState("");
  const [gerandoArte, setGerandoArte] = useState(false);
  const [arteResultado, setArteResultado] = useState<string | null>(null);
  const [arteMotivo, setArteMotivo] = useState<string | null>(null);
  const arteFileRef = useRef<HTMLInputElement>(null);

  const geradasRef = useRef<Set<number>>(new Set(
    Object.keys(pedido.mockups || {}).filter((k) => (pedido.mockups || {})[k]?.liso).map(Number)
  ));

  async function salvarMockup(payload: { index?: number; liso?: string | null; arte?: string | null; resetAll?: boolean }) {
    try {
      await fetch(`/api/pedido/assistente/${pedido.id}/mockup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* silencioso */ }
  }

  async function gerarMockup(i: number, forcar = false) {
    if (!forcar && geradasRef.current.has(i)) return;
    geradasRef.current.add(i);
    const l = linhas[i];
    if (!l) return;
    setImgs((m) => ({ ...m, [i]: { ...m[i], loading: true, motivo: undefined } }));
    try {
      const res = await fetch("/api/visualizador/mockup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelo: l.modelo, cor: l.cor, material: l.material, publico: l.publico ?? null, descricao: l.descricao }),
      });
      const data = await res.json().catch(() => null);
      setImgs((m) => ({
        ...m,
        [i]: data?.disponivel
          ? { ...m[i], loading: false, url: data.imagemDataUrl, motivo: undefined }
          : { ...m[i], loading: false, motivo: data?.motivo || "Não foi possível gerar agora." },
      }));
      if (data?.disponivel && data.imagemDataUrl) void salvarMockup({ index: i, liso: data.imagemDataUrl });
    } catch {
      setImgs((m) => ({ ...m, [i]: { ...m[i], loading: false, motivo: "Erro de conexão." } }));
    }
  }

  useEffect(() => {
    linhas.forEach((_, i) => { if (!imgs[i]?.url) void gerarMockup(i); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // orçamento: no 1º carregamento, pesquisa automaticamente os preços que
  // faltam (IA) enquanto o cliente finaliza; nas edições seguintes só recalcula.
  useEffect(() => {
    const primeira = !orcMountRef.current;
    orcMountRef.current = true;
    const body = { linhas: linhas.map((l) => ({ modelo: l.modelo, material: l.material, total: l.total, estampas: l.estampas ?? [], estampado: l.estampado ?? ((l.estampas?.length ?? 0) > 0) })), prazoDias: pedido.prazo_dias ?? null };
    const url = primeira ? "/api/orcamento/pesquisar-faltantes" : "/api/orcamento";
    if (primeira) setEstimandoPrecos(true);
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((d) => { if (d?.ok) { setOrcamento(d.orcamento); setSemTabela(!!d.semTabela); } })
      .catch(() => {})
      .finally(() => { if (primeira) setEstimandoPrecos(false); });
  }, [linhas]);

  async function persistir(novas: Linha[]) {
    setSalvando(true);
    try {
      await fetch(`/api/pedido/assistente/${pedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas: novas }),
      });
    } catch {
      // silencioso
    } finally {
      setSalvando(false);
    }
  }

  function abrirEdicao(i: number | null) {
    if (i === null) {
      setDraft({ ...linhaVazia, tamanhos: [] });
      setEditIndex(null);
    } else {
      setDraft(JSON.parse(JSON.stringify(linhas[i])));
      setEditIndex(i);
    }
    setEditOpen(true);
  }

  function salvarEdicao() {
    const limpa: Linha = {
      modelo: draft.modelo?.trim() || null,
      cor: draft.cor?.trim() || null,
      material: draft.material?.trim() || null,
      total: draft.total && draft.total > 0 ? Math.round(draft.total) : null,
      tamanhos: (draft.tamanhos || []).map((t) => ({ tamanho: t.tamanho.trim(), qtd: t.qtd && t.qtd > 0 ? Math.round(t.qtd) : null })).filter((t) => t.tamanho),
      estampas: (draft.estampas || []).map((e) => ({ posicao: (e.posicao || "").trim(), tamanho: (e.tamanho || "").trim() })).filter((e) => e.posicao && e.tamanho),
      publico: draft.publico ?? null,
      estampado: draft.estampado ?? null,
      descricao: draft.descricao?.trim() || null,
    };
    if (!limpa.modelo && !limpa.cor && !limpa.total) return;
    let novas: Linha[];
    let alvo: number;
    if (editIndex === null) {
      novas = [...linhas, limpa];
      alvo = novas.length - 1;
    } else {
      novas = linhas.map((l, idx) => (idx === editIndex ? limpa : l));
      alvo = editIndex;
    }
    setLinhas(novas);
    setEditOpen(false);
    void persistir(novas);
    setImgs((m) => ({ ...m, [alvo]: {} }));
    setVerArte((m) => ({ ...m, [alvo]: false }));
    geradasRef.current.delete(alvo);
    void salvarMockup({ index: alvo, liso: null, arte: null });
    setTimeout(() => void gerarMockup(alvo, true), 0);
  }

  function excluir(i: number) {
    if (!confirm("Remover este produto do pedido?")) return;
    const novas = linhas.filter((_, idx) => idx !== i);
    setLinhas(novas);
    setImgs({});
    setVerArte({});
    geradasRef.current = new Set();
    void persistir(novas);
    void salvarMockup({ resetAll: true });
    setTimeout(() => novas.forEach((_, idx) => void gerarMockup(idx, true)), 0);
  }

  // ---- aplicar arte ----
  function limparArte(i: number) {
    setImgs((m) => ({ ...m, [i]: { ...m[i], aplicado: undefined } }));
    setVerArte((m) => ({ ...m, [i]: false }));
    void salvarMockup({ index: i, arte: null });
  }

  function abrirArte(i: number) {
    setArteIndex(i);
    setArtes([]);
    setInstrucoes("");
    setArteResultado(null);
    setArteMotivo(null);
    setArteOpen(true);
  }

  async function onUploadArtes(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const urls: string[] = [];
    for (const f of files.slice(0, 8)) {
      if (f.size > 6 * 1024 * 1024) continue;
      urls.push(await fileToDataUrl(f));
    }
    setArtes((a) => [...a, ...urls].slice(0, 8));
    if (arteFileRef.current) arteFileRef.current.value = "";
  }

  async function gerarArte() {
    if (arteIndex === null || artes.length === 0 || gerandoArte) return;
    const base = imgs[arteIndex]?.url;
    if (!base) {
      setArteMotivo("Gere a prévia do produto primeiro.");
      return;
    }
    const l = linhas[arteIndex];
    setGerandoArte(true);
    setArteMotivo(null);
    setArteResultado(null);
    try {
      const res = await fetch("/api/visualizador/aplicar-arte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseDataUrl: base,
          artes,
          instrucoes,
          contexto: [l?.modelo, l?.cor, l?.material].filter(Boolean).join(", "),
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.disponivel) setArteResultado(data.imagemDataUrl);
      else setArteMotivo(data?.motivo || data?.error || "Não foi possível gerar agora.");
    } catch {
      setArteMotivo("Erro de conexão.");
    } finally {
      setGerandoArte(false);
    }
  }

  function usarArte() {
    if (arteIndex === null || !arteResultado) return;
    const idx = arteIndex;
    setImgs((m) => ({ ...m, [idx]: { ...m[idx], aplicado: arteResultado } }));
    setVerArte((m) => ({ ...m, [idx]: true }));
    setArteOpen(false);
    void salvarMockup({ index: idx, arte: arteResultado });
  }

  async function confirmarPedido() {
    if (confirmando) return;
    const cpfDig = cpf.replace(/\D/g, "");
    if (cpfDig.length !== 11 && cpfDig.length !== 14) {
      setConfirmErro("Informe um CPF (11 dígitos) ou CNPJ (14).");
      return;
    }
    setConfirmando(true);
    setConfirmErro(null);
    const imagens = linhas.map((_, i) => imgs[i]?.aplicado || imgs[i]?.url).filter((x): x is string => !!x);
    try {
      const res = await fetch(`/api/pedido/assistente/${pedido.id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpfCnpj: cpf, linhas, imagens }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.erro || "Não foi possível confirmar.");
      setPixResult({ copiaCola: d.copiaCola ?? null, invoiceUrl: d.invoiceUrl, valorCentavos: d.valorCentavos });
      setConfirmStep("feito");
    } catch (e) {
      setConfirmErro(e instanceof Error ? e.message : "Erro ao confirmar.");
    } finally {
      setConfirmando(false);
    }
  }

  async function checkStatus() {
    setChecandoPago(true);
    try {
      const r = await fetch(`/api/pedido/assistente/${pedido.id}/status`).then((x) => x.json());
      if (r?.ok) { setPago(!!r.pago); setNumImagensSalvas(r.numImagens || 0); }
    } catch {
      // silencioso
    } finally {
      setChecandoPago(false);
    }
  }

  // enquanto aguarda pagamento, faz polling do status (e libera o download)
  useEffect(() => {
    if (confirmStep !== "feito" || pago) return;
    void checkStatus();
    const t = setInterval(() => { void checkStatus(); }, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmStep, pago]);

  const podeConfirmar = linhas.length > 0 && !!orcamento && orcamento.completo && orcamento.total_centavos > 0;
  const totalPecas = linhas.reduce((acc, l) => acc + (l.total ?? 0), 0);

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 pt-8 pb-16">
      <div className="flex items-center justify-between gap-3 mb-1">
        <Link href="/#pedido" className="text-sm text-gray-500 hover:text-gray-800">← Voltar</Link>
        {salvando && <span className="text-xs text-gray-400">salvando…</span>}
      </div>
      <h1 className="text-gray-900 text-2xl font-semibold mt-2">Pré-visualização dos seus produtos</h1>
      <p className="text-gray-500 text-sm mt-1 mb-6">
        Veja cada produto liso (frente · lateral · costas), ajuste o que precisar e aplique suas artes. {totalPecas > 0 && <span className="text-gray-700 font-medium">{totalPecas} peças no total.</span>}
      </p>

      <div className="space-y-5">
        {linhas.map((l, i) => {
          const st = imgs[i] || {};
          const mostrandoArte = !!verArte[i] && !!st.aplicado;
          const urlMostrar = mostrandoArte ? st.aplicado : st.url;
          const orc = orcamento?.linhas?.[i];
          return (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              {/* VISUALIZADOR — imagem panorâmica (frente · lateral · costas) */}
              <div className="relative bg-gray-50 border-b border-gray-100 flex items-center justify-center p-3 min-h-[320px]">
                {urlMostrar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urlMostrar} alt={`${l.modelo ?? "produto"} ${l.cor ?? ""}`} className="max-h-[560px] w-auto max-w-full object-contain rounded-lg" />
                ) : st.loading ? (
                  <span className="text-xs text-gray-400">gerando prévia… (frente · lateral · costas)</span>
                ) : (
                  <div className="text-center px-4">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-gray-100 flex items-center justify-center text-gray-300 text-xl">👕</div>
                    <p className="text-[11px] text-gray-400 leading-snug max-w-xs mx-auto">{st.motivo || "Prévia ainda não gerada."}</p>
                    <button type="button" onClick={() => void gerarMockup(i, true)} className="mt-2 text-[11px] text-[#0F6E56] hover:underline">Tentar gerar</button>
                  </div>
                )}
                {st.aplicado && (
                  <div className="absolute top-2 left-2 flex gap-1">
                    <button type="button" onClick={() => setVerArte((m) => ({ ...m, [i]: false }))}
                      className={"px-2.5 py-1 rounded-lg text-xs border transition-colors " + (!mostrandoArte ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50")}>Liso</button>
                    <button type="button" onClick={() => setVerArte((m) => ({ ...m, [i]: true }))}
                      className={"px-2.5 py-1 rounded-lg text-xs border transition-colors " + (mostrandoArte ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50")}>Com arte</button>
                  </div>
                )}
              </div>

              {/* DETALHES */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-gray-900 font-medium capitalize flex items-center gap-1.5">{corHex(l.cor) && <span className="w-3.5 h-3.5 rounded-full border border-black/10 inline-block shrink-0" style={{ backgroundColor: corHex(l.cor) as string }} />}{[l.modelo, corLabel(l.cor)].filter(Boolean).join(" · ") || "Produto"}</p>
                    {l.material && <p className="text-sm text-gray-500 mt-0.5">Material: {l.material}</p>}
                  </div>
                  {l.total ? <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full shrink-0">{l.total} un.</span> : null}
                </div>

                {l.tamanhos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {l.tamanhos.map((t, j) => (
                      <span key={j} className="bg-gray-50 border border-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-md">
                        {t.tamanho.toUpperCase()}{t.qtd ? ` · ${t.qtd}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {(l.estampado === true || (l.estampas?.length ?? 0) > 0) && (
                  <div className="mt-2">
                    <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs px-2 py-0.5 rounded-md">Estampado / bordado</span>
                  </div>
                )}
                {l.descricao && <p className="text-sm text-gray-500 mt-3 leading-relaxed">{l.descricao}</p>}

                {orc && orc.unit_centavos !== null && (
                  <p className="text-sm text-gray-700 mt-3">
                    Estimativa: <strong>{brl(orc.total_centavos)}</strong> <span className="text-gray-400">({brl(orc.unit_centavos)}/un)</span>
                  </p>
                )}

                <div className="flex flex-wrap gap-2 mt-4">
                  <button type="button" onClick={() => abrirArte(i)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-3.5 py-1.5 rounded-lg">{st.aplicado ? "Trocar arte" : "+ Aplicar minha arte"}</button>
                  {st.aplicado && (
                    <button type="button" onClick={() => limparArte(i)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm px-3 py-1.5 rounded-lg">Limpar arte</button>
                  )}
                  <button type="button" onClick={() => abrirEdicao(i)} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-3 py-1.5 rounded-lg">Editar</button>
                  <button type="button" onClick={() => excluir(i)} className="border border-gray-200 text-red-600 hover:bg-red-50 text-sm px-3 py-1.5 rounded-lg">Excluir</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <button type="button" onClick={() => abrirEdicao(null)} className="border-2 border-dashed border-gray-300 text-gray-600 hover:border-[#1D9E75] hover:text-[#0F6E56] text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
          + Adicionar produto
        </button>
      </div>

      {/* ESTIMATIVA DE ORÇAMENTO */}
      {estimandoPrecos && (!orcamento || orcamento.total_centavos === 0) && (
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500">
          <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-[#1D9E75] rounded-full animate-spin" />
          Pesquisando preços de mercado pros seus produtos…
        </div>
      )}
      {orcamento && orcamento.total_centavos > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-900">Estimativa de orçamento</p>
            <p className="text-xl font-semibold text-[#0F6E56]">{brl(orcamento.total_centavos)}</p>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Estimativa, sujeita a confirmação.</p>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
            <span className="text-base leading-none">🚚</span>
            <p className="text-[11px] text-gray-500 leading-relaxed">O frete é à parte. Assim que a produção ficar pronta, enviamos as opções de transporte e prazos — você escolhe a que preferir e paga o frete na hora do envio.</p>
          </div>
          {estimandoPrecos && <p className="text-[11px] text-gray-400 mt-1">Atualizando preços de mercado…</p>}
          {!orcamento.completo && !estimandoPrecos && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-snug">Alguns itens ainda estão sendo precificados. Se persistir, nosso time ajusta antes de fechar.</p>
          )}
        </div>
      )}

      {/* GARANTIA CONFECCIONE */}
      <div className="mt-3 bg-[#E1F5EE]/60 border border-[#1D9E75]/20 rounded-xl p-3 flex items-start gap-2">
        <span aria-hidden className="text-[#0F6E56] leading-none">🔒</span>
        <p className="text-xs text-[#0F6E56] leading-relaxed">
          <strong>Pagamento garantido pela Confeccione.</strong> A gente segura o valor e só repassa pro fornecedor quando você confirmar que recebeu o pedido em conformidade. Após o pagamento, liberamos os visualizadores dos seus produtos pra você baixar.
        </p>
      </div>

      {/* CONTATO + AVANÇAR */}
      <div className="mt-8 bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
        {(pedido.nome || pedido.email) && (
          <div className="mb-4">
            <p className="text-xs text-gray-400 font-medium mb-1">Contato</p>
            <p className="text-sm text-gray-700">{pedido.nome}{pedido.telefone ? ` · ${pedido.telefone}` : ""}{pedido.email ? ` · ${pedido.email}` : ""}</p>
            {(pedido.cep || pedido.complemento) && <p className="text-sm text-gray-500">{[pedido.cep, pedido.complemento].filter(Boolean).join(" · ")}</p>}
          </div>
        )}
        {confirmStep === "feito" && pixResult ? (
          <div className="bg-[#E1F5EE] border border-[#1D9E75]/30 rounded-xl p-4">
            <p className="text-sm text-[#0F6E56] font-medium">Pedido confirmado! ✅</p>
            <p className="text-xs text-[#0F6E56]/80 mt-1 leading-relaxed">Enviamos o resumo pro seu e-mail. Pague no <strong>cartão de crédito</strong> (botão abaixo) ou no <strong>PIX</strong> — assim que o pagamento cair, seu pedido entra em produção e você poderá baixar os visualizadores. O valor fica garantido pela Confeccione até você receber tudo certinho.</p>
            <div className="mt-3">
              <a href={pixResult.invoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-5 py-2.5 rounded-xl">💳 Pagar com cartão de crédito</a>
            </div>
            {pixResult.copiaCola && (
              <div className="mt-4 flex flex-col sm:flex-row gap-4 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/pedido/assistente/${pedido.id}/pix-qr`} alt="QR Code PIX" className="w-40 h-40 rounded-lg border border-[#1D9E75]/30 bg-white shrink-0" />
                <div className="flex-1 w-full min-w-0">
                  <p className="text-xs text-gray-500 mb-1">Ou pague no PIX (copia e cola):</p>
                  <code className="block break-all bg-white border border-gray-200 rounded-lg px-3 py-2 text-[11px] text-gray-700">{pixResult.copiaCola}</code>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(pixResult.copiaCola!); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }} className="border border-[#1D9E75] text-[#0F6E56] text-xs px-3 py-1.5 rounded-lg hover:bg-white">{copiado ? "Copiado!" : "Copiar código PIX"}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-[#1D9E75]/20">
              {pago ? (
                <div>
                  <p className="text-sm text-[#0F6E56] font-medium mb-2">Pagamento confirmado! ✅ Baixe seus visualizadores:</p>
                  {numImagensSalvas > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: numImagensSalvas }).map((_, i) => (
                        <a key={i} href={`/api/pedido/assistente/${pedido.id}/imagem?i=${i}`} download={`confeccione-produto-${i + 1}.jpg`} className="border border-[#1D9E75] text-[#0F6E56] text-xs px-3 py-1.5 rounded-lg hover:bg-white">Baixar produto {i + 1}</a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#0F6E56]/80">Seus visualizadores também foram pro seu e-mail.</p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Aguardando confirmação do pagamento — o download libera assim que o pagamento cair.</span>
                  <button type="button" onClick={() => void checkStatus()} disabled={checandoPago} className="text-xs text-[#0F6E56] underline disabled:opacity-50">{checandoPago ? "verificando…" : "Já paguei? Atualizar"}</button>
                </div>
              )}
            </div>
          </div>
        ) : confirmStep === "form" ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-900 mb-1">Confirmar pedido e pagar</p>
            <p className="text-xs text-gray-500 mb-3">Informe seu CPF (ou CNPJ) pra gerar a cobrança (PIX ou cartão). Total: <strong>{orcamento ? brl(orcamento.total_centavos) : ""}</strong>.</p>
            <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF ou CNPJ" inputMode="numeric"
              className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => void confirmarPedido()} disabled={confirmando}
                className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl">{confirmando ? "Gerando…" : "Confirmar e ir para o pagamento"}</button>
              <button type="button" onClick={() => { setConfirmStep("idle"); setConfirmErro(null); }} className="text-sm text-gray-500 px-3 py-2.5 rounded-xl hover:bg-gray-100">Cancelar</button>
            </div>
            {confirmErro && <p className="text-xs text-red-600 mt-2">{confirmErro}</p>}
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setConfirmStep("form")} disabled={!podeConfirmar}
              className="w-full sm:w-auto bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-6 py-3 rounded-xl transition-colors">
              Confirmar pedido →
            </button>
            {!podeConfirmar && linhas.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-2">Pra confirmar, todos os itens precisam ter preço cadastrado (estimativa completa).</p>
            )}
          </>
        )}
      </div>

      {/* ---------- MODAL EDITAR / ADICIONAR ---------- */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-gray-900 font-medium mb-4">{editIndex === null ? "Adicionar produto" : "Editar produto"}</p>
            <div className="space-y-3">
              <Campo label="Modelo (tshirt, oversized, polo, boné…)">
                <input value={draft.modelo ?? ""} onChange={(e) => setDraft({ ...draft, modelo: e.target.value })} className={inputCls} placeholder="oversized" />
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Cor"><input value={draft.cor ?? ""} onChange={(e) => setDraft({ ...draft, cor: e.target.value })} className={inputCls} placeholder="preta" /></Campo>
                <Campo label="Material"><input value={draft.material ?? ""} onChange={(e) => setDraft({ ...draft, material: e.target.value })} className={inputCls} placeholder="algodão" /></Campo>
              </div>
              <Campo label="Quantidade total">
                <input type="number" min={1} value={draft.total ?? ""} onChange={(e) => setDraft({ ...draft, total: parseInt(e.target.value) || null })} className={inputCls} placeholder="10" />
              </Campo>
              <Campo label="Tamanhos">
                <div className="space-y-2">
                  {(draft.tamanhos || []).map((t, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <input value={t.tamanho} onChange={(e) => setDraft({ ...draft, tamanhos: draft.tamanhos.map((x, k) => k === j ? { ...x, tamanho: e.target.value } : x) })} className={inputCls + " w-20"} placeholder="M" />
                      <input type="number" min={1} value={t.qtd ?? ""} onChange={(e) => setDraft({ ...draft, tamanhos: draft.tamanhos.map((x, k) => k === j ? { ...x, qtd: parseInt(e.target.value) || null } : x) })} className={inputCls + " w-24"} placeholder="qtd" />
                      <button type="button" onClick={() => setDraft({ ...draft, tamanhos: draft.tamanhos.filter((_, k) => k !== j) })} className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setDraft({ ...draft, tamanhos: [...(draft.tamanhos || []), { tamanho: "", qtd: null }] })} className="text-xs text-[#0F6E56] hover:underline">+ adicionar tamanho</button>
                </div>
              </Campo>
              <Campo label="Público">
                <div className="flex flex-wrap gap-2">
                  {([["feminino","Feminino"],["masculino","Masculino"],["infantil","Infantil"],["unissex","Unissex"]] as const).map(([val,label]) => (
                    <button key={val} type="button" onClick={() => setDraft({ ...draft, publico: val })}
                      className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (draft.publico === val ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50")}>
                      {label}
                    </button>
                  ))}
                </div>
              </Campo>
              <Campo label="Acabamento (entra no orçamento)">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDraft({ ...draft, estampado: false })}
                    className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (draft.estampado !== true ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50")}>
                    Lisa
                  </button>
                  <button type="button" onClick={() => setDraft({ ...draft, estampado: true })}
                    className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (draft.estampado === true ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50")}>
                    Estampada / bordada
                  </button>
                </div>
              </Campo>
              <Campo label="Detalhes (observações, instruções…)">
                <textarea rows={2} value={draft.descricao ?? ""} onChange={(e) => setDraft({ ...draft, descricao: e.target.value })} className={inputCls + " resize-none"} placeholder="estampa na frente, arte própria" />
              </Campo>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setEditOpen(false)} className="border border-gray-200 text-gray-500 px-4 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={salvarEdicao} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-4 py-2 rounded-xl text-sm font-medium">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- MODAL APLICAR ARTE (estilo Nano Banana) ---------- */}
      {arteOpen && arteIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setArteOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-gray-900 font-medium">Aplicar arte no produto</p>
                <p className="text-xs text-gray-400 capitalize">{[linhas[arteIndex]?.modelo, linhas[arteIndex]?.cor].filter(Boolean).join(" · ")}</p>
              </div>
              <button type="button" onClick={() => setArteOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
            </div>

            <div className="p-5 grid sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs text-gray-500 font-medium mb-2">Suas artes ({artes.length}/8)</p>
                <div className="grid grid-cols-3 gap-2">
                  {artes.map((a, j) => (
                    <div key={j} className="relative aspect-square rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a} alt={`arte ${j + 1}`} className="w-full h-full object-contain" />
                      <button type="button" onClick={() => setArtes((arr) => arr.filter((_, k) => k !== j))} className="absolute top-0.5 right-0.5 bg-white/90 rounded-full w-5 h-5 text-xs text-gray-600 hover:text-red-600">✕</button>
                    </div>
                  ))}
                  {artes.length < 8 && (
                    <button type="button" onClick={() => arteFileRef.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-[#1D9E75] text-gray-400 hover:text-[#0F6E56] flex flex-col items-center justify-center text-xs">
                      <span className="text-lg leading-none">+</span>
                      arte
                    </button>
                  )}
                </div>
                <input ref={arteFileRef} type="file" accept="image/*" multiple className="hidden" onChange={onUploadArtes} />

                <p className="text-xs text-gray-500 font-medium mt-4 mb-1">Como aplicar?</p>
                <textarea rows={4} value={instrucoes} onChange={(e) => setInstrucoes(e.target.value)}
                  placeholder="Ex.: logo pequena no peito esquerdo + arte grande nas costas; cor da arte em branco…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75]" />

                <button type="button" onClick={() => void gerarArte()} disabled={artes.length === 0 || gerandoArte}
                  className="mt-3 w-full bg-[#111] text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:opacity-85 disabled:opacity-40">
                  {gerandoArte ? "Gerando…" : "Gerar com a arte"}
                </button>
                {arteMotivo && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-snug">{arteMotivo}</p>}
              </div>

              <div>
                <p className="text-xs text-gray-500 font-medium mb-2">Resultado</p>
                <div className="aspect-[16/9] rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
                  {arteResultado ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={arteResultado} alt="resultado com arte" className="w-full h-full object-contain" />
                  ) : gerandoArte ? (
                    <span className="text-xs text-gray-400">aplicando sua arte…</span>
                  ) : (
                    <span className="text-xs text-gray-400 text-center px-6">A prévia com sua arte aparece aqui.</span>
                  )}
                </div>
                {arteResultado && (
                  <button type="button" onClick={usarArte} className="mt-3 w-full bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2.5 rounded-xl">
                    Usar essa versão
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
