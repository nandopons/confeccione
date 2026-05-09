// app/lib/asaas-customers.ts
// ============================================================================
// CRUD de Customers no Asaas.
// 1 fornecedor = 1 customer no Asaas (vinculado por leads_fornecedores.asaas_customer_id).
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { asaasFetch } from './asaas'
import { apenasDigitos } from './cpf-cnpj'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AsaasCustomer = {
  id: string                  // cus_xxxxxxxxxxxx
  name: string
  email: string | null
  phone: string | null
  mobilePhone: string | null
  cpfCnpj: string
  personType: 'FISICA' | 'JURIDICA'
  dateCreated: string
  // ... outros campos retornados pela Asaas que não precisamos no momento
}

export type CriarCustomerInput = {
  fornecedorId: string
  nome: string
  email: string | null
  whatsapp: string
  cpfCnpj: string
}

/**
 * Cria um novo customer no Asaas e salva o ID no fornecedor.
 * Se o fornecedor já tem asaas_customer_id, retorna esse customer
 * sem criar um duplicado.
 */
export async function criarOuObterCustomer(
  input: CriarCustomerInput
): Promise<AsaasCustomer> {
  // Verifica se já existe customer pra esse fornecedor
  const { data: forn } = await supabase
    .from('leads_fornecedores')
    .select('asaas_customer_id')
    .eq('id', input.fornecedorId)
    .single()

  if (forn?.asaas_customer_id) {
    // Já tem customer — busca dados atualizados no Asaas
    return await asaasFetch<AsaasCustomer>(`/customers/${forn.asaas_customer_id}`)
  }

  // Cria customer novo no Asaas
  const cpfCnpj = apenasDigitos(input.cpfCnpj)
  const personType = cpfCnpj.length === 11 ? 'FISICA' : 'JURIDICA'

  const customer = await asaasFetch<AsaasCustomer>('/customers', {
    method: 'POST',
    body: {
      name: input.nome,
      email: input.email,
      mobilePhone: apenasDigitos(input.whatsapp),
      cpfCnpj,
      personType,
      // notificationDisabled: true para evitar Asaas mandar e-mail/SMS de cobrança
      // (a gente cuida da comunicação via WhatsApp/email próprios)
      notificationDisabled: true,
    },
  })

  // Salva o ID no fornecedor
  await supabase
    .from('leads_fornecedores')
    .update({ asaas_customer_id: customer.id })
    .eq('id', input.fornecedorId)

  return customer
}

/**
 * Atualiza dados do customer no Asaas (em caso de troca de email, telefone, etc).
 */
export async function atualizarCustomer(
  asaasCustomerId: string,
  dados: Partial<{
    name: string
    email: string
    mobilePhone: string
    cpfCnpj: string
  }>
): Promise<AsaasCustomer> {
  const body: Record<string, string> = {}
  if (dados.name) body.name = dados.name
  if (dados.email) body.email = dados.email
  if (dados.mobilePhone) body.mobilePhone = apenasDigitos(dados.mobilePhone)
  if (dados.cpfCnpj) body.cpfCnpj = apenasDigitos(dados.cpfCnpj)

  return await asaasFetch<AsaasCustomer>(`/customers/${asaasCustomerId}`, {
    method: 'POST',
    body,
  })
}
