"use client";
import { useState } from "react";
import Link from "next/link";

const tiposProduto = [
  { id: "interclasse",     icon: "👕", title: "Interclasse / Evento", sub: "Camisas e uniformes em grupo" },
  { id: "private_label",   icon: "✂️", title: "Private Label",        sub: "Marca própria e coleções" },
  { id: "peca_unica",      icon: "🧵", title: "Peça Única",           sub: "Personalizada ou presente" },
  { id: "fardamento",      icon: "🏢", title: "Fardamento",           sub: "Uniformes corporativos" },
  { id: "padrao_esportivo",icon: "⚽", title: "Padrão Esportivo",     sub: "Pelada, vôlei, futebol com nome nas costas" },
  { id: "ajuste",          icon: "📐", title: "Ajuste / Conserto",    sub: "Ajustes e reparos em geral" },
];

const ufs = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

type CapacidadeOpcao = "" | "ate10" | "10a50" | "50a500" | "500mais";

const capacidadeOpcoes: { value: CapacidadeOpcao; label: string; min: number; max: number | null }[] = [
  { value: "ate10",   label: "Até 10 peças",      min: 1,   max: 10  },
  { value: "10a50",   label: "10 a 50 peças",     min: 10,  max: 50  },
  { value: "50a500",  label: "50 a 500 peças",    min: 50,  max: 500 },
  { value: "500mais", label: "Mais de 500 peças", min: 500, max: null },
];

