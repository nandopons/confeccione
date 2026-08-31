'use client'

// app/components/pdf/OrcamentoPDF.tsx
// ============================================================================
// Documento PDF do orçamento avulso (@react-pdf/renderer, client-side).
//
// Uso: alimentar com o registro retornado por POST /api/admin/orcamentos e
// renderizar via PDFDownloadLink importado com next/dynamic { ssr: false }.
//
// Logo Confeccione: não existe PNG no repo — a marca é desenhada aqui em SVG
// (mesmos paths do SiteHeader, stroke escuro pra fundo branco) + wordmark.
// Logo Porto Digital: public/porto-digital/porto-digital-cor-bg-claro.png.
// ============================================================================

import {
  Document,
  Page,
  View,
  Text,
  Image,
  Link,
  Svg,
  Path,
  Circle,
  StyleSheet,
} from '@react-pdf/renderer'
import { EMPRESA } from '@/app/lib/empresa'

export type ItemOrcamento = {
  tipo: 'produto' | 'servico'
  descricao: string
  quantidade: number
  valor_unitario_centavos: number
  subtotal_centavos: number
}

export type OrcamentoPDFDados = {
  id: string
  numero: string
  cliente_nome: string | null
  cliente_documento: string | null
  cliente_email?: string | null
  cep?: string | null
  logradouro?: string | null
  endereco_numero?: string | null
  endereco_complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  itens: ItemOrcamento[]
  frete_centavos: number
  subtotal_centavos: number
  total_centavos: number
  observacoes: string | null
  data_orcamento: string // YYYY-MM-DD
  validade: string | null // YYYY-MM-DD
  // Cobrança ASAAS (opcionais — presentes quando gerada junto com o orçamento)
  asaas_invoice_url?: string | null
  pix_copia_cola?: string | null
  pix_qr_imagem?: string | null // PNG base64, sem prefixo data:
  cobranca_vencimento?: string | null // YYYY-MM-DD
}

/** Espelha DESCONTO_PIX_PERCENTUAL de orcamento-cobranca.ts (não importar —
 *  aquele módulo puxa env server-side e este componente roda no browser). */
const DESCONTO_PAGAMENTO_PERCENTUAL = 3

function brl(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

/** YYYY-MM-DD → DD/MM/YYYY sem pegadinha de timezone. */
function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

function cepBR(digitos: string): string {
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos
}

/** Monta a linha de entrega com as partes que existirem. */
function linhaEntrega(o: OrcamentoPDFDados): string | null {
  const rua = o.logradouro
    ? `${o.logradouro}${o.endereco_numero ? `, ${o.endereco_numero}` : ''}${o.endereco_complemento ? ` — ${o.endereco_complemento}` : ''}`
    : null
  const cidadeUf = o.cidade ? `${o.cidade}${o.uf ? `/${o.uf}` : ''}` : null
  const partes = [rua, o.bairro, cidadeUf, o.cep ? `CEP ${cepBR(o.cep)}` : null].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}

const VERDE = '#1D9E75'
const ESCURO = '#111111'

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 64,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: ESCURO,
  },
  cabecalho: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  marca: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 3,
  },
  logoPorto: { height: 30, width: 96, objectFit: 'contain' },
  empresa: {
    borderBottomWidth: 1,
    borderBottomColor: '#DDDDDD',
    paddingBottom: 10,
    marginBottom: 18,
  },
  empresaLinha: { fontSize: 8.5, color: '#555555', marginTop: 1.5 },
  titulo: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  meta: { fontSize: 9.5, color: '#333333', marginTop: 1.5 },
  tabela: { marginTop: 16, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 3 },
  linhaCab: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#DDDDDD',
  },
  linha: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  celCab: { fontFamily: 'Helvetica-Bold', fontSize: 9, padding: 6 },
  cel: { fontSize: 9.5, padding: 6 },
  colTipo: { width: '13%' },
  colDesc: { width: '43%' },
  colQtd: { width: '10%', textAlign: 'right' },
  colUnit: { width: '17%', textAlign: 'right' },
  colSub: { width: '17%', textAlign: 'right' },
  totais: { marginTop: 10, alignItems: 'flex-end' },
  totaisLinha: { flexDirection: 'row', marginTop: 3 },
  totaisRotulo: { width: 110, textAlign: 'right', color: '#555555', fontSize: 9.5 },
  totaisValor: { width: 100, textAlign: 'right', fontSize: 9.5 },
  totalDestaque: {
    flexDirection: 'row',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: ESCURO,
  },
  totalRotulo: {
    width: 110,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  totalValor: {
    width: 100,
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: VERDE,
  },
  obsTitulo: { marginTop: 18, fontFamily: 'Helvetica-Bold', fontSize: 10 },
  obsTexto: { marginTop: 4, fontSize: 9.5, color: '#333333', lineHeight: 1.5 },
  pagamento: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 3,
    padding: 10,
  },
  pagTitulo: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  pagLinhas: { flex: 1, marginLeft: 12 },
  pagQr: { width: 92, height: 92 },
  pagDestaque: { fontSize: 9.5, marginTop: 2 },
  pagValorPix: { fontFamily: 'Helvetica-Bold', color: VERDE },
  pagRotulo: { fontSize: 8, color: '#555555', marginTop: 6 },
  pagCopiaCola: { fontSize: 6.5, color: '#555555', marginTop: 2, lineHeight: 1.4 },
  pagLink: { fontSize: 8.5, color: '#555555', marginTop: 6, textDecoration: 'underline' },
  pagBotaoCopiar: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
    backgroundColor: VERDE,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 8,
    textDecoration: 'none',
    alignSelf: 'flex-start',
  },
  rodape: {
    position: 'absolute',
    bottom: 28,
    left: 48,
    right: 48,
    borderTopWidth: 1,
    borderTopColor: '#DDDDDD',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rodapeTexto: { fontSize: 8.5, color: '#555555' },
})

