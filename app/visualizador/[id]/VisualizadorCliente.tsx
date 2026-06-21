"use client";

// app/visualizador/[id]/VisualizadorCliente.tsx
// ============================================================================
// Etapa 2 — Visualizadores. Cada linha do pedido vira um card; o cliente
// ENVIA a própria arte ou o mockup pronto da peça (uma imagem por produto).
// Sem geração por IA. Ações: trocar/remover imagem enviada,
// editar/excluir/adicionar produto.
//
// SEM preço pro cliente (jun/2026): ele CONFIRMA o pedido e a Confeccione
// encontra o fornecedor; o orçamento final (definido pelo fornecedor) chega
// por e-mail/WhatsApp e aparece aqui com o botão de pagamento.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ListaColeta from "./ListaColeta";

export type Tamanho = { tamanho: string; qtd: number | null };
export type Estampa = { posicao: string; tamanho: string };
export type Linha = {
  lid?: string | null;
  modelo: string | null;
  cor: string | null;
  material: string | null;
  publico?: string | null;
  total: number | null;
  tamanhos: Tamanho[];
  estampas: Estampa[];
  estampado: boolean | null;
  acabamentos?: string[] | null;
  categoria?: string | null;
  objetivo_material?: string | null;
  descricao: string | null;
  preco_unit_centavos?: number | null;
};

