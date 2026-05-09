// app/fornecedor/entrar/layout.tsx
// ============================================================================
// Layout server-component da rota /fornecedor/entrar.
//
// Único objetivo: redirecionar pra /fornecedor/painel se o usuário já tem
// sessão válida. Sem isso, quem clica em "Área do fornecedor" estando logado
// cai na tela de OTP em vez de ir direto pro painel.
//
// A page.tsx continua client-component (precisa do useState/useRouter pro
// formulário), e o gate fica isolado aqui.
// ============================================================================

import { redirect } from "next/navigation";
import { getFornecedorAtual } from "@/app/lib/auth-server";

export default async function EntrarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fornecedor = await getFornecedorAtual();
  if (fornecedor) {
    redirect("/fornecedor/painel");
  }
  return <>{children}</>;
}
