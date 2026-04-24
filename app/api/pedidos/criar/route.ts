import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { estaEmHorarioComercial, proximoHorarioValido } from '@/app/lib/horario'
import { criarEDispararOferta } from '@/app/lib/ofertas'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { tipo, quantidade, prazo, estado, nome, whatsapp, email, descricao } = await req.json()

  const { data, error } = await supabase
    .from('pedidos')
    .insert({
      tipo,
      quantidade: tipo !== 'ajuste' ? quantidade : null,
      prazo,
      estado,
      nome,
      whatsapp,
      email,
      descricao: descricao || null,
      status: 'buscando_fornecedor',
    })
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Erro ao criar pedido' },
      { status: 500 }
    )
  }

  if (estaEmHorarioComercial()) {
    criarEDispararOferta(data.id).catch(err =>
      console.error('criarEDispararOferta error:', err)
    )
  } else {
    await supabase
      .from('pedidos')
      .update({ buscar_apos: proximoHorarioValido().toISOString() })
      .eq('id', data.id)
  }

  return NextResponse.json({ ok: true, protocolo: data.id, status: 'buscando_fornecedor' })
}
