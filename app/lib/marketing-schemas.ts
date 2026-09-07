// app/lib/marketing-schemas.ts
// Schemas zod compartilhados entre as rotas de marketing. Ficam aqui (e não
// num route.ts) porque arquivo de rota do Next só aceita exportar handlers e
// as opções de segmento — qualquer export extra quebra o build.

import { z } from 'zod'

export const CANAL_TEMPLATE = z.enum(['email', 'whatsapp', 'mala_direta'])
export const FORMATO_PECA = z.enum(['panfleto', 'catalogo', 'carta', 'cartao_postal', 'brinde'])
export const GATILHO = z.enum(['lead_novo', 'pedido_parado', 'pos_compra', 'lead_frio'])

export const TEMPLATE_PARAMS = z.object({
  corpo: z.array(z.string().max(300)).max(5),
  botaoUrl: z.string().max(300).optional(),
})

const camposTemplate = {
  descricao: z.string().trim().max(300).nullish(),
  assunto: z.string().trim().max(150).nullish(),
  corpo: z.string().max(5000),
  templateMeta: z.string().trim().max(80).nullish(),
  templateParams: TEMPLATE_PARAMS.optional(),
  usaTemplateOficial: z.boolean().optional(),
  formato: FORMATO_PECA.nullish(),
  arteUrl: z.string().trim().max(500).nullish(),
  pesoGramas: z.number().int().min(0).max(100000).nullish(),
  dimensoes: z.string().trim().max(60).nullish(),
  custoUnitarioCentavos: z.number().int().min(0).max(1_000_000).nullish(),
  tags: z.array(z.string().trim().max(30)).max(10).optional(),
  status: z.enum(['rascunho', 'ativo', 'arquivado']).optional(),
}

export const TemplateNovoSchema = z.object({
  nome: z.string().trim().min(3).max(80),
  canal: CANAL_TEMPLATE,
  ...camposTemplate,
  corpo: camposTemplate.corpo.default(''),
})

export const TemplatePatchSchema = z.object({
  nome: z.string().trim().min(3).max(80).optional(),
  ...camposTemplate,
  corpo: camposTemplate.corpo.optional(),
})

export const PUBLICO_SCHEMA = z
  .object({
    busca: z.string().trim().max(120).optional(),
    uf: z.string().trim().max(2).optional(),
    origem: z.enum(['todas', 'chat', 'conta', 'manual', 'importacao']).optional(),
    status: z.enum(['todos', 'lead', 'cliente', 'descadastrado']).optional(),
    tag: z.string().trim().max(30).optional(),
    canal: z.enum(['todos', 'whatsapp', 'email', 'endereco']).optional(),
  })
  .default({})

export const AutomacaoSchema = z.object({
  nome: z.string().trim().min(3).max(80),
  descricao: z.string().trim().max(300).nullish(),
  gatilho: GATILHO,
  gatilhoDias: z.number().int().min(0).max(365),
  publico: PUBLICO_SCHEMA,
  maxToques: z.number().int().min(1).max(10),
  horaInicio: z.number().int().min(0).max(23).optional(),
  horaFim: z.number().int().min(1).max(24).optional(),
  status: z.enum(['rascunho', 'ativa', 'pausada']).optional(),
  passos: z
    .array(
      z.object({
        esperaDias: z.number().int().min(0).max(365),
        templateId: z.string().uuid().nullable(),
        ativo: z.boolean().optional(),
      })
    )
    .max(8),
})
