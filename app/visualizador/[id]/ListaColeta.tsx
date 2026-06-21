"use client";
// Gestão da "lista de coleta" de UM modelo (Listas Externas), embutida no card.
// O dono cria o link, acompanha as respostas, baixa o PDF/QR e envia por e-mail.
//
// MODELO DE QUANTIDADE (jun/2026): o modelo tem uma QUANTIDADE-ALVO (metaQtd) =
// a quantidade já definida no pedido. A lista PREENCHE até esse alvo. Enquanto
// não completa, o pedido mantém o breakdown de tamanhos original — a lista NÃO
// altera o total. Quando completa (todos responderam OU o organizador completa
// os faltantes manualmente), os tamanhos coletados passam a valer (total segue
// = alvo) e a lista fecha. Sem alvo (metaQtd=0) a lista é a fonte (legado).
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
// Tamanhos padrão oferecidos no formulário de complemento manual.
const TAMS_PADRAO = ["PP", "P", "M", "G", "GG", "XG"];
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
  metaQtd = 0,
  onAtualizarLinha,
}: {
  pedidoId: string;
  linhaIndex: number;
  metaQtd?: number;
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
  // complemento manual
  const [compAberto, setCompAberto] = useState(false);
  const [compQtd, setCompQtd] = useState<Record<string, number>>({});
  const [compMsg, setCompMsg] = useState<string | null>(null);
  const [completando, setCompletando] = useState(false);

  const base = `/api/pedido/assistente/${pedidoId}/listas`;
  const link = lista ? `${typeof window !== "undefined" ? window.location.origin : ""}/inscricao/${lista.token}` : "";

  // Sincroniza a linha do pedido com a contagem — MAS só quando a lista está
  // completa (ou quando não há alvo). Antes de completar, o pedido mantém o
  // breakdown original, igual ao backend.
  function sincronizarPai(insc: Inscrito[]) {
    const t = tally(insc);
    const total = t.reduce((a, x) => a + x.qtd, 0);
    if (metaQtd > 0 && total < metaQtd) return;
    onAtualizarLinha?.(linhaIndex, t, metaQtd > 0 ? metaQtd : total);
  }

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch(base, { cache: "no-store" });
      const j = await r.json();
      const minha = (j.listas as Lista[] | undefined)?.find((l) => l.linha_index === linhaIndex) || null;
      setLista(minha);
      if (minha) sincronizarPai(minha.inscritos);
    } catch { /* silencioso */ }
    finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pedidoId, linhaIndex]);

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
    sincronizarPai(novos);
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

  async function completar(restante: number) {
    if (!lista) return;
    const itens = Object.entries(compQtd)
      .map(([tamanho, qtd]) => ({ tamanho, qtd: Math.max(0, Math.round(Number(qtd) || 0)) }))
      .filter((x) => x.qtd > 0);
    const soma = itens.reduce((a, x) => a + x.qtd, 0);
    if (soma !== restante) {
      setCompMsg(`Distribua exatamente ${restante} peça${restante === 1 ? "" : "s"} (você somou ${soma}).`);
      return;
    }
    setCompletando(true);
    setCompMsg(null);
    try {
      const r = await fetch(`${base}/${lista.id}/completar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faltantes: itens }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.erro || "Não consegui completar.");
      setCompAberto(false);
      setCompQtd({});
      await carregar(); // recarrega: agora completa e fechada; sincroniza o pai
    } catch (e) {
      setCompMsg(e instanceof Error ? e.message : "Erro ao completar.");
    } finally { setCompletando(false); }
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
          {metaQtd > 0
            ? `Gera um link pra você mandar no grupo. Cada pessoa coloca nome e tamanho até completar as ${metaQtd} peças deste modelo — a quantidade do pedido não muda, só a distribuição dos tamanhos.`
            : "Gera um link pra você mandar no grupo. Cada pessoa coloca nome e tamanho, e a quantidade deste modelo passa a ser contada automaticamente."}
        </p>
      </div>
    );
  }

  const cont = tally(lista.inscritos);
  const total = cont.reduce((a, x) => a + x.qtd, 0);
  const temAlvo = metaQtd > 0;
  const restante = temAlvo ? Math.max(0, metaQtd - total) : 0;
  const completa = temAlvo && total >= metaQtd;
  // tamanhos do form de complemento = padrão + os que já apareceram
  const tamsComp = Array.from(new Set([...TAMS_PADRAO, ...cont.map((c) => c.tamanho)])).sort((a, b) => ordemTam(a) - ordemTam(b));
  const somaComp = Object.values(compQtd).reduce((a, x) => a + (Math.max(0, Math.round(Number(x) || 0))), 0);

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">🔗 Lista de coleta</p>
        <span className={"text-[11px] px-2 py-0.5 rounded-full " + (lista.ativa ? "bg-[#E1F5EE] text-[#0F6E56]" : (completa ? "bg-[#E1F5EE] text-[#0F6E56]" : "bg-gray-100 text-gray-500"))}>
          {lista.ativa ? "aberta" : (completa ? "completa" : "fechada")}
        </span>
      </div>

      {/* link + copiar */}
      <div className="mt-2 flex items-stretch gap-2">
        <input readOnly value={link} className="flex-1 min-w-0 border border-gray-200 bg-gray-50 rounded-lg px-2.5 py-2 text-xs text-gray-600" />
        <button type="button" onClick={copiar} className="shrink-0 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium px-3 rounded-lg">
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>

      {/* progresso vs alvo */}
      {temAlvo && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-gray-700">{total} de {metaQtd} responderam</span>
            <span className={completa ? "text-[#0F6E56] font-medium" : "text-amber-700 font-medium"}>
              {completa ? "completa ✅" : `faltam ${restante}`}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full bg-[#1D9E75]" style={{ width: `${Math.min(100, Math.round((total / metaQtd) * 100))}%` }} />
          </div>
        </div>
      )}

      {/* resumo da contagem por tamanho */}
      <div className="mt-3 flex items-center flex-wrap gap-1.5">
        {!temAlvo && <span className="text-xs text-gray-600 font-medium">{total} inscrito{total === 1 ? "" : "s"}</span>}
        {cont.map((c) => (
          <span key={c.tamanho} className="bg-gray-50 border border-gray-200 text-gray-700 text-xs px-2 py-0.5 rounded-md">{c.tamanho} · {c.qtd}</span>
        ))}
        {total === 0 && <span className="text-xs text-gray-400">aguardando respostas</span>}
      </div>

      {/* aviso: enquanto incompleta, o pedido mantém o breakdown original */}
      {temAlvo && !completa && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3 leading-snug">
          Enquanto a lista não fecha, o pedido mantém os tamanhos atuais. Quando todos responderem (ou você completar os faltantes), os tamanhos são atualizados — o total de {metaQtd} não muda.
        </p>
      )}

      {/* ações */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={`${base}/${lista.id}/pdf`} className="inline-flex items-center gap-1.5 border border-[#1D9E75] text-[#0F6E56] text-xs px-3 py-1.5 rounded-lg hover:bg-[#E1F5EE]">⬇️ PDF com QR</a>
        <button type="button" onClick={() => { setEmailDest(""); setEmailMsg(null); setEmailModal(true); }} className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50">✉️ Enviar por e-mail</button>
        {temAlvo && !completa && (
          <button type="button" onClick={() => { setCompMsg(null); setCompQtd({}); setCompAberto((v) => !v); }} className="inline-flex items-center gap-1.5 border border-[#1D9E75] text-[#0F6E56] text-xs px-3 py-1.5 rounded-lg hover:bg-[#E1F5EE]">
            ✏️ Completar {restante} faltante{restante === 1 ? "" : "s"}
          </button>
        )}
        <button type="button" onClick={() => void alternarAtiva()} className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50">{lista.ativa ? "Fechar coleta" : "Reabrir coleta"}</button>
        {lista.inscritos.length > 0 && (
          <button type="button" onClick={() => setAberto((v) => !v)} className="inline-flex items-center gap-1.5 text-gray-500 text-xs px-2 py-1.5 rounded-lg hover:text-[#0F6E56]">{aberto ? "Ocultar" : "Ver"} respostas</button>
        )}
      </div>
      {emailMsg && <p className="text-[11px] text-[#0F6E56] mt-1.5">{emailMsg}</p>}

      {/* form de complemento manual */}
      {compAberto && temAlvo && !completa && (
        <div className="mt-3 border border-[#1D9E75]/30 bg-[#E1F5EE]/30 rounded-xl p-3">
          <p className="text-xs font-medium text-gray-800">Completar os {restante} faltante{restante === 1 ? "" : "s"} manualmente</p>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-2">Distribua exatamente {restante} peça{restante === 1 ? "" : "s"} entre os tamanhos. Ao salvar, a lista fecha.</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {tamsComp.map((t) => (
              <label key={t} className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-gray-600">{t}</span>
                <input
                  type="number" min={0} inputMode="numeric"
                  value={compQtd[t] ?? ""}
                  onChange={(e) => setCompQtd((m) => ({ ...m, [t]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
                  className="w-full text-center border border-gray-300 rounded-lg px-1.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-[#1D9E75]"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className={"text-[11px] " + (somaComp === restante ? "text-[#0F6E56]" : "text-amber-700")}>
              {somaComp} / {restante} distribuídas
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setCompAberto(false); setCompMsg(null); }} className="text-xs text-gray-500 px-2 py-1.5">Cancelar</button>
              <button type="button" disabled={completando || somaComp !== restante} onClick={() => void completar(restante)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50">
                {completando ? "Salvando…" : "Completar e fechar"}
              </button>
            </div>
          </div>
          {compMsg && <p className="text-[11px] text-red-600 mt-1.5">{compMsg}</p>}
        </div>
      )}

      {/* roster */}
      {aberto && lista.inscritos.length > 0 && (
        <div className="mt-3 border border-gray-100 rounded-lg divide-y divide-gray-100">
          {lista.inscritos.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-gray-800 truncate">{p.nome} <span className="text-gray-400">·</span> <span className="font-medium text-[#0F6E56]">{p.tamanho}</span>{p.numero ? <span className="text-gray-500"> · nº {p.numero}</span> : null}</p>
                {(p.observacao || p.whatsapp) && <p className="text-[11px] text-gray-400 truncate">{[p.observacao, p.whatsapp].filter(Boolean).join(" · ")}</p>}
              </div>
              <button type="button" onClick={() => void removerInscrito(p.id)} className="shrink-0 text-gray-300 hover:text-red-600 text-sm px-1" aria-label="Remover resposta">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          {temAlvo ? "A lista preenche os tamanhos sem mudar o total deste modelo." : "As quantidades deste modelo são contadas por esta lista."}
        </p>
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