// Lista de tamanhos só faz sentido em pedidos coletivos: interclasse/eventos
// e padrão esportivo (futebol/vôlei com nome nas costas).
function permiteListaTamanhos(cat?: string | null): boolean {
  const c = (cat || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /interclasse|evento|esportiv/.test(c);
}
function brl(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export type PedidoVis = {
  id: string;
  categoria?: string | null;
  linhas: Linha[];
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  numero?: string | null;
  complemento: string | null;
  logradouro?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  status: string | null;
  mockups?: Record<string, { liso?: string; arte?: string; fotos?: string[]; ia?: { url: string; prompt?: string }[] }> | null;
  prazo_dias?: number | null;
  confirmado_em?: string | null;
  orcamento_status?: string | null;
  valor_centavos?: number | null;
  frete_centavos?: number | null;
  pagamento_status?: string | null;
  fornecedor_nome?: string | null;
  codigo?: string | null;
  oferta_id?: string | null;
  fornecedor_portfolio?: PortfolioMidiaVis[];
};

type PortfolioMidiaVis = { path: string; mime: string | null; tipo: 'imagem' | 'video'; nome: string };

type ImgEstado = { loading?: boolean; urls?: string[]; motivo?: string };

const linhaVazia: Linha = { modelo: "", cor: "", material: "", publico: null, total: null, tamanhos: [], estampas: [], estampado: null, acabamentos: [], categoria: null, objetivo_material: null, descricao: "" };

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
function acabamentoLabel(l: { acabamentos?: string[] | null; estampado?: boolean | null; estampas?: { posicao: string; tamanho: string }[] | null }): string {
  const a = Array.isArray(l.acabamentos) ? l.acabamentos : [];
  if (a.length > 0) return a.map((x) => (x === "bordada" ? "Bordada" : "Estampada")).join(" + ");
  if (l.estampado === true || (l.estampas?.length ?? 0) > 0) return "Estampado / bordado";
  return "";
}

function corLabel(s: string | null | undefined): string {
  return (s || "").replace(/\s*\(#?[0-9a-fA-F]{6}\)\s*/g, " ").replace(/#[0-9a-fA-F]{6}/g, "").replace(/\s{2,}/g, " ").trim();
}

const EDIT_HINTS: string[] = [
  "Quais os tamanhos?",
  "Qual a cor exata?",
  "Material: algodão? poliéster?",
  "Detalhes da estampa/bordado?",
  "Completar este produto",
];

const TAM_CHIPS = ["P", "M", "G", "GG", "XG"];
const TAM_ORDEM = ["PP", "P", "M", "G", "GG", "XG", "XGG", "XXG", "XXXG"];
function ordemTam(t: string | null | undefined): number {
  const i = TAM_ORDEM.indexOf((t || "").trim().toUpperCase());
  return i >= 0 ? i : 90;
}
function ordenarTamanhos(arr: Tamanho[]): Tamanho[] {
  return [...arr].sort((a, b) => ordemTam(a.tamanho) - ordemTam(b.tamanho) || (a.tamanho || "").localeCompare(b.tamanho || ""));
}

const CORES_NOMEADAS: { nome: string; hex: string; claro?: boolean }[] = [
  { nome: "Branca", hex: "#FFFFFF", claro: true },
  { nome: "Off White", hex: "#F3EFE6", claro: true },
  { nome: "Pérola", hex: "#EAE6DA", claro: true },
  { nome: "Areia", hex: "#E4D5B7", claro: true },
  { nome: "Bege", hex: "#D9C7A6", claro: true },
  { nome: "Caqui", hex: "#B6A06A", claro: true },
  { nome: "Cinza Clara", hex: "#C9CDD2", claro: true },
  { nome: "Cinza Mescla", hex: "#B9BDC2", claro: true },
  { nome: "Cinza", hex: "#8A8F98" },
  { nome: "Chumbo", hex: "#4A4F55" },
  { nome: "Preta", hex: "#141414" },
  { nome: "Café", hex: "#3B2A20" },
  { nome: "Marrom", hex: "#5B3A29" },
  { nome: "Coral", hex: "#FF6F61" },
  { nome: "Salmão", hex: "#F5A38B", claro: true },
  { nome: "Vermelha", hex: "#C62828" },
  { nome: "Vermelho Tomate", hex: "#E04A2F" },
  { nome: "Vinho", hex: "#6E1423" },
  { nome: "Bordô", hex: "#4E1119" },
  { nome: "Laranja", hex: "#E8590C" },
  { nome: "Laranja Queimado", hex: "#B5481B" },
  { nome: "Amarela", hex: "#F2C200", claro: true },
  { nome: "Amarelo Ouro", hex: "#D4A017" },
  { nome: "Mostarda", hex: "#C99A2E" },
  { nome: "Verde Limão", hex: "#9CCB3B", claro: true },
  { nome: "Verde Bandeira", hex: "#1B7A3D" },
  { nome: "Verde Musgo", hex: "#3E5631" },
  { nome: "Verde Oliva", hex: "#6B7333" },
  { nome: "Verde Militar", hex: "#4B5320" },
  { nome: "Verde Água", hex: "#9FE2BF", claro: true },
  { nome: "Tiffany", hex: "#5FD0C5", claro: true },
  { nome: "Turquesa", hex: "#1AA7A0" },
  { nome: "Azul Bebê", hex: "#A9CCE3", claro: true },
  { nome: "Azul Celeste", hex: "#7EC8E3", claro: true },
  { nome: "Azul Royal", hex: "#1E50C8" },
  { nome: "Azul Marinho", hex: "#1B2A4A" },
  { nome: "Lilás", hex: "#C9A7E0", claro: true },
  { nome: "Roxa", hex: "#5E35B1" },
  { nome: "Roxo Uva", hex: "#3F2A6E" },
  { nome: "Rosa Bebê", hex: "#F4C2D7", claro: true },
  { nome: "Rosa", hex: "#E59ABF", claro: true },
  { nome: "Rosa Pink", hex: "#E5006E" },
  { nome: "Magenta", hex: "#C2185B" },
];

type ObjetivoMaterial = { id: string; label: string; desc: string; material: string; recomendado?: boolean };
const OBJETIVOS_MATERIAL: ObjetivoMaterial[] = [
  { id: "economica", label: "Econômica", desc: "Material mais em conta, sem perder a modelagem, costura e estamparia.", material: "malha básica (algodão básico/PV)" },
  { id: "padrao", label: "Padrão", desc: "Tecido mais durável e resistente — bom custo-benefício.", material: "algodão fio 30 penteado" },
  { id: "premium", label: "Premium", desc: "Alta qualidade, conforto e tecnologia — pra quem busca o melhor.", material: "algodão premium (pima/penteado nobre)" },
  { id: "performance", label: "Performance / Dry", desc: "Seca rápido — dry-fit, poliamida (esporte/fitness)", material: "dry-fit / poliamida" },
  { id: "indefinido", label: "Não sei, me ajudem", desc: "A gente sugere o melhor material pro seu objetivo", material: "" },
];

const CATEGORIAS = [
  "Interclasse / Evento",
  "Private Label",
  "Fitness",
  "Moda Praia",
  "Moda Íntima",
  "Padrão Esportivo",
  "Fardamento",
  "Inverno",
  "Roupas UV",
  "Bonés",
  "Brindes / Gráfica",
];

export default function VisualizadorCliente({ pedido }: { pedido: PedidoVis }) {
  const [linhas, setLinhas] = useState<Linha[]>(
    (pedido.linhas ?? []).map((l) => ({ ...l, tamanhos: l.tamanhos ?? [], estampas: l.estampas ?? [], estampado: l.estampado ?? null, acabamentos: Array.isArray(l.acabamentos) ? l.acabamentos : (l.estampado === true ? ["estampada"] : []), categoria: l.categoria ?? null, objetivo_material: l.objetivo_material ?? null }))
  );
  const [imgs, setImgs] = useState<Record<number, ImgEstado>>(() => {
    const m = pedido.mockups || {};
    const init: Record<number, ImgEstado> = {};
    for (const k of Object.keys(m)) {
      const v = m[k] || {};
      const fotos = Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : [];
      const urls = fotos.length > 0 ? fotos : [v.liso || v.arte].filter((x): x is string => !!x);
      if (urls.length > 0) init[Number(k)] = { urls };
    }
    return init;
  });
  const [salvando, setSalvando] = useState(false);
  const [iaImgs, setIaImgs] = useState<Record<number, { url: string; prompt?: string }[]>>(() => {
    const m = pedido.mockups || {}; const init: Record<number, { url: string; prompt?: string }[]> = {};
    for (const k of Object.keys(m)) { const v = (m as Record<string, { ia?: { url: string; prompt?: string }[] }>)[k] || {}; if (Array.isArray(v.ia) && v.ia.length) init[Number(k)] = v.ia; }
    return init;
  });
  const [iaInstr, setIaInstr] = useState<Record<number, string>>({});
  const [iaBusy, setIaBusy] = useState<number | null>(null);
  const [iaErro, setIaErro] = useState<Record<number, string | null>>({});
  const [iaAjuste, setIaAjuste] = useState<{ i: number; idx: number } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  // confirmação / pagamento
  const [confirmStep, setConfirmStep] = useState<"idle" | "form" | "feito">("idle");
  const [confirmadoEm, setConfirmadoEm] = useState<string | null>(pedido.confirmado_em ?? null);
  const [confirmandoPedido, setConfirmandoPedido] = useState(false);
  const [confirmadoMsg, setConfirmadoMsg] = useState(false);
  const [contato, setContato] = useState({ nome: pedido.nome, telefone: pedido.telefone, email: pedido.email, cep: pedido.cep, numero: pedido.numero ?? null, complemento: pedido.complemento, logradouro: pedido.logradouro ?? null, bairro: pedido.bairro ?? null, cidade: pedido.cidade ?? null, uf: pedido.uf ?? null });
  const [contatoOpen, setContatoOpen] = useState(false);
  const [contatoDraft, setContatoDraft] = useState({ nome: "", telefone: "", email: "", cep: "", numero: "", complemento: "" });
  const [salvandoContato, setSalvandoContato] = useState(false);
  const [contatoErro, setContatoErro] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [confirmErro, setConfirmErro] = useState<string | null>(null);
  const [pixResult, setPixResult] = useState<{ copiaCola: string | null; invoiceUrl: string; valorCentavos: number } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pago, setPago] = useState(pedido.pagamento_status === "pago");
  const [numImagensSalvas, setNumImagensSalvas] = useState(0);
  const [checandoPago, setChecandoPago] = useState(false);

  // edição / adição
  const [editOpen, setEditOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editHintIdx, setEditHintIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setEditHintIdx((x) => (x + 1) % EDIT_HINTS.length), 2600);
    return () => clearInterval(t);
  }, []);
  const [draft, setDraft] = useState<Linha>({ ...linhaVazia });
  const [editStep, setEditStep] = useState<1 | 2 | 3>(1);
  const [corPickerOpen, setCorPickerOpen] = useState(false);

  // subir a própria arte / mockup
  const [subindoIdx, setSubindoIdx] = useState<number | null>(null);

  async function salvarMockup(payload: { index?: number; liso?: string | null; arte?: string | null; fotos?: string[] | null; resetAll?: boolean }) {
    try {
      await fetch(`/api/pedido/assistente/${pedido.id}/mockup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { /* silencioso */ }
  }

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
      setDraft({ ...linhaVazia, categoria: pedido.categoria ?? (linhas.find((l) => l.categoria)?.categoria ?? null), tamanhos: [] });
      setEditIndex(null);
    } else {
      setDraft(JSON.parse(JSON.stringify(linhas[i])));
      setEditIndex(i);
    }
    setEditStep(1);
    setCorPickerOpen(false);
    setEditOpen(true);
  }

  function salvarEdicao() {
    const tams = (draft.tamanhos || []).map((t) => ({ tamanho: t.tamanho.trim(), qtd: t.qtd && t.qtd > 0 ? Math.round(t.qtd) : null })).filter((t) => t.tamanho);
    const somaTam = tams.reduce((a, t) => a + (t.qtd || 0), 0);
    const limpa: Linha = {
      modelo: draft.modelo?.trim() || null,
      cor: draft.cor?.trim() || null,
      material: draft.material?.trim() || null,
      total: somaTam > 0 ? somaTam : (draft.total && draft.total > 0 ? Math.round(draft.total) : null),
      tamanhos: tams,
      estampas: (draft.estampas || []).map((e) => ({ posicao: (e.posicao || "").trim(), tamanho: (e.tamanho || "").trim() })).filter((e) => e.posicao && e.tamanho),
      publico: draft.publico ?? null,
      acabamentos: draft.acabamentos ?? [],
      estampado: (draft.acabamentos ?? []).length > 0,
      categoria: draft.categoria?.trim() || null,
      objetivo_material: draft.objetivo_material ?? null,
      descricao: draft.descricao?.trim() || null,
    };
    if (!limpa.modelo && !limpa.cor && !limpa.total) return;
    let novas: Linha[];
    if (editIndex === null) {
      novas = [...linhas, limpa];
    } else {
      novas = linhas.map((l, idx) => (idx === editIndex ? limpa : l));
    }
    setLinhas(novas);
    setEditOpen(false);
    void persistir(novas);
    // Imagem enviada pelo cliente é preservada ao editar os detalhes do produto.
  }

  function excluir(i: number) {
    if (!confirm("Remover este produto do pedido?")) return;
    const novas = linhas.filter((_, idx) => idx !== i);
    // Reindexa as imagens preservando o que o cliente já enviou.
    const novasImgs: Record<number, ImgEstado> = {};
    novas.forEach((_, novoIdx) => {
      const antigoIdx = novoIdx >= i ? novoIdx + 1 : novoIdx;
      if (imgs[antigoIdx]) novasImgs[novoIdx] = imgs[antigoIdx];
    });
    setLinhas(novas);
    setImgs(novasImgs);
    void persistir(novas);
    void (async () => {
      await salvarMockup({ resetAll: true });
      for (const [k, st] of Object.entries(novasImgs)) {
        if (st.urls && st.urls.length) await salvarMockup({ index: Number(k), fotos: st.urls });
      }
    })();
  }

  async function reSalvarTodosMockups(imgsMap: Record<number, ImgEstado>, iaMap: Record<number, { url: string; prompt?: string }[]>) {
    await salvarMockup({ resetAll: true });
    for (const [k, st] of Object.entries(imgsMap)) {
      if (st.urls && st.urls.length) await salvarMockup({ index: Number(k), fotos: st.urls });
    }
    for (const [k, arr] of Object.entries(iaMap)) {
      if (arr && arr.length) {
        try { await fetch(`/api/pedido/assistente/${pedido.id}/mockup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: Number(k), ia: arr }) }); } catch {}
      }
    }
  }

  function clonarProduto(i: number) {
    const copia: Linha = JSON.parse(JSON.stringify(linhas[i]));
    delete copia.lid; // clone é um modelo novo — ganha lid próprio se criar lista
    const novas = [...linhas.slice(0, i + 1), copia, ...linhas.slice(i + 1)];
    const novasImgs: Record<number, ImgEstado> = {};
    const novasIa: Record<number, { url: string; prompt?: string }[]> = {};
    Object.entries(imgs).forEach(([k, v]) => { const idx = Number(k); novasImgs[idx > i ? idx + 1 : idx] = v; });
    Object.entries(iaImgs).forEach(([k, v]) => { const idx = Number(k); novasIa[idx > i ? idx + 1 : idx] = v; });
    if (imgs[i]?.urls?.length) novasImgs[i + 1] = { urls: [...(imgs[i].urls as string[])] };
    if (iaImgs[i]?.length) novasIa[i + 1] = iaImgs[i].map((x) => ({ ...x }));
    setLinhas(novas);
    setImgs(novasImgs);
    setIaImgs(novasIa);
    void persistir(novas);
    void reSalvarTodosMockups(novasImgs, novasIa);
  }

  // ---- remover a imagem enviada ----
  function removerFoto(i: number, j: number) {
    const urls = (imgs[i]?.urls ?? []).filter((_, k) => k !== j);
    setImgs((m) => ({ ...m, [i]: { ...m[i], urls } }));
    void salvarMockup({ index: i, fotos: urls });
  }

  // ---- subir o próprio visualizador ----
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

  const MAX_FOTOS = 6;

  function ehPlaceholder(v?: string | null): boolean {
    const t = (v || "").trim().toLowerCase();
    if (!t) return true;
    return /(a\s*definir|a\s*combinar|\bdefinir\b|indefinid|private\s*label|sob\s*consulta|^n\/?a$|^-+$)/.test(t);
  }
  function modeloCompleto(l: Linha): boolean {
    const qtd = (l.total ?? 0) > 0 ? (l.total as number) : (l.tamanhos || []).reduce((a, t) => a + (t.qtd || 0), 0);
    return !ehPlaceholder(l.modelo) && !ehPlaceholder(corLabel(l.cor)) && qtd > 0;
  }
  async function gerarMockupIA(i: number, regenIaIndex: number | null = null) {
    if (iaBusy !== null) return;
    setIaBusy(i); setIaErro((p) => ({ ...p, [i]: null }));
    try {
      const r = await fetch(`/api/visualizador/${pedido.id}/gerar-mockup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: i, instrucoes: iaInstr[i] || "", regenIaIndex }),
      }).then((x) => x.json());
      if (r.disponivel === false) { setIaErro((p) => ({ ...p, [i]: r.motivo || "Geração de IA indisponível agora." })); return; }
      if (r.erro) { setIaErro((p) => ({ ...p, [i]: r.erro })); return; }
      if (Array.isArray(r.ia)) { setIaImgs((p) => ({ ...p, [i]: r.ia })); setIaAjuste(null); }
    } catch { setIaErro((p) => ({ ...p, [i]: "Falha de conexão." })); }
    finally { setIaBusy(null); }
  }
  async function removerIaImg(i: number, idx: number) {
    const nova = (iaImgs[i] || []).filter((_, k) => k !== idx);
    setIaImgs((p) => ({ ...p, [i]: nova }));
    try { await fetch(`/api/pedido/assistente/${pedido.id}/mockup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index: i, ia: nova }) }); } catch {}
  }
  async function onUploadVisualizador(e: React.ChangeEvent<HTMLInputElement>, i: number) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const atuais = imgs[i]?.urls ?? [];
    const espaco = Math.max(0, MAX_FOTOS - atuais.length);
    if (espaco === 0) { alert(`Máximo de ${MAX_FOTOS} fotos por produto.`); return; }
    const aUsar = files.slice(0, espaco);
    setSubindoIdx(i);
    try {
      const novas: string[] = [];
      for (const file of aUsar) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) { alert(`"${file.name}" passa de 10 MB e foi ignorada.`); continue; }
        novas.push(await arquivoParaVisualizador(file));
      }
      if (novas.length === 0) return;
      const urls = [...atuais, ...novas];
      setImgs((m) => ({ ...m, [i]: { ...m[i], urls, loading: false, motivo: undefined } }));
      void salvarMockup({ index: i, fotos: urls });
    } catch {
      alert("Não consegui ler a imagem. Tenta outro arquivo.");
    } finally {
      setSubindoIdx(null);
    }
  }

  // Confirma o pedido SEM pagamento — a Confeccione busca o fornecedor ideal.
  async function confirmarPedido() {
    if (confirmandoPedido) return;
    setConfirmandoPedido(true);
    setConfirmErro(null);
    const imagens = linhas.flatMap((_, i) => imgs[i]?.urls ?? []);
    try {
      const res = await fetch(`/api/pedido/assistente/${pedido.id}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas, imagens }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.erro || "Não foi possível confirmar.");
      // Conversão Google Ads (via GTM): empurra o evento no dataLayer ao confirmar
      // o pedido. No GTM, dispare a tag de conversão pelo gatilho do evento "confirmar_pedido".
      try {
        const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({
          event: "confirmar_pedido",
          pedido_id: String(pedido.id),
          value: typeof pedido.valor_centavos === "number" ? pedido.valor_centavos / 100 : undefined,
          currency: "BRL",
        });
      } catch { /* analytics nunca quebra o fluxo */ }
      setConfirmadoEm(d.confirmadoEm ?? new Date().toISOString());
      setConfirmadoMsg(true);
      setTimeout(() => document.getElementById("status-pedido")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    } catch (e) {
      setConfirmErro(e instanceof Error ? e.message : "Erro ao confirmar.");
    } finally {
      setConfirmandoPedido(false);
    }
  }

  // Gera a cobrança do ORÇAMENTO FINAL (valor definido pelo fornecedor).
  const [recusando, setRecusando] = useState(false);
  async function recusarOrcamento() {
    if (recusando) return;
    if (!confirm(
      "Recusar este orçamento?\n\n" +
      "Seu pedido será oferecido a outro fornecedor. O novo orçamento pode vir com valor diferente (maior ou menor) — não garantimos o mesmo preço deste."
    )) return;
    setRecusando(true);
    try {
      const res = await fetch(`/api/pedido/assistente/${pedido.id}/recusar-orcamento`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.erro || "Não foi possível recusar agora.");
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao recusar.");
      setRecusando(false);
    }
  }

  const [cancelando, setCancelando] = useState(false);
  async function cancelarPedido() {
    if (cancelando) return;
    if (!confirm("Cancelar este pedido? Esta ação não pode ser desfeita.")) return;
    setCancelando(true);
    try {
      const res = await fetch(`/api/pedido/assistente/${pedido.id}/cancelar`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.erro || "Não foi possível cancelar agora.");
      window.location.href = "/cliente/painel";
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao cancelar.");
      setCancelando(false);
    }
  }

  async function gerarPagamento() {
    if (confirmando) return;
    const cpfDig = cpf.replace(/\D/g, "");
    if (cpfDig.length !== 11 && cpfDig.length !== 14) {
      setConfirmErro("Informe um CPF (11 dígitos) ou CNPJ (14).");
      return;
    }
    setConfirmando(true);
    setConfirmErro(null);
    try {
      const res = await fetch(`/api/pedido/assistente/${pedido.id}/pagar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpfCnpj: cpf }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.erro || "Não foi possível gerar o pagamento.");
      setPixResult({ copiaCola: d.copiaCola ?? null, invoiceUrl: d.invoiceUrl, valorCentavos: d.valorCentavos });
      // Conversão Google Ads (via GTM): cliente clicou "Pagar agora" e a cobrança foi gerada.
      // No GTM, dispare a tag de conversão pelo gatilho do evento "iniciar_pagamento".
      try {
        const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({
          event: "iniciar_pagamento",
          pedido_id: String(pedido.id),
          value: typeof d.valorCentavos === "number" ? d.valorCentavos / 100 : undefined,
          currency: "BRL",
        });
      } catch { /* analytics nunca quebra o fluxo */ }
      setConfirmStep("feito");
    } catch (e) {
      setConfirmErro(e instanceof Error ? e.message : "Erro ao gerar o pagamento.");
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

  // pedido já pago ao abrir: busca o nº de imagens pro bloco de download
  useEffect(() => {
    if (pedido.pagamento_status === "pago") void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // enquanto aguarda pagamento, faz polling do status (e libera o download)
  useEffect(() => {
    if (confirmStep !== "feito" || pago) return;
    void checkStatus();
    const t = setInterval(() => { void checkStatus(); }, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmStep, pago]);

  function abrirContato() {
    setContatoDraft({ nome: contato.nome ?? "", telefone: contato.telefone ?? "", email: contato.email ?? "", cep: contato.cep ?? "", numero: (contato as { numero?: string | null }).numero ?? "", complemento: contato.complemento ?? "" });
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
        body: JSON.stringify({ contato: { nome: contatoDraft.nome.trim(), telefone: contatoDraft.telefone.trim() || null, email: contatoDraft.email.trim() || null, cep: cepDigs || null, numero: contatoDraft.numero.trim() || null, complemento: contatoDraft.complemento.trim() || null } }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Não foi possível salvar.");
      const p = d.pedido ?? {};
      setContato({ nome: p.nome ?? contatoDraft.nome, telefone: p.telefone ?? null, email: p.email ?? null, cep: p.cep ?? null, numero: p.numero ?? null, complemento: p.complemento ?? null, logradouro: p.logradouro ?? null, bairro: p.bairro ?? null, cidade: p.cidade ?? null, uf: p.uf ?? null });
      setContatoOpen(false);
    } catch (e) {
      setContatoErro(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvandoContato(false);
    }
  }

  const orcamentoDefinido = pedido.orcamento_status === "definido" && (pedido.valor_centavos ?? 0) > 0;
  const podeConfirmar = linhas.length > 0;
  const totalPecas = linhas.reduce((acc, l) => acc + (l.total ?? 0), 0);
  const freteCliente = pedido.frete_centavos ?? 0;
  const produtosCliente = Math.max((pedido.valor_centavos ?? 0) - freteCliente, 0);

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto px-6 pt-8 pb-16">
      <div className="flex items-center justify-between gap-3 mb-1">
        <Link href="/cliente/painel" className="text-sm text-gray-500 hover:text-gray-800">← Voltar aos meus pedidos</Link>
        <div className="flex items-center gap-3">
          {salvando && <span className="text-xs text-gray-400">salvando…</span>}
          <a
            href={`/api/pedido/assistente/${pedido.id}/resumo-pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0F6E56] bg-[#E1F5EE] hover:bg-[#cdeee2] px-3 py-1.5 rounded-lg ring-1 ring-[#1D9E75]/25 transition-colors"
            title="Baixar um PDF com o resumo do pedido"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
            Baixar resumo (PDF)
          </a>
        </div>
      </div>
      <h1 className="text-gray-900 text-2xl font-semibold mt-2">Pré-visualização dos seus produtos</h1>
      {pedido.codigo && <p className="text-xs text-gray-400 mt-1">Pedido nº <span className="font-medium text-gray-600">{pedido.codigo}</span></p>}
      {pedido.status === "cancelado" && (
        <div className="mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">Este pedido foi cancelado.</div>
      )}
      <p className="text-gray-500 text-sm mt-1 mb-6">
        Para cada produto, envie uma ou mais fotos/artes. {totalPecas > 0 && <span className="text-gray-700 font-medium">{totalPecas} peças no total.</span>}
      </p>

      <PerguntasCliente pedidoId={pedido.id} />

      <div className="space-y-7">
        {linhas.map((l, i) => {
          const st = imgs[i] || {};
          return (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl shadow-md ring-1 ring-gray-900/5 overflow-hidden">
              {/* CABEÇALHO DO MODELO */}
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#0F6E56] text-white">
                <span className="inline-flex items-center gap-2 font-semibold text-sm">
                  <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-white/20 text-[11px] font-bold">{i + 1}</span>
                  Modelo {i + 1}
                </span>
                <span className="text-xs text-white/85 truncate max-w-[55%] capitalize">{[l.modelo, corLabel(l.cor)].filter(Boolean).join(" · ")}</span>
              </div>
              {/* VISUALIZADOR — imagem enviada pelo cliente */}
              <div className="relative bg-gray-50 border-b border-gray-100 flex items-center justify-center p-3 min-h-[200px]">
                {(st.urls && st.urls.length > 0) ? (
                  <div className="w-full">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {st.urls.map((u, j) => (
                        <div key={j} className="relative">
                          <button type="button" onClick={() => setZoom(u)} className="block w-full" aria-label={`Ampliar foto ${j + 1}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`foto ${j + 1}`} className="w-full h-40 object-contain rounded-lg border border-gray-200 bg-white cursor-zoom-in" />
                          </button>
                          <button type="button" onClick={() => removerFoto(i, j)} aria-label="Remover foto" className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/55 hover:bg-black/80 text-white text-base leading-none flex items-center justify-center">×</button>
                        </div>
                      ))}
                      {st.urls.length < MAX_FOTOS && (
                        <label className="h-40 rounded-lg border-2 border-dashed border-[#1D9E75]/50 hover:border-[#1D9E75] bg-[#E1F5EE]/30 hover:bg-[#E1F5EE]/60 text-[#0F6E56] flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors">
                          <span className="text-3xl leading-none">＋</span>
                          <span className="text-xs font-medium">Adicionar foto</span>
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onUploadVisualizador(e, i)} />
                        </label>
                      )}
                    </div>
                    {subindoIdx === i && <p className="text-xs text-gray-400 mt-2 text-center">enviando…</p>}
                    <p className="text-[11px] text-gray-400 mt-2 text-center">{st.urls.length}/{MAX_FOTOS} fotos — toque no + pra adicionar mais.</p>
                  </div>
                ) : subindoIdx === i ? (
                  <span className="text-xs text-gray-400">enviando suas fotos…</span>
                ) : (
                  <div className="text-center px-4 py-6 w-full max-w-md mx-auto">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-gray-100 flex items-center justify-center text-gray-300 text-xl">👕</div>
                    <p className="text-sm font-medium text-gray-800">Adicione as fotos desta peça</p>
                    <p className="text-[11px] text-gray-400 mt-1 mb-4 leading-snug">Envie uma ou mais fotos/artes desta peça (até {MAX_FOTOS}).</p>
                    <label className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors cursor-pointer text-center">
                      📤 Enviar fotos
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onUploadVisualizador(e, i)} />
                    </label>
                    {st.motivo && <p className="text-[11px] text-red-500 mt-3">{st.motivo} — tenta de novo.</p>}
                  </div>
                )}
              </div>

              {/* DETALHES */}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-gray-900 font-medium capitalize flex items-center gap-1.5">{corHex(l.cor) && <span className="w-3.5 h-3.5 rounded-full border border-black/10 inline-block shrink-0" style={{ backgroundColor: corHex(l.cor) as string }} />}{[l.modelo, corLabel(l.cor)].filter(Boolean).join(" · ") || "Produto"}</p>
                    {(() => {
                      const obj = OBJETIVOS_MATERIAL.find((o) => o.id === l.objetivo_material);
                      const txt = [obj?.label, l.material].filter(Boolean).join(" · ");
                      return txt ? <p className="text-sm text-gray-500 mt-0.5">Tecido: {txt}</p> : null;
                    })()}
                    {l.categoria && <p className="text-xs text-gray-400 mt-0.5">Categoria: {l.categoria}</p>}
                  </div>
                  {l.total ? <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full shrink-0">{l.total} un.</span> : null}
                </div>

                {!orcamentoDefinido && (
                  <button type="button" onClick={() => abrirEdicao(i)} title="Editar / completar produto" className="group mt-3 w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-2 bg-[#E1F5EE] hover:bg-[#1D9E75] text-[#0F6E56] hover:text-white text-sm font-medium px-3.5 py-2.5 rounded-lg ring-1 ring-[#1D9E75]/30 transition-colors">
                    <span className="relative flex h-5 w-5 items-center justify-center shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[#1D9E75]/30 motion-safe:animate-ping" aria-hidden="true" />
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="relative"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                    </span>
                    <span key={editHintIdx} style={{ animation: "hintIn .45s ease" }} className="whitespace-nowrap">{EDIT_HINTS[editHintIdx]}</span>
                  </button>
                )}

                {l.tamanhos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {l.tamanhos.map((t, j) => (
                      <span key={j} className="bg-gray-50 border border-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-md">
                        {t.tamanho.toUpperCase()}{t.qtd ? ` · ${t.qtd}` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {acabamentoLabel(l) && (
                  <div className="mt-2">
                    <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs px-2 py-0.5 rounded-md">{acabamentoLabel(l)}</span>
                  </div>
                )}
                {l.descricao && <p className="text-sm text-gray-500 mt-3 leading-relaxed">{l.descricao}</p>}

                {/* MOCKUP COM IA */}
                {!orcamentoDefinido && (() => {
                  const temArte = (st.urls?.length ?? 0) > 0;
                  const completo = modeloCompleto(l);
                  const liberado = temArte && completo;
                  const lista = iaImgs[i] || [];
                  const ajustandoEste = iaAjuste && iaAjuste.i === i;
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-sm font-medium text-gray-800 mb-2">✨ Mockup com IA</p>
                      {lista.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
                          {lista.map((it, idx) => (
                            <div key={idx} className={"relative group aspect-square rounded-lg overflow-hidden border bg-white " + (ajustandoEste && iaAjuste!.idx === idx ? "border-[#1D9E75] ring-2 ring-[#1D9E75]" : "border-[#1D9E75]/40")}>
                              <button type="button" onClick={() => setZoom(it.url)} className="block h-full w-full" aria-label={`Ampliar mockup IA ${idx + 1}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={it.url} alt={`Mockup IA ${idx + 1}`} className="h-full w-full object-cover cursor-zoom-in" />
                              </button>
                              <span className="absolute top-1 left-1 text-[10px] font-semibold bg-[#1D9E75] text-white rounded px-1">IA</span>
                              <button type="button" onClick={() => { setIaAjuste({ i, idx }); setIaInstr((p) => ({ ...p, [i]: it.prompt || p[i] || "" })); }} className="absolute bottom-1 left-1 inline-flex items-center gap-1 text-[10px] font-medium bg-black/60 hover:bg-black/80 text-white rounded px-1.5 py-0.5" aria-label="Ajustar mockup">✎ Ajustar</button>
                              <button type="button" onClick={() => void removerIaImg(i, idx)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 hover:bg-black/80 text-white text-sm leading-none flex items-center justify-center" aria-label="Remover">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {liberado ? (
                        <div>
                          {ajustandoEste && <p className="text-[11px] text-[#0F6E56] mb-1">Ajustando o mockup selecionado — descreva o que mudar.</p>}
                          <textarea
                            value={iaInstr[i] ?? ""}
                            onChange={(e) => setIaInstr((p) => ({ ...p, [i]: e.target.value }))}
                            rows={2}
                            placeholder="Como aplicar? Ex.: logo branca centralizada no peito; nome nas costas em dourado…"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75] resize-y"
                          />
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <button type="button" onClick={() => void gerarMockupIA(i, ajustandoEste ? iaAjuste!.idx : null)} disabled={iaBusy !== null} className="inline-flex items-center gap-1.5 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                              {iaBusy === i ? "Gerando…" : ajustandoEste ? "Atualizar mockup" : "✨ Gerar mockup com IA"}
                            </button>
                            {ajustandoEste && <button type="button" onClick={() => setIaAjuste(null)} className="text-sm text-gray-500 hover:text-gray-700">cancelar ajuste</button>}
                          </div>
                          {iaErro[i] && <p className="text-xs text-red-600 mt-2">{iaErro[i]}</p>}
                          <p className="text-[11px] text-gray-400 mt-1">A IA usa as artes deste modelo + os detalhes. Clique numa imagem gerada pra ajustar com outro texto.</p>
                        </div>
                      ) : (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                          Pra gerar o mockup com IA, {!completo ? "complete os detalhes do modelo (toque em \u201cCompletar este produto\u201d) \u2014 ex.: tipo da pe\u00e7a e cor" : ""}{!completo && !temArte ? " e " : ""}{!temArte ? "envie ao menos uma arte/foto" : ""}.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* LISTA DE COLETA (Listas Externas) — o grupo informa os tamanhos */}
                {!orcamentoDefinido && permiteListaTamanhos(pedido.categoria ?? (linhas.find((x) => x.categoria)?.categoria ?? null)) && (
                  <ListaColeta
                    pedidoId={pedido.id}
                    linhaIndex={i}
                    onAtualizarLinha={(idx, tamanhos, total) => setLinhas((prev) => prev.map((l, k) => (k === idx ? { ...l, tamanhos, total } : l)))}
                  />
                )}

                {/* AÇÕES — toolbar única: imagem à esquerda, produto à direita */}
                <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-2" aria-hidden />
                  {!orcamentoDefinido && (<>
                  <button type="button" onClick={() => clonarProduto(i)} title="Clonar este modelo" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-[#0F6E56] hover:bg-[#E1F5EE] text-sm px-3 py-2 rounded-lg transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                    Clonar
                  </button>
                  <button type="button" onClick={() => excluir(i)} title="Excluir produto" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 text-sm px-3 py-2 rounded-lg transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    Excluir
                  </button>
                  </>)}
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {!orcamentoDefinido && (
      <div className="mt-4">
        <button type="button" onClick={() => abrirEdicao(null)} className="border-2 border-dashed border-gray-300 text-gray-600 hover:border-[#1D9E75] hover:text-[#0F6E56] text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
          + Adicionar produto
        </button>
      </div>
      )}

      {/* STATUS / CONFIRMAÇÃO / ORÇAMENTO FINAL */}
      <div id="status-pedido" aria-hidden />
      {orcamentoDefinido ? (
        <div className="mt-6 bg-white border-2 border-[#1D9E75]/40 rounded-2xl shadow-sm p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">💰 Orçamento final do seu pedido</p>
            <span className="text-[11px] text-[#0F6E56] bg-[#E1F5EE] px-2 py-0.5 rounded-full">definido pelo fornecedor</span>
          </div>
          {pedido.fornecedor_nome && (
            <p className="text-xs text-gray-600 mt-1.5">Quem vai produzir: <strong className="text-gray-900">{pedido.fornecedor_nome}</strong></p>
          )}
          {pedido.oferta_id && (pedido.fornecedor_portfolio?.length ?? 0) > 0 && (
            <PortfolioGaleriaCliente ofertaId={pedido.oferta_id} midias={pedido.fornecedor_portfolio!} />
          )}
          <div className="mt-4 divide-y divide-gray-100 border-y border-gray-100">
            {linhas.map((l, i) => {
              const qtd = l.total ?? (l.tamanhos || []).reduce((a, t) => a + (t.qtd ?? 0), 0);
              const unitCliente = l.preco_unit_centavos != null ? Math.round(l.preco_unit_centavos / (1 - 0.03)) : null;
              const subtotal = unitCliente != null ? unitCliente * (qtd || 0) : null;
              const nome = [l.modelo, corLabel(l.cor)].filter(Boolean).join(" · ") || `Produto ${i + 1}`;
              return (
                <div key={i} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-800 capitalize truncate">{nome}</p>
                    <p className="text-xs text-gray-500">{qtd || "?"} un{unitCliente != null ? ` × ${brl(unitCliente)}` : ""}</p>
                  </div>
                  <span className="text-gray-900 font-medium shrink-0">{subtotal != null ? brl(subtotal) : brl(produtosCliente)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-sm space-y-1.5">
            <div className="flex justify-between text-gray-600"><span>Subtotal dos produtos</span><span>{brl(produtosCliente)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Frete</span><span>{freteCliente > 0 ? brl(freteCliente) : "incluso"}</span></div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-900">Valor total</p>
            <p className="text-xl font-bold text-[#0F6E56] leading-tight">{brl(pedido.valor_centavos ?? 0)}</p>
          </div>
          {!pago ? (
            <>
              <button type="button"
                onClick={() => { setConfirmStep("form"); setConfirmErro(null); setTimeout(() => document.getElementById("pagar-agora-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60); }}
                className="mt-4 w-full bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-base font-semibold px-6 py-3.5 rounded-xl transition-colors shadow-sm">
                Pagar agora →
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-2">PIX ou cartão na página de pagamento. Com o pagamento confirmado, a produção começa.</p>
              <div className="text-center mt-3">
                <button type="button" onClick={() => void recusarOrcamento()} disabled={recusando}
                  className="text-[13px] font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2 disabled:opacity-50">
                  {recusando ? "Recusando…" : "Recusar este orçamento"}
                </button>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">Ao recusar, o pedido vai pra outro fornecedor — o valor pode mudar e não garantimos manter este.</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#0F6E56] font-medium mt-3">Pagamento confirmado ✅ — pedido em produção.</p>
          )}
        </div>
      ) : confirmadoEm ? (
        <div className="mt-6 bg-[#E1F5EE] border border-[#1D9E75]/30 rounded-2xl p-5">
          <p className="text-sm font-semibold text-[#0F6E56]">🔎 Pedido confirmado — buscando o fornecedor ideal</p>
          <p className="text-xs text-[#0F6E56]/80 mt-1.5 leading-relaxed">
            Nosso time está selecionando o melhor fornecedor pras suas peças. Assim que ele preparar o <strong>orçamento final</strong> (produtos + frete), você recebe por <strong>e-mail e WhatsApp</strong> — e só paga se aprovar. Enquanto isso, pode continuar ajustando as artes por aqui.
          </p>
          {confirmadoMsg && <p className="text-[11px] text-[#0F6E56] bg-white/60 rounded-lg px-3 py-2 mt-3">Resumo enviado pro seu e-mail. ✉️</p>}
        </div>
      ) : (
        <div className="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-900">Tudo certo com os produtos?</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            Confirme o pedido e a gente encontra o <strong>fornecedor ideal</strong> pra produzir suas peças. Você recebe o orçamento final por e-mail e WhatsApp — <strong>sem compromisso até aprovar</strong>.
          </p>
          <button type="button" disabled={!podeConfirmar || confirmandoPedido}
            onClick={() => void confirmarPedido()}
            className="mt-4 w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 disabled:cursor-not-allowed text-white text-base font-semibold px-6 py-3.5 rounded-xl transition-colors shadow-sm">
            {confirmandoPedido ? "Confirmando…" : "Confirmar pedido →"}
          </button>
          {confirmErro && confirmStep === "idle" && <p className="text-xs text-red-600 mt-2">{confirmErro}</p>}
          <p className="text-[11px] text-gray-400 text-center mt-2">Sem pagamento agora — o valor só aparece no orçamento final.</p>
        </div>
      )}

      {/* PRAZO DE PRODUÇÃO */}
      {pedido.prazo_dias ? (
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
                    <p className="text-sm text-gray-800 leading-snug">{[[contato.logradouro, (contato as { numero?: string | null }).numero].filter(Boolean).join(", "), contato.complemento].filter(Boolean).join(" — ")}</p>
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
            <p className="text-sm text-[#0F6E56] font-medium">Pagamento gerado! ✅</p>
            <p className="text-xs text-[#0F6E56]/80 mt-1 leading-relaxed">Enviamos a cobrança pro seu e-mail. Pague no <strong>PIX</strong> abaixo ou no <strong>cartão</strong> pelo botão — assim que o pagamento cair, seu pedido entra em produção e você poderá baixar os visualizadores. O valor fica garantido pela Confeccione até você receber tudo certinho.</p>
            {pixResult.copiaCola && (
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
              <a href={pixResult.invoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-block border border-[#1D9E75]/40 text-[#0F6E56] hover:bg-white text-xs font-medium px-4 py-2 rounded-xl">💳 Prefere cartão? Pagar com cartão</a>
            </div>
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
            <p className="text-xs text-gray-500 mb-3">Informe seu CPF (ou CNPJ) pra gerar a cobrança. Total: <strong>{brl(pedido.valor_centavos ?? 0)}</strong> — PIX ou cartão na página de pagamento.</p>
            <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF ou CNPJ" inputMode="numeric"
              className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={() => void gerarPagamento()} disabled={confirmando}
                className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl">{confirmando ? "Gerando…" : "Gerar pagamento →"}</button>
              <button type="button" onClick={() => { setConfirmStep("idle"); setConfirmErro(null); }} className="text-sm text-gray-500 px-3 py-2.5 rounded-xl hover:bg-gray-100">Cancelar</button>
            </div>
            {confirmErro && <p className="text-xs text-red-600 mt-2">{confirmErro}</p>}
          </div>
        ) : pago ? (
          <div className="bg-[#E1F5EE] border border-[#1D9E75]/30 rounded-xl p-4">
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
          <p className="text-xs text-gray-400">
            {orcamentoDefinido
              ? <>Orçamento final disponível acima — clique em <strong className="text-gray-600">Pagar agora</strong> pra fechar o pedido.</>
              : confirmadoEm
                ? <>Pedido confirmado — assim que o fornecedor definir o orçamento, o pagamento libera por aqui.</>
                : <>Revise os produtos acima e clique em <strong className="text-gray-600">Confirmar pedido</strong> — a gente encontra o fornecedor ideal.</>}
          </p>
        )}
      </div>

      {!pago && pedido.status !== "cancelado" && (
        <div className="mt-6 text-center">
          <button type="button" onClick={() => void cancelarPedido()} disabled={cancelando}
            className="text-[13px] text-gray-500 hover:text-red-600 underline underline-offset-2 disabled:opacity-50">
            {cancelando ? "Cancelando…" : "Cancelar pedido"}
          </button>
        </div>
      )}

      {/* ---------- MODAL EDITAR ENTREGA/CONTATO ---------- */}
      {contatoOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvandoContato) setContatoOpen(false); }}>
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Número</label>
                    <input value={contatoDraft.numero} onChange={(e) => setContatoDraft((d) => ({ ...d, numero: e.target.value }))} placeholder="ex.: 121" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Complemento</label>
                    <input value={contatoDraft.complemento} onChange={(e) => setContatoDraft((d) => ({ ...d, complemento: e.target.value }))} placeholder="ex.: loja 2, fundos" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                  </div>
                </div>
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

      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditOpen(false); }}>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[88vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setEditOpen(false)} aria-label="Fechar" className="absolute top-3 right-3 h-8 w-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none">×</button>
            <p className="text-gray-900 font-medium mb-3">{editIndex === null ? "Adicionar produto" : `Editar Modelo ${editIndex + 1}`}</p>
            <div className="flex items-center mb-5">
              {[0, 1, 2].map((i) => {
                const cur = editStep - 1;
                const labels = ["Tecido", "Básico", "Detalhes"];
                return (
                  <div key={i} className="flex items-center flex-1 last:flex-none">
                    <div className={"w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 shadow-sm transition-all " + (i < cur ? "bg-[#1D9E75] text-white" : i === cur ? "bg-[#111] text-white" : "bg-white border border-gray-300 text-gray-500")}>
                      {i < cur ? "✓" : i + 1}
                    </div>
                    <span className={"ml-2 text-xs whitespace-nowrap " + (i <= cur ? "text-gray-700 font-medium" : "text-gray-400")}>{labels[i]}</span>
                    {i < 2 && <div className={"flex-1 h-px mx-3 transition-colors " + (i < cur ? "bg-[#1D9E75]" : "bg-gray-200")} />}
                  </div>
                );
              })}
            </div>

            {editStep === 1 ? (
            <div className="space-y-3">
              <Campo label="Tipo / qualidade do tecido">
                <div className="space-y-1.5">
                  {OBJETIVOS_MATERIAL.filter((o) => ["economica", "padrao", "premium"].includes(o.id)).map((o) => {
                    const sel = (draft.objetivo_material ?? "") === o.id;
                    return (
                      <button key={o.id} type="button" onClick={() => setDraft({ ...draft, objetivo_material: o.id })}
                        className={"w-full text-left rounded-lg border px-3 py-2.5 transition-colors " + (sel ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 bg-white hover:bg-gray-50")}>
                        <div className="flex items-center gap-2">
                          <span className={"h-4 w-4 rounded-full border flex items-center justify-center shrink-0 " + (sel ? "border-[#1D9E75] bg-[#1D9E75]" : "border-gray-300")}>
                            {sel && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </span>
                          <span className="text-sm font-medium text-gray-900">{o.label}</span>
                          {o.recomendado && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1D9E75] text-white">recomendado</span>}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5 ml-6">{o.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Escolha pelo objetivo da peça — a gente alinha o tecido ideal e o orçamento.</p>
              </Campo>
            </div>
            ) : editStep === 2 ? (
            <div className="space-y-3">
              <Campo label="Modelo (tshirt, oversized, polo, boné…)">
                <input value={draft.modelo ?? ""} onChange={(e) => setDraft({ ...draft, modelo: e.target.value })} className={inputCls} placeholder="oversized" />
              </Campo>
              <Campo label="Cor">
                <div className="flex items-center gap-2">
                  <input value={draft.cor ?? ""} onChange={(e) => setDraft({ ...draft, cor: e.target.value })} className={inputCls} placeholder="Ex.: Verde Oliva, Azul Marinho…" />
                  <div className="relative shrink-0">
                    <button type="button" onClick={() => setCorPickerOpen((v) => !v)} aria-label="Escolher cor pela paleta" title="Escolher cor"
                      className="h-9 w-9 rounded-lg border border-gray-300 flex items-center justify-center hover:bg-gray-50">
                      <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: CORES_NOMEADAS.find((c) => c.nome.toLowerCase() === (draft.cor || "").trim().toLowerCase())?.hex ?? "#FFFFFF" }} />
                    </button>
                    {corPickerOpen && (
                      <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-gray-200 bg-white shadow-lg p-2">
                        <div className="grid grid-cols-6 gap-1.5">
                          {CORES_NOMEADAS.map((c) => {
                            const sel = (draft.cor || "").trim().toLowerCase() === c.nome.toLowerCase();
                            return (
                              <button key={c.nome} type="button" title={c.nome} aria-label={c.nome}
                                onClick={() => { setDraft({ ...draft, cor: c.nome }); setCorPickerOpen(false); }}
                                className={"h-7 w-7 rounded-full flex items-center justify-center border transition-all " + (sel ? "ring-2 ring-[#1D9E75] ring-offset-1 border-gray-300" : "border-gray-200 hover:scale-110")}
                                style={{ backgroundColor: c.hex }}>
                                {sel && <span className="text-[11px] leading-none" style={{ color: c.claro ? "#111" : "#fff" }}>✓</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Escolha pela paleta (botão ao lado) ou escreva o nome da cor (sem código).</p>
              </Campo>
              <Campo label="Especificar tecido (opcional)">
                <input value={draft.material ?? ""} onChange={(e) => setDraft({ ...draft, material: e.target.value })} className={inputCls} placeholder="Ex.: algodão Menegotti 170g" />
              </Campo>
            </div>
            ) : (
            <div className="space-y-3">
              <Campo label="Tamanhos">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(() => {
                    const presentes = (draft.tamanhos || []).map((t) => (t.tamanho || "").trim().toUpperCase()).filter(Boolean);
                    const lista = Array.from(new Set([...TAM_CHIPS, ...presentes])).sort((a, b) => ordemTam(a) - ordemTam(b) || a.localeCompare(b));
                    return lista.map((tam) => {
                      const ativo = presentes.includes(tam);
                      return (
                        <button key={tam} type="button" title={ativo ? "Já adicionado — remova no ✕ da linha" : "Adicionar tamanho"}
                          onClick={() => { if (ativo) return; setDraft({ ...draft, tamanhos: ordenarTamanhos([...(draft.tamanhos || []), { tamanho: tam, qtd: null }]) }); }}
                          className={"px-3 py-1 rounded-lg text-sm border transition-colors " + (ativo ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56] cursor-default" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50")}>
                          {tam}
                        </button>
                      );
                    });
                  })()}
                </div>
                <div className="space-y-2">
                  {(draft.tamanhos || []).map((t, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <input value={t.tamanho}
                        onChange={(e) => setDraft({ ...draft, tamanhos: (draft.tamanhos || []).map((x, k) => k === j ? { ...x, tamanho: e.target.value.toUpperCase() } : x) })}
                        onBlur={() => setDraft({ ...draft, tamanhos: ordenarTamanhos(draft.tamanhos || []) })}
                        className={inputCls + " w-24"} placeholder="Ex.: 4XGG" />
                      <input type="number" min={1} value={t.qtd ?? ""}
                        onChange={(e) => setDraft({ ...draft, tamanhos: (draft.tamanhos || []).map((x, k) => k === j ? { ...x, qtd: parseInt(e.target.value) || null } : x) })}
                        className={inputCls + " w-24"} placeholder="qtd" />
                      <button type="button" onClick={() => setDraft({ ...draft, tamanhos: (draft.tamanhos || []).filter((_, k) => k !== j) })} className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setDraft({ ...draft, tamanhos: [...(draft.tamanhos || []), { tamanho: "", qtd: null }] })} className="text-xs text-[#0F6E56] hover:underline">+ adicionar tamanho</button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Toque nos tamanhos pra adicionar (ou crie um com “+ adicionar tamanho”). Informe a quantidade por tamanho — o total do modelo vira a soma deles.</p>
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
                {(() => {
                  const acab = draft.acabamentos ?? [];
                  const has = (v: string) => acab.includes(v);
                  const toggle = (v: string) => setDraft({ ...draft, acabamentos: has(v) ? acab.filter((a) => a !== v) : [...acab, v] });
                  const cls = (ativo: boolean) => "px-3 py-1.5 rounded-lg text-sm border transition-colors " + (ativo ? "border-[#1D9E75] bg-[#E1F5EE] text-[#0F6E56]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50");
                  return (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setDraft({ ...draft, acabamentos: [] })} className={cls(acab.length === 0)}>Lisa</button>
                      <button type="button" onClick={() => toggle("estampada")} className={cls(has("estampada"))}>Estampada</button>
                      <button type="button" onClick={() => toggle("bordada")} className={cls(has("bordada"))}>Bordada</button>
                    </div>
                  );
                })()}
                <p className="text-[11px] text-gray-400 mt-1">Dá pra combinar Estampada + Bordada se o layout tiver os dois.</p>
              </Campo>
              <Campo label="Detalhes (observações, instruções…)">
                <textarea rows={2} value={draft.descricao ?? ""} onChange={(e) => setDraft({ ...draft, descricao: e.target.value })} className={inputCls + " resize-none"} placeholder="estampa na frente, arte própria" />
              </Campo>
            </div>
            )}

            <div className="flex justify-between gap-2 mt-5">
              {editStep === 1 ? (
                <>
                  <button type="button" onClick={() => setEditOpen(false)} className="border border-gray-200 text-gray-500 px-4 py-2 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
                  <button type="button" onClick={() => setEditStep(2)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-4 py-2 rounded-xl text-sm font-medium">Continuar →</button>
                </>
              ) : editStep === 2 ? (
                <>
                  <button type="button" onClick={() => setEditStep(1)} className="border border-gray-200 text-gray-500 px-4 py-2 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                  <button type="button" onClick={() => setEditStep(3)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-4 py-2 rounded-xl text-sm font-medium">Continuar →</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setEditStep(2)} className="border border-gray-200 text-gray-500 px-4 py-2 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                  <button type="button" onClick={salvarEdicao} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-4 py-2 rounded-xl text-sm font-medium">Salvar</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setZoom(null); }} role="dialog" aria-modal="true">
          <button type="button" onClick={() => setZoom(null)} className="absolute top-4 right-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl leading-none" aria-label="Fechar">×</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Imagem ampliada" className="max-h-[92vh] max-w-[94vw] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
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

// ─── Perguntas mediadas dos fornecedores (anonimizadas) ──────────────────
type MensagemPergunta = { id: string; autor: "fornecedor" | "cliente"; texto: string; criadoEm: string };
type ThreadPergunta = { ofertaId: string; label: string; mensagens: MensagemPergunta[] };

function PerguntasCliente({ pedidoId }: { pedidoId: string }) {
  const [threads, setThreads] = useState<ThreadPergunta[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<Record<string, string | null>>({});
  const carregouRef = useRef(false);

  async function carregar() {
    try {
      const r = await fetch(`/api/pedido/assistente/${pedidoId}/perguntas`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && Array.isArray(j.threads)) setThreads(j.threads);
    } catch {
      // silencioso
    } finally {
      carregouRef.current = true;
    }
  }

  useEffect(() => {
    void carregar();
    const t = setInterval(() => { void carregar(); }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId]);

  async function responder(ofertaId: string) {
    const texto = (drafts[ofertaId] || "").trim();
    if (!texto || enviando) return;
    setEnviando(ofertaId);
    setErro((e) => ({ ...e, [ofertaId]: null }));
    try {
      const r = await fetch(`/api/pedido/assistente/${pedidoId}/responder-pergunta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ofertaId, texto }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || "Não foi possível enviar a resposta.");
      setDrafts((d) => ({ ...d, [ofertaId]: "" }));
      await carregar();
    } catch (e) {
      setErro((er) => ({ ...er, [ofertaId]: e instanceof Error ? e.message : "Erro ao enviar." }));
    } finally {
      setEnviando(null);
    }
  }

  // Nada a mostrar: não renderiza o bloco (mantém a âncora pro scroll).
  if (carregouRef.current && threads.length === 0) {
    return <div id="perguntas" aria-hidden />;
  }

  return (
    <div id="perguntas" className="mb-6 bg-white border border-gray-200 rounded-2xl shadow-sm p-5 scroll-mt-24">
      <h2 className="text-gray-900 text-base font-semibold">💬 Perguntas dos fornecedores</h2>
      <p className="text-gray-500 text-sm mt-1 mb-4">
        Fornecedores interessados no seu pedido podem perguntar por aqui — sem trocar contato. Responda que a Confeccione faz a ponte.
      </p>
      <div className="space-y-4">
        {threads.map((th) => (
          <div key={th.ofertaId} className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="text-xs font-semibold text-[#0F6E56] uppercase tracking-wide mb-2">{th.label}</div>
            <ul className="space-y-2 mb-3">
              {th.mensagens.map((m) => {
                const meu = m.autor === "cliente";
                return (
                  <li key={m.id} className={`flex ${meu ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${meu ? "bg-[#1D9E75] text-white" : "bg-white border border-gray-200 text-gray-800"}`}>
                      <div className={`text-[11px] font-semibold mb-0.5 ${meu ? "text-emerald-50" : "text-gray-500"}`}>{meu ? "Você" : th.label}</div>
                      <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {erro[th.ofertaId] && <div className="mb-2 text-sm rounded-md bg-red-50 text-red-700 px-3 py-2">{erro[th.ofertaId]}</div>}
            <textarea
              value={drafts[th.ofertaId] || ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [th.ofertaId]: e.target.value }))}
              placeholder="Escreva sua resposta…"
              maxLength={1000}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => void responder(th.ofertaId)}
                disabled={enviando === th.ofertaId || !(drafts[th.ofertaId] || "").trim()}
                className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-5 py-2 rounded-xl disabled:opacity-50"
              >
                {enviando === th.ofertaId ? "Enviando…" : "Responder"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PortfolioGaleriaCliente({ ofertaId, midias }: { ofertaId: string; midias: PortfolioMidiaVis[] }) {
  const [aberto, setAberto] = useState<number | null>(null);
  if (!midias || midias.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-gray-700">📸 Trabalhos do fornecedor</p>
      <p className="text-[11px] text-gray-500 mt-0.5">Fotos e vídeos de peças parecidas com o seu pedido, enviados por quem vai produzir.</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
        {midias.map((m, i) => (
          <button
            key={m.path}
            type="button"
            onClick={() => setAberto(i)}
            className="relative group aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#1D9E75]"
            aria-label={`Abrir ${m.tipo === "video" ? "vídeo" : "foto"} ${i + 1}`}
          >
            {m.tipo === "video" ? (
              <>
                <video src={`/api/oferta/${ofertaId}/portfolio/${i}`} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="h-7 w-7 rounded-full bg-black/55 text-white flex items-center justify-center text-xs">▶</span>
                </span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/oferta/${ofertaId}/portfolio/${i}`} alt={m.nome} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
            )}
          </button>
        ))}
      </div>

      {aberto !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(null); }} role="dialog" aria-modal="true">
          <button type="button" onClick={() => setAberto(null)} className="absolute top-4 right-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl leading-none" aria-label="Fechar">×</button>
          {midias.length > 1 && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); setAberto((aberto - 1 + midias.length) % midias.length); }} className="absolute left-3 sm:left-6 h-11 w-11 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl" aria-label="Anterior">‹</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); setAberto((aberto + 1) % midias.length); }} className="absolute right-3 sm:right-6 h-11 w-11 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl" aria-label="Próximo">›</button>
            </>
          )}
          {midias[aberto].tipo === "video" ? (
            <video src={`/api/oferta/${ofertaId}/portfolio/${aberto}`} className="max-h-[90vh] max-w-[92vw] rounded-lg shadow-2xl" controls autoPlay playsInline onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/oferta/${ofertaId}/portfolio/${aberto}`} alt={midias[aberto].nome} className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
          )}
          {midias.length > 1 && (
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs bg-black/40 rounded-full px-3 py-1">{aberto + 1} / {midias.length}</span>
          )}
        </div>
      )}
    </div>
  );
}
