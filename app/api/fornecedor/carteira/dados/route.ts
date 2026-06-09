// app/api/fornecedor/carteira/dados/route.ts
// POST — salva os dados de repasse (PIX + conta bancária) do fornecedor logado.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getFornecedorAtual } from '@/app/lib/auth-server'
import { salvarDadosRepasse } from '@/app/lib/fornecedor-pedidos'

export const runtime = 'nodejs'

const BodySchema = z.object({
  pix_chave: z.string().max(160).optional(),
  pix_tipo: z.enum(['cpf', 'cnpj', 'email', 'telefone', 'aleatoria', '']).optional(),
  banco_nome: z.string().max(120).optional(),
  banco_agencia: z.string().max(20).optional(),
  banco_conta: z.string().max(30).optional(),
  banco_titular: z.string().max(160).optional(),
})

export async function POST(req: Request) {
  const fornecedor = await getFornecedorAtual()
  if (!fornecedor) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 })

  let bruto: unknown
  try { bruto = await req.json() } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }) }
  const p = BodySchema.safeParse(bruto)
  if (!p.success) return NextResponse.json({ erro: 'Dados inválidos' }, { status: 400 })

  const r = await salvarDadosRepasse(fornecedor.id, p.data)
  if (!r.ok) return NextResponse.json({ erro: r.erro ?? 'Falha ao salvar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
