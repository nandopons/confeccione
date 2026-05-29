import Link from "next/link";
import { WHATSAPP_SUPORTE } from "@/app/lib/contatos";
import PortoDigitalBadge from "@/app/components/PortoDigitalBadge";

export default function SiteFooter() {
  return (
    <footer className="bg-[#0a0a0a] px-6 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
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
            <Link href="/sobre" className="hover:text-gray-400 transition-colors">Sobre</Link>
            {" · "}
            <Link href="/fornecedor/entrar" className="hover:text-gray-400 transition-colors">Área do fornecedor</Link>
          </p>
          <p className="text-gray-600 text-xs">© 2026 Confeccione · CNPJ 49.307.439/0001-50</p>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 flex justify-center">
          <PortoDigitalBadge variant="footer" />
        </div>
      </div>
    </footer>
  );
}
