"use client";

// app/components/PedidoSteps.tsx
// Etapa 1 do pedido em FORMATO DE PASSOS (botões + barra de progresso no topo).
// Substitui o chat na home, mas grava no MESMO pipeline atual:
//   POST /api/pedido/assistente/criar  → tabela pedidos_assistente
//   → redireciona pro /visualizador/{id} (mockups, orçamento, oferta, preços).
// Coleta categoria, quantidade, prazo, UF e descrição + contato (com CEP).

import { useEffect, useState } from "react";
import SelectModal from "@/app/components/SelectModal";

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
  { id: "brindes",          icon: "🎁", title: "Brindes / Gráfica",    sub: "Canecas, crachás, copos, chaveiros" },
];
const nichosTodos = [...nichosPrincipais, ...nichosExtras];

const prazos: Record<string, string> = {
  urgente: "Urgente (até 7 dias)",
  normal: "Normal (8 a 21 dias)",
  sempressa: "Sem pressa (21+ dias)",
};
const PRAZO_DIAS: Record<string, number> = { urgente: 7, normal: 14, sempressa: 25 };

const ufs = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

export default function PedidoSteps() {
  const [step, setStep] = useState(0);
  const [tipo, setTipo] = useState("");
  const [qty, setQty] = useState(10);
  const [prazo, setPrazo] = useState("");
  const [estado, setEstado] = useState("");
  const [descricao, setDescricao] = useState("");
  const [descricaoRevisada, setDescricaoRevisada] = useState("");
  const [organizando, setOrganizando] = useState(false);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [email, setEmail] = useState("");
  const [cep, setCep] = useState("");
  const [complemento, setComplemento] = useState("");
  const [endereco, setEndereco] = useState<{ logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null } | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepMsg, setCepMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [showExtras, setShowExtras] = useState(false);

  useEffect(() => {
    if (tipo && nichosExtras.some((n) => n.id === tipo)) setShowExtras(true);
  }, [tipo]);

  function avancarParaDetalhes() {
    setErro(null);
    if (!tipo) { setErro("Escolha uma categoria pra continuar"); return; }
    setStep(1);
  }

  async function avancarParaContatos() {
    setErro(null);
    const faltando: string[] = [];
    if (!qty || qty <= 0) faltando.push("quantidade");
    if (!prazo) faltando.push("prazo");
    if (!estado) faltando.push("estado");
    if (faltando.length > 0) { setErro(`Preencha: ${faltando.join(", ")}`); return; }
    setStep(2);
    await organizarDescricao();
  }

  // Organiza a descrição com IA pra revisão. Nunca bloqueia.
  async function organizarDescricao() {
    const original = descricao;
    if (original.trim().length < 15) { setDescricaoRevisada(original); return; }
    setOrganizando(true);
    try {
      const res = await fetch("/api/pedido/organizar-descricao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: original, tipo }),
      });
      const data = await res.json().catch(() => null);
      setDescricaoRevisada((data && typeof data.descricao_organizada === "string" ? data.descricao_organizada : original) || original);
    } catch {
      setDescricaoRevisada(original);
    } finally {
      setOrganizando(false);
    }
  }

  async function buscarCep(valor: string) {
    const digs = valor.replace(/\D/g, "");
    setEndereco(null);
    setCepMsg(null);
    if (digs.length !== 8) return;
    setBuscandoCep(true);
    try {
      let end: { logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null } | null = null;
      try {
        const r = await fetch(`https://viacep.com.br/ws/${digs}/json/`, { headers: { Accept: "application/json" } });
        const j = await r.json().catch(() => null);
        if (j && !j.erro) end = { logradouro: j.logradouro || null, bairro: j.bairro || null, cidade: j.localidade || null, uf: j.uf || null };
      } catch { /* tenta fallback */ }
      if (!end) {
        try {
          const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${digs}`, { headers: { Accept: "application/json" } });
          const j = await r.json().catch(() => null);
          if (j && (j.city || j.street)) end = { logradouro: j.street || null, bairro: j.neighborhood || null, cidade: j.city || null, uf: j.state || null };
        } catch { /* sem endereço */ }
      }
      if (end) {
        setEndereco(end);
        if (end.uf) setEstado(end.uf);
        setCepMsg([end.logradouro, end.bairro, end.cidade && end.uf ? `${end.cidade}/${end.uf}` : end.cidade].filter(Boolean).join(", ") || null);
      } else {
        setCepMsg("CEP não encontrado — você pode seguir mesmo assim.");
      }
    } finally {
      setBuscandoCep(false);
    }
  }

  async function enviarPedido() {
    setErro(null);
    const faltando: string[] = [];
    if (!nome.trim()) faltando.push("nome");
    if (!tel.trim()) faltando.push("WhatsApp");
    if (!email.trim()) faltando.push("e-mail");
    if (faltando.length > 0) { setErro(`Preencha: ${faltando.join(", ")}`); return; }

    const nichoTitle = nichosTodos.find((n) => n.id === tipo)?.title ?? tipo;
    const linha = {
      modelo: nichoTitle,
      cor: "a definir",
      material: null as string | null,
      publico: null as string | null,
      total: qty,
      tamanhos: [] as { tamanho: string; qtd: number | null }[],
      estampas: [] as { posicao: string; tamanho: string }[],
      estampado: null as boolean | null,
      descricao: (descricaoRevisada || descricao).trim() || null,
    };
    const contato = {
      nome: nome.trim(),
      telefone: tel.trim(),
      email: email.trim(),
      cep: cep.replace(/\D/g, "") || null,
      complemento: complemento.trim() || null,
      logradouro: endereco?.logradouro ?? null,
      bairro: endereco?.bairro ?? null,
      cidade: endereco?.cidade ?? null,
      uf: endereco?.uf ?? (estado || null),
      prazoDias: PRAZO_DIAS[prazo] ?? null,
    };

    setEnviando(true);
    try {
      const res = await fetch("/api/pedido/assistente/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linhas: [linha], contato, observacoes: `Categoria: ${nichoTitle}` }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErro((data && data.error) || "Erro ao enviar pedido. Tente novamente.");
        setEnviando(false);
        return;
      }
      try {
        const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ event: "generate_lead", pedido_id: String(data.id), pecas: qty, value: 1, currency: "BRL" });
      } catch { /* analytics nunca quebra o fluxo */ }
      window.location.href = `/visualizador/${data.id}`;
    } catch {
      setErro("Erro de conexão. Verifique sua internet e tente de novo.");
      setEnviando(false);
    }
  }

  const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]";

  return (
    <div>
      {/* barra de progresso */}
      <div className="flex items-center mb-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 shadow-sm transition-all ${i < step ? "bg-[#1D9E75] text-white" : i === step ? "bg-[#111] text-white" : "bg-white border border-gray-300 text-gray-500"}`}>
              {i < step ? "✓" : i + 1}
            </div>
            {i < 2 && <div className={`flex-1 h-px mx-2 transition-colors ${i < step ? "bg-[#1D9E75]" : "bg-gray-200"}`} />}
          </div>
        ))}
      </div>

      <div className="bg-white shadow-sm border border-gray-200 rounded-2xl p-6 flex flex-col min-h-[560px] md:h-[620px]">
        <div className="flex-1 md:overflow-y-auto md:-mr-2 md:pr-2">
        {step === 0 && (
          <>
            <p className="text-gray-900 font-medium mb-1">O que você precisa produzir?</p>
            <p className="text-gray-400 text-sm mb-5">Escolha o tipo de pedido mais próximo da sua necessidade.</p>
            <div className="overflow-hidden mb-0">
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
                  <button type="button" onClick={() => setShowExtras(false)} className="text-xs text-gray-500 hover:text-gray-800 mb-3 inline-flex items-center gap-1">← Voltar</button>
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
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-gray-900 font-medium mb-1">Detalhes do pedido</p>
            <p className="text-gray-400 text-sm mb-5">Quanto você precisa produzir, o prazo e os detalhes.</p>
            <div className="mb-5">
              <label className="text-xs text-gray-400 mb-2 block">Quantidade de peças</label>
              <div className="flex items-center gap-3">
                <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-9 h-9 border border-gray-400 text-gray-700 rounded-lg text-lg flex items-center justify-center hover:bg-gray-100">−</button>
                <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="w-16 h-9 border border-gray-200 rounded-lg text-center text-sm font-medium text-gray-900 focus:outline-none focus:border-[#1D9E75]" />
                <button onClick={() => setQty(qty + 1)} className="w-9 h-9 border border-gray-400 text-gray-700 rounded-lg text-lg flex items-center justify-center hover:bg-gray-100">+</button>
                <span className="text-sm text-gray-400">peças</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Prazo desejado</label>
                <SelectModal
                  label="Prazo desejado"
                  placeholder="Selecione..."
                  value={prazo}
                  onChange={setPrazo}
                  triggerClassName="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm"
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
                  triggerClassName="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm"
                  options={ufs.map((uf) => ({ value: uf, label: uf }))}
                />
              </div>
            </div>
            <div className="mb-6">
              <label className="text-xs text-gray-400 mb-1 block">Descreva seu pedido (opcional)</label>
              <textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: camisa polo P, M, G com logo bordado no peito..." className={inputCls + " resize-none"} />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-gray-900 font-medium mb-1">Contato</p>
            <p className="text-gray-400 text-sm mb-5">Vamos montar seus mockups e o orçamento — você acompanha tudo no visualizador.</p>
            <div className="mb-4">
              <label className="text-xs text-gray-400 mb-1 block">Nome completo</label>
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">WhatsApp</label>
                <input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="(00) 00000-0000" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">E-mail</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">CEP de entrega (recomendado)</label>
                <input type="text" inputMode="numeric" value={cep} onChange={(e) => setCep(e.target.value)} onBlur={(e) => void buscarCep(e.target.value)} placeholder="00000-000" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Número / complemento</label>
                <input type="text" value={complemento} onChange={(e) => setComplemento(e.target.value)} placeholder="Ex: 123, apto 4" className={inputCls} />
              </div>
            </div>
            {(buscandoCep || cepMsg) && (
              <p className="text-xs text-gray-500 mb-6">{buscandoCep ? "Buscando endereço…" : cepMsg}</p>
            )}

            <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
              <p className="text-xs text-gray-400 font-medium mb-3">Resumo do pedido</p>
              <div className="space-y-2">
                <div className="flex justify-between text-gray-600"><span>Categoria</span><span>{nichosTodos.find((n) => n.id === tipo)?.title}</span></div>
                <div className="flex justify-between text-gray-600"><span>Quantidade</span><span>{qty} peças</span></div>
                {prazo && <div className="flex justify-between text-gray-600"><span>Prazo</span><span>{prazos[prazo]}</span></div>}
                {estado && <div className="flex justify-between text-gray-600"><span>Estado</span><span>{estado}</span></div>}
              </div>
            </div>
            <div className="mb-6">
              <label className="text-xs text-gray-400 mb-1 block">Detalhes do pedido (revise e ajuste se quiser)</label>
              {organizando ? (
                <div className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-400 bg-gray-50">Organizando os detalhes…</div>
              ) : (
                <textarea rows={4} value={descricaoRevisada} onChange={(e) => setDescricaoRevisada(e.target.value)} placeholder="Ex: camisa polo P, M, G com logo bordado..." className={inputCls + " resize-none"} />
              )}
            </div>
          </>
        )}
        </div>

        <div className="pt-4 mt-2 border-t border-gray-100">
          {erro && <div className="mb-2 text-red-600 text-sm text-right">{erro}</div>}
          <div className="flex justify-between items-center">
            {step > 0 ? (
              <button onClick={() => setStep(step - 1)} className="border border-gray-200 text-gray-400 px-5 py-3 rounded-xl text-sm hover:bg-gray-50 whitespace-nowrap">← Voltar</button>
            ) : <span />}
            {step === 0 && (
              <button onClick={avancarParaDetalhes} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-85 whitespace-nowrap">Continuar →</button>
            )}
            {step === 1 && (
              <button onClick={() => void avancarParaContatos()} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium hover:opacity-85 whitespace-nowrap">Continuar →</button>
            )}
            {step === 2 && (
              <button onClick={() => void enviarPedido()} disabled={enviando} className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors whitespace-nowrap">
                {enviando ? "Gerando…" : "Continuar →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
