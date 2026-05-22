// app/admin/(painel)/orfaos/page.tsx
// ============================================================================
// Rota aposentada — a gestão de órfãos foi consolidada em /admin/pedidos
// (aba "Precisa de atenção"). Mantida viva só como redirect pra não quebrar
// bookmarks/links externos. O destino é admin-gated pelo layout.
//
// Os loaders que esta página usava foram extraídos pra
// app/lib/admin-pedido-detalhe.ts (casa única). Os componentes
// (ModalDetalhesOrfao, AcoesOrfao, BotaoDetectar) seguem nesta pasta,
// reusados pela aba de pedidos.
// ============================================================================

import { redirect } from 'next/navigation'

export default function AdminOrfaosRedirect() {
  redirect('/admin/pedidos?aba=precisa_atencao')
}
