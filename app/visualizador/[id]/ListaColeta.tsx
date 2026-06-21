"use client";
// Gestão da "lista de coleta" de UM modelo (Listas Externas), embutida no card.
// O dono cria o link, acompanha os inscritos, baixa o PDF/QR e envia por e-mail.
// A lista é a FONTE das quantidades do modelo (cada inscrição soma +1).
import { useEffect, useState } from "react";

type Inscrito = {
  id: string;
  nome: string;
  tamanho: string;
  numero: string | null;
  observacao: string | null;
  whatsapp: string | null;
  email: string | null;
};
type Lista = {
  id: string;
  linha_index: number;
  token: string;
  ativa: boolean;
  titulo: string | null;
  inscritos: Inscrito[];
};

const ORDEM = ["PP", "P", "M", "G", "GG", "XG", "XGG", "XXG"];
function ordemTam(t: string): number {
  const u = (t || "").toUpperCase().trim();
  const i = ORDEM.indexOf(u);
  if (i >= 0) return i;
  const n = parseInt(u, 10);
  if (!isNaN(n)) return 100 + n;
  return 90;
}
function tally(insc: Inscrito[]): { tamanho: string; qtd: number }[] {
  const m = new Map<string, number>();
  for (const r of insc) {
    const t = (r.tamanho || "").toUpperCase().trim();
    if (!t) continue;
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([tamanho, qtd]) => ({ tamanho, qtd }))
    .sort((a, b) => ordemTam(a.tamanho) - ordemTam(b.tamanho));
}

