const ZAPI_INSTANCE     = process.env.ZAPI_INSTANCE_ID!
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN!
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!

export async function enviarMensagem(telefone: string, mensagem: string) {
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
    const data = await res.json()
    console.log('Z-API response:', JSON.stringify(data))
  } catch (err) {
    console.error('Z-API error:', err)
  }
}
