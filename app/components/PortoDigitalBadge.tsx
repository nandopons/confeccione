import Image from "next/image";
import Link from "next/link";

// Dimensoes intrinsecas reais do PNG oficial: 4500x1638 (~2.747:1).
// A altura e derivada daqui para preservar o aspect ratio e nao distorcer a
// marca (regra do manual do Porto Digital). Nao usar proporcao chutada.
const LOGO_W = 4500;
const LOGO_H = 1638;

type Variant = "footer" | "inline" | "hero";

interface PortoDigitalBadgeProps {
  variant?: Variant;
  className?: string;
}

const sizes: Record<Variant, { logoWidth: number; textSize: string }> = {
  footer: { logoWidth: 100, textSize: "text-xs" },
  inline: { logoWidth: 140, textSize: "text-sm" },
  hero: { logoWidth: 180, textSize: "text-base" },
};

export default function PortoDigitalBadge({
  variant = "footer",
  className = "",
}: PortoDigitalBadgeProps) {
  const { logoWidth, textSize } = sizes[variant];
  const logoHeight = Math.round((logoWidth * LOGO_H) / LOGO_W);

  return (
    <Link
      href="/porto-digital"
      aria-label="Confeccione é empresa embarcada no Porto Digital"
      className={`inline-flex items-center text-gray-400 hover:text-gray-200 transition-colors ${className}`}
    >
      {/* area livre (clear space) >= 1em ao redor da marca — regra do manual */}
      <span className="p-4">
        <Image
          src="/porto-digital/porto-digital-cor.png"
          alt="Porto Digital"
          width={logoWidth}
          height={logoHeight}
          preload={variant === "hero"}
        />
      </span>
      <span className={`${textSize} leading-tight`}>
        Empresa embarcada
        <br />
        <span className="text-gray-500">no Porto Digital</span>
      </span>
    </Link>
  );
}
