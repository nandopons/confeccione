// app/fornecedor/entrar/page.tsx
// Casca server só pra ler o ?id= e o ?codigo= do botão "Entrar com este código"
// que vai no e-mail do OTP. O formulário em si continua sendo client.
import EntrarFornecedorForm from "./EntrarFornecedorForm";

export const dynamic = "force-dynamic";

export default async function EntrarFornecedorPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; codigo?: string }>;
}) {
  const params = await searchParams;
  const codigo = (params.codigo ?? "").replace(/\D/g, "").slice(0, 6);

  return (
    <EntrarFornecedorForm
      identificadorPrefill={(params.id ?? "").trim()}
      codigoPrefill={codigo.length === 6 ? codigo : ""}
    />
  );
}
