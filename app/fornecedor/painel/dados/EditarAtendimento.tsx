"use client";

// app/fornecedor/painel/dados/EditarAtendimento.tsx
// ============================================================================
// Bloco editável dos dados do fornecedor (05/09/2026).
//
// Só os campos que o fornecedor pode mudar sozinho: nome, cidade, UF, raio e
// pedido mínimo. WhatsApp, e-mail, CPF/CNPJ e tipos de produto continuam no
// suporte — o motivo de cada um está na rota PATCH.
// ============================================================================

import { useRouter } from "next/navigation";
import { useState } from "react";

const RAIOS = [
  { valor: "cidade", label: "Apenas minha cidade" },
  { valor: "estado", label: "Apenas meu estado" },
  { valor: "regiao", label: "Minha região" },
  { valor: "nacional", label: "Brasil inteiro" },
];

const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR",
  "PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

export type DadosEditaveis = {
  nome: string | null;
  cidade: string | null;
  estado: string | null;
  raio_atendimento: string | null;
  pedido_minimo: number | null;
};

export default function EditarAtendimento({ inicial }: { inicial: DadosEditaveis }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(inicial.nome ?? "");
  const [cidade, setCidade] = useState(inicial.cidade ?? "");
  const [estado, setEstado] = useState(inicial.estado ?? "");
  const [raio, setRaio] = useState(inicial.raio_atendimento ?? "nacional");
  const [minimo, setMinimo] = useState(
    inicial.pedido_minimo !== null ? String(inicial.pedido_minimo) : "",
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const r = await fetch("/api/fornecedor/painel/dados", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome,
          cidade,
          estado,
          raio_atendimento: raio,
          pedido_minimo: minimo,
        }),
      });
      const json = await r.json();
      if (!r.ok) {
        setErro(json?.error ?? "não consegui salvar");
        return;
      }
      setOk(true);
      setAberto(false);
      // Recarrega o server component pra tela mostrar o que foi gravado, não o
      // que o formulário achava que gravou.
      router.refresh();
    } catch {
      setErro("falha de conexão ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => {
            setOk(false);
            setAberto(true);
          }}
          className="bg-[#1D9E75] hover:bg-[#0F6E56] text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
        >
          Editar meus dados
        </button>
        {ok && <span className="text-sm text-[#0F6E56]">Dados atualizados.</span>}
      </div>
    );
  }

  const campo =
    "w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-[#1D9E75]";
  const rotulo = "block text-xs text-gray-500 mb-1.5";

  return (
    <form
      onSubmit={salvar}
      className="bg-white border border-gray-200 rounded-2xl p-6 mb-4 grid sm:grid-cols-2 gap-3"
    >
      <h2 className="sm:col-span-2 text-gray-900 text-base font-medium">Editar meus dados</h2>

      <label className="block sm:col-span-2">
        <span className={rotulo}>Nome da confecção</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} maxLength={120} required />
      </label>

      <label className="block">
        <span className={rotulo}>Cidade</span>
        <input value={cidade} onChange={(e) => setCidade(e.target.value)} className={campo} maxLength={80} />
      </label>

      <label className="block">
        <span className={rotulo}>Estado</span>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} className={campo}>
          <option value="">Não informar</option>
          {UFS.map((uf) => (
            <option key={uf} value={uf}>{uf}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={rotulo}>Até onde você atende</span>
        <select value={raio} onChange={(e) => setRaio(e.target.value)} className={campo}>
          {RAIOS.map((r) => (
            <option key={r.valor} value={r.valor}>{r.label}</option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={rotulo}>Pedido mínimo (peças)</span>
        <input
          type="number"
          min={1}
          value={minimo}
          onChange={(e) => setMinimo(e.target.value)}
          className={campo}
          placeholder="sem mínimo"
        />
      </label>

      <p className="sm:col-span-2 text-xs text-gray-400 leading-relaxed">
        Esses dados definem quais pedidos chegam pra você. Pedido mínimo alto demais
        deixa passar produção pequena; raio muito estreito tira você dos pedidos de fora.
      </p>

      {erro && (
        <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          {erro}
        </p>
      )}

      <div className="sm:col-span-2 flex gap-2">
        <button
          type="submit"
          disabled={salvando}
          className="bg-[#1D9E75] hover:bg-[#0F6E56] disabled:bg-gray-300 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2.5"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