export default function CadastroFornecedor() {
  const [step, setStep]               = useState(0);
  const [nome, setNome]               = useState("");
  const [whatsapp, setWhatsapp]       = useState("");
  const [email, setEmail]             = useState("");
  const [tiposSel, setTiposSel]       = useState<string[]>([]);
  const [descricao, setDescricao]     = useState("");
  const [capacidade, setCapacidade]   = useState<CapacidadeOpcao>("");
  const [emiteNf, setEmiteNf]         = useState<"sim" | "nao" | "">("");
  const [estado, setEstado]           = useState("");
  const [cidade, setCidade]           = useState("");
  const [raio, setRaio]               = useState("");
  const [enviando, setEnviando]       = useState(false);

  function toggleTipo(id: string) {
    setTiposSel(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  }

  const step1Valid = nome.trim().length > 0 && whatsapp.replace(/\D/g, "").length >= 10 && email.includes("@");
  const step2Valid = tiposSel.length > 0 && capacidade !== "" && emiteNf !== "";
  const step3Valid = estado !== "" && raio !== "";

  async function enviar() {
    setEnviando(true);
    const cap = capacidadeOpcoes.find(o => o.value === capacidade)!;
    try {
      await fetch("/api/fornecedor/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          whatsapp,
          email,
          tipos_produto: tiposSel,
          descricao_livre: descricao,
          capacidade_min: cap.min,
          capacidade_max: cap.max,
          emite_nf: emiteNf === "sim",
          estado,
          cidade,
          raio_atendimento: raio,
        }),
      });
    } catch (e) {
      console.error(e);
    }
    setEnviando(false);
    setStep(3);
  }

  return (
    <main className="min-h-screen bg-white font-sans">
      <nav className="bg-[#111] px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <Link href="/" className="flex items-center gap-2 md:gap-3">
          <svg width="32" height="32" viewBox="0 0 60 60" fill="none">
            <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round"/>
            <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
            <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <circle cx="30" cy="30" r="5" fill="white"/>
          </svg>
          <span className="text-white font-medium tracking-widest text-base md:text-lg">CONFECCIONE</span>
        </Link>
      </nav>

      <section className="px-6 pt-10 pb-16 max-w-2xl mx-auto">
        <h2 className="text-gray-900 text-xl font-medium mb-1">
          Cadastro de fornecedor{" "}
          <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">3 passos simples</span>
        </h2>
        <p className="text-gray-400 text-sm mb-6">Gratuito e sem burocracia. Comece a receber pedidos hoje.</p>

        {step < 3 && (
          <div className="flex items-center mb-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 transition-all ${i < step ? "bg-[#1D9E75] text-white" : i === step ? "bg-[#111] text-white" : "bg-gray-100 text-gray-400"}`}>
                  {i < step ? "✓" : i + 1}
                </div>
                {i < 2 && <div className={`flex-1 h-px mx-2 transition-colors ${i < step ? "bg-[#1D9E75]" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        )}

        <div className="border border-gray-200 rounded-2xl p-6">

          {step === 0 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Sobre você ou sua empresa</p>
              <p className="text-gray-400 text-sm mb-5">Seus dados de contato para receber os pedidos.</p>
              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1 block">Nome completo ou nome da empresa</label>
                <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome ou razão social" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">WhatsApp com DDD</label>
                  <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">E-mail</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
              </div>
              <div className="flex justify-end">
                <button disabled={!step1Valid} onClick={() => setStep(1)} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium disabled:opacity-30 hover:opacity-85">Continuar →</button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Sua produção</p>
              <p className="text-gray-400 text-sm mb-5">Conte o que você faz para receber pedidos compatíveis.</p>

              <div className="mb-5">
                <label className="text-xs text-gray-400 mb-2 block">Tipos de produto que você confecciona <span className="text-red-400">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {tiposProduto.map((t) => (
                    <button key={t.id} type="button" onClick={() => toggleTipo(t.id)} className={`text-left border-2 rounded-xl p-4 transition-all ${tiposSel.includes(t.id) ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-[#1D9E75]"}`}>
                      <span className="text-2xl mb-2 block">{t.icon}</span>
                      <div className="text-sm font-medium text-gray-900">{t.title}</div>
                      <div className="text-xs text-gray-400 mt-1">{t.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <label className="text-xs text-gray-400 mb-1 block">Descrição livre (opcional)</label>
                <textarea rows={3} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Conte mais sobre sua produção (especialidades, estilo, experiência)" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75]" />
              </div>

              <div className="mb-5">
                <label className="text-xs text-gray-400 mb-2 block">Capacidade de produção por pedido <span className="text-red-400">*</span></label>
                <div className="space-y-2">
                  {capacidadeOpcoes.map((op) => (
                    <label key={op.value} className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 cursor-pointer transition-all ${capacidade === op.value ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-gray-300"}`}>
                      <input type="radio" name="capacidade" value={op.value} checked={capacidade === op.value} onChange={() => setCapacidade(op.value)} className="accent-[#1D9E75]" />
                      <span className="text-sm text-gray-800">{op.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-xs text-gray-400 mb-2 block">Emite nota fiscal? <span className="text-red-400">*</span></label>
                <div className="flex gap-3">
                  <label className={`flex items-center gap-2 border-2 rounded-xl px-5 py-3 cursor-pointer transition-all ${emiteNf === "sim" ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-gray-300"}`}>
                    <input type="radio" name="emite_nf" value="sim" checked={emiteNf === "sim"} onChange={() => setEmiteNf("sim")} className="accent-[#1D9E75]" />
                    <span className="text-sm text-gray-800">Sim</span>
                  </label>
                  <label className={`flex items-center gap-2 border-2 rounded-xl px-5 py-3 cursor-pointer transition-all ${emiteNf === "nao" ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-gray-300"}`}>
                    <input type="radio" name="emite_nf" value="nao" checked={emiteNf === "nao"} onChange={() => setEmiteNf("nao")} className="accent-[#1D9E75]" />
                    <span className="text-sm text-gray-800">Não</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(0)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button disabled={!step2Valid} onClick={() => setStep(2)} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium disabled:opacity-30 hover:opacity-85">Continuar →</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Onde você atende</p>
              <p className="text-gray-400 text-sm mb-5">Informe sua localização para receber pedidos da sua área.</p>

              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Estado (UF) <span className="text-red-400">*</span></label>
                  <select value={estado} onChange={e => setEstado(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]">
                    <option value="">Selecione...</option>
                    {ufs.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Cidade (opcional)</label>
                  <input type="text" value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Ex: Recife" className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
              </div>

              <div className="mb-6">
                <label className="text-xs text-gray-400 mb-2 block">Raio de atendimento <span className="text-red-400">*</span></label>
                <div className="space-y-2">
                  {[
                    { value: "estado",   label: "Só meu estado" },
                    { value: "regiao",   label: "Minha região" },
                    { value: "nacional", label: "Brasil todo" },
                  ].map((op) => (
                    <label key={op.value} className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 cursor-pointer transition-all ${raio === op.value ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-gray-300"}`}>
                      <input type="radio" name="raio" value={op.value} checked={raio === op.value} onChange={() => setRaio(op.value)} className="accent-[#1D9E75]" />
                      <span className="text-sm text-gray-800">{op.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button disabled={!step3Valid || enviando} onClick={enviar} className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors">
                  {enviando ? "Enviando..." : "Concluir cadastro →"}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-[#E1F5EE] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h3 className="text-gray-900 text-lg font-medium mb-2">Cadastro feito!</h3>
              <p className="text-gray-400 text-sm max-w-xs mx-auto mb-6 leading-relaxed">
                Você vai receber uma mensagem no WhatsApp em instantes. Em breve enviaremos pedidos que batem com o seu perfil.
              </p>
              <Link href="/" className="inline-block bg-[#111] hover:opacity-85 text-white font-medium px-6 py-3 rounded-xl text-sm transition-opacity">Voltar pro site</Link>
            </div>
          )}

        </div>
      </section>
    </main>
  );
}
