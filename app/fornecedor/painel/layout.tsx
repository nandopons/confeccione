// app/fornecedor/painel/layout.tsx
// ============================================================================
// Layout protegido do painel do fornecedor.
// - Valida sessão server-side (segunda barreira após middleware)
// - Renderiza sidebar desktop / bottom nav mobile via <PainelNav>
// - Children = conteúdo de cada página do painel
// ============================================================================

import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import PainelNav from "./PainelNav";

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Esta chamada redireciona pra /fornecedor/entrar se não tiver sessão válida.
  const fornecedor = await exigirFornecedorAtual();

  return (
    <div className="min-h-screen bg-[#FAFAFA] font-sans">
      <div className="md:flex">
        <PainelNav nomeFornecedor={fornecedor.nome} />

        {/* Conteúdo principal */}
        <main className="flex-1 min-w-0 pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
