// app/lib/captacao-templates.ts
//
// Fonte ÚNICA dos textos de captação de fornecedores.
// Adicionar um segmento novo = uma linha em SEGMENTOS_CAPTACAO.
// Os ids batem com `tipos_produto` em leads_fornecedores e com o
// formulário do cliente (app/page.tsx / NovoPedidoForm.tsx).

export const URL_CADASTRO_FORNECEDOR =
  'https://confeccione.com.br/fornecedor/cadastro'

// Cadência: dias após o convite em que cada follow-up dispara.
// etapa 0 = convite (dia 0); etapa 1 = +5; etapa 2 = +12; etapa 3 = +21.
export const CADENCIA_DIAS = [0, 5, 12, 21] as const
export const TOTAL_ETAPAS = CADENCIA_DIAS.length - 1 // 3 follow-ups

type Segmento = {
  id: string // bate com tipos_produto
  nome: string // como aparece no texto ("moda praia")
  exemplos: string // peças entre parênteses
}

// Os 10 segmentos existentes no banco/formulário.
export const SEGMENTOS_CAPTACAO: Segmento[] = [
  { id: 'moda_praia', nome: 'moda praia', exemplos: 'biquíni, maiô, sunga, saída de praia' },
  { id: 'private_label', nome: 'private label', exemplos: 'peças com a marca e a etiqueta do cliente' },
  { id: 'fitness', nome: 'fitness', exemplos: 'top, legging, short de academia' },
  { id: 'interclasse', nome: 'interclasse e eventos', exemplos: 'camisas e uniformes de turma e evento' },
  { id: 'moda_intima', nome: 'moda íntima', exemplos: 'lingerie, pijama, sleepwear' },
  { id: 'fardamento', nome: 'fardamento', exemplos: 'uniforme escolar, fardamento corporativo' },
  { id: 'padrao_esportivo', nome: 'padrão esportivo', exemplos: 'camisa de time, uniforme esportivo' },
  { id: 'roupas_uv', nome: 'roupas UV', exemplos: 'proteção solar, roupa para esporte ao ar livre' },
  { id: 'bolsas', nome: 'bolsas', exemplos: 'bolsas, mochilas, ecobags' },
  { id: 'bones', nome: 'bonés', exemplos: 'bonés, viseiras' },
]

export function getSegmento(id: string): Segmento | undefined {
  return SEGMENTOS_CAPTACAO.find((s) => s.id === id)
}

// ---------- E-MAIL ----------

export function assuntoCaptacao(etapa: number, segmentoId: string): string {
  const seg = getSegmento(segmentoId)
  const nome = seg?.nome ?? 'confecção'
  switch (etapa) {
    case 0:
      return `Tem pedidos de ${nome} procurando fornecedor`
    case 1:
      return `Os pedidos de ${nome} continuam chegando`
    case 2:
      return `Como funciona a Confeccione pra você fornecedor`
    case 3:
      return `Último contato`
    default:
      return `Confeccione`
  }
}

export function corpoEmailCaptacao(etapa: number, segmentoId: string): string {
  const seg = getSegmento(segmentoId)
  const nome = seg?.nome ?? 'confecção'
  const ex = seg ? ` — ${seg.exemplos} — ` : ' '
  const link = URL_CADASTRO_FORNECEDOR

  switch (etapa) {
    case 0:
      return `Olá!

Temos recebido pedidos de fabricação de ${nome}${ex}de clientes procurando uma confecção desse segmento.

Vários se encaixam com o tipo de produção que vocês fazem. Pra gente encaminhar esses pedidos, basta deixar seu contato no nosso site:

${link}

Equipe Confeccione
confeccione.com.br`

    case 1:
      return `Olá!

Semana passada comentamos sobre os pedidos de ${nome} que chegam pra gente. Eles continuam vindo, e ainda não temos fornecedor desse segmento pra encaminhar na sua região.

Se tiver interesse em recebê-los, é rápido deixar seu contato:

${link}

Equipe Confeccione`

    case 2:
      return `Olá!

Pra deixar claro: a Confeccione não cobra nada pra você receber os pedidos. A gente conecta o cliente que procura ${nome} direto com fornecedores como você — você só recebe oportunidades que combinam com o que produz.

Sem mensalidade pra começar, sem compromisso. Se quiser entrar pra fila de quem recebe esses pedidos:

${link}

Equipe Confeccione`

    case 3:
      return `Olá!

Esse é nosso último e-mail sobre os pedidos de ${nome} — não queremos incomodar.

Se em algum momento fizer sentido receber esses pedidos, a porta fica aberta:

${link}

Obrigado!
Equipe Confeccione`

    default:
      return ''
  }
}

// ---------- WHATSAPP ----------

export function mensagemWhatsappCaptacao(etapa: number, segmentoId: string): string {
  const seg = getSegmento(segmentoId)
  const nome = seg?.nome ?? 'confecção'
  const ex = seg ? ` (${seg.exemplos})` : ''
  const link = URL_CADASTRO_FORNECEDOR

  switch (etapa) {
    case 0:
      return `Olá! Aqui é da Confeccione.

Temos recebido pedidos de fabricação de ${nome}${ex} que se encaixam com a produção de vocês.

Pra encaminhar esses pedidos, é só deixar seu contato aqui: ${link}`

    case 1:
      return `Olá! Da Confeccione.

Os pedidos de ${nome} continuam chegando e ainda buscamos fornecedor na região pra encaminhar. Se quiser receber, é só deixar seu contato: ${link}`

    case 2:
      return `Olá! Da Confeccione.

Só reforçando: receber os pedidos de ${nome} não tem custo nenhum pra você. A gente conecta o cliente direto com quem produz. Quer entrar na fila? ${link}`

    case 3:
      return `Olá! Último contato da Confeccione.

Se quiser receber os pedidos de ${nome} algum dia, é só deixar seu contato aqui: ${link}. Obrigado!`

    default:
      return ''
  }
}
