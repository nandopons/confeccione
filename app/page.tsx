"use client";
import Link from "next/link";
import Image from "next/image";
import SiteHeader from "@/app/components/SiteHeader";
import SiteFooter from "@/app/components/SiteFooter";
import PortoDigitalBadge from "@/app/components/PortoDigitalBadge";
import PedidoSteps from "@/app/components/PedidoSteps";
import { linkWhatsAppSuporte, WHATSAPP_SUPORTE_FORMATADO } from "@/app/lib/contatos";

export default function Home() {
  return (
    <main className="min-h-screen bg-white font-sans">

      <section className="relative h-[58vh] min-h-[480px] md:h-[72vh] md:min-h-[520px] overflow-hidden bg-[#0a0a0a]">
        {/* Foto em tela cheia (desktop e mobile) */}
        <div className="absolute inset-0 z-0">
          <Image
            src="/hero/hero-estampa.jpg"
            alt="Camiseta estampada em destaque numa arara de camisetas — confecção e estamparia"
            fill
            preload
            quality={85}
            sizes="100vw"
            className="object-contain object-center md:object-right"
          />
        </div>

        {/* Máscara desktop: degradê leve só para legibilidade do texto, sem bloco preto */}
        <div
          className="hidden md:block absolute inset-0 z-[1]"
          style={{
            background: [
              // horizontal: preto sólido à esquerda (texto) dissolvendo a borda da foto
              "linear-gradient(90deg, #0a0a0a 0%, rgba(10,10,10,0.96) 26%, rgba(10,10,10,0.6) 42%, rgba(10,10,10,0.22) 56%, rgba(10,10,10,0) 72%)",
              // topo: leve escurecimento e fade da borda superior da foto
              "linear-gradient(180deg, rgba(10,10,10,0.5) 0%, rgba(10,10,10,0) 18%)",
              // base: dissolve a foto no preto da seção seguinte
              "linear-gradient(180deg, rgba(10,10,10,0) 80%, #0a0a0a 100%)",
            ].join(", "),
          }}
        />
        {/* Mobile: foto ao fundo + escurecimento forte para legibilidade */}
        <div className="md:hidden absolute inset-0 z-[1] bg-[rgba(10,10,10,0.6)]" />

        <SiteHeader transparent />

        <div
          className="relative z-10 h-full flex items-center pt-20 md:pt-0 px-8 md:px-16 lg:px-20"
          style={{ fontFamily: "var(--font-manrope)" }}
        >
          <div className="max-w-[520px]">
            <h1 className="text-white font-semibold text-2xl md:text-3xl lg:text-4xl leading-[1.1] tracking-tight">
              Conectamos você às <span className="text-[#2DD4A7]">melhores confecções e costureiras</span> do Brasil
            </h1>
            <p className="font-light text-sm md:text-base text-gray-300 max-w-md mt-4 leading-relaxed">
              Faça seu pedido em minutos. A gente gera os mockups, monta o orçamento e acha os fornecedores certos.
            </p>
            <div className="mt-7 flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-6">
              <button
                onClick={() => {
                  const el = document.getElementById("pedido");
                  if (!el) return;
                  const isMobile = window.innerWidth < 768;
                  const vh = window.innerHeight;
                  const offset = isMobile ? -Math.round(vh * 0.02) : -80 + Math.round(vh * 0.07);
                  const y = el.getBoundingClientRect().top + window.scrollY - offset;
                  window.scrollTo({ top: y, behavior: "smooth" });
                }}
                className="bg-[#1D9E75] hover:bg-[#178a64] text-white px-5 md:px-6 py-2.5 rounded text-sm font-medium whitespace-nowrap transition-colors"
              >
                Fazer meu pedido →
              </button>
              <Link
                href="/cliente/login"
                className="text-xs text-gray-300 hover:text-gray-100 underline underline-offset-4 whitespace-nowrap transition-colors"
              >
                Já fez pedido? Acompanhar
              </Link>
            </div>
          </div>
        </div>

        {/* Selo institucional sutil — só texto, sem o ícone azul (regra de marca) */}
        <div className="absolute bottom-6 right-8 z-10 text-right opacity-80 md:hidden">
          <div className="text-white text-xs font-medium">Empresa embarcada</div>
          <div className="text-gray-400 text-[10px]">no Porto Digital</div>
        </div>
      </section>

      <section className="bg-[#0a0a0a] px-6 pt-4 pb-10 hidden md:flex justify-center">
        <PortoDigitalBadge variant="inline" />
      </section>

      <section id="pedido" className="bg-[#F7F8F9] scroll-mt-40 md:scroll-mt-48">
        <div className="px-6 pt-12 pb-16 max-w-5xl mx-auto">
          <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3 mb-1">
            <h2 className="text-gray-900 text-xl font-medium">Faça seu pedido</h2>
            <span className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2 py-1 rounded-full">3 passos simples</span>
          </div>
          <p className="text-gray-400 text-sm mb-6">
            Preencha em 3 passos rápidos: a gente gera os mockups e o orçamento na sequência.
          </p>

          <PedidoSteps />

          <div className="mt-6 flex items-center gap-4">
            <div className="w-10 h-10 bg-[#E1F5EE] rounded-full flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#0F6E56" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </div>
            <div>
              <p className="text-sm text-gray-900 font-medium">Precisa de ajuda?</p>
              <p className="text-xs text-gray-400 leading-relaxed">Nosso time atende pelo WhatsApp{" "}<a href={linkWhatsAppSuporte("Olá! Estou com uma dúvida no pedido")} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0F6E56] hover:underline">{WHATSAPP_SUPORTE_FORMATADO}</a>. Chame a qualquer momento que a gente te guia pelo processo.</p>
            </div>
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

      <SiteFooter />

    </main>
  );
}
