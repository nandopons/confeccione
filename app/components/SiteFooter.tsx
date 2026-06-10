import Link from "next/link";
import Image from "next/image";
import { WHATSAPP_SUPORTE } from "@/app/lib/contatos";

// Dimensões reais do PNG oficial do Porto Digital: 4500x1638 (~2.747:1).
// Altura derivada para preservar o aspect ratio (regra do manual da marca).
const PD_W = 4500;
const PD_H = 1638;
const PD_LOGO_W = 116;
const PD_LOGO_H = Math.round((PD_LOGO_W * PD_H) / PD_W);

// Marca da Confeccione reutilizada no rodapé (wordmark e lockup co-brand).
function ConfeccioneMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none" aria-hidden="true">
      <path d="M30 6 A24 24 0 0 1 54 30" stroke="white" strokeWidth="10" strokeLinecap="round" />
      <path d="M54 30 A24 24 0 0 1 30 54" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.5" />
      <path d="M30 54 A24 24 0 0 1 6 30" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.75" />
      <path d="M6 30 A24 24 0 0 1 30 6" stroke="white" strokeWidth="10" strokeLinecap="round" opacity="0.35" />
      <circle cx="30" cy="30" r="5" fill="white" />
    </svg>
  );
}

function IconWhatsApp({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconMail({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

const linkCls = "inline-flex items-center gap-2 py-1 text-sm text-gray-300 hover:text-[#2DD4A7] transition-colors";
const tituloCls = "text-gray-500 text-[11px] font-semibold uppercase tracking-wider mb-3";

export default function SiteFooter() {
  return (
    <footer className="bg-[#0a0a0a] border-t border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1.1fr]">
          {/* Marca + descrição + CTA */}
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <ConfeccioneMark size={26} />
              <span className="text-white text-sm font-semibold tracking-widest">CONFECCIONE</span>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed mt-4 max-w-xs">
              Conectamos você às melhores confecções e costureiras do Brasil — do pedido à entrega, com pagamento garantido.
            </p>
            <Link
              href="/#pedido"
              className="inline-block mt-5 bg-[#1D9E75] hover:bg-[#178a64] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Fazer meu pedido →
            </Link>
          </div>

          {/* Para você */}
          <nav aria-label="Links para clientes">
            <h3 className={tituloCls}>Para você</h3>
            <ul className="space-y-0.5">
              <li><Link href="/#pedido" className={linkCls}>Fazer pedido</Link></li>
              <li><Link href="/cliente/login" className={linkCls}>Acompanhar pedido</Link></li>
              <li><Link href="/saiba-mais" className={linkCls}>Saiba mais</Link></li>
              <li><Link href="/sobre" className={linkCls}>Sobre a Confeccione</Link></li>
            </ul>
          </nav>

          {/* Para fornecedores */}
          <nav aria-label="Links para fornecedores">
            <h3 className={tituloCls}>Para fornecedores</h3>
            <ul className="space-y-0.5">
              <li><Link href="/fornecedor/cadastro" className={linkCls}>Quero ser fornecedor</Link></li>
              <li><Link href="/fornecedor/entrar" className={linkCls}>Área do fornecedor</Link></li>
            </ul>
          </nav>

          {/* Contato */}
          <div>
            <h3 className={tituloCls}>Contato</h3>
            <ul className="space-y-0.5">
              <li>
                <a
                  href={`https://wa.me/${WHATSAPP_SUPORTE}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkCls}
                >
                  <IconWhatsApp className="shrink-0 opacity-70" />
                  (81) 99578-2077
                </a>
              </li>
              <li>
                <a href="mailto:contato@confeccione.com.br" className={linkCls}>
                  <IconMail className="shrink-0 opacity-70" />
                  contato@confeccione.com.br
                </a>
              </li>
            </ul>
            <p className="text-gray-600 text-[11px] mt-3 leading-relaxed">
              Atendimento de seg. a sáb. — respondemos rapidinho no WhatsApp.
            </p>
          </div>
        </div>

        {/* Barra inferior: copyright + lockup co-brand (logos juntas) */}
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-gray-500 text-xs">
            © 2026 Confeccione · CNPJ 49.307.439/0001-50
          </p>

          <Link
            href="/porto-digital"
            aria-label="Confeccione é empresa embarcada no Porto Digital"
            className="group inline-flex flex-col items-start gap-1.5 sm:items-end"
          >
            <span className="text-gray-500 text-[10px] uppercase tracking-wider">
              Empresa embarcada no Porto Digital
            </span>
            <span className="inline-flex items-center gap-3">
              <ConfeccioneMark size={22} />
              <span className="h-6 w-px bg-white/15" aria-hidden="true" />
              <Image
                src="/porto-digital/porto-digital-branco.png"
                alt="Porto Digital"
                width={PD_LOGO_W}
                height={PD_LOGO_H}
                className="opacity-90 group-hover:opacity-100 transition-opacity"
              />
            </span>
          </Link>
        </div>
      </div>
    </footer>
  );
}
