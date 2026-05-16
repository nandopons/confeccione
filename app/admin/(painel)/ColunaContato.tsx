// app/admin/(painel)/ColunaContato.tsx
// ============================================================================
// Renderiza nome do cliente + número de WhatsApp em texto plano selecionável
// + botão 💬 separado pra wa.me.
//
// Padrão anti-click-acidental: o número NÃO é link. Admin que navegasse a
// tabela clicaria por engano e abriria conversas indesejadas. Botão 💬
// separado é a intenção explícita.
//
// Server Component (sem state, sem handlers). Shared entre páginas do painel.
// ============================================================================

import { linkWhatsApp } from '@/app/lib/phone'

export function ColunaContato({
  nome,
  whatsapp,
}: {
  nome: string
  whatsapp: string
}) {
  return (
    <>
      <div className="text-gray-900">{nome}</div>
      <div className="flex items-center gap-2 mt-0.5">
        {/* Número como texto selecionável (não link) — evita abrir
            conversa por click acidental ao navegar a lista. */}
        <span className="text-xs text-gray-600 select-text">{whatsapp}</span>
        <a
          href={linkWhatsApp(whatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          title={`Abrir WhatsApp · ${nome}`}
          aria-label={`Abrir WhatsApp ${nome}`}
          className="text-xs px-1.5 py-0.5 bg-green-50 hover:bg-green-100 rounded text-green-700 leading-none"
        >
          💬
        </a>
      </div>
    </>
  )
}
