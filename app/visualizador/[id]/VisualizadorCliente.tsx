"use client";

// app/visualizador/[id]/VisualizadorCliente.tsx
// ============================================================================
// Etapa 2 — Visualizadores. Cada linha do pedido vira um card; o cliente
// ESCOLHE entre subir o próprio visualizador (se já tem pronto) ou criar com
// IA (imagem panorâmica frente · lateral · costas via Gemini). Nada é gerado
// automaticamente. Ações: aplicar/trocar arte (IA), ajustar detalhe,
// trocar/remover imagem enviada, editar/excluir/adicionar produto.
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
type Orcamento = { linhas: LinhaOrc[]; subtotal_centavos: number; desconto_qtd_centavos: number; total_centavos: number; pix_centavos: number; total_pecas: number; frete_gratis: boolean; completo: boolean } | null;

function brl(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
/** Estimativa de frete só pra exibição: R$ 4,90 por peça, mínimo R$ 21,80. */
function freteEstimadoCentavos(pecas: number): number {
  return Math.max(2180, pecas * 490);
}
export type PedidoVis = {
  id: string;
  linhas: Linha[];
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  complemento: string | null;
  logradouro?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
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
function telBR(s: string | null | undefined): string {
  if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return s;
}
function cepBR(s: string | null | undefined): string {
  const d = (s || "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (s || "");
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
  const [metodoPag, setMetodoPag] = useState<"pix" | "cartao">("pix");
  const [contato, setContato] = useState({ nome: pedido.nome, telefone: pedido.telefone, email: pedido.email, cep: pedido.cep, complemento: pedido.complemento, logradouro: pedido.logradouro ?? null, bairro: pedido.bairro ?? null, cidade: pedido.cidade ?? null, uf: pedido.uf ?? null });
  const [contatoOpen, setContatoOpen] = useState(false);
  const [contatoDraft, setContatoDraft] = useState({ nome: "", telefone: "", email: "", cep: "", complemento: "" });
  const [salvandoContato, setSalvandoContato] = useState(false);
  const [contatoErro, setContatoErro] = useState<string | null>(null);
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
  const [ajusteIndex, setAjusteIndex] = useState<number | null>(null);
  const [ajusteTexto, setAjusteTexto] = useState("");
  const [ajustandoIdx, setAjustandoIdx] = useState<number | null>(null);
  const [ajusteErro, setAjusteErro] = useState<string | null>(null);
  const arteFileRef = useRef<HTMLInputElement>(null);

  // subir o próprio visualizador
  const subirRef = useRef<HTMLInputElement>(null);
  const [subirIndex, setSubirIndex] = useState<number | null>(null);
  const [subindoIdx, setSubindoIdx] = useState<number | null>(null);

  async function salvarMockup(payload: { index?: number; liso?: string | null; arte?: string | null; resetAll?: boolean }) {
    try {
      await fetch(`/api/pedido/assistente/${pedido.id}/mockup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* silencioso */ }
  }

  async function gerarMockup(i: number) {
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
    const antes = editIndex !== null ? linhas[editIndex] : null;
    const visualMudou =
      !antes ||
      [antes.modelo, antes.cor, antes.material, antes.publico ?? null, antes.descricao].join("|") !==
        [limpa.modelo, limpa.cor, limpa.material, limpa.publico ?? null, limpa.descricao].join("|");
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
    if (visualMudou) {
      // o visual mudou → volta pro seletor (subir próprio ou criar com IA)
      setImgs((m) => ({ ...m, [alvo]: {} }));
      setVerArte((m) => ({ ...m, [alvo]: false }));
      void salvarMockup({ index: alvo, liso: null, arte: null });
    }
  }

  function excluir(i: number) {
    if (!confirm("Remover este produto do pedido?")) return;
    const novas = linhas.filter((_, idx) => idx !== i);
    // Reindexa as imagens preservando o que o cliente já subiu/criou.
    const novasImgs: Record<number, ImgEstado> = {};
    const novaArte: Record<number, boolean> = {};
    novas.forEach((_, novoIdx) => {
      const antigoIdx = novoIdx >= i ? novoIdx + 1 : novoIdx;
      if (imgs[antigoIdx]) novasImgs[novoIdx] = imgs[antigoIdx];
      if (verArte[antigoIdx]) novaArte[novoIdx] = true;
    });
    setLinhas(novas);
    setImgs(novasImgs);
    setVerArte(novaArte);
    void persistir(novas);
    void (async () => {
      await salvarMockup({ resetAll: true });
      for (const [k, st] of Object.entries(novasImgs)) {
        if (st.url || st.aplicado) await salvarMockup({ index: Number(k), liso: st.url ?? null, arte: st.aplicado ?? null });
      }
    })();
  }

  // ---- aplicar arte ----
  function limparArte(i: number) {
    setImgs((m) => ({ ...m, [i]: { ...m[i], aplicado: undefined } }));
    setVerArte((m) => ({ ...m, [i]: false }));
    void salvarMockup({ index: i, arte: null });
  }

  // ---- subir o próprio visualizador ----
  function abrirSubir(i: number) {
    setSubirIndex(i);
    subirRef.current?.click();
  }

  /** Lê o arquivo; se for grande, redimensiona pra ≤2000px e re-encoda em JPEG. */
  async function arquivoParaVisualizador(file: File): Promise<string> {
    const dataUrl = await fileToDataUrl(file);
    if (file.size <= 1_500_000) return dataUrl;
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("imagem inválida")); img.src = dataUrl; });
    const maxDim = 2000;
    const esc = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * esc));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * esc));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d");
    if (!cx) return dataUrl;
    cx.fillStyle = "#ffffff";
    cx.fillRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.85);
  }

  async function onUploadVisualizador(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (subirRef.current) subirRef.current.value = "";
    const i = subirIndex;
    setSubirIndex(null);
    if (!file || i === null) return;
    if (!file.type.startsWith("image/")) { alert("Envie um arquivo de imagem (JPG, PNG…)."); return; }
    if (file.size > 10 * 1024 * 1024) { alert("Imagem muito grande (máx. 10 MB)."); return; }
    setSubindoIdx(i);
    try {
      const dataUrl = await arquivoParaVisualizador(file);
      setImgs((m) => ({ ...m, [i]: { ...m[i], aplicado: dataUrl, loading: false, motivo: undefined } }));
      setVerArte((m) => ({ ...m, [i]: true }));
      void salvarMockup({ index: i, arte: dataUrl });
    } catch {
      alert("Não consegui ler essa imagem. Tenta outro arquivo.");
    } finally {
      setSubindoIdx(null);
    }
  }

  function abrirAjuste(i: number) {
    setAjusteIndex(i);
    setAjusteTexto("");
    setAjusteErro(null);
  }

  async function aplicarAjuste(i: number) {
    const st = imgs[i] || {};
    const base = st.aplicado || st.url;
    const txt = ajusteTexto.trim();
    if (!base || !txt) { setAjusteErro("Descreva o ajuste."); return; }
    setAjustandoIdx(i);
    setAjusteErro(null);
    try {
      const l = linhas[i];
      const res = await fetch("/api/visualizador/ajustar-detalhe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseDataUrl: base, instrucoes: txt, contexto: [l?.modelo, l?.cor, l?.material].filter(Boolean).join(" ") }),
      });
      const d = await res.json().catch(() => null);
      if (!d?.disponivel) { setAjusteErro(d?.motivo || d?.error || "Não consegui ajustar agora."); return; }
      setImgs((m) => ({ ...m, [i]: { ...m[i], aplicado: d.imagemDataUrl } }));
      setVerArte((m) => ({ ...m, [i]: true }));
      void salvarMockup({ index: i, arte: d.imagemDataUrl });
      setAjusteIndex(null);
      setAjusteTexto("");
    } catch {
      setAjusteErro("Erro de conexão.");
    } finally {
      setAjustandoIdx(null);
    }
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

  function abrirContato() {
    setContatoDraft({ nome: contato.nome ?? "", telefone: contato.telefone ?? "", email: contato.email ?? "", cep: contato.cep ?? "", complemento: contato.complemento ?? "" });
    setContatoErro(null);
    setContatoOpen(true);
  }

  async function salvarContato() {
    if (salvandoContato) return;
    if (!contatoDraft.nome.trim()) { setContatoErro("Informe o nome."); return; }
    const cepDigs = contatoDraft.cep.replace(/\D/g, "");
    if (cepDigs && cepDigs.length !== 8) { setContatoErro("CEP deve ter 8 dígitos."); return; }
    setSalvandoContato(true);
    setContatoErro(null);
    try {
      const res = await fetch(`/api/pedido/assistente/${pedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contato: { nome: contatoDraft.nome.trim(), telefone: contatoDraft.telefone.trim() || null, email: contatoDraft.email.trim() || null, cep: cepDigs || null, complemento: contatoDraft.complemento.trim() || null } }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Não foi possível salvar.");
      const p = d.pedido ?? {};
      setContato({ nome: p.nome ?? contatoDraft.nome, telefone: p.telefone ?? null, email: p.email ?? null, cep: p.cep ?? null, complemento: p.complemento ?? null, logradouro: p.logradouro ?? null, bairro: p.bairro ?? null, cidade: p.cidade ?? null, uf: p.uf ?? null });
      setContatoOpen(false);
    } catch (e) {
      setContatoErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvandoContato(false);
    }
  }

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
        Para cada produto, envie seu visualizador pronto ou crie um com a IA (frente · lateral · costas) — depois aplique suas artes. {totalPecas > 0 && <span className="text-gray-700 font-medium">{totalPecas} peças no total.</span>}
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
                ) : subindoIdx === i ? (
                  <span className="text-xs text-gray-400">enviando seu visualizador…</span>
                ) : (
                  <div className="text-center px-4 py-6 w-full max-w-md mx-auto">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-gray-100 flex items-center justify-center text-gray-300 text-xl">👕</div>
                    <p className="text-sm font-medium text-gray-800">Como você quer o visualizador desta peça?</p>
                    <p className="text-[11px] text-gray-400 mt-1 mb-4 leading-snug">Já tem o mockup ou a foto da peça? É só enviar. Se não tiver, a gente cria pra você na hora.</p>
                    <div className="flex flex-col sm:flex-row items-stretch justify-center gap-2">
                      <button type="button" onClick={() => abrirSubir(i)} className="flex-1 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">📤 Subir meu visualizador</button>
                      <button type="button" onClick={() => void gerarMockup(i)} className="flex-1 border border-[#1D9E75]/40 bg-white text-[#0F6E56] hover:bg-[#E1F5EE]/50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">✦ Criar com IA</button>
                    </div>
                    {st.motivo && <p className="text-[11px] text-red-500 mt-3">{st.motivo} — tenta de novo.</p>}
                  </div>
                )}
                {st.url && st.aplicado && (
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

                {/* AÇÕES — toolbar única: arte à esquerda, produto à direita */}
                <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
                  {st.url ? (
                    <>
                      <button type="button" onClick={() => abrirArte(i)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                        {st.aplicado ? "✦ Trocar arte" : "✦ Aplicar minha arte"}
                      </button>
                      {st.aplicado && (
                        <button type="button" onClick={() => limparArte(i)} className="border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg transition-colors">Limpar arte</button>
                      )}
                      <button type="button" onClick={() => abrirAjuste(i)} className="border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg transition-colors">Ajustar detalhe</button>
                    </>
                  ) : st.aplicado ? (
                    <>
                      <button type="button" onClick={() => abrirSubir(i)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">📤 Trocar imagem</button>
                      <button type="button" onClick={() => limparArte(i)} className="border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg transition-colors">Remover imagem</button>
                      <button type="button" onClick={() => abrirAjuste(i)} className="border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg transition-colors">Ajustar detalhe</button>
                    </>
                  ) : null}
                  <span className="flex-1 min-w-2" aria-hidden />
                  <button type="button" onClick={() => abrirEdicao(i)} title="Editar produto" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                    Editar
                  </button>
                  <button type="button" onClick={() => excluir(i)} title="Excluir produto" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 text-sm px-3 py-2 rounded-lg transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    Excluir
                  </button>
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

      {/* input oculto: upload do visualizador próprio */}
      <input ref={subirRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onUploadVisualizador(e)} />

      {/* ESTIMATIVA DE ORÇAMENTO */}
      {estimandoPrecos && (!orcamento || orcamento.total_centavos === 0) && (
        <div className="mt-6 flex items-center gap-2 text-sm text-gray-500">
          <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-[#1D9E75] rounded-full animate-spin" />
          Pesquisando preços de mercado pros seus produtos…
        </div>
      )}
      {orcamento && orcamento.total_centavos > 0 && (() => {
        const pix = metodoPag === "pix";
        const descontoPix = orcamento.total_centavos - orcamento.pix_centavos;
        const totalPagar = pix ? orcamento.pix_centavos : orcamento.total_centavos;
        const frete = freteEstimadoCentavos(orcamento.total_pecas);
        return (
        <div className="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 pb-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">Resumo do pedido</p>
              <span className="text-[11px] text-gray-400">Estimativa, sujeita a confirmação</span>
            </div>

            {/* método de pagamento (PIX pré-selecionado) */}
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pagamento">
              <button type="button" role="radio" aria-checked={pix} onClick={() => setMetodoPag("pix")}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${pix ? "border-[#1D9E75] bg-[#E1F5EE]/60 ring-1 ring-[#1D9E75]" : "border-gray-200 hover:border-gray-300"}`}>
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">⚡ PIX <span className="text-[10px] font-semibold text-white bg-[#1D9E75] rounded-full px-1.5 py-0.5">−3%</span></span>
                <span className="block text-[11px] text-gray-500 mt-0.5">À vista · aprovação na hora</span>
              </button>
              <button type="button" role="radio" aria-checked={!pix} onClick={() => setMetodoPag("cartao")}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${!pix ? "border-[#1D9E75] bg-[#E1F5EE]/60 ring-1 ring-[#1D9E75]" : "border-gray-200 hover:border-gray-300"}`}>
                <span className="block text-sm font-medium text-gray-900">💳 Cartão de crédito</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">Em até 12x, conforme a operadora</span>
              </button>
            </div>

            {/* extrato */}
            <div className="mt-4 text-sm space-y-1.5">
              <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{brl(orcamento.subtotal_centavos)}</span></div>
              {orcamento.desconto_qtd_centavos > 0 && (
                <div className="flex justify-between text-[#0F6E56]"><span>Desconto quantidade (5%)</span><span>− {brl(orcamento.desconto_qtd_centavos)}</span></div>
              )}
              <div className="flex justify-between items-center text-gray-600">
                <span>Frete</span>
                {orcamento.frete_gratis ? (
                  <span className="flex items-center gap-2"><s className="text-gray-400">{brl(frete)}</s><span className="text-[#0F6E56] font-semibold">Grátis 🎉</span></span>
                ) : (
                  <span className="text-gray-400 text-xs">calculado no envio*</span>
                )}
              </div>
              {pix && descontoPix > 0 && (
                <div className="flex justify-between text-[#0F6E56]"><span>Desconto PIX (3%)</span><span>− {brl(descontoPix)}</span></div>
              )}
            </div>

            {/* total */}
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-900">Total {pix ? "no PIX" : "no cartão"}</p>
              <div className="text-right">
                <p className="text-2xl font-bold text-[#0F6E56] leading-tight">{brl(totalPagar)}</p>
                <p className="text-[11px] text-gray-400">{pix ? `no cartão: ${brl(orcamento.total_centavos)} em até 12x` : `no PIX sai por ${brl(orcamento.pix_centavos)} (−3%)`}</p>
              </div>
            </div>
            {!orcamento.frete_gratis && (
              <p className="text-[10px] text-gray-400 mt-1">*Frete à parte (grátis acima de R$ 200) — opções de envio após a produção.</p>
            )}
          </div>

          {/* CTA */}
          <div className="p-5 pt-4">
            <button type="button" disabled={!podeConfirmar}
              onClick={() => { setConfirmStep("form"); setConfirmErro(null); setTimeout(() => document.getElementById("pagar-agora-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); }}
              className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 disabled:cursor-not-allowed text-white text-base font-semibold px-6 py-3.5 rounded-xl transition-colors shadow-sm">
              Pagar agora →
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-2">Com o pagamento confirmado, seu pedido entra em produção.</p>
            {estimandoPrecos && <p className="text-[11px] text-gray-400 mt-1 text-center">Atualizando preços de mercado…</p>}
            {!orcamento.completo && !estimandoPrecos && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 leading-snug">Alguns itens ainda estão sendo precificados. Se persistir, nosso time ajusta antes de fechar.</p>
            )}
          </div>
        </div>
        );
      })()}

      {/* PRAZO DE PRODUÇÃO */}
      {pedido.prazo_dias && orcamento && orcamento.total_centavos > 0 ? (
        <div className="mt-3 bg-white border border-gray-200 rounded-2xl shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#E1F5EE] flex items-center justify-center text-lg shrink-0" aria-hidden>⏱️</div>
          <div>
            <p className="text-sm font-medium text-gray-900">Prazo de produção: <span className="text-[#0F6E56] font-semibold">{pedido.prazo_dias} dias</span></p>
            <p className="text-[11px] text-gray-500">Contados a partir da confirmação do pagamento — o envio acontece assim que a produção fica pronta.</p>
          </div>
        </div>
      ) : null}

      {/* GARANTIA CONFECCIONE */}
      <div className="mt-3 bg-[#E1F5EE]/60 border border-[#1D9E75]/20 rounded-xl p-3 flex items-start gap-2">
        <span aria-hidden className="text-[#0F6E56] leading-none">🔒</span>
        <p className="text-xs text-[#0F6E56] leading-relaxed">
          <strong>Pagamento garantido pela Confeccione.</strong> A gente segura o valor e só repassa pro fornecedor quando você confirmar que recebeu o pedido em conformidade. Após o pagamento, liberamos os visualizadores dos seus produtos pra você baixar.
        </p>
      </div>

      {/* CONTATO + AVANÇAR */}
      <div className="mt-8 bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
        {(contato.nome || contato.email) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-900">Entrega e contato</p>
              <button type="button" onClick={abrirContato} className="inline-flex items-center gap-1.5 text-[#0F6E56] hover:bg-[#E1F5EE]/60 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                Editar
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">📦 Endereço de entrega</p>
                <p className="text-[11px] text-[#0F6E56] mb-1">Seu lote será enviado para:</p>
                {contato.logradouro || contato.cidade ? (
                  <>
                    <p className="text-sm text-gray-800 leading-snug">{[contato.logradouro, contato.complemento].filter(Boolean).join(", ")}</p>
                    <p className="text-sm text-gray-600 leading-snug">{[contato.bairro, [contato.cidade, contato.uf].filter(Boolean).join("/")].filter(Boolean).join(" — ")}</p>
                    {contato.cep && <p className="text-xs text-gray-500 mt-1">CEP {cepBR(contato.cep)}</p>}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">{contato.cep ? `CEP ${cepBR(contato.cep)}${contato.complemento ? ` · ${contato.complemento}` : ""}` : "Endereço ainda não informado — clique em Editar."}</p>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">👤 Contato</p>
                <p className="text-sm text-gray-800">{contato.nome}</p>
                {contato.telefone && <p className="text-sm text-gray-600">{telBR(contato.telefone)}</p>}
                {contato.email && <p className="text-sm text-gray-600 break-all">{contato.email}</p>}
                <p className="text-[11px] text-gray-400 mt-1.5">Usamos esses dados pra te avisar sobre produção e envio.</p>
              </div>
            </div>
          </div>
        )}
        {confirmStep === "feito" && pixResult ? (
          <div className="bg-[#E1F5EE] border border-[#1D9E75]/30 rounded-xl p-4">
            <p className="text-sm text-[#0F6E56] font-medium">Pedido confirmado! ✅</p>
            <p className="text-xs text-[#0F6E56]/80 mt-1 leading-relaxed">Enviamos o resumo pro seu e-mail. {metodoPag === "pix" ? <>Pague no <strong>PIX</strong> abaixo (3% de desconto já aplicado)</> : <>Pague no <strong>cartão de crédito</strong> pelo botão abaixo</>} — assim que o pagamento cair, seu pedido entra em produção e você poderá baixar os visualizadores. O valor fica garantido pela Confeccione até você receber tudo certinho.</p>
            {metodoPag === "pix" && pixResult.copiaCola && (
              <div className="mt-4 flex flex-col sm:flex-row gap-4 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/pedido/assistente/${pedido.id}/pix-qr`} alt="QR Code PIX" className="w-40 h-40 rounded-lg border border-[#1D9E75]/30 bg-white shrink-0" />
                <div className="flex-1 w-full min-w-0">
                  <p className="text-xs text-gray-500 mb-1">Escaneie o QR Code ou use o copia e cola:</p>
                  <code className="block break-all bg-white border border-gray-200 rounded-lg px-3 py-2 text-[11px] text-gray-700">{pixResult.copiaCola}</code>
                  <div className="flex gap-2 mt-2">
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(pixResult.copiaCola!); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }} className="border border-[#1D9E75] text-[#0F6E56] text-xs px-3 py-1.5 rounded-lg hover:bg-white">{copiado ? "Copiado!" : "Copiar código PIX"}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-3">
              <a href={pixResult.invoiceUrl} target="_blank" rel="noopener noreferrer" className={metodoPag === "cartao" ? "inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-5 py-2.5 rounded-xl" : "inline-block border border-[#1D9E75]/40 text-[#0F6E56] hover:bg-white text-xs font-medium px-4 py-2 rounded-xl"}>💳 {metodoPag === "cartao" ? "Pagar com cartão de crédito" : "Prefere cartão? Pagar com cartão"}</a>
            </div>
            {metodoPag === "cartao" && pixResult.copiaCola && (
              <div className="mt-4 flex flex-col sm:flex-row gap-4 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/pedido/assistente/${pedido.id}/pix-qr`} alt="QR Code PIX" className="w-40 h-40 rounded-lg border border-[#1D9E75]/30 bg-white shrink-0" />
                <div className="flex-1 w-full min-w-0">
                  <p className="text-xs text-gray-500 mb-1">Ou pague no PIX (3% de desconto):</p>
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
          <div id="pagar-agora-form" className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-sm font-medium text-gray-900 mb-1">Quase lá — confirme pra pagar</p>
            <p className="text-xs text-gray-500 mb-3">Informe seu CPF (ou CNPJ) pra gerar a cobrança. Total: <strong>{orcamento ? brl(metodoPag === "pix" ? orcamento.pix_centavos : orcamento.total_centavos) : ""}</strong> {metodoPag === "pix" ? "no PIX" : "no cartão (em até 12x)"}.</p>
            <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF ou CNPJ" inputMode="numeric"
              className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => void confirmarPedido()} disabled={confirmando}
                className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl">{confirmando ? "Gerando…" : "Gerar pagamento →"}</button>
              <button type="button" onClick={() => { setConfirmStep("idle"); setConfirmErro(null); }} className="text-sm text-gray-500 px-3 py-2.5 rounded-xl hover:bg-gray-100">Cancelar</button>
            </div>
            {confirmErro && <p className="text-xs text-red-600 mt-2">{confirmErro}</p>}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Revise os produtos e o resumo acima e clique em <strong className="text-gray-600">Pagar agora</strong> pra fechar o pedido.</p>
        )}
      </div>

      {/* ---------- MODAL EDITAR ENTREGA/CONTATO ---------- */}
      {contatoOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!salvandoContato) setContatoOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-gray-900 font-medium">Editar entrega e contato</p>
              <button type="button" onClick={() => setContatoOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Rua, bairro e cidade são preenchidos automaticamente pelo CEP.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nome</label>
                <input value={contatoDraft.nome} onChange={(e) => setContatoDraft((d) => ({ ...d, nome: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">WhatsApp / telefone</label>
                  <input value={contatoDraft.telefone} onChange={(e) => setContatoDraft((d) => ({ ...d, telefone: e.target.value }))} inputMode="tel" placeholder="(11) 99999-9999" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CEP</label>
                  <input value={contatoDraft.cep} onChange={(e) => setContatoDraft((d) => ({ ...d, cep: e.target.value }))} inputMode="numeric" placeholder="00000-000" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">E-mail</label>
                <input value={contatoDraft.email} onChange={(e) => setContatoDraft((d) => ({ ...d, email: e.target.value }))} inputMode="email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Número e complemento</label>
                <input value={contatoDraft.complemento} onChange={(e) => setContatoDraft((d) => ({ ...d, complemento: e.target.value }))} placeholder="ex.: 121, loja 2" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
              </div>
            </div>
            {contatoErro && <p className="text-xs text-red-600 mt-3">{contatoErro}</p>}
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => void salvarContato()} disabled={salvandoContato} className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl">{salvandoContato ? "Salvando…" : "Salvar"}</button>
              <button type="button" onClick={() => setContatoOpen(false)} disabled={salvandoContato} className="text-sm text-gray-500 px-3 py-2.5 rounded-xl hover:bg-gray-100">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- MODAL EDITAR / ADICIONAR ---------- */}
      {ajusteIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (ajustandoIdx === null) { setAjusteIndex(null); setAjusteErro(null); } }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-gray-900 font-medium">Ajustar detalhe</p>
              <button type="button" onClick={() => { setAjusteIndex(null); setAjusteErro(null); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 mb-3">A IA muda só esse detalhe e mantém o resto. Ex.: <em>&ldquo;sobe a logo da manga pro ombro&rdquo;</em>, <em>&ldquo;deixa o bordado das costas menor&rdquo;</em>.</p>
            {(imgs[ajusteIndex]?.aplicado || imgs[ajusteIndex]?.url) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgs[ajusteIndex]?.aplicado || imgs[ajusteIndex]?.url} alt="prévia atual" className="w-full rounded-lg border border-gray-200 mb-3" />
            )}
            <textarea
              value={ajusteTexto}
              onChange={(e) => setAjusteTexto(e.target.value)}
              rows={3}
              autoFocus
              placeholder="o que você quer mudar nessa imagem?"
              className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-base sm:text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]"
            />
            {ajusteErro && <p className="text-xs text-red-600 mt-1">{ajusteErro}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => { setAjusteIndex(null); setAjusteErro(null); }} className="text-sm text-gray-500 px-4 py-2 rounded-xl hover:bg-gray-100">Cancelar</button>
              <button type="button" onClick={() => void aplicarAjuste(ajusteIndex)} disabled={ajustandoIdx !== null || !ajusteTexto.trim()} className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-xl">
                {ajustandoIdx !== null ? "Ajustando…" : "Aplicar ajuste"}
              </button>
            </div>
          </div>
        </div>
      )}

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
