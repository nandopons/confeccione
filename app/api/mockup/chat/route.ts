// app/api/mockup/chat/route.ts
// ============================================================================
// POST /api/mockup/chat — o Claude é o "operador" do estúdio de mockup.
// Conversa em pt-BR e devolve AÇÕES (ops) pra aplicar no preview: trocar peça,
// vista (frente/costas/lateral), cor da logo, remover fundo, posição (zona) e
// tamanho. Stateless; contrato JSON; parse defensivo.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MOCKUPS, CATEGORIAS } from "@/app/lib/mockups";

export const runtime = "nodejs";

const MODELO = "claude-sonnet-4-6";
const MAX_TOKENS = 700;
const TEMPERATURE = 0.4;
const MAX_MENSAGENS = 30;

const PECA_IDS = new Set(MOCKUPS.map((m) => m.id));

const MensagemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
const EstadoSchema = z
  .object({
    pecaId: z.string().nullable().optional(),
    vista: z.string().nullable().optional(),
    corLogo: z.string().nullable().optional(),
    removerFundo: z.boolean().nullable().optional(),
    posicao: z.string().nullable().optional(),
    tamanho: z.number().nullable().optional(),
    temLogo: z.boolean().optional(),
  })
  .partial();
const BodySchema = z.object({
  messages: z.array(MensagemSchema),
  estado: EstadoSchema.optional(),
});

const OpsSchema = z
  .object({
    pecaId: z.string().nullable().catch(null),
    vista: z.enum(["frente", "costas", "lateral"]).nullable().catch(null),
    corLogo: z.enum(["original", "preto", "branco"]).nullable().catch(null),
    removerFundo: z.boolean().nullable().catch(null),
    posicao: z
      .enum(["peito_esquerdo", "peito_centro", "costas_centro", "centro"])
      .nullable()
      .catch(null),
    tamanho: z
      .preprocess((v) => {
        if (v === null || v === undefined || v === "") return null;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      }, z.number().nullable())
      .catch(null),
  })
  .catch({ pecaId: null, vista: null, corLogo: null, removerFundo: null, posicao: null, tamanho: null });

const RespostaModeloSchema = z.object({
  mensagem: z.string().min(1),
  ops: OpsSchema.default({
    pecaId: null, vista: null, corLogo: null, removerFundo: null, posicao: null, tamanho: null,
  }),
});

// Catálogo resumido pro modelo
const CATALOGO = MOCKUPS.map((m) => {
  const cat = CATEGORIAS.find((c) => c.id === m.categoria)?.nome ?? m.categoria;
  const vistas = Object.entries(m.vistas)
    .map(([v, info]) => `${v} [zonas: ${Object.keys(info!.zonas).join(", ")}]`)
    .join("; ");
  return `- ${m.nome} (id: ${m.id}, categoria: ${cat}) — vistas: ${vistas}`;
}).join("\n");

const SYSTEM_PROMPT = `Você é o operador do estúdio "Monte seu mockup" da Confeccione. O cliente já tem um preview onde a logo dele é aplicada num mockup de peça. Você conduz tudo pela conversa: trocar a peça, mudar a vista (frente/costas/lateral), a cor da logo, remover o fundo da arte, a posição e o tamanho.

Fale em português do Brasil, caloroso e objetivo, uma coisa por vez. Quando o cliente pedir algo, devolva as AÇÕES correspondentes em "ops" (só os campos que mudam; o resto null). Convenções importantes:
- "peito" / "peito esquerdo" = posicao "peito_esquerdo" (peito esquerdo de quem veste). "peito centro"/"no meio" = "peito_centro". Nas costas, "costas_centro". Em peças sem peito, "centro".
- Se a logo estiver clara demais ou escura demais pra peça, sugira corLogo "preto" ou "branco". 
- Se a arte tiver fundo, mantenha removerFundo true (padrão).
- "tamanho" é fração de 0.3 a 1.3 (1.0 = cheio na zona).
- Só use ids/vistas/zonas que existem no catálogo abaixo. Se faltar a logo, lembre o cliente de anexar.
- O cliente pode ARRASTAR a logo livremente na prévia (qualquer lugar: manga, nuca, barra, bolso). Se ele pedir um ponto sem zona específica, NÃO recuse: posicione na zona mais próxima (ex.: "centro" ou "costas_centro") e diga, de forma simpática, que ele pode arrastar a arte na prévia pra deixar exatamente nesse ponto.

Catálogo disponível:
${CATALOGO}

A cada resposta devolva SOMENTE um JSON válido (sem markdown, sem cercas) neste formato exato:
{"mensagem": string, "ops": {"pecaId": string|null, "vista": "frente"|"costas"|"lateral"|null, "corLogo": "original"|"preto"|"branco"|null, "removerFundo": boolean|null, "posicao": "peito_esquerdo"|"peito_centro"|"costas_centro"|"centro"|null, "tamanho": number|null}}`;

function extrairJson(bruto: string): string {
  let s = bruto.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const i = s.indexOf("{"), f = s.lastIndexOf("}");
  if (i !== -1 && f !== -1 && f > i) s = s.slice(i, f + 1);
  return s;
}
function textoDaResposta(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// valida ops contra o catálogo (peça/vista/zona coerentes)
function validarOps(ops: z.infer<typeof OpsSchema>) {
  const out = { ...ops };
  if (out.pecaId && !PECA_IDS.has(out.pecaId)) out.pecaId = null;
  if (out.tamanho != null) out.tamanho = Math.min(1.3, Math.max(0.3, out.tamanho));
  return out;
}

export async function POST(req: Request) {
  let bruto: unknown;
  try { bruto = await req.json(); } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const body = BodySchema.safeParse(bruto);
  if (!body.success) {
    return NextResponse.json({ error: "Formato esperado: { messages, estado? }" }, { status: 400 });
  }
  const { messages, estado } = body.data;
  if (messages.length > MAX_MENSAGENS) {
    return NextResponse.json({ error: `Histórico longo demais (máx. ${MAX_MENSAGENS}).` }, { status: 400 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Serviço de chat indisponível." }, { status: 500 });
  }

  const ctx = `Estado atual do preview: ${JSON.stringify(estado ?? {})}.`;

  let texto: string;
  try {
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: ctx },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    texto = textoDaResposta(r.content);
  } catch (err) {
    console.error("[mockup/chat] modelo:", err);
    return NextResponse.json({ error: "Não consegui responder agora." }, { status: 502 });
  }

  let parsed: z.infer<typeof RespostaModeloSchema> | null = null;
  try {
    const r = RespostaModeloSchema.safeParse(JSON.parse(extrairJson(texto)));
    if (r.success) parsed = r.data;
  } catch { parsed = null; }

  if (!parsed) {
    return NextResponse.json({
      mensagem: "Pode me dizer de novo como você quer o mockup? (peça, vista, posição da logo, cor…)",
      ops: { pecaId: null, vista: null, corLogo: null, removerFundo: null, posicao: null, tamanho: null },
    });
  }

  return NextResponse.json({ mensagem: parsed.mensagem, ops: validarOps(parsed.ops) });
}
