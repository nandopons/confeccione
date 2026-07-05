// app/admin/(painel)/whatsapp/page.tsx
// Inbox do WhatsApp oficial (Meta Cloud API). Auth: mesma defesa em
// profundidade das demais pages do (painel).
//
// Deep-link: /admin/whatsapp?abrir=<telefone>&nome=<nome>&t=<texto>
// abre (criando se preciso) a conversa do telefone e pré-preenche o composer.

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { WhatsAppInbox } from './WhatsAppInbox'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ abrir?: string; nome?: string; t?: string }>
}) {
  if (!(await eAdminLogado())) redirect('/admin/login')
  const params = await searchParams
  return (
    <WhatsAppInbox
      abrirTelefone={params.abrir}
      abrirNome={params.nome}
      abrirTexto={params.t}
    />
  )
}
