'use client'

// app/admin/(painel)/orcamentos/BaixarOrcamentoPDF.tsx
// ============================================================================
// Botão de download do PDF do orçamento. Importa @react-pdf/renderer
// diretamente — por isso este componente SÓ pode ser carregado via
// next/dynamic com { ssr: false } (o renderer não roda no server).
// ============================================================================

import { PDFDownloadLink } from '@react-pdf/renderer'
import { OrcamentoPDF, type OrcamentoPDFDados } from '@/app/components/pdf/OrcamentoPDF'

export default function BaixarOrcamentoPDF({ orcamento }: { orcamento: OrcamentoPDFDados }) {
  return (
    <PDFDownloadLink
      document={<OrcamentoPDF orcamento={orcamento} />}
      fileName={`orcamento-${orcamento.numero}.pdf`}
      className="inline-flex items-center gap-2 bg-[#1D9E75] hover:bg-[#188a65] text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors"
    >
      {({ loading }) => (loading ? 'Gerando PDF…' : 'Baixar PDF')}
    </PDFDownloadLink>
  )
}
