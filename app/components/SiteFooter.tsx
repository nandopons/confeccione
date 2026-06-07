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

export default function SiteFooter() {
  return (
    <footer className="bg-[#0a0a0a] border-t border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          {/* Marca + descrição */}
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <ConfeccioneMark size={26} />
              <span className="text-white text-sm font-semibold tracking-widest">CONFECCIONE</span>
            </Link>
            <p className="text-gray-400 text-sm leading-relaxed mt-4 max-w-xs">
              Conectamos você às melhores confecções e costureiras do Brasil.
            </p>
          </div>

          {/* Navegação */}
          <nav aria-label="Navegação do rodapé">
            <h3 className="text-gray-500 text-[11px] font-semibold uppercase tracking-wider mb-3">
              Navegação
            </h3>
            <ul className="space-y-0.5">
              <li>
                <Link href="/sobre" className="block py-1 text-sm text-gray-300 hover:text-white transition-colors">
                  Sobre
                </Link>
              </li>
              <li>
                <Link href="/fornecedor/entrar" className="block py-1 text-sm text-gray-300 hover:text-white transition-colors">
                  Área do fornecedor
                </Link>
              </li>
              <li>
                <Link href="/cliente/login" className="block py-1 text-sm text-gray-300 hover:text-white transition-colors">
                  Acompanhar pedido
                </Link>
              </li>
            </ul>
          </nav>

          {/* Contato */}
          <div>
            <h3 className="text-gray-500 text-[11px] font-semibold uppercase tracking-wider mb-3">
              Contato
            </h3>
            <ul className="space-y-0.5">
              <li>
                <a href="mailto:contato@confeccione.com.br" className="block py-1 text-sm text-gray-300 hover:text-white transition-colors">
                  contato@confeccione.com.br
                </a>
              </li>
              <li>
                <a
                  href={`https://wa.me/${WHATSAPP_SUPORTE}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block py-1 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  (81) 99578-2077
                </a>
              </li>
            </ul>
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
