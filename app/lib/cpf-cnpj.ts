// app/lib/cpf-cnpj.ts
// ============================================================================
// Validação e formatação de CPF/CNPJ.
// Algoritmo padrão da Receita Federal (dígito verificador).
// ============================================================================

/**
 * Remove tudo que não é dígito.
 */
export function apenasDigitos(valor: string): string {
  return (valor || '').replace(/\D/g, '')
}

/**
 * Aplica máscara dinâmica de CPF (123.456.789-00) ou CNPJ (12.345.678/0001-90)
 * baseado no número de dígitos.
 */
export function formatarCpfCnpj(valor: string): string {
  const digitos = apenasDigitos(valor)

  if (digitos.length <= 11) {
    // Formata como CPF progressivamente
    return digitos
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  } else {
    // Formata como CNPJ progressivamente (até 14 dígitos)
    return digitos
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }
}

/**
 * Valida CPF usando algoritmo de dígito verificador.
 * Retorna true se válido, false caso contrário.
 */
export function validarCpf(cpf: string): boolean {
  const digitos = apenasDigitos(cpf)

  if (digitos.length !== 11) return false

  // Rejeita CPFs com todos os dígitos iguais (111.111.111-11, 000.000.000-00, etc)
  if (/^(\d)\1{10}$/.test(digitos)) return false

  // Calcula primeiro dígito verificador
  let soma = 0
  for (let i = 0; i < 9; i++) {
    soma += parseInt(digitos[i], 10) * (10 - i)
  }
  let resto = (soma * 10) % 11
  if (resto === 10) resto = 0
  if (resto !== parseInt(digitos[9], 10)) return false

  // Calcula segundo dígito verificador
  soma = 0
  for (let i = 0; i < 10; i++) {
    soma += parseInt(digitos[i], 10) * (11 - i)
  }
  resto = (soma * 10) % 11
  if (resto === 10) resto = 0
  if (resto !== parseInt(digitos[10], 10)) return false

  return true
}

/**
 * Valida CNPJ usando algoritmo de dígito verificador.
 * Retorna true se válido, false caso contrário.
 */
export function validarCnpj(cnpj: string): boolean {
  const digitos = apenasDigitos(cnpj)

  if (digitos.length !== 14) return false

  // Rejeita CNPJs com todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(digitos)) return false

  const calcularDV = (base: string, pesos: number[]): number => {
    let soma = 0
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base[i], 10) * pesos[i]
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const dv1 = calcularDV(digitos.slice(0, 12), pesos1)
  if (dv1 !== parseInt(digitos[12], 10)) return false

  const dv2 = calcularDV(digitos.slice(0, 13), pesos2)
  if (dv2 !== parseInt(digitos[13], 10)) return false

  return true
}

/**
 * Valida CPF ou CNPJ baseado no comprimento.
 * Retorna { valido: boolean, tipo: 'cpf' | 'cnpj' | null, erro?: string }.
 */
export function validarCpfCnpj(valor: string): {
  valido: boolean
  tipo: 'cpf' | 'cnpj' | null
  erro?: string
} {
  const digitos = apenasDigitos(valor)

  if (digitos.length === 0) {
    return { valido: false, tipo: null, erro: 'Documento obrigatório' }
  }

  if (digitos.length === 11) {
    return validarCpf(digitos)
      ? { valido: true, tipo: 'cpf' }
      : { valido: false, tipo: 'cpf', erro: 'CPF inválido' }
  }

  if (digitos.length === 14) {
    return validarCnpj(digitos)
      ? { valido: true, tipo: 'cnpj' }
      : { valido: false, tipo: 'cnpj', erro: 'CNPJ inválido' }
  }

  return {
    valido: false,
    tipo: null,
    erro: 'Documento deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ)',
  }
}
