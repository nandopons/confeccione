// app/lib/cep.ts
// ============================================================================
// Resolução de endereço por CEP com fallback: ViaCEP -> BrasilAPI.
// CEPs "únicos" de cidades pequenas muitas vezes não existem no ViaCEP, mas a
// BrasilAPI resolve cidade/UF (sem rua — nesses casos o cliente informa a rua).
// ============================================================================

export type EnderecoCep = {
  logradouro: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
}

async function viaCep(digs: string): Promise<EnderecoCep | null> {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${digs}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
    if (j.erro) return null
    return {
      logradouro: j.logradouro?.trim() || null,
      bairro: j.bairro?.trim() || null,
      cidade: j.localidade?.trim() || null,
      uf: j.uf?.trim() || null,
    }
  } catch {
    return null
  }
}

async function brasilApi(digs: string): Promise<EnderecoCep | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${digs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { street?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null }
    if (!j.city && !j.street) return null
    return {
      logradouro: j.street?.trim() || null,
      bairro: j.neighborhood?.trim() || null,
      cidade: j.city?.trim() || null,
      uf: j.state?.trim() || null,
    }
  } catch {
    return null
  }
}

/** Busca o endereço de um CEP (8 dígitos). Retorna null se não encontrado. */
export async function buscarEnderecoCep(cep: string | null | undefined): Promise<EnderecoCep | null> {
  if (!cep) return null
  const digs = cep.replace(/\D/g, '')
  if (digs.length !== 8) return null
  return (await viaCep(digs)) ?? (await brasilApi(digs))
}
