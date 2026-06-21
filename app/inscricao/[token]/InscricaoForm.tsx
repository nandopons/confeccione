"use client";
// Formulário público de inscrição. Coleta nome + tamanho (+ número/whatsapp/
// email/observação). Pós-envio: agradece e oferece "adicionar outra pessoa".
import { useState } from "react";

const TAMANHOS = ["PP", "P", "M", "G", "GG", "XG", "XGG"];

export default function InscricaoForm({ token }: { token: string }) {
  const [nome, setNome] = useState("");
  const [tamanho, setTamanho] = useState("");
  const [tamOutro, setTamOutro] = useState("");
  const [numero, setNumero] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [obs, setObs] = useState("");
  const [maisCampos, setMaisCampos] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [ultimo, setUltimo] = useState("");

  const tamFinal = (tamanho === "__outro" ? tamOutro : tamanho).trim();

  function limpar() {
    setNome(""); setTamanho(""); setTamOutro(""); setNumero(""); setObs("");
    setErro(null);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!nome.trim()) return setErro("Coloca seu nome.");
    if (!tamFinal) return setErro("Escolhe o tamanho.");
    setEnviando(true);
    try {
      const r = await fetch(`/api/lista/${token}/inscrever`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          tamanho: tamFinal,
          numero: numero.trim() || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          observacao: obs.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.erro || "Não consegui enviar. Tenta de novo.");
      setUltimo(nome.trim());
      setOk(true);
      limpar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao enviar.");
    } finally {
      setEnviando(false);
    }
  }

  if (ok) {
    return (
      <div className="mt-5 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-[#E1F5EE] flex items-center justify-center text-2xl">✅</div>
        <p className="text-gray-900 font-semibold mt-3">Prontinho{ultimo ? `, ${ultimo.split(" ")[0]}` : ""}!</p>
        <p className="text-sm text-gray-500 mt-1">Seu tamanho foi adicionado ao pedido.</p>
        <button
          type="button"
          onClick={() => { setOk(false); }}
          className="mt-5 bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2.5 rounded-lg"
        >
          + Adicionar outra pessoa
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mt-5 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1">Seu nome</label>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome e sobrenome"
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1.5">Tamanho da camisa</label>
        <div className="flex flex-wrap gap-2">
          {TAMANHOS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTamanho(t)}
              className={
                "px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors " +
                (tamanho === t
                  ? "bg-[#1D9E75] border-[#1D9E75] text-white"
                  : "bg-white border-gray-300 text-gray-700 hover:border-[#1D9E75]")
              }
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTamanho("__outro")}
            className={
              "px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors " +
              (tamanho === "__outro"
                ? "bg-[#1D9E75] border-[#1D9E75] text-white"
                : "bg-white border-gray-300 text-gray-700 hover:border-[#1D9E75]")
            }
          >
            Outro
          </button>
        </div>
        {tamanho === "__outro" && (
          <input
            value={tamOutro}
            onChange={(e) => setTamOutro(e.target.value.toUpperCase())}
            placeholder="Ex.: infantil 12, 4XG…"
            className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]"
          />
        )}
      </div>

      {!maisCampos ? (
        <button type="button" onClick={() => setMaisCampos(true)} className="text-xs text-[#0F6E56] hover:underline">
          + número da camisa, WhatsApp, e-mail (opcional)
        </button>
      ) : (
        <div className="space-y-4 border-t border-gray-100 pt-4">
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Número da camisa <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 10" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">WhatsApp <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 90000-0000" inputMode="tel" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">E-mail <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" inputMode="email" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">Observação <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: nome pra estampar nas costas" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#1D9E75]" />
          </div>
        </div>
      )}

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <button
        type="submit"
        disabled={enviando}
        className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-semibold px-4 py-3 rounded-lg disabled:opacity-50"
      >
        {enviando ? "Enviando…" : "Enviar meu tamanho"}
      </button>
    </form>
  );
}