export default function ListaColeta({
  pedidoId,
  linhaIndex,
  onAtualizarLinha,
}: {
  pedidoId: string;
  linhaIndex: number;
  onAtualizarLinha?: (i: number, tamanhos: { tamanho: string; qtd: number }[], total: number) => void;
}) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [emailModal, setEmailModal] = useState(false);
  const [emailDest, setEmailDest] = useState("");
  const [confirmExcluir, setConfirmExcluir] = useState(false);

  const base = `/api/pedido/assistente/${pedidoId}/listas`;
  const link = lista ? `${typeof window !== "undefined" ? window.location.origin : ""}/inscricao/${lista.token}` : "";

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch(base, { cache: "no-store" });
      const j = await r.json();
      const minha = (j.listas as Lista[] | undefined)?.find((l) => l.linha_index === linhaIndex) || null;
      setLista(minha);
    } catch { /* silencioso */ }
    finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pedidoId, linhaIndex]);

  function aplicarContagem(insc: Inscrito[]) {
    const t = tally(insc);
    onAtualizarLinha?.(linhaIndex, t, t.reduce((a, x) => a + x.qtd, 0));
  }

  async function criar() {
    setCriando(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linha_index: linhaIndex }),
      });
      const j = await r.json();
      if (j.lista) { setLista({ ...j.lista, inscritos: j.lista.inscritos ?? [] }); setAberto(true); }
    } finally { setCriando(false); }
  }

  async function alternarAtiva() {
    if (!lista) return;
    const nova = !lista.ativa;
    setLista({ ...lista, ativa: nova });
    await fetch(`${base}/${lista.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativa: nova }),
    });
  }

  async function removerInscrito(inscId: string) {
    if (!lista) return;
    const novos = lista.inscritos.filter((x) => x.id !== inscId);
    setLista({ ...lista, inscritos: novos });
    aplicarContagem(novos);
    await fetch(`${base}/${lista.id}/inscricao/${inscId}`, { method: "DELETE" });
  }

  async function excluirLista() {
    if (!lista) return;
    await fetch(`${base}/${lista.id}`, { method: "DELETE" });
    setLista(null);
    setConfirmExcluir(false);
  }

  function copiar() {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    });
  }

  async function enviarEmail() {
    if (!lista) return;
    setEnviando(true);
    setEmailMsg(null);
    try {
      const r = await fetch(`${base}/${lista.id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailDest.trim() ? { email: emailDest.trim() } : {}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro || "Não consegui enviar.");
      setEmailMsg(`Enviado para ${j.email} ✅`);
      setEmailModal(false);
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : "Erro ao enviar.");
    } finally { setEnviando(false); }
  }

  if (carregando) {
    return <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">carregando lista de coleta…</div>;
  }

  // Sem lista ainda → CTA pra criar
  if (!lista) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-100">
        <button
          type="button"
          onClick={() => void criar()}
          disabled={criando}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#E1F5EE] hover:bg-[#1D9E75] text-[#0F6E56] hover:text-white text-sm font-medium px-3 py-2.5 rounded-lg ring-1 ring-[#1D9E75]/30 transition-colors disabled:opacity-50"
        >
          🔗 {criando ? "Criando…" : "Criar lista de coleta (o grupo informa os tamanhos)"}
        </button>
        <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">
          Gera um link pra você mandar no grupo. Cada pessoa coloca nome e tamanho, e a quantidade deste modelo passa a ser contada automaticamente.
        </p>
      </div>
    );
  }

  const cont = tally(lista.inscritos);
  const total = cont.reduce((a, x) => a + x.qtd, 0);

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">🔗 Lista de coleta</p>
        <span className={"text-[11px] px-2 py-0.5 rounded-full " + (lista.ativa ? "bg-[#E1F5EE] text-[#0F6E56]" : "bg-gray-100 text-gray-500")}>
          {lista.ativa ? "aberta" : "fechada"}
        </span>
      </div>

      {/* link + copiar */}
      <div className="mt-2 flex items-stretch gap-2">
        <input readOnly value={link} className="flex-1 min-w-0 border border-gray-200 bg-gray-50 rounded-lg px-2.5 py-2 text-xs text-gray-600" />
        <button type="button" onClick={copiar} className="shrink-0 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium px-3 rounded-lg">
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>

      {/* resumo da contagem */}
      <div className="mt-3 flex items-center flex-wrap gap-1.5">
        <span className="text-xs text-gray-600 font-medium">{total} inscrito{total === 1 ? "" : "s"}</span>
        {cont.map((c) => (
          <span key={c.tamanho} className="bg-gray-50 border border-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-md">{c.tamanho} · {c.qtd}</span>
        ))}
        {total === 0 && <span className="text-xs text-gray-400">aguardando inscrições</span>}
      </div>

      {/* ações */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={`${base}/${lista.id}/pdf`} className="inline-flex items-center gap-1.5 border border-[#1D9E75] text-[#0F6E56] text-xs px-3 py-1.5 rounded-lg hover:bg-[#E1F5EE]">⬇️ PDF com QR</a>
        <button type="button" onClick={() => { setEmailDest(""); setEmailMsg(null); setEmailModal(true); }} className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50">✉️ Enviar por e-mail</button>
        <button type="button" onClick={() => void alternarAtiva()} className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50">{lista.ativa ? "Fechar coleta" : "Reabrir coleta"}</button>
        {lista.inscritos.length > 0 && (
          <button type="button" onClick={() => setAberto((v) => !v)} className="inline-flex items-center gap-1.5 text-gray-500 text-xs px-2 py-1.5 rounded-lg hover:text-[#0F6E56]">{aberto ? "Ocultar" : "Ver"} inscritos</button>
        )}
      </div>
      {emailMsg && <p className="text-[11px] text-[#0F6E56] mt-1.5">{emailMsg}</p>}

      {/* roster */}
      {aberto && lista.inscritos.length > 0 && (
        <div className="mt-3 border border-gray-100 rounded-lg divide-y divide-gray-100">
          {lista.inscritos.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-gray-800 truncate">{p.nome} <span className="text-gray-400">·</span> <span className="font-medium text-[#0F6E56]">{p.tamanho}</span>{p.numero ? <span className="text-gray-500"> · nº {p.numero}</span> : null}</p>
                {(p.observacao || p.whatsapp) && <p className="text-[11px] text-gray-400 truncate">{[p.observacao, p.whatsapp].filter(Boolean).join(" · ")}</p>}
              </div>
              <button type="button" onClick={() => void removerInscrito(p.id)} className="shrink-0 text-gray-300 hover:text-red-600 text-sm px-1" aria-label="Remover inscrito">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        <p className="text-[11px] text-gray-400">As quantidades deste modelo são contadas por esta lista.</p>
        {!confirmExcluir ? (
          <button type="button" onClick={() => setConfirmExcluir(true)} className="text-[11px] text-gray-400 hover:text-red-600">excluir lista</button>
        ) : (
          <span className="text-[11px] text-gray-500">excluir? <button type="button" onClick={() => void excluirLista()} className="text-red-600 font-medium">sim</button> / <button type="button" onClick={() => setConfirmExcluir(false)} className="text-gray-500">não</button></span>
        )}
      </div>

      {/* modal e-mail */}
      {emailModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={() => setEmailModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900">Enviar link por e-mail</p>
            <p className="text-xs text-gray-500 mt-1">Deixe em branco pra usar o e-mail do pedido. Vai junto o PDF com QR Code.</p>
            <input value={emailDest} onChange={(e) => setEmailDest(e.target.value)} placeholder="email@exemplo.com (opcional)" className="mt-3 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]" />
            {emailMsg && <p className="text-[11px] text-red-600 mt-1.5">{emailMsg}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEmailModal(false)} className="text-sm text-gray-500 px-3 py-2">Cancelar</button>
              <button type="button" onClick={() => void enviarEmail()} disabled={enviando} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">{enviando ? "Enviando…" : "Enviar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
