// app/admin/(painel)/whatsapp/page.tsx
// Inbox do WhatsApp oficial (Meta Cloud API). Auth: mesma defesa em
// profundidade das demais pages do (painel).

import { redirect } from 'next/navigation'
import { eAdminLogado } from '@/app/lib/admin-auth'
import { WhatsAppInbox } from './WhatsAppInbox'

export const dynamic = 'force-dynamic'

export default async function Page() {
  if (!(await eAdminLogado())) redirect('/admin/login')
  return <WhatsAppInbox />
}
