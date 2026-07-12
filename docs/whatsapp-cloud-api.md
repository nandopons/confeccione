# WhatsApp oficial (Meta Cloud API) — configuração

Chat de atendimento em `/admin/whatsapp`, cobrança direta na Meta (sem BSP).
Este guia cobre a fase de **desenvolvimento com número de teste** e depois a
**migração pro número oficial**.

## Fase 1 — número de teste (sem tocar no número real)

### 1. Criar o app na Meta
1. [developers.facebook.com](https://developers.facebook.com) → **Meus apps** → **Criar app**
2. Tipo **Business** → vincular ao portfólio **Instex** (ID 1231541731505546)
3. No painel do app → **Adicionar produto** → **WhatsApp** → **Configurar**
4. Na configuração, em vez de usar a WABA de teste sugerida, escolha
   **Criar nova conta do WhatsApp Business** → nome **Confeccione**
   (ou use a de teste da Meta por enquanto — qualquer uma funciona pra dev)

### 2. Pegar as credenciais (aba *API Setup* do produto WhatsApp)
| O que | Onde | Env var |
|---|---|---|
| Token temporário (24h) ou permanente | topo da API Setup | `WHATSAPP_TOKEN` |
| Phone number ID | seletor "From" | `WHATSAPP_PHONE_NUMBER_ID` |
| WABA ID | logo abaixo do Phone number ID | `WHATSAPP_WABA_ID` |
| App secret | App Settings → Basic → App Secret | `WHATSAPP_APP_SECRET` |
| Verify token | **você inventa** (string aleatória longa) | `WHATSAPP_VERIFY_TOKEN` |

Pra parar de renovar token a cada 24h: **Business Manager → Usuários do
sistema → Criar system user (admin)** → gerar token com
`whatsapp_business_messaging` + `whatsapp_business_management` → esse token
não expira.

### 3. Env vars
Adicionar em `.env.local` e na Vercel (Production + Preview):
```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_WABA_ID=...
WHATSAPP_APP_SECRET=...
WHATSAPP_VERIFY_TOKEN=...
```

### 4. Configurar o webhook
1. No app → **WhatsApp → Configuration → Webhook**
2. Callback URL: `https://confeccione.com.br/api/whatsapp/webhook`
   (ou a URL do preview do Vercel durante o teste)
3. Verify token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
4. **Verify and save** (a Meta faz um GET — precisa do deploy no ar)
5. Em **Webhook fields**, assinar **messages** (só esse)

### 5. Testar
1. Na API Setup, adicione seu celular na lista **To** (recebe código por WhatsApp)
2. Envie a mensagem de teste da Meta pro seu celular
3. **Responda** a mensagem no seu WhatsApp
4. Abra `/admin/whatsapp` → a conversa aparece; responda de lá; mande foto,
   áudio e documento pra validar mídia nos dois sentidos

## Fase 2 — número oficial

> ⚠️ Registrar o número na Cloud API **desliga ele do app WhatsApp** do
> celular. O atendimento passa a ser 100% pelo `/admin/whatsapp`.
> Só fazer quando o inbox estiver validado na Fase 1.

1. **Pagamento:** WhatsApp Manager → conta Confeccione → **Configurações de
   pagamento** → adicionar cartão (é aqui que nasce a cobrança direta na Meta)
2. No celular: backup se quiser → **Configurações → Conta → Apagar conta**
3. No app Meta → WhatsApp → API Setup → **Add phone number**: número oficial,
   display name **Confeccione**, verificação por SMS/ligação
4. Trocar `WHATSAPP_PHONE_NUMBER_ID` (e `WHATSAPP_WABA_ID` se mudou) na Vercel
5. Redeploy → mandar mensagem de um celular qualquer pro número → conferir no inbox

## Regras de negócio (resumo)

- **Janela de 24h:** abre/renova a cada mensagem recebida do contato. Dentro
  dela, texto/mídia livres (conversa de serviço — **grátis**). Fora, só
  **template aprovado** (o inbox já troca o composer automaticamente).
- **Templates:** criar em WhatsApp Manager → Templates. Categoria *utility*
  pra notificações de pedido (~R$0,03/msg) e *marketing* pra promoções
  (~R$0,31/msg). Aprovação típica: minutos a poucas horas.
- **Limite de envio inicial:** 250–1.000 destinatários únicos/24h em conversas
  iniciadas pela empresa; sobe automático com qualidade (empresa já verificada).
  Receber/responder não tem limite.

## Arquitetura

```
Cliente (WhatsApp) ⇄ Meta Cloud API
        ⇅ webhook                    ⇅ envio (Graph API)
POST /api/whatsapp/webhook      app/lib/whatsapp-cloud.ts
        ⇅                            ⇅
   Supabase: wa_contatos / wa_conversas / wa_mensagens
   Storage: bucket privado wa-midia (signed URLs 1h)
        ⇅ polling (5s lista / 3s thread)
   /admin/whatsapp (WhatsAppInbox.tsx)
```

- Mídia recebida é baixada na hora (URL da Meta expira ~5min) e persistida no
  bucket `wa-midia`.
- Status enviado→entregue→lido chega pelo mesmo webhook (statuses) e atualiza
  os ✓✓ do inbox via `wamid`.
- Contatos são vinculados automaticamente a `contas_clientes` /
  `leads_fornecedores` pelos últimos 8 dígitos do número.
- Envio programático (notificações do sistema): importar de
  `app/lib/whatsapp-cloud.ts` (`enviarTexto`, `enviarTemplate`) — mesma infra
  do inbox. Migração do Z-API pode ser gradual, função a função.
- **Retomada de pedido (marketing)**: template `retomar_pedido_v3` com botão
  de URL dinâmica `visualizador/{{1}}` — cada cliente cai direto no PRÓPRIO
  pedido. Criação one-shot: `POST /api/admin/whatsapp/criar-templates-retomada`
  (logado como admin). Envio: pelo inbox (o backend injeta o pedido do contato
  automaticamente) ou via `enviarTemplateRetomadaPedido()` (nutrição do painel
  de marketing e botão Lembrete usam essa função).

## Fase 3 (futuro, não implementado)
- Gravação de áudio pelo microfone no composer (MediaRecorder)
- Realtime via Supabase Realtime no lugar do polling
- Respostas rápidas / atalhos por contexto de pedido
- Vincular conversa a um pedido específico na UI
