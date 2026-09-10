import { createClient } from '@supabase/supabase-js'
import { NextResponse, after } from 'next/server'
import { normalizarWhatsApp } from '@/app/lib/phone'
import { legadoDasPecas, pecaValida } from '@/app/lib/pecas'
import { enviarMensagem } from '@/app/lib/zapi'
import { emailBoasVindasFornecedor } from '@/app/lib/email'
import { validarCpfCnpj, apenasDigitos } from '@/app/lib/cpf-cnpj'
import { matchingRetroativo } from '@/app/lib/orfaos'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const {
    nome,
    whatsapp,
    email,
    pecas: pecasRecebidas,
    pecas_outro,
    tipos_produto,
    descricao_livre,
    pedido_minimo,
    estado,
    cidade,
    raio_atendimento,
    cpf_cnpj,
  } = await req.json()

  const numero = normalizarWhatsApp(whatsapp)

  // O cadastro passou a mandar PEÇAS (app/lib/pecas.ts). `tipos_produto` é
  // derivado delas e continua gravado: é por ele que o matching antigo enxerga
  // este fornecedor enquanto a migração dos 41 cadastros não termina.
  const pecas = Array.isArray(pecasRecebidas) ? pecasRecebidas.filter(pecaValida) : []
  const tiposDerivados = pecas.length > 0 ? legadoDasPecas(pecas) : tipos_produto

  // Validação do CPF/CNPJ — obrigatório a partir desta migração.
  // Fornecedores existentes pré-migração podem ter cpf_cnpj = NULL no banco
  // (via edição de cadastro sem campo novo), mas TODO novo cadastro precisa.
  const cpfCnpjLimpo = apenasDigitos(cpf_cnpj || '')
  const validacao = validarCpfCnpj(cpfCnpjLimpo)
  if (!validacao.valido) {
    return NextResponse.json(
      { error: validacao.erro ?? 'CPF/CNPJ inválido' },
      { status: 400 }
    )
  }

  // O trial Pro de 90 dias SAIU daqui em 26/08/2026.
  //
  // O plano Pro foi encerrado em 25/08 (a monetização passou a ser % no
  // orçamento) e a mensagem de aprovação parou de prometê-lo — mas o cadastro
  // continuava gravando `plano_expira_em`. Consequência: 90 dias depois,
  // `planoEfetivo()` rebaixava o fornecedor pra 'free' (3 pedidos/mês, contra
  // 30) e o cron mandava uma mensagem oferecendo planos pagos que não
  // existem. Ver `api/cron/scheduler` (tarefa 5, desligada).
  //
  // Sem gravar nada, o DEFAULT da coluna vale: `plano = 'pro'` e
  // `plano_expira_em = NULL` — sem prazo, sem rebaixamento, sem mensagem.

  const payload = {
    nome,
    whatsapp: numero,
    email,
    pecas,
    // Texto livre, guardado como veio: é o material bruto pra saber que peça
    // falta no catálogo. Normalizar aqui perderia a palavra que a confecção
    // usou, que é justamente o dado.
    pecas_outro:
      typeof pecas_outro === 'string' && pecas_outro.trim()
        ? pecas_outro.trim().slice(0, 300)
        : null,
    tipos_produto: tiposDerivados,
    descricao_livre: descricao_livre || null,
    pedido_minimo,
    estado,
    cidade: cidade || null,
    raio_atendimento,
    cpf_cnpj: cpfCnpjLimpo,
    status: 'ativo',
    etapa_bot: null,
  }

  const { data: existente } = await supabase
    .from('leads_fornecedores')
    .select('id')
    .eq('whatsapp', numero)
    .maybeSingle()

  let fornecedorId: string

  if (existente) {
    // Edição de cadastro: NÃO mexe em plano/trial pra não resetar
    fornecedorId = (existente as { id: string }).id
    const { error } = await supabase
      .from('leads_fornecedores')
      .update(payload)
      .eq('whatsapp', numero)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Novo cadastro. `plano` e `plano_expira_em` NÃO são gravados: os DEFAULTs
    // da coluna dão 'pro' sem prazo. `plano_ativado_em` continua porque é a
    // âncora da janela de contagem de ofertas (`contarOfertasMesAtual`), não
    // um marcador de trial.
    const { data: novo, error } = await supabase
      .from('leads_fornecedores')
      .insert({
        ...payload,
        aprovacao_status: 'pendente',
        plano_ativado_em: new Date().toISOString(),
        creditos_extras: 0,
      })
      .select('id')
      .single()
    if (error || !novo) {
      return NextResponse.json(
        { error: error?.message ?? 'Erro ao inserir' },
        { status: 500 }
      )
    }
    fornecedorId = (novo as { id: string }).id
  }

  // Edição de cadastro (fornecedor já existente e já aprovado no passado):
  // mantém o comportamento antigo — dispara matching retroativo e confirma.
  // Cadastro NOVO entra como PENDENTE: não recebe pedidos até a equipe
  // aprovar o perfil (gate em matching.ts / fornecedores-compativeis).
  if (existente) {
    after(async () => {
      try {
        const resultado = await matchingRetroativo(fornecedorId)
        console.log(
          `[cadastro-callback] fornecedor=${fornecedorId} ` +
            `ofertasDisparadas=${resultado.ofertasDisparadas} ` +
            `orfaosComOfertaAtiva=${resultado.orfaosComOfertaAtiva.length}`
        )
      } catch (err) {
        console.error(
          `[cadastro-callback] matchingRetroativo falhou pra ${fornecedorId}:`,
          err
        )
      }
    })
  } else {
    // Cadastro novo — avisa que o perfil está em análise (não promete bônus
    // nem pedidos ainda; isso vem quando a equipe aprovar no admin).
    await enviarMensagem(
      numero,
      `Olá ${nome}! 🙌\n\nRecebemos seu cadastro no *Confeccione*.\n\n🔎 *Seu perfil está em análise.* Nossa equipe revisa cada fornecedor antes de liberar o acesso aos pedidos — isso garante a qualidade da nossa rede.\n\nAssim que aprovarmos (normalmente em até 1 dia útil), você recebe um aviso aqui e já começa a receber pedidos compatíveis com a sua produção. 🚀`
    )
    if (email) {
      try {
        await emailBoasVindasFornecedor({ email, nome })
      } catch (err) {
        console.error('email boas-vindas falhou:', err)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
