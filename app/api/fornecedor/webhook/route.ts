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
  try {
    const res = await fetch(
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
    console.log('Z-API webhook status:', res.status)
    const data = await res.json()
    console.log('Z-API webhook response:', JSON.stringify(data))
  } catch (err) {
    console.error('Z-API webhook error:', err)
  }
}

export async function POST(req: Request) {
  const body = await req.json()
  console.log('WEBHOOK BODY:', JSON.stringify(body))

  const telefone = body.phone?.replace(/\D/g, '')
  const texto    = body.text?.message?.trim()

  console.log('telefone:', telefone, '| texto:', texto, '| fromMe:', body.fromMe)

  if (!telefone || !texto) return NextResponse.json({ ok: true })
  if (body.fromMe) return NextResponse.json({ ok: true })

  const { data: lead } = await supabase
    .from('leads_fornecedores')
    .select('*')
    .eq('whatsapp', telefone)
    .maybeSingle()

  if (!lead) return NextResponse.json({ ok: true })

  const etapa = lead.etapa_bot ?? 0
  console.log('etapa atual:', etapa)

  if (etapa === 0) {
    await supabase
      .from('leads_fornecedores')
      .update({ cidade: texto, etapa_bot: 1 })
      .eq('whatsapp', telefone)

    await enviarMensagem(
      telefone,
      `Anotado! ✅\n\n👕 *Que tipo de produto você confecciona?*\n\nExemplos: camisetas, uniformes, moda praia, bermudas, vestidos, fardamentos...`
    )

  } else if (etapa === 1) {
    await supabase
      .from('leads_fornecedores')
      .update({ tipos_produto: [texto], etapa_bot: 2 })
      .eq('whatsapp', telefone)

    await enviarMensagem(
      telefone,
      `Ótimo! 📋\n\n*Você tem CNPJ?*\n\nResponde com *sim* ou *não*.`
    )

  } else if (etapa === 2) {
    const temCnpj = texto.toLowerCase().includes('sim')

    await supabase
      .from('leads_fornecedores')
      .update({ tem_cnpj: temCnpj, etapa_bot: 3 })
      .eq('whatsapp', telefone)

    await enviarMensagem(
      telefone,
      `Perfeito! 📧\n\n*Qual é o seu e-mail?*`
    )

  } else if (etapa === 3) {
    await supabase
      .from('leads_fornecedores')
      .update({
        email: texto,
        status: 'ativo',
        etapa_bot: 4,
        atualizado_em: new Date().toISOString(),
      })
      .eq('whatsapp', telefone)

    await enviarMensagem(
      telefone,
      `Tudo certo! 🎉\n\nSeu cadastro está completo no *Confeccione*.\n\nEm breve você vai começar a receber pedidos de clientes na sua região. Qualquer dúvida é só chamar! 🚀`
    )
  }

  return NextResponse.json({ ok: true })
}