/** Marca da Confeccione (mesmos arcos do SiteHeader, em escuro). */
function MarcaConfeccione() {
  return (
    <Svg width={30} height={30} viewBox="0 0 60 60">
      <Path d="M30 6 A24 24 0 0 1 54 30" stroke={ESCURO} strokeWidth={10} strokeLinecap="round" />
      <Path d="M54 30 A24 24 0 0 1 30 54" stroke={ESCURO} strokeWidth={10} strokeLinecap="round" opacity={0.5} />
      <Path d="M30 54 A24 24 0 0 1 6 30" stroke={ESCURO} strokeWidth={10} strokeLinecap="round" opacity={0.75} />
      <Path d="M6 30 A24 24 0 0 1 30 6" stroke={ESCURO} strokeWidth={10} strokeLinecap="round" opacity={0.35} />
      <Circle cx={30} cy={30} r={5} fill={ESCURO} />
    </Svg>
  )
}

const TIPO_ROTULO: Record<ItemOrcamento['tipo'], string> = {
  produto: 'Produto',
  servico: 'Serviço',
}

export function OrcamentoPDF({ orcamento }: { orcamento: OrcamentoPDFDados }) {
  return (
    <Document
      title={`Orçamento ${orcamento.numero} — ${EMPRESA.nome}`}
      author={EMPRESA.nome}
    >
      <Page size="A4" style={s.page}>
        {/* Cabeçalho: marca à esquerda, Porto Digital à direita */}
        <View style={s.cabecalho}>
          <View style={s.marca}>
            <MarcaConfeccione />
            <Text style={s.wordmark}>CONFECCIONE</Text>
          </View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do react-pdf não tem alt */}
          <Image style={s.logoPorto} src="/porto-digital/porto-digital-cor-bg-claro.png" />
        </View>

        {/* Dados da empresa */}
        <View style={s.empresa}>
          <Text style={s.empresaLinha}>CNPJ {EMPRESA.cnpj}</Text>
          <Text style={s.empresaLinha}>
            {EMPRESA.site} · {EMPRESA.email}
          </Text>
        </View>

        {/* Bloco do orçamento */}
        <Text style={s.titulo}>Orçamento nº {orcamento.numero}</Text>
        <Text style={s.meta}>Data: {dataBR(orcamento.data_orcamento)}</Text>
        {orcamento.validade ? (
          <Text style={s.meta}>Válido até: {dataBR(orcamento.validade)}</Text>
        ) : null}
        {orcamento.cliente_nome ? (
          <Text style={s.meta}>
            Cliente: {orcamento.cliente_nome}
            {orcamento.cliente_documento ? ` — ${orcamento.cliente_documento}` : ''}
            {orcamento.cliente_email ? ` — ${orcamento.cliente_email}` : ''}
          </Text>
        ) : null}
        {linhaEntrega(orcamento) ? (
          <Text style={s.meta}>Entrega: {linhaEntrega(orcamento)}</Text>
        ) : null}

        {/* Tabela de itens */}
        <View style={s.tabela}>
          <View style={s.linhaCab}>
            <Text style={[s.celCab, s.colTipo]}>Tipo</Text>
            <Text style={[s.celCab, s.colDesc]}>Descrição</Text>
            <Text style={[s.celCab, s.colQtd]}>Qtd</Text>
            <Text style={[s.celCab, s.colUnit]}>Valor unit.</Text>
            <Text style={[s.celCab, s.colSub]}>Subtotal</Text>
          </View>
          {orcamento.itens.map((item, i) => (
            <View key={i} style={[s.linha, i === orcamento.itens.length - 1 ? { borderBottomWidth: 0 } : {}]}>
              <Text style={[s.cel, s.colTipo]}>{TIPO_ROTULO[item.tipo]}</Text>
              <Text style={[s.cel, s.colDesc]}>{item.descricao}</Text>
              <Text style={[s.cel, s.colQtd]}>{item.quantidade.toLocaleString('pt-BR')}</Text>
              <Text style={[s.cel, s.colUnit]}>{brl(item.valor_unitario_centavos)}</Text>
              <Text style={[s.cel, s.colSub]}>{brl(item.subtotal_centavos)}</Text>
            </View>
          ))}
        </View>

        {/* Totais */}
        <View style={s.totais}>
          <View style={s.totaisLinha}>
            <Text style={s.totaisRotulo}>Subtotal</Text>
            <Text style={s.totaisValor}>{brl(orcamento.subtotal_centavos)}</Text>
          </View>
          <View style={s.totaisLinha}>
            <Text style={s.totaisRotulo}>Frete</Text>
            <Text style={s.totaisValor}>{brl(orcamento.frete_centavos)}</Text>
          </View>
          <View style={s.totalDestaque}>
            <Text style={s.totalRotulo}>Total</Text>
            <Text style={s.totalValor}>{brl(orcamento.total_centavos)}</Text>
          </View>
        </View>

        {/* Observações */}
        {orcamento.observacoes ? (
          <>
            <Text style={s.obsTitulo}>Observações</Text>
            <Text style={s.obsTexto}>{orcamento.observacoes}</Text>
          </>
        ) : null}

        {/* Pagamento (cobrança ASAAS gerada junto com o orçamento) */}
        {orcamento.pix_qr_imagem || orcamento.asaas_invoice_url ? (
          <View style={s.pagamento} wrap={false}>
            <Text style={s.pagTitulo}>Pagamento</Text>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              {orcamento.pix_qr_imagem ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- Image do react-pdf não tem alt
                <Image
                  style={s.pagQr}
                  src={`data:image/png;base64,${orcamento.pix_qr_imagem}`}
                />
              ) : null}
              <View style={s.pagLinhas}>
                <Text style={s.pagDestaque}>
                  No PIX
                  {orcamento.cobranca_vencimento
                    ? ` até ${dataBR(orcamento.cobranca_vencimento)}`
                    : ''}
                  :{' '}
                  <Text style={s.pagValorPix}>
                    {brl(
                      Math.round(
                        orcamento.total_centavos * (1 - DESCONTO_PAGAMENTO_PERCENTUAL / 100)
                      )
                    )}
                  </Text>{' '}
                  ({DESCONTO_PAGAMENTO_PERCENTUAL}% de desconto)
                </Text>
                <Link style={s.pagBotaoCopiar} src={`https://${EMPRESA.site}/orcamento/${orcamento.id}/pix`}>
                  Copiar código PIX com 1 clique
                </Link>
                {orcamento.pix_copia_cola ? (
                  <>
                    <Text style={s.pagRotulo}>Ou use o PIX copia e cola:</Text>
                    <Text style={s.pagCopiaCola}>{orcamento.pix_copia_cola}</Text>
                  </>
                ) : null}
                {orcamento.asaas_invoice_url ? (
                  <Link style={s.pagLink} src={orcamento.asaas_invoice_url}>
                    Ver fatura no Asaas
                  </Link>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {/* Rodapé fixo */}
        <View style={s.rodape} fixed>
          <Text style={s.rodapeTexto}>{EMPRESA.selo}</Text>
          <Text style={s.rodapeTexto}>{EMPRESA.site}</Text>
        </View>
      </Page>
    </Document>
  )
}
