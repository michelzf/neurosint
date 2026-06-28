#!/usr/bin/env bash
# deploy-server.sh — publica o Neurosint num projeto Supabase hospedado.
# Pré: projeto criado (recomendado sa-east-1 / São Paulo por LGPD) e Supabase CLI logado.
# Uso:  PROJECT_REF=<ref> bash tools/deploy-server.sh
set -euo pipefail
export DO_NOT_TRACK=1
: "${PROJECT_REF:?defina PROJECT_REF=<ref-do-projeto-supabase>}"
ENV_FILE="${ENV_FILE:-supabase/functions/.env.server}"

if [ ! -f "$ENV_FILE" ]; then
  echo "!! Falta $ENV_FILE. Copie supabase/functions/.env.example e preencha o Preset C (server)." >&2
  exit 1
fi

echo "==> link $PROJECT_REF";        supabase link --project-ref "$PROJECT_REF"
echo "==> db push (migrations)";     supabase db push
echo "==> secrets set";              supabase secrets set --env-file "$ENV_FILE"
echo "==> deploy functions";         supabase functions deploy ask; supabase functions deploy health

echo ""
echo "Deploy concluído. Smoke (health é público):"
echo "  curl https://$PROJECT_REF.supabase.co/functions/v1/health"
