// app/lib/captacao.ts
//
// Orquestração da captação: envia UM toque (convite ou follow-up) de um
// contato, respeitando os canais ligados. Reusa enviarMensagem (zapi.ts) e
// emailCaptacaoFornecedor (email.ts). Todo o estado fica em
// captacao_fornecedores (etapa, status, ultimo_envio_em, ultimo_erro) — sem
// tabela de log separada.

import { supabaseAdmin } from '@/app/lib/supabase-server'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailCaptacaoFornecedor } from '@/app/lib/email'
import {
  assuntoCaptacao,
  corpoEmailCaptacao,
  mensagemWhatsappCaptacao,
  CADENCIA_DIAS,
  TOTAL_ETAPAS,
} from '@/app/lib/captacao-templates'

type ContatoCaptacao = {
  id: string
  nome: string | null
  email: string | null
  whatsapp: string | null
  segmento: string
  etapa: number
  canal_email: boolean
  canal_whatsapp: boolean
}

// Dispara o toque da etapa atual. Retorna se ao menos um canal teve sucesso.
export async function dispararToqueCaptacao(
  contato: ContatoCaptacao,
): Promise<{
  enviouAlgo: boolean
  emailOk: boolean | null
  whatsappOk: boolean | null
}> {
  const { etapa, segmento } = contato
  let emailOk: boolean | null = null
  let whatsappOk: boolean | null = null

  // E-MAIL — await obrigatório (serverless mata o processo no return)
  if (contato.canal_email && contato.email) {
    emailOk = await emailCaptacaoFornecedor({
      para: contato.email,
      assunto: assuntoCaptacao(etapa, segmento),
      corpo: corpoEmailCaptacao(etapa, segmento),
    })
  }

  // WHATSAPP — await obrigatório
  if (contato.canal_whatsapp && contato.whatsapp) {
    whatsappOk = await enviarMensagem(
      contato.whatsapp,
      mensagemWhatsappCaptacao(etapa, segmento),
    )
  }

  const enviouAlgo = emailOk === true || whatsappOk === true
  return { enviouAlgo, emailOk, whatsappOk }
}

// Calcula o próximo agendamento após enviar a etapa atual.
// Se acabaram os follow-ups, retorna null (status vira 'esgotado').
export function proximoAgendamento(etapaAtual: number): {
  proximaEtapa: number
  proximoEnvioEm: string | null
} {
  const proximaEtapa = etapaAtual + 1
  if (proximaEtapa > TOTAL_ETAPAS) {
    return { proximaEtapa, proximoEnvioEm: null }
  }
  // dias ENTRE a etapa atual e a próxima
  const diasAteProxima = CADENCIA_DIAS[proximaEtapa] - CADENCIA_DIAS[etapaAtual]
  const d = new Date()
  d.setDate(d.getDate() + diasAteProxima)
  return { proximaEtapa, proximoEnvioEm: d.toISOString() }
}

// Verifica se o contato já se cadastrou (virou lead_fornecedor) por e-mail OU
// whatsapp. Comparação simples (sem normalização de número).
export async function jaConverteu(
  email: string | null,
  whatsapp: string | null,
): Promise<boolean> {
  if (!email && !whatsapp) return false

  if (email) {
    const { data } = await supabaseAdmin
      .from('leads_fornecedores')
      .select('id')
      .ilike('email', email)
      .limit(1)
    if (data && data.length > 0) return true
  }
  if (whatsapp) {
    const { data } = await supabaseAdmin
      .from('leads_fornecedores')
      .select('id')
      .eq('whatsapp', whatsapp)
      .limit(1)
    if (data && data.length > 0) return true
  }
  return false
}
