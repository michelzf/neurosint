#!/usr/bin/env bash
# check-pii.sh — varredura anti-PII para o Neurosint.
#
# Bloqueia o commit/CI se encontrar padrões óbvios de dado pessoal nos arquivos
# RASTREADOS pelo git (não toca nos dados ignorados pelo .gitignore). É uma rede
# de segurança — NÃO substitui revisão humana nem o gitleaks (que pega segredos).
#
# Padrões cobertos (ajuste à sua realidade):
#   - CPF                  ###.###.###-##
#   - Telefone BR          55 + DDD + 9 dígitos (ex.: 5511987654321)
#   - WhatsApp group JID    ...@g.us  /  número@s.whatsapp.net
#   - Chave privada PEM     BEGIN ... PRIVATE KEY
#
# Uso:  bash tools/check-pii.sh
set -euo pipefail

# Arquivos rastreados pelo git (respeita o .gitignore). Fallback: árvore atual.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t FILES < <(git ls-files)
else
  mapfile -t FILES < <(find . -type f -not -path './.git/*')
fi

# Não varrer o próprio scanner nem docs que explicam os padrões.
PATTERNS=(
  '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'      # CPF
  '55[0-9]{2}9[0-9]{8}'                         # telefone BR (55 DDD 9########)
  '[0-9]{15,}@g\.us'                            # WhatsApp group JID
  '[0-9]{10,}@s\.whatsapp\.net'                 # WhatsApp user JID
  'BEGIN [A-Z ]*PRIVATE KEY'                    # chave privada
)

# Linhas que casam um destes são PLACEHOLDERS (não PII real) e são ignoradas:
#   - 8+ zeros seguidos (ex.: 000000000000000000@g.us, 550000000000000@s.whatsapp.net)
#   - marcadores de exemplo
ALLOW='0{8,}|[Ee]xample|[Ee]xemplo|placeholder|changeme|XXXX'

FOUND=0
for f in "${FILES[@]}"; do
  case "$f" in
    tools/check-pii.sh|*.gitleaks.toml) continue ;;
  esac
  [ -f "$f" ] || continue
  for p in "${PATTERNS[@]}"; do
    # casa o padrão de PII, mas remove as linhas que são placeholders óbvios
    matches=$(grep -nE "$p" "$f" 2>/dev/null | grep -vE "$ALLOW" || true)
    if [ -n "$matches" ]; then
      echo "❌ Possível PII em: $f"
      echo "$matches" | sed 's/^/     /'
      FOUND=1
    fi
  done
done

if [ "$FOUND" -ne 0 ]; then
  echo ""
  echo "Varredura anti-PII FALHOU. Remova o dado pessoal antes de commitar."
  echo "Se for um falso positivo (ex.: número fictício de exemplo), ajuste o padrão"
  echo "ou mova o conteúdo para fora dos arquivos rastreados."
  exit 1
fi

echo "✅ Varredura anti-PII: nada encontrado nos arquivos rastreados."
