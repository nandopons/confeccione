"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import SelectModal from "@/app/components/SelectModal";
import { WHATSAPP_SUPORTE, linkWhatsAppSuporte } from "@/app/lib/contatos";

const nichosPrincipais = [
  { id: "interclasse",   icon: "👕", title: "Interclasse / Evento", sub: "Camisas e uniformes em grupo" },
  { id: "private_label", icon: "✂️", title: "Private Label",        sub: "Marca própria e coleções" },
  { id: "fitness",       icon: "💪", title: "Fitness",              sub: "Academia, corrida, yoga" },
  { id: "moda_praia",    icon: "🏖️", title: "Moda Praia",           sub: "Biquínis, sungas, saídas de praia" },
  { id: "moda_intima",   icon: "🩱", title: "Moda Íntima",          sub: "Lingerie, pijamas, sleepwear" },
];

const nichosExtras = [
  { id: "padrao_esportivo", icon: "⚽", title: "Padrão Esportivo",     sub: "Futebol, vôlei, com nome nas costas" },
  { id: "fardamento",       icon: "🏢", title: "Fardamento",           sub: "Uniformes corporativos" },
  { id: "inverno",          icon: "🧥", title: "Inverno",              sub: "Casacos, jaquetas, moletons" },
  { id: "roupas_uv",        icon: "☀️", title: "Roupas UV",            sub: "Proteção solar, esportes ao ar livre" },
  { id: "bones",            icon: "🧢", title: "Bonés",                sub: "Bonés bordados, customizados" },
  { id: "bolsas",           icon: "👜", title: "Bolsas e Acessórios",  sub: "Mochilas, ecobags, acessórios" },
];

const nichosTodos = [...nichosPrincipais, ...nichosExtras];

