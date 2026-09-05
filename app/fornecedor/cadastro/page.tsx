"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import SelectModal from "@/app/components/SelectModal";
import { formatarCpfCnpj, validarCpfCnpj, apenasDigitos } from "@/app/lib/cpf-cnpj";
import { PECAS_PRINCIPAIS, PECAS_EXTRAS } from "@/app/lib/pecas";

// PEÇAS, não categorias (05/09/2026). O fornecedor descreve o que faz do jeito
// dele — "produzimos vestidos, camisas, blusas, top, calças e saias" — e é a
// mesma lista que o cliente escolhe na home. Vocabulário único nas duas pontas;
// é o que permite refinar o match. Ver app/lib/pecas.ts.
const tiposProdutoPrincipais = PECAS_PRINCIPAIS.map((p) => ({ id: p.id, icon: p.icon, title: p.label, sub: p.sub }));
const tiposProdutoExtras = PECAS_EXTRAS.map((p) => ({ id: p.id, icon: p.icon, title: p.label, sub: p.sub }));

const ufs = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

export default function CadastroFornecedor() {
  const [step, setStep]               = useState(0);
  const [nome, setNome]               = useState("");
  const [whatsapp, setWhatsapp]       = useState("");
  const [email, setEmail]             = useState("");
  const [tiposSel, setTiposSel]       = useState<string[]>([]);
  const [descricao, setDescricao]     = useState("");
  const [pedidoMinimo, setPedidoMinimo] = useState<number>(1);
  const [estado, setEstado]           = useState("");
  const [cidade, setCidade]           = useState("");
  const [raio, setRaio]               = useState("");
  const [cpfCnpj, setCpfCnpj]         = useState("");
  const [cpfCnpjErro, setCpfCnpjErro] = useState<string | null>(null);
  const [enviando, setEnviando]       = useState(false);
  const [erroEnvio, setErroEnvio]     = useState<string | null>(null);
  const [showExtras, setShowExtras]   = useState(false);
  // Texto livre pro que não está no catálogo. O catálogo é a nossa aposta sobre
  // o mercado; sem campo aberto, a confecção que faz algo fora dele marca a
  // peça mais ou menos parecida (e passa a receber pedido errado) ou não marca
  // nada. Aqui a lacuna vira dado em /admin/pecas-faltando.
  const [pecasOutro, setPecasOutro]   = useState("");

  function toggleTipo(id: string) {
    setTiposSel(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  }

  function handleCpfCnpjChange(valor: string) {
    setCpfCnpj(formatarCpfCnpj(valor));
    setCpfCnpjErro(null);
  }

  function validarCpfCnpjOnBlur() {
    const digitos = apenasDigitos(cpfCnpj);
    if (digitos.length === 0) {
      setCpfCnpjErro(null);
      return;
    }
    const r = validarCpfCnpj(cpfCnpj);
    setCpfCnpjErro(r.valido ? null : (r.erro ?? "Documento inválido"));
  }

  useEffect(() => {
    if (tiposSel.some(id => tiposProdutoExtras.some(t => t.id === id))) {
      setShowExtras(true);
    }
  }, [tiposSel]);

  const step1Valid = nome.trim().length > 0 && whatsapp.replace(/\D/g, "").length >= 10 && email.includes("@");
  const step2Valid = (tiposSel.length > 0 || pecasOutro.trim().length > 0) && pedidoMinimo >= 1;
  const step3Valid =
    estado !== "" &&
    raio !== "" &&
    validarCpfCnpj(cpfCnpj).valido;

  // 26/08/2026 — ANTES, esta função avançava pro passo 3 ("Cadastro feito!")
  // acontecesse o que acontecesse: não olhava `res.ok` e o catch só fazia
  // console.error. CPF recusado pela API, erro 500 ou queda de sinal no
  // celular e a pessoa via o check verde, fechava a aba e nunca se cadastrou
  // — descobria semanas depois, quando nenhum pedido chegou.
  async function enviar() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      const res = await fetch("/api/fornecedor/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          whatsapp,
          email,
          // `pecas` é o dado novo; `tipos_produto` vai junto, derivado, pra
          // este cadastro continuar visível pro matching antigo enquanto a
          // migração não termina.
          pecas: tiposSel,
          pecas_outro: pecasOutro,
          descricao_livre: descricao,
          pedido_minimo: pedidoMinimo,
          estado,
          cidade,
          raio_atendimento: raio,
          cpf_cnpj: apenasDigitos(cpfCnpj),
        }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok || dados?.error) {
        setErroEnvio(
          dados?.error ??
            `Não conseguimos concluir o cadastro (erro ${res.status}). Confira os dados e tente de novo.`
        );
        return;
      }
      setStep(3);
    } catch {
      setErroEnvio(
        "Sem conexão com o servidor. Seus dados continuam preenchidos aqui — tente de novo em instantes."
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="min-h-screen bg-white font-sans">
      <SiteHeader />

      <section className="px-6 pt-10 pb-16 max-w-2xl mx-auto">
        <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3 mb-1">
          <h1 className="text-gray-900 text-xl font-medium">Cadastre sua confecção, facção ou ateliê e receba pedidos</h1>
          <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">3 passos simples</span>
        </div>
        <p className="text-gray-500 text-sm mb-6">Gratuito e sem burocracia. Comece a receber pedidos hoje.</p>

        {step < 3 && (
          <div className="flex items-center mb-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 transition-all ${i < step ? "bg-[#1D9E75] text-white" : i === step ? "bg-[#111] text-white" : "bg-gray-100 text-gray-500"}`}>
                  {i < step ? "✓" : i + 1}
                </div>
                {i < 2 && <div className={`flex-1 h-px mx-2 transition-colors ${i < step ? "bg-[#1D9E75]" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        )}

        <div className="border border-gray-200 rounded-2xl p-6 shadow-sm">

          {step === 0 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Sobre você ou sua empresa</p>
              <p className="text-gray-500 text-sm mb-5">Seus dados de contato para receber os pedidos.</p>
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Nome completo ou nome da empresa</label>
                <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome ou razão social" className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20" />
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">WhatsApp com DDD</label>
                  <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(00) 00000-0000" className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">E-mail</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20" />
                </div>
              </div>
              <div className="flex justify-end">
                <button disabled={!step1Valid} onClick={() => setStep(1)} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed enabled:hover:opacity-85">Continuar →</button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Sua produção</p>
              <p className="text-gray-500 text-sm mb-5">Conte o que você faz para receber pedidos compatíveis.</p>

              <div className="mb-5">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Tipos de produto que você confecciona <span className="text-red-400">*</span></label>
                <div className="overflow-hidden">
                  <div className={`flex transition-transform duration-300 ease-out ${showExtras ? "-translate-x-full" : "translate-x-0"}`}>
                    <div className="flex-shrink-0 w-full">
                      <div className="grid grid-cols-2 gap-3">
                        {tiposProdutoPrincipais.map((t) => (
                          <button key={t.id} type="button" onClick={() => toggleTipo(t.id)} className={`text-left border-2 rounded-xl p-4 transition-all ${tiposSel.includes(t.id) ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-300 hover:border-[#1D9E75]"}`}>
                            <span className="text-2xl mb-2 block" aria-hidden="true">{t.icon}</span>
                            <div className="text-sm font-medium text-gray-900">{t.title}</div>
                            <div className="text-xs text-gray-500 mt-1">{t.sub}</div>
                          </button>
                        ))}
                        <button type="button" onClick={() => setShowExtras(true)} className="text-left border-2 border-gray-300 hover:border-[#1D9E75] rounded-xl p-4 transition-all">
                          <span className="text-2xl mb-2 block">➕</span>
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-medium text-gray-900">Outros</div>
                              <div className="text-xs text-gray-500 mt-1">Mais categorias</div>
                            </div>
                            <span className="text-gray-500 text-lg shrink-0">›</span>
                          </div>
                        </button>
                      </div>
                    </div>
                    <div className="flex-shrink-0 w-full">
                      <button type="button" onClick={() => setShowExtras(false)} className="text-xs text-gray-500 hover:text-gray-800 mb-3 inline-flex items-center gap-1">
                        ← Voltar
                      </button>
                      <div className="grid grid-cols-2 gap-3">
                        {tiposProdutoExtras.map((t) => (
                          <button key={t.id} type="button" onClick={() => toggleTipo(t.id)} className={`text-left border-2 rounded-xl p-4 transition-all ${tiposSel.includes(t.id) ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-300 hover:border-[#1D9E75]"}`}>
                            <span className="text-2xl mb-2 block" aria-hidden="true">{t.icon}</span>
                            <div className="text-sm font-medium text-gray-900">{t.title}</div>
                            <div className="text-xs text-gray-500 mt-1">{t.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-5">
                <label htmlFor="pecas-outro" className="text-sm font-medium text-gray-700 mb-1 block">
                  Produz alguma peça que não está na lista?
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Escreva do seu jeito. A gente lê tudo — é assim que peça nova entra na lista.
                </p>
                <textarea
                  id="pecas-outro"
                  rows={2}
                  maxLength={300}
                  value={pecasOutro}
                  onChange={e => setPecasOutro(e.target.value.slice(0, 300))}
                  placeholder="Ex.: capa de almofada, toalha de mesa sob medida, cortina…"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
                />
              </div>

              <div className="mb-5">
                <label className="text-sm font-medium text-gray-700 mb-1 block">Descrição livre (opcional)</label>
                <textarea rows={3} value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Conte mais sobre sua produção (especialidades, estilo, experiência)" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-800 resize-none focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20" />
              </div>

              <div className="mb-5">
                <label className="text-sm font-medium text-gray-900 mb-1 block">Qual seu pedido mínimo? <span className="text-red-400">*</span></label>
                <p className="text-xs text-gray-500 mb-3">Quantidade mínima de peças que você aceita produzir por pedido.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPedidoMinimo(Math.max(1, pedidoMinimo - 1))}
                    className="w-9 h-9 bg-[#F5F5F7] text-gray-700 rounded-full text-lg font-light flex items-center justify-center hover:bg-[#EBEBED] active:bg-[#E0E0E3] transition-colors"
                    aria-label="Diminuir"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={pedidoMinimo}
                    onChange={e => setPedidoMinimo(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-14 h-9 bg-[#F5F5F7] rounded-lg text-center text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPedidoMinimo(pedidoMinimo + 1)}
                    className="w-9 h-9 bg-[#F5F5F7] text-gray-700 rounded-full text-lg font-light flex items-center justify-center hover:bg-[#EBEBED] active:bg-[#E0E0E3] transition-colors"
                    aria-label="Aumentar"
                  >
                    +
                  </button>
                  <span className="text-sm text-gray-500 ml-2">peças</span>
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(0)} className="border border-gray-300 text-gray-600 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button disabled={!step2Valid} onClick={() => setStep(2)} className="bg-[#111] text-white px-6 py-3 rounded-xl text-sm font-medium disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed enabled:hover:opacity-85">Continuar →</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-gray-900 font-medium mb-1">Onde você atende</p>
              <p className="text-gray-500 text-sm mb-5">Informe sua localização para receber pedidos da sua área.</p>

              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Estado (UF) <span className="text-red-400">*</span></label>
                  <SelectModal
                    label="Estado (UF)"
                    placeholder="Selecione..."
                    value={estado}
                    onChange={setEstado}
                    options={ufs.map(uf => ({ value: uf, label: uf }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Cidade (opcional)</label>
                  <input type="text" value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Ex: Recife" className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20" />
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Raio de atendimento <span className="text-red-400">*</span></label>
                <div className="space-y-2">
                  {[
                    { value: "estado",   label: "Só meu estado" },
                    { value: "regiao",   label: "Minha região" },
                    { value: "nacional", label: "Brasil todo" },
                  ].map((op) => (
                    <label key={op.value} className={`flex items-center gap-3 border-2 rounded-xl px-4 py-3 cursor-pointer transition-all ${raio === op.value ? "border-[#1D9E75] bg-[#E1F5EE]" : "border-gray-300 hover:border-gray-400"}`}>
                      <input type="radio" name="raio" value={op.value} checked={raio === op.value} onChange={() => setRaio(op.value)} className="accent-[#1D9E75]" />
                      <span className="text-sm text-gray-800">{op.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm font-medium text-gray-700 mb-1 block">
                  CPF ou CNPJ <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cpfCnpj}
                  onChange={(e) => handleCpfCnpjChange(e.target.value)}
                  onBlur={validarCpfCnpjOnBlur}
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  maxLength={18}
                  className={`w-full border rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none ${
                    cpfCnpjErro
                      ? "border-red-300 focus:border-red-400"
                      : "border-gray-300 focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/20"
                  }`}
                />
                {cpfCnpjErro && (
                  <p className="text-xs text-red-500 mt-1">{cpfCnpjErro}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Usado para o repasse do seu pagamento e a emissão fiscal. Não é exibido publicamente.
                </p>
              </div>

              {erroEnvio && (
                <div role="alert" className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  {erroEnvio}
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="border border-gray-300 text-gray-600 px-5 py-3 rounded-xl text-sm hover:bg-gray-50">← Voltar</button>
                <button disabled={!step3Valid || enviando} onClick={enviar} className="bg-[#1D9E75] enabled:hover:bg-[#0F6E56] disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors">
                  {enviando ? "Enviando..." : "Concluir cadastro →"}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-gray-400 text-center">Ao continuar, você concorda com os <a href="/termos" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">Política de Privacidade</a>.</p>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-[#E1F5EE] rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h3 className="text-gray-900 text-lg font-medium mb-2">Cadastro enviado!</h3>
              {/* O cadastro entra como `pendente` e o matching só distribui pedido
                  pra quem está `aprovado`. Prometer "em breve enviaremos pedidos"
                  fazia a pessoa esperar por algo que ainda depende de análise —
                  e o WhatsApp que a API dispara já dizia "em análise", em
                  contradição com esta tela. */}
              <p className="text-gray-500 text-sm max-w-xs mx-auto mb-6 leading-relaxed">
                Seu perfil vai passar por uma análise rápida da nossa equipe. Assim que for aprovado, você recebe um aviso no WhatsApp e começa a receber pedidos que batem com o que você produz.
              </p>
              <Link href="/" className="inline-block bg-[#111] hover:opacity-85 text-white font-medium px-6 py-3 rounded-xl text-sm transition-opacity">Voltar pro site</Link>
            </div>
          )}

        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
