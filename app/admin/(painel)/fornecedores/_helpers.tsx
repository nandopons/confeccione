// app/admin/(painel)/fornecedores/_helpers.tsx
// ============================================================================
// Helpers visuais compartilhados entre page.tsx (Server Component) e
// FornecedoresTabela.tsx (Client Component) da Fase 3a.
//
// Sem 'use client' — são componentes puros (só render, sem hooks/state).
// Funcionam tanto em server quanto client components.
// ============================================================================

export function BadgePlano({ plano }: { plano: string }) {
  const premium = plano === 'pro'
  const cor = premium
    ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${cor}`}
    >
      {plano}
    </span>
  )
}

export function BadgeStatusFornecedor({ status }: { status: string }) {
  const config: Record<string, { cor: string; label: string }> = {
    ativo: { cor: 'bg-green-100 text-green-800', label: 'Ativo' },
    pausado: { cor: 'bg-gray-200 text-gray-700', label: 'Pausado' },
  }
  const def = config[status] ?? {
    cor: 'bg-gray-100 text-gray-500',
    label: status,
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${def.cor}`}
    >
      {def.label}
    </span>
  )
}