// Quantidade mínima ideal por categoria — usada pra dar dica ao cliente no formulário.
// Não é restrição: cliente pode pedir abaixo, mas vai ter menos fornecedores compatíveis.
const quantidadesMinimas: Record<string, number> = {
  interclasse:      20,
  private_label:    20,
  fitness:          20,
  moda_praia:       20,
  moda_intima:      20,
  padrao_esportivo: 20,
  fardamento:       20,
  inverno:          20,
  roupas_uv:        20,
  bones:            20,
  bolsas:           20,
};

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
  const [descricao, setDescricao] = useState("");
  const [protocolo] = useState(() => Math.floor(Math.random() * 90000) + 10000);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [showExtras, setShowExtras] = useState(false);
  const leadEnviado = useRef(false);

  const ufs = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

  useEffect(() => {
    if (tipo && nichosExtras.some(n => n.id === tipo)) {
      setShowExtras(true);
    }
  }, [tipo]);

  useEffect(() => {
    if (step !== 3) return;
    if (leadEnviado.current) return;
    if (typeof window === "undefined") return;
    leadEnviado.current = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "generate_lead",
      pedido_id: `CF-${protocolo}`,
      pedido_tipo: tipo,
      quantidade: qty,
      estado,
      value: 1,
      currency: "BRL",
    });
  }, [step, protocolo, tipo, qty, estado]);

  function avancarParaDetalhes() {
    setErroEnvio(null);
    if (!tipo || tipo.trim() === '') {
      setErroEnvio('Escolha uma categoria pra continuar');
      return;
    }
    setStep(1);
  }

  function avancarParaContatos() {
    setErroEnvio(null);
    const faltando: string[] = [];
    if (!qty || qty <= 0) faltando.push('quantidade');
    if (!prazo || prazo.trim() === '') faltando.push('prazo');
    if (!estado || estado.trim() === '') faltando.push('estado');
    if (faltando.length > 0) {
      setErroEnvio(`Preencha: ${faltando.join(', ')}`);
      return;
    }
    setStep(2);
  }

  async function enviarPedido() {
    setErroEnvio(null);

    const campos: { campo: string; valor: unknown; label: string }[] = [
      { campo: 'tipo', valor: tipo, label: 'tipo de peça' },
      { campo: 'qty', valor: qty, label: 'quantidade' },
      { campo: 'prazo', valor: prazo, label: 'prazo' },
      { campo: 'estado', valor: estado, label: 'estado' },
      { campo: 'nome', valor: nome, label: 'nome' },
      { campo: 'tel', valor: tel, label: 'WhatsApp' },
      { campo: 'email', valor: email, label: 'e-mail' },
    ];
    const faltando = campos.filter(c =>
      c.valor === undefined || c.valor === null ||
      (typeof c.valor === 'string' && c.valor.trim() === '') ||
      (typeof c.valor === 'number' && c.valor <= 0)
    );
    if (faltando.length > 0) {
      setErroEnvio(`Preencha: ${faltando.map(f => f.label).join(', ')}`);
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/pedidos/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          quantidade: qty,
          prazo,
          estado,
          nome,
          whatsapp: tel,
          email,
          descricao,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
        setErroEnvio(body.error || 'Erro ao enviar pedido. Tente novamente.');
        setEnviando(false);
        return;
      }
      setEnviando(false);
      setStep(3);
    } catch (e) {
      console.error(e);
      setErroEnvio('Erro de conexão. Verifique sua internet e tente de novo.');
      setEnviando(false);
    }
  }

  return (
    <main className="min-h-screen bg-white font-sans">

      <SiteHeader />

      <section className="bg-[#111] px-6 py-16 text-center">
        <h1 className="text-white text-2xl md:text-4xl font-medium leading-tight mb-4">Conectamos você às melhores<br />confecções e costureiras do Brasil</h1>
        <p className="text-gray-400 text-base max-w-xl mx-auto mb-8 leading-relaxed">Faça seu pedido em minutos. Receba orçamentos de fornecedores verificados. Produza com confiança.</p>
        <button onClick={() => document.getElementById("pedido")?.scrollIntoView({ behavior: "smooth" })} className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-medium px-8 py-4 rounded-xl text-base transition-colors">Fazer meu pedido agora</button>
        <div className="mt-4 text-center">
          <Link
            href="/cliente/login"
            className="text-sm text-gray-300 hover:text-white underline underline-offset-4 transition-colors"
          >
            Já fez pedido? Acompanhar meu pedido
          </Link>
        </div>
      </section>

      <div className="bg-[#1a1a1a] px-6 py-3 flex flex-wrap items-center justify-center gap-6">
        {["Fornecedores verificados", "Pagamento seguro", "Atendimento humano no WhatsApp", "Todo o Brasil"].map((item) => (
          <div key={item} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#1D9E75] flex-shrink-0" />
            <span className="text-gray-400 text-xs">{item}</span>
          </div>
        ))}
      </div>

      <section id="pedido" className="px-6 pt-12 pb-16 max-w-2xl mx-auto scroll-mt-20">
        <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3 mb-1">
          <h2 className="text-gray-900 text-xl font-medium">Faça seu pedido</h2>
          <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">3 passos simples</span>
        </div>
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
              <div className="overflow-hidden mb-6">
                <div className={`flex transition-transform duration-300 ease-out ${showExtras ? "-translate-x-full" : "translate-x-0"}`}>
                  <div className="flex-shrink-0 w-full">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      {nichosPrincipais.map((n) => (
                        <button key={n.id} onClick={() => setTipo(n.id)} className={`text-left border-2 rounded-xl p-3 sm:p-4 flex items-center sm:flex-col sm:items-start gap-3 sm:gap-0 transition-all ${tipo === n.id ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-[#1D9E75]"}`}>
                          <span className="text-2xl shrink-0 sm:mb-2">{n.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 leading-tight">{n.title}</div>
                            <div className="text-xs text-gray-400 mt-0.5 leading-snug">{n.sub}</div>
                          </div>
                        </button>
                      ))}
                      <button type="button" onClick={() => setShowExtras(true)} className="text-left border-2 border-gray-200 hover:border-[#1D9E75] rounded-xl p-3 sm:p-4 flex items-center sm:flex-col sm:items-start gap-3 sm:gap-0 transition-all">
                        <span className="text-2xl shrink-0 sm:mb-2">➕</span>
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-gray-900 leading-tight">Outros</div>
                            <div className="text-xs text-gray-400 mt-0.5 leading-snug">Mais categorias</div>
                          </div>
                          <span className="text-gray-400 text-lg shrink-0">›</span>
                        </div>
                      </button>
                    </div>
                  </div>
                  <div className="flex-shrink-0 w-full">
                    <button type="button" onClick={() => setShowExtras(false)} className="text-xs text-gray-500 hover:text-gray-800 mb-3 inline-flex items-center gap-1">
                      ← Voltar
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      {nichosExtras.map((n) => (
                        <button key={n.id} onClick={() => setTipo(n.id)} className={`text-left border-2 rounded-xl p-3 sm:p-4 flex items-center sm:flex-col sm:items-start gap-3 sm:gap-0 transition-all ${tipo === n.id ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-200 hover:border-[#1D9E75]"}`}>
                          <span className="text-2xl shrink-0 sm:mb-2">{n.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 leading-tight">{n.title}</div>
                            <div className="text-xs text-gray-400 mt-0.5 leading-snug">{n.sub}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={avancarParaDetalhes} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-85">Continuar →</button>
              </div>
              {erroEnvio && (
                <div className="mt-3 text-red-600 text-sm text-right">
                  {erroEnvio}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Detalhes do pedido</p>
              <p className="text-gray-400 text-sm mb-5">Quanto você precisa produzir e qual o prazo?</p>
              <div className="mb-5">
                <label className="text-xs text-gray-400 mb-2 block">Quantidade de peças</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-9 h-9 border border-gray-400 text-gray-700 rounded-lg text-lg flex items-center justify-center hover:bg-gray-100">−</button>
                  <input type="number" min={1} step={1} value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="w-14 h-9 border border-gray-200 rounded-lg text-center text-sm font-medium text-gray-900 focus:outline-none focus:border-[#1D9E75]" />
                  <button onClick={() => setQty(qty + 1)} className="w-9 h-9 border border-gray-400 text-gray-700 rounded-lg text-lg flex items-center justify-center hover:bg-gray-100">+</button>
                  <span className="text-sm text-gray-400">peças</span>
                </div>
                {tipo && quantidadesMinimas[tipo] !== undefined && (() => {
                  const minimo = quantidadesMinimas[tipo];
                  const nicho = nichosTodos.find(n => n.id === tipo);
                  const nome = nicho?.title ?? tipo;
                  const atingiu = qty >= minimo;
                  const classes = atingiu
                    ? "bg-green-50 border-l-2 border-green-500 text-green-800"
                    : "bg-blue-50 border-l-2 border-blue-400 text-blue-800";
                  const mensagem = atingiu
                    ? `✓ Quantidade ideal para ${nome} — você terá mais opções de fornecedor.`
                    : `Para ${nome}, ${minimo} peças é o ideal para ter mais opções de fornecedor e melhores preços.`;
                  return (
                    <div className={`mt-3 px-3 py-2 rounded-md text-xs leading-relaxed ${classes}`}>
                      {mensagem}
                    </div>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Prazo desejado</label>
                  <SelectModal
                    label="Prazo desejado"
                    placeholder="Selecione..."
                    value={prazo}
                    onChange={setPrazo}
                    triggerClassName="border border-gray-200 rounded-xl px-3 py-2 bg-white"
                    options={Object.entries(prazos).map(([value, label]) => ({ value, label }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Estado (UF)</label>
                  <SelectModal
                    label="Estado (UF)"
                    placeholder="Selecione..."
                    value={estado}
                    onChange={setEstado}
                    triggerClassName="border border-gray-200 rounded-xl px-3 py-2 bg-white"
                    options={ufs.map(uf => ({ value: uf, label: uf }))}
                  />
                </div>
              </div>
              <div className="mb-6">
                <label className="text-xs text-gray-400 mb-1 block">Descreva seu pedido (opcional)</label>
                <textarea rows={3} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: camisa polo tamanhos P, M, G, com logo bordado..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75]" />
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(0)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button onClick={avancarParaContatos} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-85">Continuar →</button>
              </div>
              {erroEnvio && (
                <div className="mt-3 text-red-600 text-sm text-right">
                  {erroEnvio}
                </div>
              )}
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
                  <div className="flex justify-between text-gray-600"><span>Tipo</span><span>{nichosTodos.find(n => n.id === tipo)?.title}</span></div>
                  <div className="flex justify-between text-gray-600"><span>Quantidade</span><span>{qty} peças</span></div>
                  {prazo && <div className="flex justify-between text-gray-600"><span>Prazo</span><span>{prazos[prazo]}</span></div>}
                  {estado && <div className="flex justify-between text-gray-600"><span>Estado</span><span>{estado}</span></div>}
                </div>
              </div>
              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button onClick={enviarPedido} disabled={enviando} className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors">
                  {enviando ? "Enviando..." : "Enviar pedido →"}
                </button>
              </div>
              {erroEnvio && (
                <div className="mt-3 text-red-600 text-sm text-right">
                  {erroEnvio}
                </div>
              )}
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

              <div className="mt-6 bg-gray-50 border border-gray-200 rounded-2xl p-5 max-w-sm mx-auto">
                <p className="text-sm text-gray-700 mb-3">
                  ✨ Acompanhe seu pedido em tempo real e organize tudo num só lugar
                </p>
                <a
                  href={`/cliente/login?email=${encodeURIComponent(email)}`}
                  className="inline-block px-5 py-2.5 rounded-md bg-[#1D9E75] text-white text-sm font-medium hover:bg-[#178761]"
                >
                  Criar conta grátis →
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 border border-gray-100 bg-gray-50 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-[#E1F5EE] rounded-full flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#0F6E56" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </div>
          <div>
            <p className="text-sm text-gray-900 font-medium">Precisa de ajuda?</p>
            <p className="text-xs text-gray-400 leading-relaxed">Nosso time atende pelo WhatsApp{" "}<a href={linkWhatsAppSuporte("Olá! Estou com uma dúvida no pedido")} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0F6E56] hover:underline">(81) 99578-2077</a>. Chame a qualquer momento que a gente te guia pelo processo.</p>
          </div>
        </div>
      </section>

      <section className="bg-[#111] px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="bg-[#1D9E75]/20 text-[#1D9E75] text-xs font-medium px-3 py-1 rounded-full">Para fornecedores</span>
              <h2 className="text-white text-2xl md:text-3xl font-medium mt-4 mb-4 leading-tight">Você é confeccionista ou costureira?</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">Cadastre seu negócio no Confeccione e receba pedidos de clientes em todo o Brasil. Sem mensalidade para começar.</p>
              <div className="space-y-3 mb-8">
                {["Receba pedidos direto no seu WhatsApp","Defina seus próprios preços e prazos","Clientes verificados e pagamento garantido","Cadastro gratuito e sem burocracia"].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#1D9E75]/20 flex items-center justify-center flex-shrink-0">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <span className="text-gray-300 text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Link href="/fornecedor/cadastro" className="inline-block bg-[#1D9E75] hover:bg-[#0F6E56] text-white font-medium px-8 py-4 rounded-xl text-base transition-colors">Quero me cadastrar</Link>
              <div className="mt-3 text-sm">
                <Link href="/fornecedor/entrar" className="text-gray-400 hover:text-white transition-colors">
                  Já sou fornecedor, entrar →
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[{icon:"✂️",title:"Costureiras",desc:"Ajustes, reparos e peças únicas"},{icon:"🏭",title:"Confecções",desc:"Produção em escala e fardamentos"},{icon:"🧵",title:"Facções",desc:"Terceirização de costura"},{icon:"👗",title:"Ateliês",desc:"Alta costura e nichos especiais"}].map((item) => (
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
          <p className="text-gray-600 text-xs">
            <a href="mailto:contato@confeccione.com.br" className="hover:text-gray-400 transition-colors">contato@confeccione.com.br</a>
            {" · "}
            <a href={`https://wa.me/${WHATSAPP_SUPORTE}`} target="_blank" rel="noopener noreferrer" className="hover:text-gray-400 transition-colors">(81) 99578-2077</a>
            {" · "}
            <Link href="/fornecedor/entrar" className="hover:text-gray-400 transition-colors">Área do fornecedor</Link>
          </p>
          <p className="text-gray-600 text-xs">© 2026 Confeccione · CNPJ 49.307.439/0001-50</p>
        </div>
      </footer>

    </main>
  );
}
