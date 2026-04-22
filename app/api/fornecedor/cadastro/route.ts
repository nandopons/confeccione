import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ZAPI_INSTANCE     = process.env.ZAPI_INSTANCE_ID!
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN!
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!

async function enviarMensagem(telefone: string, mensagem: string) {
  await fetch(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI_CLIENT_TOKEN,
      },
      body: JSON.stringify({ phone: telefone, message: mensagem }),
    }
  )
}

export async function POST(req: Request) {
  const { whatsapp } = await req.json()
  const numero = whatsapp.replace(/\D/g, '')

  const { data: existente } = await supabase
    .from('leads_fornecedores')
    .select('id')
    .eq('whatsapp', numero)
    .maybeSingle()

  if (!existente) {
    const { error } = await supabase
      .from('leads_fornecedores')
      .insert({ whatsapp: numero, status: 'aguardando_contato', etapa_bot: 0 })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    await supabase
      .from('leads_fornecedores')
      .update({ etapa_bot: 0, status: 'aguardando_contato' })
      .eq('whatsapp', numero)
  }

  await enviarMensagem(
    numero,
    `Olá! 👋 Sou do *Confeccione*, a plataforma que conecta confeccionistas a clientes em todo o Brasil.\n\nVocê se cadastrou como fornecedor — ótimo! 🎉\n\nVou te fazer 4 perguntinhas rápidas para completar seu perfil.\n\n📍 *Em qual cidade você está localizado?*`
  )

  return NextResponse.json({ ok: true })
}