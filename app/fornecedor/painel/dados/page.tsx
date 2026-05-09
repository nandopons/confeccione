// app/fornecedor/painel/dados/page.tsx
// ============================================================================
// Página de dados cadastrais do fornecedor (server component, leitura pura).
// - Card "Identificação": nome, WhatsApp, e-mail, CPF/CNPJ
// - Card "Atendimento": estado, cidade, raio, tipos de produto, pedido mínimo
// - Card "Conta": status (ativo/pausado)
// - Rodapé: link de suporte via WhatsApp pra solicitar alterações
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { exigirFornecedorAtual } from "@/app/lib/auth-server";
import {
  WHATSAPP_SUPORTE_FORMATADO,
  linkWhatsAppSuporte,
} from "@/app/lib/contatos";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

// ─────────────── Helpers de formatação ───────────────

function formatarWhatsApp(numero: string | null | undefined): string {
  if (!numero) return "—";
  // Remove tudo que não é dígito
  const digitos = numero.replace(/\D/g, "");
  // Formato esperado: 5581995782077 (13 dígitos com DDI)
  if (digitos.length === 13) {
    const ddd = digitos.slice(2, 4);
    const parte1 = digitos.slice(4, 9);
    const parte2 = digitos.slice(9, 13);
    return `(${ddd}) ${parte1}-${parte2}`;
  }
  // Sem DDI (11 dígitos)
  if (digitos.length === 11) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  }
  return numero;
}

function formatarCpfCnpj(valor: string | null | undefined): string {
  if (!valor) return "—";
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length === 11) {
    return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  }
  if (digitos.length === 14) {
    return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
  }
  return valor;
}

function labelRaio(raio: string | null | undefined): string {
  switch (raio) {
    case "estado":
      return "Apenas meu estado";
    case "regiao":
      return "Minha região";
    case "nacional":
      return "Brasil inteiro";
    default:
      return raio || "—";
  }
}

function labelTipoProduto(tipo: string): string {
  const labels: Record<string, string> = {
    fitness: "Fitness",
    fardamento_escolar: "Fardamento escolar",
    moda_intima: "Moda íntima",
    private_label: "Private label",
    interclasse: "Interclasse",
    ajuste: "Ajuste / costura",
    padrao_esportivo: "Padrão esportivo",
  };
  return labels[tipo] || tipo;
}

function labelStatus(status: string | null | undefined): {
  texto: string;
  classe: string;
} {
  if (status === "ativo") {
    return {
      texto: "Ativo",
      classe: "bg-[#E1F5EE] text-[#0F6E56]",
    };
  }
  return {
    texto: "Pausado",
    classe: "bg-orange-100 text-orange-700",
  };
}

// ─────────────── Componente "linha" de definição ───────────────

function Linha({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-3 border-b border-gray-100 last:border-0">
      <div className="text-xs text-gray-400 uppercase tracking-wide sm:w-32 flex-shrink-0">
        {label}
      </div>
      <div className="text-sm text-gray-900 break-words">{children}</div>
    </div>
  );
}

// ─────────────── Page ───────────────

export default async function PaginaDados() {
  const sessao = await exigirFornecedorAtual();

  // Busca dados completos do fornecedor
  const { data: fornecedor } = await supabase
    .from("leads_fornecedores")
    .select(
      "id, nome, whatsapp, email, cpf_cnpj, tipos_produto, pedido_minimo, estado, cidade, raio_atendimento, status"
    )
    .eq("id", sessao.id)
    .single();

  if (!fornecedor) {
    return (
      <section className="px-5 md:px-8 pt-8 pb-12 max-w-4xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <p className="text-gray-500 text-sm">
            Não foi possível carregar seus dados.
          </p>
        </div>
      </section>
    );
  }

  const status = labelStatus(fornecedor.status);
  const tiposProduto: string[] = fornecedor.tipos_produto || [];

  return (
    <section className="px-5 md:px-8 pt-8 pb-12 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-gray-900 text-2xl font-medium mb-1">Seus dados</h1>
        <p className="text-gray-500 text-sm">
          Informações cadastradas no seu perfil de fornecedor.
        </p>
      </div>

      {/* Card 1 — Identificação */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-4">
        <h2 className="text-gray-900 text-base font-medium mb-2">
          Identificação
        </h2>
        <Linha label="Nome">{fornecedor.nome}</Linha>
        <Linha label="WhatsApp">{formatarWhatsApp(fornecedor.whatsapp)}</Linha>
        <Linha label="E-mail">{fornecedor.email || "—"}</Linha>
        <Linha label="CPF / CNPJ">{formatarCpfCnpj(fornecedor.cpf_cnpj)}</Linha>
      </div>

      {/* Card 2 — Atendimento */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-4">
        <h2 className="text-gray-900 text-base font-medium mb-2">Atendimento</h2>
        <Linha label="Estado">{fornecedor.estado || "—"}</Linha>
        <Linha label="Cidade">{fornecedor.cidade || "—"}</Linha>
        <Linha label="Raio">{labelRaio(fornecedor.raio_atendimento)}</Linha>
        <Linha label="Tipos">
          {tiposProduto.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tiposProduto.map((tipo) => (
                <span
                  key={tipo}
                  className="bg-[#E1F5EE] text-[#0F6E56] text-xs font-medium px-2.5 py-1 rounded-full"
                >
                  {labelTipoProduto(tipo)}
                </span>
              ))}
            </div>
          ) : (
            "—"
          )}
        </Linha>
        <Linha label="Pedido mínimo">
          {fornecedor.pedido_minimo
            ? `${fornecedor.pedido_minimo} ${fornecedor.pedido_minimo === 1 ? "peça" : "peças"}`
            : "—"}
        </Linha>
      </div>

      {/* Card 3 — Conta */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <h2 className="text-gray-900 text-base font-medium mb-2">Conta</h2>
        <Linha label="Status">
          <span
            className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${status.classe}`}
          >
            {status.texto}
          </span>
        </Linha>
      </div>

      {/* Rodapé — Suporte */}
      <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-[#E1F5EE] rounded-full flex items-center justify-center flex-shrink-0">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="#0F6E56"
              aria-hidden="true"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 font-medium mb-1">
              Precisa alterar algum dado?
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Pra mudar nome, tipos de produto, raio ou pausar a conta, fale com
              a gente no WhatsApp{" "}
              <a
                href={linkWhatsAppSuporte("Olá! Preciso alterar dados do meu cadastro.")}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0F6E56] hover:underline"
              >
                {WHATSAPP_SUPORTE_FORMATADO}
              </a>
              . A edição direta na tela vai chegar nas próximas atualizações.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
