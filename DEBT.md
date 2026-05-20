# Débito técnico — Confeccione

Registro de débitos e decisões adiadas. Cada item diz **o que**, **por que importa** e **como revisitar**.

---

## 🔴 DESTAQUE — Over-share de artes per-conta entre fornecedores (decisão de PRODUTO)

**Descoberto em:** Sprint "UX pós-aceite" (Item 2), 2026-05-20.
**Não é trivial — é decisão de produto, não só refactor.**

### O quê
O repositório de arquivos do cliente (`arquivos_cliente`) é **por conta**, não por pedido — não existe vínculo `pedido_id` no schema. A página pública de artes (`/artes/[token]`) serve `listarArquivos(conta_id)`, ou seja, **o repositório inteiro da conta**.

Cada compartilhamento (`compartilhamentos_artes`) é por pedido + por fornecedor, com token aleatório de 24 bytes (validade 7d). O token isola o **link** (fornecedor A nunca obtém o token do B), mas **não** isola o **conteúdo**: abrir qualquer token mostra todas as artes da conta.

### Por que importa
Todo fornecedor que algum dia recebeu um link de compartilhamento de um cliente consegue ver **todas** as artes daquele cliente — inclusive artes enviadas pensando em outro pedido / outro fornecedor. Hoje isso já acontece via o link do WhatsApp (feature da Sprint 3). O botão "Ver artes compartilhadas" do painel (Item 2) **não cria nem agrava** isso — apenas surfaça o mesmo link que o fornecedor já tem.

### A pergunta de produto a decidir
**As artes devem ser escopadas por pedido, ou seguir como repositório por conta (compartilhado entre os fornecedores do cliente)?**

- Se **por pedido**: muda schema (vincular `arquivos_cliente` a pedido, ou tabela de associação), o fluxo de upload, a rota `compartilhar-artes` e a página pública `/artes/[token]`. **É sprint própria** — não cabe num item pequeno de UX.
- Se **repositório por conta** (como hoje): documentar como comportamento intencional ("biblioteca de marca do cliente, compartilhada com seus fornecedores") e, idealmente, deixar isso explícito na UI do cliente ao compartilhar.

### Como revisitar
Decisão de produto do Fernando, **fora desta sprint**. Não tocar sem essa decisão.

---
