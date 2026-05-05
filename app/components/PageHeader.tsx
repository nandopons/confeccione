import Link from "next/link";

export default function PageHeader() {
  return (
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
  );
}
