// app/fornecedor/painel/plano/ModalCheckout.tsx
// ============================================================================
// Modal de checkout — fornecedor escolhe método (Pix/Boleto/Cartão) e gera
// cobrança via POST /api/fornecedor/asaas/checkout.
// ============================================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tipo: string; // 'pacote_leads_5' | 'assinatura_starter' | etc
  valorCentavos: number;
  descricao: string; // "Pacote de 5 pedidos" ou "Plano Starter"
  jaTemCpfCnpj: boolean;
  onClose: () => void;
};

type Metodo = "pix" | "boleto" | "cartao";

type ResultadoCheckout = {
  asaas_payment_id: string;
  link_pagamento: string | null;
  qr_code_pix: string | null;
  qr_code_pix_imagem: string | null;
  vencimento: string;
};

const METODO_LABEL: Record<Metodo, string> = {
  pix: "Pix",
  boleto: "Boleto",
  cartao: "Cartão de crédito",
};

const METODO_DESC: Record<Metodo, string> = {
  pix: "Aprovação instantânea",
  boleto: "Pagamento em até 3 dias úteis",
  cartao: "Aprovação imediata",
};

export default function ModalCheckout({
  tipo,
  valorCentavos,
  descricao,
  jaTemCpfCnpj,
  onClose,
}: Props) {
  const router = useRouter();
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [metodo, setMetodo] = useState<Metodo>("pix");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<"cpf_cnpj" | null>(null);
  const [resultado, setResultado] = useState<ResultadoCheckout | null>(null);

  const valorBRL = (valorCentavos / 100)
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setErroCampo(null);

    if (!jaTemCpfCnpj) {
      const digitos = cpfCnpj.replace(/\D/g, "");
      if (digitos.length !== 11 && digitos.length !== 14) {
        setErroCampo("cpf_cnpj");
        setErro("CPF (11 dígitos) ou CNPJ (14 dígitos).");
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/fornecedor/asaas/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          metodo,
          cpf_cnpj: jaTemCpfCnpj ? undefined : cpfCnpj.replace(/\D/g, ""),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === "cpf_cnpj_required" || data.error === "cpf_cnpj_invalido") {
          setErroCampo("cpf_cnpj");
          setErro(data.detalhe ?? "CPF/CNPJ inválido.");
        } else if (data.error === "ja_possui_assinatura_ativa") {
          setErro("Você já possui assinatura ativa.");
        } else {
          setErro("Não foi possível gerar o pagamento. Tente novamente.");
        }
        return;
      }

      setResultado({
        asaas_payment_id: data.asaas_payment_id,
        link_pagamento: data.link_pagamento,
        qr_code_pix: data.qr_code_pix,
        qr_code_pix_imagem: data.qr_code_pix_imagem,
        vencimento: data.vencimento,
      });
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function formatarMascaraCpfCnpj(v: string): string {
    const d = v.replace(/\D/g, "").slice(0, 14);
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-gray-900 text-lg font-medium">{descricao}</h2>
              <p className="text-gray-900 text-2xl font-medium mt-1">
                R$ {valorBRL}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 text-xl leading-none p-1"
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>

          {!resultado ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {!jaTemCpfCnpj && (
                <div>
                  <label className="text-sm text-gray-700 font-medium block mb-1">
                    CPF / CNPJ
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cpfCnpj}
                    onChange={(e) =>
                      setCpfCnpj(formatarMascaraCpfCnpj(e.target.value))
                    }
                    placeholder="000.000.000-00"
                    className={`w-full px-3 py-2 border rounded-xl text-sm ${
                      erroCampo === "cpf_cnpj"
                        ? "border-red-400"
                        : "border-gray-300"
                    }`}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Necessário pra emissão da nota fiscal.
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-700 font-medium block mb-2">
                  Forma de pagamento
                </label>
                <div className="flex flex-col gap-2">
                  {(Object.keys(METODO_LABEL) as Metodo[]).map((m) => (
                    <label
                      key={m}
                      className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer ${
                        metodo === m
                          ? "border-[#1D9E75] bg-green-50/30"
                          : "border-gray-200"
                      }`}
                    >
                      <input
                        type="radio"
                        name="metodo"
                        value={m}
                        checked={metodo === m}
                        onChange={() => setMetodo(m)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="text-sm text-gray-900 font-medium">
                          {METODO_LABEL[m]}
                        </div>
                        <div className="text-xs text-gray-500">
                          {METODO_DESC[m]}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {erro && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                  {erro}
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-[#1D9E75] text-white disabled:bg-gray-300"
                >
                  {loading ? "Gerando..." : "Gerar pagamento"}
                </button>
              </div>
            </form>
          ) : (
            <ResultadoView
              metodo={metodo}
              resultado={resultado}
              onRefresh={() => router.refresh()}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultadoView({
  metodo,
  resultado,
  onRefresh,
  onClose,
}: {
  metodo: Metodo;
  resultado: ResultadoCheckout;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const venc = new Date(resultado.vencimento + "T00:00:00").toLocaleDateString(
    "pt-BR"
  );

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // ignora
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {metodo === "pix" && resultado.qr_code_pix && (
        <div className="flex flex-col items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
          {resultado.qr_code_pix_imagem ? (
            <>
              <div className="text-xs text-gray-500">
                Aponte a câmera do app do banco
              </div>
              <img
                src={`data:image/png;base64,${resultado.qr_code_pix_imagem}`}
                alt="QR Code Pix"
                className="w-48 h-48 border border-gray-200"
              />
            </>
          ) : (
            <div className="text-xs text-gray-500 text-center">
              QR Code indisponível — use o código copia-e-cola abaixo
              no app do seu banco.
            </div>
          )}
          <button
            type="button"
            onClick={() => copiar(resultado.qr_code_pix!)}
            className="text-xs text-[#1D9E75] hover:underline"
          >
            {copiado ? "✓ Copiado!" : "Copiar código Pix (copia e cola)"}
          </button>
        </div>
      )}

      {metodo === "pix" && !resultado.qr_code_pix && resultado.link_pagamento && (
        <a
          href={resultado.link_pagamento}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-3 rounded-xl text-center bg-[#1D9E75] text-white font-medium text-sm"
        >
          Abrir Pix no Asaas
        </a>
      )}

      {metodo === "boleto" && resultado.link_pagamento && (
        <a
          href={resultado.link_pagamento}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-3 rounded-xl text-center bg-[#1D9E75] text-white font-medium text-sm"
        >
          Abrir boleto
        </a>
      )}

      {metodo === "cartao" && resultado.link_pagamento && (
        <a
          href={resultado.link_pagamento}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-3 rounded-xl text-center bg-[#1D9E75] text-white font-medium text-sm"
        >
          Pagar com cartão
        </a>
      )}

      <div className="text-xs text-gray-500 text-center">
        Vencimento: {venc}
      </div>

      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700"
        >
          Fechar
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-gray-300 text-gray-700"
        >
          Já paguei? Verificar
        </button>
      </div>
    </div>
  );
}
