#!/usr/bin/env bash
# scripts/ship.sh — a regra do tsc virou comando.
#
# POR QUE ISTO EXISTE — 12/09/2026.
#
# A regra "tsc limpo antes de commitar" morava no AGENTS.md, e por isso era
# quebrável. Em 12/09 ela foi quebrada do jeito mais bobo: `tsc && eslint &&
# git commit && git push` numa linha só. O commit aconteceu ANTES de alguém ler
# a saída do tsc, o build da Vercel falhou, e produção só não serviu código
# quebrado porque o deploy não promove build que falha. Sorte do pipeline, não
# cuidado de quem digitou.
#
# É o tema do projeto inteiro aplicado a quem escreve: efeito se trava DENTRO da
# ferramenta, nunca só no prompt. Agora juntar as etapas numa linha é o
# comportamento CORRETO, porque a linha é esta.
#
# Uso:  npm run ship -- "mensagem do commit em uma linha"
#       npm run ship -- "mensagem" --no-push     (commita local, não empurra)
set -euo pipefail

MENSAGEM="${1:-}"
if [ -z "$MENSAGEM" ]; then
  echo "✗ falta a mensagem: npm run ship -- \"o que mudou em uma linha\"" >&2
  exit 1
fi
case "$MENSAGEM" in
  *$'\n'*) echo "✗ mensagem em UMA linha (multi-linha já criou arquivo fantasma aqui)" >&2; exit 1 ;;
  *'->'*)  echo "✗ sem '->' na mensagem (ver AGENTS.md)" >&2; exit 1 ;;
esac

if git diff --quiet && git diff --cached --quiet; then
  echo "✗ nada pra commitar" >&2
  exit 1
fi

echo "→ tsc"
# Os erros em .next/**/validator.ts são cache de build de páginas deletadas, não
# são código nosso. Zero FORA de .next é o que conta (AGENTS.md).
SAIDA_TSC="$(npx tsc --noEmit 2>&1 | grep -v '^\.next/' || true)"
if [ -n "$SAIDA_TSC" ]; then
  echo "$SAIDA_TSC" >&2
  echo "✗ tsc falhou — nada foi commitado" >&2
  exit 1
fi
echo "  ok"

echo "→ eslint (arquivos alterados)"
ALVOS="$(git diff --name-only HEAD -- '*.ts' '*.tsx' | tr '\n' ' ')"
if [ -n "${ALVOS// /}" ]; then
  # shellcheck disable=SC2086
  if ! npx eslint $ALVOS; then
    echo "✗ eslint falhou — nada foi commitado" >&2
    exit 1
  fi
fi
echo "  ok"

echo "→ commit"
git add -A
git commit -q -m "$MENSAGEM"

if [ "${2:-}" = "--no-push" ]; then
  echo "✓ commitado local (--no-push). $(git log --oneline -1)"
  exit 0
fi

echo "→ push"
git push -q origin "$(git rev-parse --abbrev-ref HEAD)"
echo "✓ $(git log --oneline -1)"
