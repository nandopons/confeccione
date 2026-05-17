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
 * Idempotente em 3 camadas:
 *   1. Se o fornecedor já tem asaas_customer_id local, retorna esse customer.
 *   2. Senão, faz GET /customers?cpfCnpj=XXX no Asaas. Se existe (foi criado
 *      em tentativa anterior que falhou no UPDATE local), reusa o id existente.
 *      Defesa contra o bug: erro entre POST /customers e UPDATE local criava
 *      um novo customer no Asaas a cada retry (lista de duplicados).
 *   3. Só então cria customer novo via POST /customers.
 * Em (2) e (3), faz UPDATE local com o asaas_customer_id resolvido.
 */
export async function criarOuObterCustomer(
  input: CriarCustomerInput
): Promise<AsaasCustomer> {
  // (1) Já tem customer salvo localmente?
  const { data: forn } = await supabase
    .from('leads_fornecedores')
    .select('asaas_customer_id')
    .eq('id', input.fornecedorId)
    .single()

  if (forn?.asaas_customer_id) {
    return await asaasFetch<AsaasCustomer>(`/customers/${forn.asaas_customer_id}`)
  }

  const cpfCnpj = apenasDigitos(input.cpfCnpj)
  const personType = cpfCnpj.length === 11 ? 'FISICA' : 'JURIDICA'

  // (2) Defesa contra duplicação: customer com esse CPF/CNPJ já existe no Asaas?
  // Acontece quando uma tentativa anterior criou no Asaas mas falhou ao gravar
  // asaas_customer_id local. Sem essa defesa, a próxima tentativa criaria outro.
  const existente = await asaasFetch<{ data: AsaasCustomer[] }>('/customers', {
    query: { cpfCnpj },
  })

  let customer: AsaasCustomer
  if (existente.data && existente.data.length > 0) {
    customer = existente.data[0]
    console.warn(
      `[asaas-customers] reusando customer ${customer.id} (CPF/CNPJ ${cpfCnpj.slice(0, 3)}***) — tentativa anterior provavelmente falhou no UPDATE local`
    )
  } else {
    // (3) Cria customer novo no Asaas
    customer = await asaasFetch<AsaasCustomer>('/customers', {
      method: 'POST',
      body: {
        name: input.nome,
        email: input.email,
        mobilePhone: apenasDigitos(input.whatsapp),
        cpfCnpj,
        personType,
        notificationDisabled: true,
      },
    })
  }

  // Salva o ID no fornecedor (idempotente — vale tanto pra customer novo quanto reusado)
  const { error: updErr } = await supabase
    .from('leads_fornecedores')
    .update({ asaas_customer_id: customer.id })
    .eq('id', input.fornecedorId)

  if (updErr) {
    console.error(
      `[asaas-customers] UPDATE leads_fornecedores.asaas_customer_id falhou pra fornecedor ${input.fornecedorId}, customer ${customer.id}:`,
      updErr
    )
    // Throw pra caller decidir — não silencia. A defesa (2) cobre o próximo retry.
    throw new Error(
      `asaas_customer_id update falhou: ${updErr.message}`
    )
  }

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
