"use client";
import { useState } from "react";

const nichos = [
  { id: "evento", icon: "👕", title: "Interclasse / Evento", sub: "Camisas e uniformes em grupo" },
  { id: "private", icon: "✂️", title: "Private Label", sub: "Marca própria e coleções" },
  { id: "peca", icon: "🧵", title: "Peça Única", sub: "Personalizada ou presente" },
  { id: "farda", icon: "🏢", title: "Fardamento", sub: "Uniformes corporativos" },
  { id: "ajuste", icon: "📐", title: "Ajuste / Conserto", sub: "Ajustes e reparos em geral" },
];

const prazos: Record<string, string> = {
  urgente: "Urgente (até 7 dias)",
  normal: "Normal (8 a 21 dias)",
  sempressa: "Sem pressa (21+ dias)",
};

export default function Home() {
  const [step, setStep] = useState(0);
  const [tipo, setTipo] = useState("");
  const [qty, setQty] = useState(10);
  const [prazo, setPrazo] = useState("");
  const [estado, setEstado] = useState("");
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [email, setEmail] = useState("");
  const [protocolo] = useState(() => Math.floor(Math.random() * 90000) + 10000);
  const [showPopup, setShowPopup] = useState(false);
  const [fornTel, setFornTel] = useState("");
  const [fornSent, setFornSent] = useState(false);

  const ufs = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

  function handleFornSubmit() {
    if (fornTel.length < 10) return;
    setFornSent(true);
  }

  function closePopup() {
    setShowPopup(false);
    setFornSent(false);
    setFornTel("");
  }

  return (
    <main className="min-h-screen bg-white font-sans">

      {/* POPUP FORNECEDOR */}
      {showPopup && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4" onClick={(e) => { if (e.target === e.currentTarget) closePopup(); }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            {!fornSent ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-gray-900 font-medium text-base">Cadastro de fornecedor</h3>
                  <button onClick={closePopup} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed mb-5">
                  Deixa seu WhatsApp com DDD e nossa equipe entra em contato para te guiar no cadastro. É rápido e gratuito!
                </p>
                <div className="mb-4">
                  <label className="text-xs text-gray-400 mb-1 block">WhatsApp com DDD</label>
                  <input
                    type="tel"
                    value={fornTel}
                    onChange={e => setFornTel(e.target.value)}
                    placeholder="(71) 99999-9999"
                    className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]"
                  />
                </div>
                <button onClick={handleFornSubmit} disabled={fornTel.length < 10} className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-30 text-white font-medium py-3 rounded-xl text-sm transition-colors">
                  Quero me cadastrar
                </button>
                <p className="text-xs text-gray-300 text-center mt-3">Cadastro 100% gratuito para fornecedores</p>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-[#E1F5EE] rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h3 className="text-gray-900 font-medium mb-2">Recebemos seu contato!</h3>
                <p className="text-gray-400 text-sm leading-relaxed mb-4">Nossa equipe vai entrar em contato pelo WhatsApp <strong className="text-gray-600">{fornTel}</strong> em breve para finalizar seu cadastro.</p>
                <button onClick={closePopup} className="text-sm text-[#1D9E75] font-medium">Fechar</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* NAVBAR */}
      <nav className="bg-[#111] px-6 py-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <svg width="32" height="32" viewBox="0 0 60 60" fill="none">
            <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round"/>
            <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
            <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
            <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
            <circle cx="30" cy="30" r="5" fill="white"/>
          </svg>
          <span className="text-white font-medium tracking-widest text-lg">CONFECCIONE</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowPopup(true)} className="text-white text-sm border border-white/20 px-4 py-2 rounded-full hover:bg-white/10 transition-colors hidden md:block">
            Sou fornecedor
          </button>
          <span className="bg-[#1D9E75] text-white text-xs font-medium px-3 py-1 rounded-full">Suporte humano</span>
          <span className="text-white text-sm font-medium">0800 000 0000</span>
        </div>
      </nav>

      {/* HERO */}
      <section className="bg-[#111] px-6 py-16 text-center">
        <h1 className="text-white text-3xl md:text-4xl font-medium leading-tight mb-4">
          Conectamos você às melhores<br />confecções e costureiras do Brasil
        </h1>
        <p className="text-gray-400 text-base max-w-xl mx-auto mb-8 leading-relaxed">
          Faça seu pedido em minutos. Receba orçamentos de fornecedores verificados. Produza com confiança.
        </p>
        <button onClick={() => document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth" })} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-medium px-8 py-4 rounded-xl text-base transition-colors">
          Fazer meu pedido agora
        </button>
      </section>

      {/* TRUST BAR */}
      <div className="bg-[#1a1a1a] px-6 py-3 flex flex-wrap items-center justify-center gap-6">
        {["Fornecedores verificados", "Pagamento seguro", "Suporte 0800 gratuito", "Todo o Brasil"].map((item) => (
          <div key={item} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#1D9E75] flex-shrink-0" />
            <span className="text-gray-400 text-xs">{item}</span>
          </div>
        ))}
      </div>

      {/* NICHOS */}
      <section className="px-6 py-10 max-w-4xl mx-auto">
        <p className="text-gray-400 text-sm mb-4">Explore por tipo de pedido:</p>
        <div className="flex flex-wrap gap-2">
          {["Todos", ...nichos.map(n => n.title)].map((label) => (
            <span key={label} className="text-sm px-4 py-2 rounded-full border border-gray-200 text-gray-500 hover:bg-[#111] hover:text-white hover:border-[#111] cursor-pointer transition-all">{label}</span>
          ))}
        </div>
      </section>

      {/* FLUXO DE PEDIDO */}
      <section id="pedido" className="px-6 pb-16 max-w-2xl mx-auto">
        <h2 className="text-gray-900 text-xl font-medium mb-1">
          Faça seu pedido{" "}
          <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">3 passos simples</span>
        </h2>
        <p className="text-gray-400 text-sm mb-6">Preencha as informações abaixo e receba orçamentos em até 24h.</p>

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

        <div className="border border-gray-200 rounded-2xl p-6">
          {step === 0 && (
            <>
              <p className="text-gray-900 font-medium mb-1">O que você precisa produzir?</p>
              <p className="text-gray-400 text-sm mb-5">Escolha o tipo de pedido mais próximo da sua necessidade.</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {nichos.map((n) => (
                  <button key={n.id} onClick={() => setTipo(n.id)} className={`text-left border-2 rounded-xl p-4 transition-all ${tipo === n.id ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-[#1D9E75]"}`}>
                    <span className="text-2xl mb-2 block">{n.icon}</span>
                    <div className="text-sm font-medium text-gray-900">{n.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{n.sub}</div>
                  </button>
                ))}
              </div>
              <div className="flex justify-end">
                <button disabled={!tipo} onClick={() => setStep(1)} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium disabled:opacity-30 hover:opacity-85 transition-opacity">Continuar →</button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Detalhes do pedido</p>
              <p className="text-gray-400 text-sm mb-5">{tipo === "ajuste" ? "Descreva o que precisa ajustar ou consertar." : "Quanto você precisa produzir e qual o prazo?"}</p>
              {tipo !== "ajuste" && (
                <div className="mb-5">
                  <label className="text-xs text-gray-400 mb-2 block">Quantidade de peças</label>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setQty(Math.max(1, qty - 5))} className="w-9 h-9 border border-gray-200 rounded-lg text-lg flex items-center justify-center hover:bg-gray-50">−</button>
                    <span className="text-xl font-medium text-gray-900 min-w-[40px] text-center">{qty}</span>
                    <button onClick={() => setQty(qty + 5)} className="w-9 h-9 border border-gray-200 rounded-lg text-lg flex items-center justify-center hover:bg-gray-50">+</button>
                    <span className="text-sm text-gray-400">peças</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Prazo desejado</label>
                  <select value={prazo} onChange={e => setPrazo(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]">
                    <option value="">Selecione...</option>
                    <option value="urgente">Urgente (até 7 dias)</option>
                    <option value="normal">Normal (8 a 21 dias)</option>
                    <option value="sempressa">Sem pressa (21+ dias)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Estado (UF)</label>
                  <select value={estado} onChange={e => setEstado(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]">
                    <option value="">Selecione...</option>
                    {ufs.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </div>
              </div>
              <div className="mb-6">
                <label className="text-xs text-gray-400 mb-1 block">Descreva seu pedido (opcional)</label>
                <textarea rows={3} placeholder="Ex: camisa polo tamanhos P, M, G, com logo bordado..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75]" />
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(0)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button onClick={() => setStep(2)} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-85">Continuar →</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Seus dados para contato</p>
              <p className="text-gray-400 text-sm mb-5">Os fornecedores vão entrar em contato pelo WhatsApp ou e-mail.</p>
              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1 block">Nome completo</label>
                <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">WhatsApp</label>
                  <input type="tel" value={tel} onChange={e => setTel(e.target.value)} placeholder="(00) 00000-0000" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">E-mail</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]" />
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 mb-6 text-sm">
                <p className="text-xs text-gray-400 font-medium mb-3">Resumo do pedido</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-gray-600"><span>Tipo</span><span>{nichos.find(n => n.id === tipo)?.title}</span></div>
                  {tipo !== "ajuste" && <div className="flex justify-between text-gray-600"><span>Quantidade</span><span>{qty} peças</span></div>}
                  {prazo && <div className="flex justify-between text-gray-600"><span>Prazo</span><span>{prazos[prazo]}</span></div>}
                  {estado && <div className="flex justify-between text-gray-600"><span>Estado</span><span>{estado}</span></div>}
                </div>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button onClick={() => setStep(3)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors">Enviar pedido →</button>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-[#E1F5EE] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h3 className="text-gray-900 text-lg font-medium mb-2">Pedido enviado!</h3>
              <p className="text-gray-400 text-sm max-w-xs mx-auto mb-5 leading-relaxed">Os fornecedores ideais para o seu pedido já estão sendo notificados. Você receberá orçamentos em até <strong>24 horas</strong> pelo WhatsApp.</p>
              <div className="bg-[#E1F5EE] text-[#0F6E56] font-medium text-sm px-6 py-3 rounded-xl inline-block mb-4">Número do pedido: #CF-{protocolo}</div>
              <p className="text-gray-400 text-xs">Dúvidas? Ligue grátis: <strong>0800 000 0000</strong></p>
            </div>
          )}
        </div>

        <div className="mt-4 border border-gray-100 bg-gray-50 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-[#E1F5EE] rounded-full flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 11a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
            </svg>
          </div>
          <div>
            <p className="text-sm text-gray-900 font-medium">Precisa de ajuda?</p>
            <p className="text-xs text-gray-400 leading-relaxed">Nosso time está disponível pelo <strong className="text-gray-600">0800 000 0000</strong> (ligação gratuita). Te guiamos por todo o processo.</p>
          </div>
        </div>
      </section>

      {/* SEÇÃO FORNECEDORES */}
      <section className="bg-[#111] px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="bg-[#1D9E75]/20 text-[#1D9E75] text-xs font-medium px-3 py-1 rounded-full">Para fornecedores</span>
              <h2 className="text-white text-2xl md:text-3xl font-medium mt-4 mb-4 leading-tight">
                Você é confeccionista ou costureira?
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                Cadastre seu negócio no Confeccione e receba pedidos de clientes em todo o Brasil. Sem mensalidade para começar — você só paga quando fechar negócio.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  "Receba pedidos direto no seu WhatsApp",
                  "Defina seus próprios preços e prazos",
                  "Clientes verificados e pagamento garantido",
                  "Cadastro gratuito e sem burocracia",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#1D9E75]/20 flex items-center justify-center flex-shrink-0">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <span className="text-gray-300 text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setShowPopup(true)} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-medium px-8 py-4 rounded-xl text-base transition-colors">
                Quero me cadastrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: "✂️", title: "Costureiras", desc: "Ajustes, reparos e peças únicas" },
                { icon: "🏭", title: "Confecções", desc: "Produção em escala e fardamentos" },
                { icon: "🧵", title: "Facções", desc: "Terceirização de costura" },
                { icon: "👗", title: "Ateliês", desc: "Alta costura e nichos especiais" },
              ].map((item) => (
                <div key={item.title} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/10 transition-colors">
                  <span className="text-2xl mb-3 block">{item.icon}</span>
                  <p className="text-white text-sm font-medium mb-1">{item.title}</p>
                  <p className="text-gray-400 text-xs leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0a0a0a] px-6 py-8">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 60 60" fill="none">
              <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round"/>
              <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5"/>
              <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75"/>
              <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35"/>
              <circle cx="30" cy="30" r="5" fill="white"/>
            </svg>
            <span className="text-white text-sm font-medium tracking-widest">CONFECCIONE</span>
          </div>
          <p className="text-gray-600 text-xs">contato@confeccione.com.br · 0800 000 0000</p>
          <p className="text-gray-600 text-xs">© 2026 Confeccione · CNPJ 49.307.439/0001-50</p>
        </div>
      </footer>

    </main>
  );
}
