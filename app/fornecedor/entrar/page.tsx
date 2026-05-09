"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";

type Estado = "identificador" | "codigo";

export default function EntrarFornecedor() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("identificador");
  const [identificador, setIdentificador] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const codigoInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-foca o campo de código quando muda pra esse estado
  useEffect(() => {
    if (estado === "codigo") {
      codigoInputRef.current?.focus();
    }
  }, [estado]);

  async function solicitarCodigo() {
    if (identificador.trim().length === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/fornecedor/auth/solicitar-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identificador: identificador.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Erro ao solicitar código");
        setEnviando(false);
        return;
      }
      setMensagem(data.mensagem ?? "Código enviado! Verifique seu email e WhatsApp.");
      setEstado("codigo");
    } catch (err) {
      console.error(err);
      setErro("Não foi possível solicitar o código. Tente novamente.");
    }
    setEnviando(false);
  }

  async function validarCodigo() {
    const codigoLimpo = codigo.replace(/\D/g, "");
    if (codigoLimpo.length !== 6) {
      setErro("Digite os 6 dígitos do código");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/fornecedor/auth/validar-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificador: identificador.trim(),
          codigo: codigoLimpo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Código inválido");
        setEnviando(false);
        return;
      }
      // Login OK → redireciona pro painel
      router.push("/fornecedor/painel");
    } catch (err) {
      console.error(err);
      setErro("Não foi possível validar o código. Tente novamente.");
    }
    setEnviando(false);
  }

  function voltarParaIdentificador() {
    setEstado("identificador");
    setCodigo("");
    setErro(null);
    setMensagem(null);
  }

  return (
    <main className="min-h-screen bg-white font-sans">
      <SiteHeader />

      <section className="px-6 pt-10 pb-16 max-w-md mx-auto">
        <h2 className="text-gray-900 text-xl font-medium mb-1">Entrar como fornecedor</h2>
        <p className="text-gray-400 text-sm mb-6">
          Acesse seu painel para ver pedidos, gerenciar seu plano e seus dados.
        </p>

        <div className="border border-gray-200 rounded-2xl p-6">
          {estado === "identificador" && (
            <>
              <p className="text-gray-900 font-medium mb-1">Como podemos te encontrar?</p>
              <p className="text-gray-400 text-sm mb-5">
                Digite o email ou WhatsApp que você usou no cadastro. Vamos te enviar um código de acesso.
              </p>

              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1 block">Email ou WhatsApp</label>
                <input
                  type="text"
                  value={identificador}
                  onChange={(e) => {
                    setIdentificador(e.target.value);
                    setErro(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !enviando && identificador.trim().length > 0) {
                      solicitarCodigo();
                    }
                  }}
                  placeholder="seu@email.com ou (00) 00000-0000"
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:border-[#1D9E75]"
                  autoFocus
                />
              </div>

              {erro && (
                <p className="text-xs text-red-500 mb-3">{erro}</p>
              )}

              <button
                disabled={enviando || identificador.trim().length === 0}
                onClick={solicitarCodigo}
                className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors"
              >
                {enviando ? "Enviando..." : "Enviar código"}
              </button>

              <p className="text-xs text-gray-400 text-center mt-5">
                Ainda não é fornecedor?{" "}
                <Link href="/fornecedor/cadastro" className="text-[#1D9E75] hover:underline">
                  Cadastre-se aqui
                </Link>
              </p>
            </>
          )}

          {estado === "codigo" && (
            <>
              <p className="text-gray-900 font-medium mb-1">Digite o código</p>
              {mensagem && (
                <p className="text-gray-500 text-sm mb-5">{mensagem}</p>
              )}

              <div className="mb-4">
                <label className="text-xs text-gray-400 mb-1 block">Código de 6 dígitos</label>
                <input
                  ref={codigoInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={codigo}
                  onChange={(e) => {
                    setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setErro(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !enviando && codigo.replace(/\D/g, "").length === 6) {
                      validarCodigo();
                    }
                  }}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full border border-gray-200 rounded-xl px-3 py-3 text-2xl text-gray-800 text-center tracking-[0.4em] font-mono focus:outline-none focus:border-[#1D9E75]"
                />
                <p className="text-xs text-gray-400 mt-2">
                  Enviamos para <strong>{identificador}</strong>. Pode demorar alguns segundos para chegar.
                </p>
              </div>

              {erro && (
                <p className="text-xs text-red-500 mb-3">{erro}</p>
              )}

              <button
                disabled={enviando || codigo.replace(/\D/g, "").length !== 6}
                onClick={validarCodigo}
                className="w-full bg-[#1D9E75] hover:bg-[#0F6E56] disabled:opacity-50 text-white px-6 py-3 rounded-xl text-sm font-medium transition-colors"
              >
                {enviando ? "Validando..." : "Entrar"}
              </button>

              <button
                onClick={voltarParaIdentificador}
                className="w-full text-gray-400 hover:text-gray-600 text-xs mt-4"
              >
                ← Usar outro email/WhatsApp
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
